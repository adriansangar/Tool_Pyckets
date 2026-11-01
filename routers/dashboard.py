"""Endpoints: dashboards (home, proyecto y trabajo personal)."""
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from models import Project, User
from database import get_session
from auth import get_current_user_from_token
from permissions import project_role
from schemas import ProjectCard, ProjectDashboard, MyWork
from services import dashboard as svc

router = APIRouter()

@router.get("/api/dashboard", response_model=List[ProjectCard])
def get_home_dashboard(
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    """Una tarjeta por proyecto accesible (no archivado) con su progreso."""
    return svc.home_cards(session, current_user)

@router.get("/api/projects/{project_id}/dashboard", response_model=ProjectDashboard)
def get_project_dashboard(
    project_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    role = project_role(project_id, current_user, session)
    if role is None:
        raise HTTPException(status_code=403, detail="No tienes permisos suficientes en este proyecto")
    return svc.project_dashboard(session, project, role, current_user)

@router.get("/api/me/work", response_model=MyWork)
def get_my_work(
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    """Mis tickets abiertos, agrupados por proyecto (vencidos primero)."""
    return svc.my_work(session, current_user)
