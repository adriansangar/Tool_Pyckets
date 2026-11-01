"""Agregados para los dashboards: tarjetas de proyecto, resumen de proyecto y trabajo personal."""
from collections import defaultdict
from datetime import date
from typing import Dict, List, Optional, Tuple

from sqlmodel import Session, select

from models import Column, Epic, Project, ProjectMember, ProjectRole, Ticket, User
from permissions import ADMIN_ROLES
from schemas import (
    ColumnCount, EpicProgress, MyWork, ProjectCard, ProjectDashboard, ProjectOut,
    TicketBrief, WorkGroup, WorkloadItem,
)
from services.tickets import plain

PRIORITIES = ("urgent", "high", "medium", "low")
_PRIORITY_RANK = {p: i for i, p in enumerate(PRIORITIES)}


def status_id(name: str) -> str:
    return name.strip().lower().replace(" ", "_")


def done_status(session: Session) -> str:
    """El estado 'hecho' es el de la última columna del tablero."""
    last = session.exec(select(Column).order_by(Column.order.desc())).first()
    return status_id(last.name) if last else "done"


def _pct(done: int, total: int) -> int:
    return round(100 * done / total) if total else 0


def _is_overdue(t: Ticket, done: str, today: date) -> bool:
    return t.due_date is not None and t.due_date < today and t.status != done


def _brief(t: Ticket, done: str, today: date) -> TicketBrief:
    return TicketBrief(
        id=t.id, title=t.title, status=t.status, priority=str(plain(t.priority)).lower(),
        ticket_type=str(plain(t.ticket_type)).lower(), due_date=t.due_date, assignee=t.assignee,
        epic=t.epic, story_points=t.story_points or 0, project_id=t.project_id,
        overdue=_is_overdue(t, done, today),
    )


def _sort_key(b: TicketBrief):
    return (not b.overdue, _PRIORITY_RANK.get(b.priority, 9), b.due_date or date.max, b.id)


def accessible_projects(session: Session, user: User, include_archived: bool = False) -> List[Tuple[Project, ProjectRole]]:
    if user.is_superuser:
        projects = session.exec(select(Project)).all()
        result = [(p, ProjectRole.OWNER) for p in projects]
    else:
        rows = session.exec(
            select(Project, ProjectMember.role).join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(ProjectMember.user_id == user.id)
        ).all()
        result = [(p, r) for p, r in rows]
    if not include_archived:
        result = [(p, r) for p, r in result if not p.is_archived]
    return sorted(result, key=lambda pr: pr[0].name.lower())


def home_cards(session: Session, user: User, today: Optional[date] = None) -> List[ProjectCard]:
    today = today or date.today()
    done = done_status(session)
    pairs = accessible_projects(session, user)
    ids = [p.id for p, _ in pairs]
    if not ids:
        return []
    tickets_by_project: Dict[int, List[Ticket]] = defaultdict(list)
    for t in session.exec(select(Ticket).where(Ticket.project_id.in_(ids))).all():
        tickets_by_project[t.project_id].append(t)
    members: Dict[int, int] = defaultdict(int)
    for m in session.exec(select(ProjectMember).where(ProjectMember.project_id.in_(ids))).all():
        members[m.project_id] += 1
    epics: Dict[int, int] = defaultdict(int)
    for e in session.exec(select(Epic).where(Epic.project_id.in_(ids))).all():
        epics[e.project_id] += 1

    cards = []
    for p, role in pairs:
        ts = tickets_by_project.get(p.id, [])
        by_status: Dict[str, int] = defaultdict(int)
        for t in ts:
            by_status[t.status] += 1
        n_done = by_status.get(done, 0)
        cards.append(ProjectCard(
            id=p.id, name=p.name, color=p.color, icon=p.icon, my_role=role.value,
            total=len(ts), done=n_done, progress=_pct(n_done, len(ts)),
            overdue=sum(1 for t in ts if _is_overdue(t, done, today)),
            my_open=sum(1 for t in ts if t.assignee == user.username and t.status != done),
            epics=epics.get(p.id, 0), members=members.get(p.id, 0), by_status=dict(by_status),
        ))
    return cards


