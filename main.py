from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select
from pydantic import BaseModel
from typing import List, Optional

# Importamos lo que creamos en la Fase 1
from models import Ticket, Epic, Column
from database import get_session, create_db_and_tables

# Lifespan: Se ejecuta al arrancar el servidor para asegurar que existan las tablas
@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    yield

app = FastAPI(title="Pyckets API", lifespan=lifespan)

# Configuración CORS: Crucial para que el frontend (HTML/JS) pueda pedir datos sin bloqueos
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- ESQUEMAS DE ENTRADA (Pydantic) ---
# Usamos Pydantic para validar lo que nos envía el usuario antes de tocar la BD
class TicketCreate(BaseModel):
    title: str
    description: Optional[str] = None
    status: str = "todo"
    epic_id: Optional[int] = None
    release: Optional[str] = None
    tags: List[str] = []

class StatusUpdate(BaseModel):
    status: str

# --- ENDPOINTS DE LECTURA (GET) ---

@app.get("/api/columns", response_model=List[Column])
def get_columns(session: Session = Depends(get_session)):
    """Devuelve la estructura de las columnas del tablero."""
    return session.exec(select(Column).order_by(Column.order)).all()

@app.get("/api/epics", response_model=List[Epic])
def get_epics(session: Session = Depends(get_session)):
    """Devuelve los epics disponibles para filtrar."""
    return session.exec(select(Epic)).all()

@app.get("/api/tickets", response_model=List[Ticket])
def get_tickets(session: Session = Depends(get_session)):
    """Devuelve todos los tickets."""
    return session.exec(select(Ticket)).all()

# --- ENDPOINTS DE ESCRITURA (POST / PUT) ---

@app.post("/api/tickets", response_model=Ticket)
def create_ticket(ticket_in: TicketCreate, session: Session = Depends(get_session)):
    """Crea un nuevo ticket en la base de datos."""
    db_ticket = Ticket(
        title=ticket_in.title,
        description=ticket_in.description,
        status=ticket_in.status,
        epic_id=ticket_in.epic_id,
        release=ticket_in.release
    )
    # Usamos el setter de la property para convertir la lista a JSON internamente
    db_ticket.tags = ticket_in.tags 
    
    session.add(db_ticket)
    session.commit()
    session.refresh(db_ticket)
    return db_ticket

@app.put("/api/tickets/{ticket_id}/status", response_model=Ticket)
def update_ticket_status(ticket_id: int, status_update: StatusUpdate, session: Session = Depends(get_session)):
    """Endpoint ultraligero para actualizar solo la columna del ticket (Drag & Drop)."""
    db_ticket = session.get(Ticket, ticket_id)
    if not db_ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    
    db_ticket.status = status_update.status
    session.add(db_ticket)
    session.commit()
    session.refresh(db_ticket)
    return db_ticket