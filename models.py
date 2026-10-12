from typing import Optional, List
from sqlmodel import Field, SQLModel
# Importamos Column con un alias (SAColumn) para que no choque con tu clase Column
from sqlalchemy import Column as SAColumn, JSON
from datetime import date

class Column(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    order: int

class Epic(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    color: str

class Ticket(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    description: Optional[str] = None
    status: str = "todo"
    
    # Usamos el alias SAColumn aquí
    tags: List[str] = Field(default_factory=list, sa_column=SAColumn(JSON))
    
    epic: Optional[str] = None          
    assignee: Optional[str] = None      
    due_date: Optional[date] = None     
    time_logged: Optional[int] = 0