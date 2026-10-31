"""Endpoints: projects."""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Form
from sqlmodel import Session, select

from models import (
    Ticket, Project, User, ProjectMember, ProjectRole, Repository, CommitLink,
    PullRequestLink, TicketComment, ChecklistItem, TicketHistory,
)
from database import get_session
from auth import (
    get_current_user_from_token, check_project_permission,
)
from schemas import (
    ProjectCreate,
)

router = APIRouter()

@router.get("/api/projects", response_model=List[Project])
def get_projects(
    include_archived: bool = False, 
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    if current_user.is_superuser:
        query = select(Project)
    else:
        query = select(Project).join(ProjectMember).where(ProjectMember.user_id == current_user.id)
        
    projects = session.exec(query).all()
    if not include_archived:
        return [p for p in projects if not p.is_archived]
    return projects


@router.post("/api/projects", response_model=Project)
def create_project(
    project: ProjectCreate, 
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    db_project = Project(name=project.name, color=project.color, is_archived=False)
    session.add(db_project)
    session.commit()
    session.refresh(db_project)
    
    member = ProjectMember(project_id=db_project.id, user_id=current_user.id, role=ProjectRole.OWNER)
    session.add(member)
    session.commit()
    session.refresh(db_project)
    return db_project


@router.put("/api/projects/{project_id}/archive", response_model=Project)
def archive_project(
    project_id: int, 
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, [ProjectRole.OWNER, ProjectRole.ADMIN])
    db_project = session.get(Project, project_id)
    if not db_project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    db_project.is_archived = True
    session.add(db_project)
    session.commit()
    session.refresh(db_project)
    return db_project


@router.put("/api/projects/{project_id}/unarchive", response_model=Project)
def unarchive_project(
    project_id: int, 
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, [ProjectRole.OWNER, ProjectRole.ADMIN])
    db_project = session.get(Project, project_id)
    if not db_project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    db_project.is_archived = False
    session.add(db_project)
    session.commit()
    session.refresh(db_project)
    return db_project


@router.delete("/api/projects/{project_id}")
def delete_project(
    project_id: int, 
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, [ProjectRole.OWNER])
    db_project = session.get(Project, project_id)
    if not db_project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    
    for t in session.exec(select(Ticket).where(Ticket.project_id == project_id)).all():
        for model in (ChecklistItem, TicketHistory, TicketComment, CommitLink, PullRequestLink):
            for row in session.exec(select(model).where(model.ticket_id == t.id)).all():
                session.delete(row)
        session.delete(t)
    for r in session.exec(select(Repository).where(Repository.project_id == project_id)).all():
        session.delete(r)
    for m in session.exec(select(ProjectMember).where(ProjectMember.project_id == project_id)).all():
        session.delete(m)

    session.delete(db_project)
    session.commit()
    return {"message": "Proyecto eliminado"}


@router.get("/api/projects/{project_id}/members")
def get_project_members(
    project_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, [ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER, ProjectRole.VIEWER])
    members = session.exec(
        select(ProjectMember, User)
        .where(ProjectMember.project_id == project_id)
        .where(ProjectMember.user_id == User.id)
    ).all()
    
    return [
        {"id": pm.id, "user_id": u.id, "username": u.username, "email": u.email, "role": pm.role}
        for pm, u in members
    ]


@router.post("/api/projects/{project_id}/members")
def add_or_update_project_member(
    project_id: int,
    user_id: int = Form(...),
    role: ProjectRole = Form(ProjectRole.MEMBER),
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, [ProjectRole.OWNER, ProjectRole.ADMIN])
    target_user = session.get(User, user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    existing = session.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id
        )
    ).first()
    
    if existing:
        existing.role = role
        session.add(existing)
        session.commit()
        return {"id": existing.id, "user_id": target_user.id, "username": target_user.username, "role": existing.role}
    
    new_member = ProjectMember(project_id=project_id, user_id=user_id, role=role)
    session.add(new_member)
    session.commit()
    session.refresh(new_member)
    return {"id": new_member.id, "user_id": target_user.id, "username": target_user.username, "role": new_member.role}


@router.delete("/api/projects/{project_id}/members/{user_id}")
def remove_project_member(
    project_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, [ProjectRole.OWNER, ProjectRole.ADMIN])
    member = session.exec(
        select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Miembro no encontrado")
    session.delete(member)
    session.commit()
    return {"message": "Miembro eliminado"}
