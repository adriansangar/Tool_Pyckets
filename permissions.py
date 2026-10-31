"""Roles por proyecto y validaciones compartidas por los routers."""
from fastapi import HTTPException
from sqlmodel import Session, select

from models import (
    Ticket, Column, User, ProjectRole,
)
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
