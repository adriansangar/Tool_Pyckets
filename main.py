from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Response, status, UploadFile, File, Form, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone
import os
import shutil
import re
import asyncio

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
from github_service import (
    verify_repo_access, fetch_repo_commits, fetch_repo_pulls, verify_webhook_signature
)

UPLOAD_DIR = os.path.join("static", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# --- MOTOR DE PARSING REGEX ---
def extract_ticket_ids(text: str) -> List[int]:
    if not text:
        return []
    matches = re.findall(r'(?:TB-?|#)(\d+)', text, re.IGNORECASE)
    return list(set(int(m) for m in matches))

# --- PROCESADOR DE REGLAS Y SINCRONIZACIÓN GITHUB ---
async def process_repo_sync(repo: Repository, session: Session) -> Dict[str, int]:
    new_commits = 0
    new_prs = 0
    
    tickets = session.exec(select(Ticket).where(Ticket.project_id == repo.project_id)).all()
    ticket_map = {t.id: t for t in tickets}

    # 1. Commits
    commits_data = await fetch_repo_commits(repo.owner, repo.repo_name, repo.access_token)
    for item in commits_data:
        sha = item.get("sha")
        msg = item.get("commit", {}).get("message", "")
        author = item.get("commit", {}).get("author", {}).get("name", "Desconocido")
        url = item.get("html_url", "")
        
        for t_id in extract_ticket_ids(msg):
            if t_id in ticket_map:
                existing = session.exec(
                    select(CommitLink).where(CommitLink.ticket_id == t_id, CommitLink.commit_sha == sha)
                ).first()
                if not existing:
                    session.add(CommitLink(
                        ticket_id=t_id, commit_sha=sha, message=msg.split("\n")[0][:255],
                        author=author, url=url
                    ))
                    new_commits += 1

    # 2. Pull Requests
    prs_data = await fetch_repo_pulls(repo.owner, repo.repo_name, repo.access_token)
    for pr in prs_data:
        number = pr.get("number")
        title = pr.get("title", "")
        state = pr.get("state", "open")
        if pr.get("merged_at"):
            state = "merged"
        url = pr.get("html_url", "")
        author = pr.get("user", {}).get("login", "Desconocido")

        for t_id in extract_ticket_ids(title):
            if t_id in ticket_map:
                ticket = ticket_map[t_id]
                existing = session.exec(
                    select(PullRequestLink).where(PullRequestLink.ticket_id == t_id, PullRequestLink.pr_number == number)
                ).first()
                
                if existing:
                    existing.title = title
                    existing.state = state
                    session.add(existing)
                else:
                    session.add(PullRequestLink(
                        ticket_id=t_id, pr_number=number, title=title,
                        state=state, url=url, author=author
                    ))
                    new_prs += 1

                # Reglas de automatización del ciclo de vida
                if repo.auto_move_tickets:
                    if state == "open" and ticket.status == "todo":
                        ticket.status = "in_progress"
                        session.add(ticket)
                    elif state == "merged" and ticket.status != "done":
                        ticket.status = "done"
                        session.add(ticket)

    repo.last_synced_at = datetime.now(timezone.utc)
    repo.last_sync_status = "ok"
    repo.last_sync_error = None
    session.add(repo)
    session.commit()
    return {"commits": new_commits, "prs": new_prs}

# --- TAREA EN SEGUNDO PLANO ---
async def periodic_github_sync(interval_seconds: int = 300):
    while True:
        try:
            await asyncio.sleep(interval_seconds)
            with Session(engine) as session:
                repos = session.exec(select(Repository).where(Repository.is_active == True)).all()
                for repo in repos:
                    try:
                        await process_repo_sync(repo, session)
                    except Exception as err:
                        repo.last_synced_at = datetime.now(timezone.utc)
                        repo.last_sync_status = "error"
                        repo.last_sync_error = str(err)
                        session.add(repo)
                        session.commit()
        except Exception as e:
            print(f"⚠️ Error en bucle de sincronización de GitHub: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    with Session(engine) as session:
        admin = session.exec(select(User).where(User.username == "adrian")).first()
        if admin and not admin.is_superuser:
            admin.is_superuser = True
            session.add(admin)
            session.commit()

    sync_task = asyncio.create_task(periodic_github_sync(300))
    yield
    sync_task.cancel()

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

class RepositoryCreate(BaseModel):
    owner: str
    repo_name: str
    access_token: Optional[str] = None
    default_branch: str = "main"
    auto_move_tickets: bool = True
    webhook_secret: Optional[str] = None

class RepositoryResponse(BaseModel):
    id: int
    project_id: int
    owner: str
    repo_name: str
    default_branch: str
    is_active: bool
    auto_move_tickets: bool
    last_synced_at: Optional[datetime] = None
    last_sync_status: Optional[str] = "never"
    last_sync_error: Optional[str] = None

class GitHubActivityResponse(BaseModel):
    commits: List[CommitLink]
    pull_requests: List[PullRequestLink]

class ManualCommitLinkCreate(BaseModel):
    commit_sha: str
    message: str
    url: str

# --- ENDPOINTS DE AUTENTICACIÓN Y PERFIL ---
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

# --- ENDPOINTS TABLERO Y TICKETS ---
@app.get("/api/columns", response_model=List[Column])
def get_columns(session: Session = Depends(get_session)):
    return session.exec(select(Column).order_by(Column.order)).all()

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
    
    for t in session.exec(select(Ticket).where(Ticket.project_id == project_id)).all():
        session.delete(t)
    for m in session.exec(select(ProjectMember).where(ProjectMember.project_id == project_id)).all():
        session.delete(m)

    session.delete(db_project)
    session.commit()
    return {"message": "Proyecto eliminado"}

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

# --- COMENTARIOS ---
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
        filename = f"{int(datetime.now(timezone.utc).timestamp())}_{file.filename}"
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

# --- ENDPOINTS GITHUB ---
@app.post("/api/projects/{project_id}/repositories", response_model=RepositoryResponse)
async def link_repository(
    project_id: int,
    repo_in: RepositoryCreate,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, [ProjectRole.OWNER, ProjectRole.ADMIN])
    
    check = await verify_repo_access(repo_in.owner, repo_in.repo_name, repo_in.access_token)
    if not check["valid"]:
        raise HTTPException(status_code=400, detail=check["error"])

    db_repo = Repository(
        project_id=project_id,
        owner=repo_in.owner,
        repo_name=repo_in.repo_name,
        access_token=repo_in.access_token,
        default_branch=repo_in.default_branch,
        auto_move_tickets=repo_in.auto_move_tickets,
        webhook_secret=repo_in.webhook_secret,
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

    total_commits = 0
    total_prs = 0
    for repo in repos:
        res = await process_repo_sync(repo, session)
        total_commits += res["commits"]
        total_prs += res["prs"]

    return {"message": "Sincronización completada", "synced_commits": total_commits, "synced_prs": total_prs}

@app.get("/api/tickets/{ticket_id}/github", response_model=GitHubActivityResponse)
def get_ticket_github_activity(
    ticket_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    commits = session.exec(select(CommitLink).where(CommitLink.ticket_id == ticket_id)).all()
    prs = session.exec(select(PullRequestLink).where(PullRequestLink.ticket_id == ticket_id)).all()
    return GitHubActivityResponse(commits=commits, pull_requests=prs)

@app.post("/api/tickets/{ticket_id}/github/commits", response_model=CommitLink)
def manual_link_commit(
    ticket_id: int,
    commit_in: ManualCommitLinkCreate,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
        
    existing = session.exec(
        select(CommitLink).where(CommitLink.ticket_id == ticket_id, CommitLink.commit_sha == commit_in.commit_sha)
    ).first()
    if existing:
        return existing

    link = CommitLink(
        ticket_id=ticket_id,
        commit_sha=commit_in.commit_sha,
        message=commit_in.message,
        author=current_user.username,
        url=commit_in.url
    )
    session.add(link)
    session.commit()
    session.refresh(link)
    return link

@app.get("/api/projects/{project_id}/github/activity")
def get_project_github_feed(
    project_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, [ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER, ProjectRole.VIEWER])
    
    tickets = session.exec(select(Ticket).where(Ticket.project_id == project_id)).all()
    ticket_ids = [t.id for t in tickets]
    
    if not ticket_ids:
        return {"commits": [], "pull_requests": []}

    commits = session.exec(select(CommitLink).where(CommitLink.ticket_id.in_(ticket_ids)).order_by(CommitLink.committed_at.desc()).limit(20)).all()
    prs = session.exec(select(PullRequestLink).where(PullRequestLink.ticket_id.in_(ticket_ids)).order_by(PullRequestLink.updated_at.desc()).limit(20)).all()
    return {"commits": commits, "pull_requests": prs}

# --- ENDPOINT RECEPTOR DE WEBHOOKS DE GITHUB (MODO PRODUCCIÓN) ---
@app.post("/api/github/webhook")
async def github_webhook_receiver(
    request: Request,
    session: Session = Depends(get_session)
):
    body_bytes = await request.body()
    event = request.headers.get("X-GitHub-Event", "")
    signature = request.headers.get("X-Hub-Signature-256")
    
    payload = await request.json()
    repo_data = payload.get("repository", {})
    owner = repo_data.get("owner", {}).get("login") or repo_data.get("owner", {}).get("name")
    repo_name = repo_data.get("name")

    if not owner or not repo_name:
        return {"status": "ignored", "reason": "Missing repository details"}

    repo = session.exec(
        select(Repository).where(Repository.owner == owner, Repository.repo_name == repo_name)
    ).first()

    if not repo:
        return {"status": "ignored", "reason": "Repository not linked"}

    if repo.webhook_secret and not verify_webhook_signature(body_bytes, repo.webhook_secret, signature):
        raise HTTPException(status_code=401, detail="Firma de Webhook inválida")

    # Procesar según tipo de evento
    if event == "push":
        commits = payload.get("commits", [])
        tickets = session.exec(select(Ticket).where(Ticket.project_id == repo.project_id)).all()
        ticket_map = {t.id: t for t in tickets}

        for c in commits:
            sha = c.get("id")
            msg = c.get("message", "")
            url = c.get("url", "")
            author = c.get("author", {}).get("name", "Desconocido")
            
            for t_id in extract_ticket_ids(msg):
                if t_id in ticket_map:
                    existing = session.exec(
                        select(CommitLink).where(CommitLink.ticket_id == t_id, CommitLink.commit_sha == sha)
                    ).first()
                    if not existing:
                        session.add(CommitLink(
                            ticket_id=t_id, commit_sha=sha, message=msg.split("\n")[0][:255],
                            author=author, url=url
                        ))
        session.commit()

    elif event == "pull_request":
        pr = payload.get("pull_request", {})
        number = pr.get("number")
        title = pr.get("title", "")
        state = pr.get("state", "open")
        if pr.get("merged"):
            state = "merged"
        url = pr.get("html_url", "")
        author = pr.get("user", {}).get("login", "Desconocido")

        tickets = session.exec(select(Ticket).where(Ticket.project_id == repo.project_id)).all()
        ticket_map = {t.id: t for t in tickets}

        for t_id in extract_ticket_ids(title):
            if t_id in ticket_map:
                ticket = ticket_map[t_id]
                existing = session.exec(
                    select(PullRequestLink).where(PullRequestLink.ticket_id == t_id, PullRequestLink.pr_number == number)
                ).first()
                if existing:
                    existing.title = title
                    existing.state = state
                    session.add(existing)
                else:
                    session.add(PullRequestLink(
                        ticket_id=t_id, pr_number=number, title=title,
                        state=state, url=url, author=author
                    ))
                
                if repo.auto_move_tickets:
                    if state == "open" and ticket.status == "todo":
                        ticket.status = "in_progress"
                        session.add(ticket)
                    elif state == "merged" and ticket.status != "done":
                        ticket.status = "done"
                        session.add(ticket)
        session.commit()

    return {"status": "success", "event": event}

# --- USUARIOS GLOBALES Y MIEMBROS ---
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

@app.get("/api/projects/{project_id}/members")
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

@app.post("/api/projects/{project_id}/members")
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

@app.delete("/api/projects/{project_id}/members/{user_id}")
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