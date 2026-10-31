"""Sincronización con GitHub: parsing de referencias, sync de repos y bucle periódico."""
import re
import asyncio
from datetime import datetime, timezone
from typing import List, Dict
from sqlmodel import Session, select

from models import (
    Ticket, Repository, CommitLink, PullRequestLink,
)
from database import engine
from github_service import (
    fetch_repo_commits, fetch_repo_pulls,
)

def extract_ticket_ids(text: str) -> List[int]:
    if not text:
        return []
    matches = re.findall(r'(?:TB-?|#)(\d+)', text, re.IGNORECASE)
    return list(set(int(m) for m in matches))


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
