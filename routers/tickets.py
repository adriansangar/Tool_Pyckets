"""Endpoints: tickets."""
import os
import uuid
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlmodel import Session, select

from models import (
    Ticket, User, ProjectMember, TicketComment, ChecklistItem, TicketHistory,
)
from database import get_session
from auth import (
    get_current_user_from_token, check_project_permission,
)
from config import UPLOAD_DIR, MAX_UPLOAD_BYTES, ALLOWED_IMAGE_EXT
from permissions import READ_ROLES, WRITE_ROLES, get_ticket_or_404, authorize_ticket, validate_status
from schemas import (
    StatusUpdate, TicketUpdate, BulkStatusUpdate, ChecklistCreate, ChecklistUpdate,
)
from services.tickets import plain, log_ticket_change

router = APIRouter()

_NOT_NULLABLE = {"title", "status", "priority", "ticket_type", "tags", "story_points", "time_logged"}


@router.get("/api/tickets", response_model=List[Ticket])
def get_tickets(
    project_id: Optional[int] = None,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    query = select(Ticket)
    if project_id:
        check_project_permission(project_id, current_user, session, READ_ROLES)
        query = query.where(Ticket.project_id == project_id)
    elif not current_user.is_superuser:
        member_projects = select(ProjectMember.project_id).where(ProjectMember.user_id == current_user.id)
        query = query.where(Ticket.project_id.in_(member_projects))
    return session.exec(query).all()


@router.post("/api/tickets")
def create_ticket(
    ticket: Ticket,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    if ticket.project_id is None:
        if not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Un ticket debe pertenecer a un proyecto")
    else:
        check_project_permission(ticket.project_id, current_user, session, WRITE_ROLES)
    if isinstance(ticket.due_date, str):
        ticket.due_date = datetime.strptime(ticket.due_date, "%Y-%m-%d").date() if ticket.due_date.strip() else None
    ticket.id = None
    ticket.status = validate_status(session, ticket.status or "todo")
    ticket.reporter = current_user.username
    ticket.created_at = ticket.updated_at = datetime.now(timezone.utc)
    session.add(ticket)
    session.commit()
    session.refresh(ticket)
    return ticket


@router.put("/api/tickets/{ticket_id}")
def update_full_ticket(
    ticket_id: int,
    ticket_update: TicketUpdate,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    db_ticket = get_ticket_or_404(session, ticket_id)
    authorize_ticket(db_ticket, current_user, session, WRITE_ROLES)

    changes = ticket_update.model_dump(exclude_unset=True)
    if "project_id" in changes and changes["project_id"] != db_ticket.project_id and changes["project_id"] is not None:
        check_project_permission(changes["project_id"], current_user, session, WRITE_ROLES)
    if "status" in changes and changes["status"] is not None:
        changes["status"] = validate_status(session, changes["status"])

    for field, new_value in changes.items():
        if new_value is None and field in _NOT_NULLABLE:
            continue
        old_value = getattr(db_ticket, field)
        if plain(old_value) != plain(new_value):
            log_ticket_change(session, db_ticket.id, current_user.username, field, old_value, new_value)
            setattr(db_ticket, field, new_value)

    db_ticket.updated_at = datetime.now(timezone.utc)
    session.add(db_ticket)
    session.commit()
    session.refresh(db_ticket)
    return db_ticket


@router.put("/api/tickets/{ticket_id}/status", response_model=Ticket)
def update_ticket_status(
    ticket_id: int,
    status_update: StatusUpdate,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    db_ticket = get_ticket_or_404(session, ticket_id)
    authorize_ticket(db_ticket, current_user, session, WRITE_ROLES)
    new_status = validate_status(session, status_update.status)
    log_ticket_change(session, db_ticket.id, current_user.username, "status", db_ticket.status, new_status)
    db_ticket.status = new_status
    db_ticket.updated_at = datetime.now(timezone.utc)
    session.add(db_ticket)
    session.commit()
    session.refresh(db_ticket)
    return db_ticket


@router.get("/api/tickets/{ticket_id}/comments", response_model=List[TicketComment])
def get_ticket_comments(
    ticket_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    authorize_ticket(get_ticket_or_404(session, ticket_id), current_user, session, READ_ROLES)
    return session.exec(
        select(TicketComment).where(TicketComment.ticket_id == ticket_id).order_by(TicketComment.created_at.asc())
    ).all()


@router.post("/api/tickets/{ticket_id}/comments", response_model=TicketComment)
def add_ticket_comment(
    ticket_id: int,
    content: str = Form(""),
    file: Optional[UploadFile] = File(None),
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    authorize_ticket(get_ticket_or_404(session, ticket_id), current_user, session, WRITE_ROLES)

    image_url = None
    if file and file.filename:
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in ALLOWED_IMAGE_EXT or not (file.content_type or "").startswith("image/"):
            raise HTTPException(status_code=400, detail="Solo se admiten imágenes (png, jpg, gif, webp)")
        filename = f"{uuid.uuid4().hex}{ext}"
        file_path = os.path.join(UPLOAD_DIR, filename)
        written = 0
        with open(file_path, "wb") as buffer:
            while chunk := file.file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    buffer.close()
                    os.remove(file_path)
                    raise HTTPException(status_code=413, detail="La imagen supera el límite de 5 MB")
                buffer.write(chunk)
        image_url = f"/static/uploads/{filename}"

    if not content.strip() and not image_url:
        raise HTTPException(status_code=400, detail="El comentario está vacío")

    comment = TicketComment(
        ticket_id=ticket_id,
        author_username=current_user.username,
        author_avatar=current_user.avatar or "🚀",
        content=content,
        image_url=image_url
    )
    session.add(comment)
    session.commit()
    session.refresh(comment)
    return comment


@router.post("/api/tickets/bulk-update")
def bulk_update_tickets(
    bulk: BulkStatusUpdate,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    tickets = session.exec(select(Ticket).where(Ticket.id.in_(bulk.ticket_ids))).all()
    for t in tickets:
        authorize_ticket(t, current_user, session, WRITE_ROLES)
    if bulk.status:
        bulk.status = validate_status(session, bulk.status)
    for t in tickets:
        if bulk.status:
            log_ticket_change(session, t.id, current_user.username, "status", t.status, bulk.status)
            t.status = bulk.status
        if bulk.assignee is not None:
            log_ticket_change(session, t.id, current_user.username, "assignee", t.assignee, bulk.assignee)
            t.assignee = bulk.assignee
        if bulk.priority:
            log_ticket_change(session, t.id, current_user.username, "priority", t.priority, bulk.priority)
            t.priority = bulk.priority
        t.updated_at = datetime.now(timezone.utc)
        session.add(t)
    session.commit()
    return {"message": f"{len(tickets)} tickets actualizados con éxito"}


@router.get("/api/tickets/{ticket_id}/subtasks", response_model=List[Ticket])
def get_subtasks(
    ticket_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    authorize_ticket(get_ticket_or_404(session, ticket_id), current_user, session, READ_ROLES)
    return session.exec(select(Ticket).where(Ticket.parent_id == ticket_id)).all()


def _get_item_and_authorize(item_id: int, user: User, session: Session, roles: list):
    item = session.get(ChecklistItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Elemento no encontrado")
    authorize_ticket(get_ticket_or_404(session, item.ticket_id), user, session, roles)
    return item


@router.get("/api/tickets/{ticket_id}/checklist", response_model=List[ChecklistItem])
def get_checklist(
    ticket_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    authorize_ticket(get_ticket_or_404(session, ticket_id), current_user, session, READ_ROLES)
    return session.exec(select(ChecklistItem).where(ChecklistItem.ticket_id == ticket_id).order_by(ChecklistItem.order.asc())).all()


@router.post("/api/tickets/{ticket_id}/checklist", response_model=ChecklistItem)
def add_checklist_item(
    ticket_id: int,
    item_in: ChecklistCreate,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    authorize_ticket(get_ticket_or_404(session, ticket_id), current_user, session, WRITE_ROLES)
    if not item_in.content.strip():
        raise HTTPException(status_code=400, detail="El elemento está vacío")
    position = len(session.exec(select(ChecklistItem).where(ChecklistItem.ticket_id == ticket_id)).all())
    item = ChecklistItem(ticket_id=ticket_id, content=item_in.content.strip(), order=position)
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@router.put("/api/checklist/{item_id}", response_model=ChecklistItem)
def update_checklist_item(
    item_id: int,
    item_in: ChecklistUpdate,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    item = _get_item_and_authorize(item_id, current_user, session, WRITE_ROLES)
    item.is_completed = item_in.is_completed
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@router.delete("/api/checklist/{item_id}")
def delete_checklist_item(
    item_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    item = _get_item_and_authorize(item_id, current_user, session, WRITE_ROLES)
    session.delete(item)
    session.commit()
    return {"message": "Elemento eliminado"}


@router.get("/api/tickets/{ticket_id}/history", response_model=List[TicketHistory])
def get_ticket_history(
    ticket_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    authorize_ticket(get_ticket_or_404(session, ticket_id), current_user, session, READ_ROLES)
    return session.exec(select(TicketHistory).where(TicketHistory.ticket_id == ticket_id).order_by(TicketHistory.changed_at.desc())).all()
