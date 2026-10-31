"""Lógica de dominio de tickets: auditoría de cambios."""
from typing import Any
from enum import Enum
from sqlmodel import Session

from models import (
    TicketHistory,
)

def plain(v):
    return v.value if isinstance(v, Enum) else v


def log_ticket_change(session: Session, ticket_id: int, author: str, field: str, old_val: Any, new_val: Any):
    old_val, new_val = plain(old_val), plain(new_val)
    if str(old_val) != str(new_val):
        session.add(TicketHistory(
            ticket_id=ticket_id,
            author_username=author,
            field_changed=field,
            old_value=str(old_val) if old_val is not None else None,
            new_value=str(new_val) if new_val is not None else None
        ))