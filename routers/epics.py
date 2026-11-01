"""Endpoints: épicas (por proyecto)."""
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from models import Epic, Ticket, User, ProjectMember
from database import get_session
from auth import get_current_user_from_token, check_project_permission
from permissions import READ_ROLES, ADMIN_ROLES
from services.dashboard import done_status
from schemas import EpicCreate, EpicUpdate, EpicOut

router = APIRouter()

def _epic_out(session: Session, epic: Epic) -> EpicOut:
    tickets = session.exec(
        select(Ticket).where(Ticket.project_id == epic.project_id, Ticket.epic == epic.name)
    ).all()
    return EpicOut(**epic.model_dump(), tickets_total=len(tickets),
                   tickets_done=sum(1 for t in tickets if t.status == done_status(session)))

def _name_taken(session: Session, project_id: int, name: str, exclude_id: int = None) -> bool:
    return any(
        e.name.lower() == name.lower() and e.id != exclude_id
        for e in session.exec(select(Epic).where(Epic.project_id == project_id)).all()
    )

@router.get("/api/projects/{project_id}/epics", response_model=List[EpicOut])
def list_project_epics(
    project_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, READ_ROLES)
    epics = session.exec(select(Epic).where(Epic.project_id == project_id).order_by(Epic.name)).all()
    return [_epic_out(session, e) for e in epics]

@router.post("/api/projects/{project_id}/epics", response_model=EpicOut)
def create_epic(
    project_id: int,
    epic_in: EpicCreate,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, ADMIN_ROLES)
    name = epic_in.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="La épica necesita un nombre")
    if _name_taken(session, project_id, name):
        raise HTTPException(status_code=409, detail="Ya existe una épica con ese nombre en el proyecto")
    epic = Epic(project_id=project_id, name=name, color=epic_in.color, description=epic_in.description)
    session.add(epic)
    session.commit()
    session.refresh(epic)
    return _epic_out(session, epic)

@router.put("/api/projects/{project_id}/epics/{epic_id}", response_model=EpicOut)
def update_epic(
    project_id: int,
    epic_id: int,
    epic_in: EpicUpdate,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, ADMIN_ROLES)
    epic = session.get(Epic, epic_id)
    if not epic or epic.project_id != project_id:
        raise HTTPException(status_code=404, detail="Épica no encontrada")
    changes = epic_in.model_dump(exclude_unset=True)
    old_name = epic.name
    if "name" in changes:
        new_name = (changes["name"] or "").strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="La épica necesita un nombre")
        if _name_taken(session, project_id, new_name, exclude_id=epic.id):
            raise HTTPException(status_code=409, detail="Ya existe una épica con ese nombre en el proyecto")
        changes["name"] = new_name
    for field, value in changes.items():
        setattr(epic, field, value)
    if epic.name != old_name:   # los tickets referencian la épica por nombre
        for t in session.exec(select(Ticket).where(Ticket.project_id == project_id, Ticket.epic == old_name)).all():
            t.epic = epic.name
            session.add(t)
    session.add(epic)
    session.commit()
    session.refresh(epic)
    return _epic_out(session, epic)

@router.delete("/api/projects/{project_id}/epics/{epic_id}")
def delete_epic(
    project_id: int,
    epic_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, ADMIN_ROLES)
    epic = session.get(Epic, epic_id)
    if not epic or epic.project_id != project_id:
        raise HTTPException(status_code=404, detail="Épica no encontrada")
    for t in session.exec(select(Ticket).where(Ticket.project_id == project_id, Ticket.epic == epic.name)).all():
        t.epic = None
        session.add(t)
    session.delete(epic)
    session.commit()
    return {"message": "Épica eliminada; sus tickets quedan sin épica"}

@router.get("/api/epics", response_model=List[EpicOut])
def list_accessible_epics(
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    """Compatibilidad: épicas de todos los proyectos a los que tienes acceso."""
    query = select(Epic)
    if not current_user.is_superuser:
        member_projects = select(ProjectMember.project_id).where(ProjectMember.user_id == current_user.id)
        query = query.where(Epic.project_id.in_(member_projects))
    return [_epic_out(session, e) for e in session.exec(query.order_by(Epic.project_id, Epic.name)).all()]
