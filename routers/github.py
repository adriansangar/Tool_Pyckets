"""Endpoints: github."""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select

from models import (
    Ticket, User, ProjectRole, Repository, CommitLink, PullRequestLink,
)
from database import get_session
from auth import (
    get_current_user_from_token, check_project_permission,
)
from permissions import READ_ROLES, WRITE_ROLES, get_ticket_or_404, authorize_ticket
from schemas import (
    RepositoryCreate, RepositoryResponse, GitHubActivityResponse, ManualCommitLinkCreate,
)
from services.github_sync import extract_ticket_ids, process_repo_sync
from github_service import (
    verify_repo_access, verify_webhook_signature,
)

router = APIRouter()

@router.post("/api/projects/{project_id}/repositories", response_model=RepositoryResponse)
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


@router.get("/api/projects/{project_id}/repositories", response_model=List[RepositoryResponse])
def get_project_repositories(
    project_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    check_project_permission(project_id, current_user, session, [ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER, ProjectRole.VIEWER])
    return session.exec(
        select(Repository).where(Repository.project_id == project_id, Repository.is_active == True)
    ).all()


@router.delete("/api/projects/{project_id}/repositories/{repo_id}")
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


@router.post("/api/projects/{project_id}/github/sync")
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


@router.get("/api/tickets/{ticket_id}/github", response_model=GitHubActivityResponse)
def get_ticket_github_activity(
    ticket_id: int,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    authorize_ticket(get_ticket_or_404(session, ticket_id), current_user, session, READ_ROLES)
    commits = session.exec(select(CommitLink).where(CommitLink.ticket_id == ticket_id)).all()
    prs = session.exec(select(PullRequestLink).where(PullRequestLink.ticket_id == ticket_id)).all()
    return GitHubActivityResponse(commits=commits, pull_requests=prs)


@router.post("/api/tickets/{ticket_id}/github/commits", response_model=CommitLink)
def manual_link_commit(
    ticket_id: int,
    commit_in: ManualCommitLinkCreate,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
        
    authorize_ticket(ticket, current_user, session, WRITE_ROLES)
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


@router.get("/api/projects/{project_id}/github/activity")
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


@router.post("/api/github/webhook")
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

    if not repo.webhook_secret or not verify_webhook_signature(body_bytes, repo.webhook_secret, signature):
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
