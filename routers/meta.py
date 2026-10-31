"""Endpoints: meta."""
from typing import List
from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from models import (
    Epic, Column, User,
)
from database import get_session
from auth import (
    get_current_user_from_token,
)

router = APIRouter()

@router.get("/api/columns", response_model=List[Column])
def get_columns(current_user: User = Depends(get_current_user_from_token), session: Session = Depends(get_session)):
    return session.exec(select(Column).order_by(Column.order)).all()


@router.get("/api/epics", response_model=List[Epic])
def get_epics(current_user: User = Depends(get_current_user_from_token), session: Session = Depends(get_session)):
    return session.exec(select(Epic)).all()
