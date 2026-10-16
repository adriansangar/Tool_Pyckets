from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import os

from models import Ticket, Epic, Column, Project
from database import get_session, create_db_and_tables

@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
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

class ProjectCreate(BaseModel):
    name: str
    color: str = "#ff5630"

class StatusUpdate(BaseModel):
    status: str

@app.get("/api/columns", response_model=List[Column])
def get_columns(session: Session = Depends(get_session)):
    return session.exec(select(Column).order_by(Column.order)).all()

@app.get("/api/projects", response_model=List[Project])
def get_projects(include_archived: bool = False, session: Session = Depends(get_session)):
    projects = session.exec(select(Project)).all()
    if not include_archived:
        return [p for p in projects if not p.is_archived]
    return projects

@app.post("/api/projects", response_model=Project)
def create_project(project: ProjectCreate, session: Session = Depends(get_session)):
    db_project = Project(name=project.name, color=project.color, is_archived=False)
    session.add(db_project)
    session.commit()
    session.refresh(db_project)
    return db_project

@app.put("/api/projects/{project_id}/archive", response_model=Project)
def archive_project(project_id: int, session: Session = Depends(get_session)):
    db_project = session.get(Project, project_id)
    if not db_project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    
    db_project.is_archived = True
    session.add(db_project)
    session.commit()
    session.refresh(db_project)
    return db_project

@app.put("/api/projects/{project_id}/unarchive", response_model=Project)
def unarchive_project(project_id: int, session: Session = Depends(get_session)):
    db_project = session.get(Project, project_id)
    if not db_project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    
    db_project.is_archived = False
    session.add(db_project)
    session.commit()
    session.refresh(db_project)
    return db_project

@app.delete("/api/projects/{project_id}")
def delete_project(project_id: int, session: Session = Depends(get_session)):
    db_project = session.get(Project, project_id)
    if not db_project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    
    tickets = session.exec(select(Ticket).where(Ticket.project_id == project_id)).all()
    for t in tickets:
        session.delete(t)
        
    session.delete(db_project)
    session.commit()
    return {"message": "Proyecto eliminado"}

@app.get("/api/epics", response_model=List[Epic])
def get_epics(session: Session = Depends(get_session)):
    return session.exec(select(Epic)).all()

@app.get("/api/tickets", response_model=List[Ticket])
def get_tickets(project_id: Optional[int] = None, session: Session = Depends(get_session)):
    query = select(Ticket)
    if project_id:
        query = query.where(Ticket.project_id == project_id)
    return session.exec(query).all()

@app.post("/api/tickets")
def create_ticket(ticket: Ticket, session: Session = Depends(get_session)):
    if isinstance(ticket.due_date, str) and ticket.due_date.strip():
        ticket.due_date = datetime.strptime(ticket.due_date, "%Y-%m-%d").date()
    session.add(ticket)
    session.commit()
    session.refresh(ticket)
    return ticket

@app.put("/api/tickets/{ticket_id}")
def update_full_ticket(ticket_id: int, ticket_update: Ticket, session: Session = Depends(get_session)):
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
def update_ticket_status(ticket_id: int, status_update: StatusUpdate, session: Session = Depends(get_session)):
    db_ticket = session.get(Ticket, ticket_id)
    if not db_ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    db_ticket.status = status_update.status
    session.add(db_ticket)
    session.commit()
    session.refresh(db_ticket)
    return db_ticket