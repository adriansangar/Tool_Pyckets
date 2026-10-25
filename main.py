from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Response, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import os
from fastapi import FastAPI, Depends, HTTPException, Response, status, UploadFile, File, Form

from models import (
    Ticket, Epic, Column, Project, User, ProjectMember, ProjectRole,
    Repository, CommitLink, PullRequestLink, TicketComment
)
from database import get_session, create_db_and_tables, engine
from auth import (
    get_password_hash, 
    verify_password, 
    create_access_token, 
    get_current_user_from_token, 
    check_project_permission
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    # Auto-sanación: Garantizar que el usuario inicial sea superusuario
    with Session(engine) as session:
        admin = session.exec(select(User).where(User.username == "adrian")).first()
        if admin and not admin.is_superuser:
            admin.is_superuser = True
            session.add(admin)
            session.commit()
    yield

app = FastAPI(title="Pyckets API", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def read_index():
    return FileResponse(os.path.join("static", "index.html"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- ESQUEMAS PYDANTIC ---
class ProjectCreate(BaseModel):
    name: str
    color: str = "#ff5630"

class StatusUpdate(BaseModel):
    status: str

class UserCreate(BaseModel):
    username: str
    email: str
    password: str

class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    avatar: str = "🚀"
    theme_preference: str = "dark"
    is_superuser: bool = False

class UserUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    avatar: Optional[str] = "🚀"
    theme_preference: Optional[str] = "dark"

class PasswordUpdate(BaseModel):
    current_password: str
    new_password: str

# --- ENDPOINTS DE PERFIL ---
@app.put("/api/auth/me", response_model=UserResponse)
def update_my_profile(
    profile_in: UserUpdate,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    current_user.first_name = profile_in.first_name
    current_user.last_name = profile_in.last_name
    if profile_in.avatar:
        current_user.avatar = profile_in.avatar
    if profile_in.theme_preference:
        current_user.theme_preference = profile_in.theme_preference
        
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user

@app.put("/api/auth/me/password")
def change_my_password(
    pwd_in: PasswordUpdate,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    if not verify_password(pwd_in.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="La contraseña actual es incorrecta")
        
    current_user.hashed_password = get_password_hash(pwd_in.new_password)
    session.add(current_user)
    session.commit()
    return {"message": "Contraseña actualizada correctamente"}

# --- ENDPOINTS DE AUTENTICACIÓN ---
@app.post("/api/auth/register", response_model=UserResponse)
def register(user_in: UserCreate, session: Session = Depends(get_session)):
    existing_user = session.exec(
        select(User).where((User.username == user_in.username) | (User.email == user_in.email))
    ).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="El usuario o email ya existe")
    
    user = User(
        username=user_in.username,
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password)
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user

@app.post("/api/auth/login")
def login(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: Session = Depends(get_session)
):
    user = session.exec(select(User).where(User.username == form_data.username)).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Credenciales incorrectas")
        
    token = create_access_token(data={"sub": user.username})
    response.set_cookie(key="pyckets_token", value=token, httponly=True, samesite="lax")
    return {"access_token": token, "token_type": "bearer"}

@app.get("/api/auth/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user_from_token)):
    return current_user

# --- ENDPOINTS COLUMNAS ---
@app.get("/api/columns", response_model=List[Column])
def get_columns(session: Session = Depends(get_session)):
    return session.exec(select(Column).order_by(Column.order)).all()

# --- ENDPOINTS PROYECTOS PROTEGIDOS ---
@app.get("/api/projects", response_model=List[Project])
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

@app.post("/api/projects", response_model=Project)
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
    
    return db_project

@app.put("/api/projects/{project_id}/archive", response_model=Project)
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

@app.put("/api/projects/{project_id}/unarchive", response_model=Project)
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

@app.delete("/api/projects/{project_id}")
def delete_project(
    project_id: int, 
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, [ProjectRole.OWNER])
    
    db_project = session.get(Project, project_id)
    if not db_project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    
    tickets = session.exec(select(Ticket).where(Ticket.project_id == project_id)).all()
    for t in tickets:
        session.delete(t)

    members = session.exec(select(ProjectMember).where(ProjectMember.project_id == project_id)).all()
    for m in members:
        session.delete(m)

    session.delete(db_project)
    session.commit()
    return {"message": "Proyecto eliminado"}

# --- ENDPOINTS TICKETS Y EPICS ---
@app.get("/api/epics", response_model=List[Epic])
def get_epics(session: Session = Depends(get_session)):
    return session.exec(select(Epic)).all()

@app.get("/api/tickets", response_model=List[Ticket])
def get_tickets(
    project_id: Optional[int] = None, 
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    query = select(Ticket)
    if project_id:
        query = query.where(Ticket.project_id == project_id)
    return session.exec(query).all()

@app.post("/api/tickets")
def create_ticket(
    ticket: Ticket, 
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    if isinstance(ticket.due_date, str) and ticket.due_date.strip():
        ticket.due_date = datetime.strptime(ticket.due_date, "%Y-%m-%d").date()
    session.add(ticket)
    session.commit()
    session.refresh(ticket)
    return ticket

@app.put("/api/tickets/{ticket_id}")
def update_full_ticket(
    ticket_id: int, 
    ticket_update: Ticket, 
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    db_ticket = session.get(Ticket, ticket_id)
    if not db_ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    
    db_ticket.title = ticket_update.title
    db_ticket.description = ticket_update.description
    db_ticket.status = ticket_update.status
    db_ticket.tags = ticket_update.tags
    db_ticket.project_id = ticket_update.project_id
    db_ticket.epic = ticket_update.epic
    db_ticket.assignee = ticket_update.assignee
    db_ticket.time_logged = ticket_update.time_logged
    
    if isinstance(ticket_update.due_date, str) and ticket_update.due_date.strip():
        db_ticket.due_date = datetime.strptime(ticket_update.due_date, "%Y-%m-%d").date()
    else:
        db_ticket.due_date = ticket_update.due_date
        
    session.add(db_ticket)
    session.commit()
    session.refresh(db_ticket)
    return db_ticket

@app.put("/api/tickets/{ticket_id}/status", response_model=Ticket)
def update_ticket_status(
    ticket_id: int, 
    status_update: StatusUpdate, 
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    db_ticket = session.get(Ticket, ticket_id)
    if not db_ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    db_ticket.status = status_update.status
    session.add(db_ticket)
    session.commit()
    session.refresh(db_ticket)
    return db_ticket

class ProjectMemberCreate(BaseModel):
    user_id: int
    role: ProjectRole = ProjectRole.MEMBER

class MemberResponse(BaseModel):
    id: int
    user_id: int
    username: str
    email: str
    role: ProjectRole

# --- GESTIÓN GLOBAL DE USUARIOS (SÓLO ADMIN) ---
@app.get("/api/users", response_model=List[UserResponse])
def get_users(
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Acceso restringido a administradores")
    return session.exec(select(User)).all()

@app.post("/api/users", response_model=UserResponse)
def create_user_by_admin(
    user_in: UserCreate,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Acceso restringido a administradores")
        
    existing = session.exec(
        select(User).where((User.username == user_in.username) | (User.email == user_in.email))
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="El usuario o email ya existe")
        
    user = User(
        username=user_in.username,
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password)
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user

# --- GESTIÓN DE MIEMBROS DEL PROYECTO ---
@app.get("/api/projects/{project_id}/members", response_model=List[MemberResponse])
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
        MemberResponse(
            id=pm.id,
            user_id=u.id,
            username=u.username,
            email=u.email,
            role=pm.role
        )
        for pm, u in members
    ]

@app.post("/api/projects/{project_id}/members", response_model=MemberResponse)
def add_or_update_project_member(
    project_id: int,
    member_in: ProjectMemberCreate,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, [ProjectRole.OWNER, ProjectRole.ADMIN])
    
    target_user = session.get(User, member_in.user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    existing = session.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == member_in.user_id
        )
    ).first()
    
    if existing:
        existing.role = member_in.role
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return MemberResponse(id=existing.id, user_id=target_user.id, username=target_user.username, email=target_user.email, role=existing.role)
    
    new_member = ProjectMember(project_id=project_id, user_id=member_in.user_id, role=member_in.role)
    session.add(new_member)
    session.commit()
    session.refresh(new_member)
    return MemberResponse(id=new_member.id, user_id=target_user.id, username=target_user.username, email=target_user.email, role=new_member.role)

@app.delete("/api/projects/{project_id}/members/{user_id}")
def remove_project_member(
    project_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, [ProjectRole.OWNER, ProjectRole.ADMIN])
    member = session.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id
        )
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Miembro no encontrado")
    
    session.delete(member)
    session.commit()
    return {"message": "Miembro eliminado"}

import re
from models import (
    Ticket, Epic, Column, Project, User, ProjectMember, ProjectRole,
    Repository, CommitLink, PullRequestLink
)
from github_service import verify_repo_access, fetch_repo_commits, fetch_repo_pulls

# --- ESQUEMAS FASE 8 (GITHUB) ---
class RepositoryCreate(BaseModel):
    owner: str
    repo_name: str
    access_token: Optional[str] = None
    default_branch: str = "main"

class RepositoryResponse(BaseModel):
    id: int
    project_id: int
    owner: str
    repo_name: str
    default_branch: str
    is_active: bool

class GitHubActivityResponse(BaseModel):
    commits: List[CommitLink]
    pull_requests: List[PullRequestLink]


# --- MOTOR DE PARSING (TB-12 / #12) ---
def extract_ticket_ids(text: str) -> List[int]:
    if not text:
        return []
    # Captura patrones tipo TB-12, TB12 o #12
    matches = re.findall(r'(?:TB-?|#)(\d+)', text, re.IGNORECASE)
    return list(set(int(m) for m in matches))


# --- ENDPOINTS GITHUB ---
@app.post("/api/projects/{project_id}/repositories", response_model=RepositoryResponse)
async def link_repository(
    project_id: int,
    repo_in: RepositoryCreate,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, [ProjectRole.OWNER, ProjectRole.ADMIN])
    
    # Verificar validez del repositorio en GitHub
    valid = await verify_repo_access(repo_in.owner, repo_in.repo_name, repo_in.access_token)
    if not valid:
        raise HTTPException(
            status_code=400, 
            detail="No se pudo verificar el repositorio. Revisa el propietario, nombre o token de acceso."
        )

    db_repo = Repository(
        project_id=project_id,
        owner=repo_in.owner,
        repo_name=repo_in.repo_name,
        access_token=repo_in.access_token,
        default_branch=repo_in.default_branch,
        is_active=True
    )
    session.add(db_repo)
    session.commit()
    session.refresh(db_repo)
    return db_repo


@app.get("/api/projects/{project_id}/repositories", response_model=List[RepositoryResponse])
def get_project_repositories(
    project_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, [ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER, ProjectRole.VIEWER])
    return session.exec(
        select(Repository).where(Repository.project_id == project_id, Repository.is_active == True)
    ).all()


@app.delete("/api/projects/{project_id}/repositories/{repo_id}")
def unlink_repository(
    project_id: int,
    repo_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, [ProjectRole.OWNER, ProjectRole.ADMIN])
    repo = session.get(Repository, repo_id)
    if not repo or repo.project_id != project_id:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")
    
    session.delete(repo)
    session.commit()
    return {"message": "Repositorio desvinculado"}


@app.post("/api/projects/{project_id}/github/sync")
async def sync_github_data(
    project_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, [ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER])
    
    repos = session.exec(
        select(Repository).where(Repository.project_id == project_id, Repository.is_active == True)
    ).all()
    if not repos:
        return {"message": "Sin repositorios vinculados", "synced_commits": 0, "synced_prs": 0}

    tickets = session.exec(select(Ticket).where(Ticket.project_id == project_id)).all()
    ticket_ids = {t.id for t in tickets}

    new_commits_count = 0
    new_prs_count = 0

    for repo in repos:
        # 1. Sincronizar Commits
        commits_data = await fetch_repo_commits(repo.owner, repo.repo_name, repo.access_token)
        for item in commits_data:
            sha = item.get("sha")
            msg = item.get("commit", {}).get("message", "")
            author = item.get("commit", {}).get("author", {}).get("name", "Desconocido")
            url = item.get("html_url", "")
            
            matched_ids = extract_ticket_ids(msg)
            for t_id in matched_ids:
                if t_id in ticket_ids:
                    existing = session.exec(
                        select(CommitLink).where(CommitLink.ticket_id == t_id, CommitLink.commit_sha == sha)
                    ).first()
                    if not existing:
                        session.add(CommitLink(
                            ticket_id=t_id,
                            commit_sha=sha,
                            message=msg.split("\n")[0][:255], # Guardar primera línea
                            author=author,
                            url=url
                        ))
                        new_commits_count += 1

        # 2. Sincronizar Pull Requests
        prs_data = await fetch_repo_pulls(repo.owner, repo.repo_name, repo.access_token)
        for pr in prs_data:
            number = pr.get("number")
            title = pr.get("title", "")
            state = pr.get("state", "open")
            if pr.get("merged_at"):
                state = "merged"
            url = pr.get("html_url", "")
            author = pr.get("user", {}).get("login", "Desconocido")

            matched_ids = extract_ticket_ids(title)
            for t_id in matched_ids:
                if t_id in ticket_ids:
                    existing = session.exec(
                        select(PullRequestLink).where(PullRequestLink.ticket_id == t_id, PullRequestLink.pr_number == number)
                    ).first()
                    if existing:
                        existing.title = title
                        existing.state = state
                        session.add(existing)
                    else:
                        session.add(PullRequestLink(
                            ticket_id=t_id,
                            pr_number=number,
                            title=title,
                            state=state,
                            url=url,
                            author=author
                        ))
                        new_prs_count += 1

    session.commit()
    return {
        "message": "Sincronización completada",
        "synced_commits": new_commits_count,
        "synced_prs": new_prs_count
    }


@app.get("/api/tickets/{ticket_id}/github", response_model=GitHubActivityResponse)
def get_ticket_github_activity(
    ticket_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
        
    commits = session.exec(select(CommitLink).where(CommitLink.ticket_id == ticket_id)).all()
    prs = session.exec(select(PullRequestLink).where(PullRequestLink.ticket_id == ticket_id)).all()
    
    return GitHubActivityResponse(commits=commits, pull_requests=prs)

import asyncio

# --- BUCLE DE SINCRONIZACIÓN AUTOMÁTICA ---
async def periodic_github_sync(interval_seconds: int = 300):
    """Sincroniza todos los repositorios activos automáticamente cada X segundos (por defecto 5 min)"""
    while True:
        try:
            await asyncio.sleep(interval_seconds)
            with Session(engine) as session:
                repos = session.exec(select(Repository).where(Repository.is_active == True)).all()
                for repo in repos:
                    # Reutiliza la lógica de extracción de commits y PRs
                    commits_data = await fetch_repo_commits(repo.owner, repo.repo_name, repo.access_token)
                    tickets = session.exec(select(Ticket).where(Ticket.project_id == repo.project_id)).all()
                    ticket_ids = {t.id for t in tickets}

                    for item in commits_data:
                        sha = item.get("sha")
                        msg = item.get("commit", {}).get("message", "")
                        author = item.get("commit", {}).get("author", {}).get("name", "Desconocido")
                        url = item.get("html_url", "")
                        
                        for t_id in extract_ticket_ids(msg):
                            if t_id in ticket_ids:
                                existing = session.exec(
                                    select(CommitLink).where(CommitLink.ticket_id == t_id, CommitLink.commit_sha == sha)
                                ).first()
                                if not existing:
                                    session.add(CommitLink(
                                        ticket_id=t_id, commit_sha=sha, message=msg.split("\n")[0][:255],
                                        author=author, url=url
                                    ))
                    session.commit()
        except Exception as e:
            print(f"⚠️ Error en auto-sincronización de GitHub: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    with Session(engine) as session:
        admin = session.exec(select(User).where(User.username == "adrian")).first()
        if admin and not admin.is_superuser:
            admin.is_superuser = True
            session.add(admin)
            session.commit()

    # Arrancar tarea periódica en segundo plano
    sync_task = asyncio.create_task(periodic_github_sync(interval_seconds=300)) # 5 minutos
    yield
    sync_task.cancel()

from fastapi import UploadFile, File
import shutil

# Crear carpeta de estáticos para archivos subidos
UPLOAD_DIR = os.path.join("static", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

class CommentCreate(BaseModel):
    content: str

@app.get("/api/tickets/{ticket_id}/comments", response_model=List[TicketComment])
def get_ticket_comments(
    ticket_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    return session.exec(
        select(TicketComment).where(TicketComment.ticket_id == ticket_id).order_by(TicketComment.created_at.asc())
    ).all()

@app.post("/api/tickets/{ticket_id}/comments", response_model=TicketComment)
async def add_ticket_comment(
    ticket_id: int,
    content: str = Form(""),
    file: Optional[UploadFile] = File(None),
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")

    image_url = None
    if file and file.filename:
        filename = f"{datetime.now().timestamp()}_{file.filename}"
        file_path = os.path.join(UPLOAD_DIR, filename)
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        image_url = f"/static/uploads/{filename}"

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