def project_dashboard(session: Session, project: Project, role: ProjectRole, user: User,
                      today: Optional[date] = None) -> ProjectDashboard:
    today = today or date.today()
    done = done_status(session)
    tickets = session.exec(select(Ticket).where(Ticket.project_id == project.id)).all()
    open_tickets = [t for t in tickets if t.status != done]

    columns = []
    for c in session.exec(select(Column).order_by(Column.order)).all():
        sid = status_id(c.name)
        columns.append(ColumnCount(status=sid, name=c.name, count=sum(1 for t in tickets if t.status == sid), is_done=sid == done))

    epic_rows = session.exec(select(Epic).where(Epic.project_id == project.id).order_by(Epic.name)).all()
    progress = []
    for e in epic_rows:
        ets = [t for t in tickets if t.epic == e.name]
        n_done = sum(1 for t in ets if t.status == done)
        progress.append(EpicProgress(
            id=e.id, name=e.name, color=e.color, description=e.description, total=len(ets), done=n_done,
            progress=_pct(n_done, len(ets)), overdue=sum(1 for t in ets if _is_overdue(t, done, today)),
            story_points=sum((t.story_points or 0) for t in ets),
        ))
    known = {e.name for e in epic_rows}
    loose = [t for t in tickets if not t.epic or t.epic not in known]
    loose_done = sum(1 for t in loose if t.status == done)
    no_epic = EpicProgress(id=None, name="Sin épica", color="#8d94a5", total=len(loose), done=loose_done,
                           progress=_pct(loose_done, len(loose)),
                           overdue=sum(1 for t in loose if _is_overdue(t, done, today)),
                           story_points=sum((t.story_points or 0) for t in loose))

    by_priority = {p: 0 for p in PRIORITIES}
    for t in open_tickets:
        by_priority[str(plain(t.priority)).lower()] = by_priority.get(str(plain(t.priority)).lower(), 0) + 1

    overdue = sorted((_brief(t, done, today) for t in tickets if _is_overdue(t, done, today)), key=lambda b: (b.due_date, b.id))[:10]

    workload = None
    if role in ADMIN_ROLES:   # el seguimiento del equipo es cosa de los admins
        buckets: Dict[Optional[str], WorkloadItem] = {}
        for t in open_tickets:
            item = buckets.setdefault(t.assignee or None, WorkloadItem(assignee=t.assignee or None))
            item.open += 1
            item.story_points += t.story_points or 0
            item.overdue += 1 if _is_overdue(t, done, today) else 0
        workload = sorted(buckets.values(), key=lambda w: (-w.open, w.assignee or ""))

    n_done = sum(1 for t in tickets if t.status == done)
    return ProjectDashboard(
        project=ProjectOut(**project.model_dump(), my_role=role.value),
        total=len(tickets), done=n_done, progress=_pct(n_done, len(tickets)),
        overdue_count=sum(1 for t in tickets if _is_overdue(t, done, today)),
        story_points_total=sum((t.story_points or 0) for t in tickets),
        story_points_done=sum((t.story_points or 0) for t in tickets if t.status == done),
        my_open=sum(1 for t in open_tickets if t.assignee == user.username),
        columns=columns, epics=progress, no_epic=no_epic, by_priority=by_priority,
        overdue=overdue, workload=workload,
    )


def my_work(session: Session, user: User, today: Optional[date] = None) -> MyWork:
    today = today or date.today()
    done = done_status(session)
    pairs = accessible_projects(session, user)
    projects = {p.id: p for p, _ in pairs}
    if not projects:
        return MyWork(groups=[], total_open=0, overdue=0)
    tickets = session.exec(
        select(Ticket).where(Ticket.project_id.in_(list(projects)), Ticket.assignee == user.username, Ticket.status != done)
    ).all()
    grouped: Dict[int, List[TicketBrief]] = defaultdict(list)
    for t in tickets:
        grouped[t.project_id].append(_brief(t, done, today))
    groups = []
    for pid, briefs in grouped.items():
        p = projects[pid]
        groups.append(WorkGroup(project_id=pid, project_name=p.name, project_color=p.color, tickets=sorted(briefs, key=_sort_key)))
    groups.sort(key=lambda g: (-sum(1 for t in g.tickets if t.overdue), g.project_name.lower()))
    return MyWork(groups=groups, total_open=len(tickets), overdue=sum(1 for g in groups for t in g.tickets if t.overdue))
