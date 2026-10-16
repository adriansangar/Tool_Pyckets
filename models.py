from typing import Optional, List
from sqlmodel import Field, SQLModel
from sqlalchemy import Column as SAColumn, JSON
from datetime import date

class Column(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    order: int

class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    color: str = "#ff5630"
    is_archived: bool = Field(default=False)

class Epic(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    color: str

class Ticket(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    description: Optional[str] = None
    status: str = "todo"
    
    tags: List[str] = Field(default_factory=list, sa_column=SAColumn(JSON))
    
    project_id: Optional[int] = Field(default=None, foreign_key="project.id")
    epic: Optional[str] = None          
    assignee: Optional[str] = None      
    due_date: Optional[date] = None     
    time_logged: Optional[int] = 0