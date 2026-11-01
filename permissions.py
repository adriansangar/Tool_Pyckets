"""Roles por proyecto y validaciones compartidas por los routers."""
from fastapi import HTTPException
from sqlmodel import Session, select
from typing import Optional

from models import Ticket, User, Epic, ProjectMember, ProjectRole, Column
from auth import (
    check_project_permission,
)

READ_ROLES = [ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER, ProjectRole.VIEWER]
WRITE_ROLES = [ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER]


def get_ticket_or_404(session: Session, ticket_id: int) -> Ticket:
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    return ticket


def authorize_ticket(ticket: Ticket, user: User, session: Session, roles: list) -> None:
    """Comprueba que el usuario tiene alguno de los roles en el proyecto del ticket."""
    if ticket.project_id is None:
        if user.is_superuser or (ticket.reporter and ticket.reporter == user.username):
            return
        raise HTTPException(status_code=403, detail="No tienes permisos sobre este ticket")
    check_project_permission(ticket.project_id, user, session, roles)


def valid_status_ids(session: Session) -> set:
    return {c.name.strip().lower().replace(" ", "_") for c in session.exec(select(Column)).all()}


def validate_status(session: Session, value: str) -> str:
    normalized = str(value or "").strip().lower().replace(" ", "_")
    allowed = valid_status_ids(session)
    if allowed and normalized not in allowed:
        raise HTTPException(status_code=400, detail=f"Estado no válido: {value}")
    return normalized


ADMIN_ROLES = [ProjectRole.OWNER, ProjectRole.ADMIN]

def require_superuser(user: User) -> None:
    """Acciones reservadas al admin general."""
    if not user.is_superuser:
        raise HTTPException(status_code=403, detail="Solo un administrador general puede hacer esto")

def project_role(project_id: int, user: User, session: Session) -> Optional[ProjectRole]:
    if user.is_superuser:
        return ProjectRole.OWNER
    member = session.exec(
        select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == user.id)
    ).first()
    return member.role if member else None

def is_project_admin(project_id: int, user: User, session: Session) -> bool:
    return project_role(project_id, user, session) in ADMIN_ROLES

def authorize_ticket_edit(ticket: Ticket, user: User, session: Session) -> None:
    """Admins del proyecto editan cualquier ticket; un miembro solo los asignados a él
    (o los suyos sin asignar); un viewer no edita."""
    if ticket.project_id is None:
        if user.is_superuser or (ticket.reporter and ticket.reporter == user.username):
            return
        raise HTTPException(status_code=403, detail="No tienes permisos sobre este ticket")
    role = project_role(ticket.project_id, user, session)
    if role in ADMIN_ROLES:
        return
    if role == ProjectRole.MEMBER and (
        ticket.assignee == user.username or (not ticket.assignee and ticket.reporter == user.username)
    ):
        return
    if role is None:
        raise HTTPException(status_code=403, detail="No tienes permisos suficientes en este proyecto")
    raise HTTPException(status_code=403, detail="Solo puedes modificar los tickets que tienes asignados")

def validate_epic(session: Session, project_id: Optional[int], epic_name: Optional[str]) -> Optional[str]:
    name = (epic_name or "").strip()
    if not name:
        return None
    if project_id is None:
        raise HTTPException(status_code=400, detail="Un ticket sin proyecto no puede tener épica")
    exists = session.exec(select(Epic).where(Epic.project_id == project_id, Epic.name == name)).first()
    if not exists:
        raise HTTPException(status_code=400, detail=f"La épica '{name}' no existe en este proyecto")
    return name
