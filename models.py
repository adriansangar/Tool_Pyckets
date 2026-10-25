from typing import Optional, List
from enum import Enum
from sqlmodel import Field, SQLModel
from sqlalchemy import Column as SAColumn, JSON
from datetime import date, datetime

class ProjectRole(str, Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"
    VIEWER = "viewer"

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True)
    email: str = Field(unique=True, index=True)
    hashed_password: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    avatar: str = Field(default="🚀")
    theme_preference: str = Field(default="dark")  # "dark", "light"
    is_active: bool = Field(default=True)
    is_superuser: bool = Field(default=False)

class ProjectMember(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id")
    user_id: int = Field(foreign_key="user.id")
    role: ProjectRole = Field(default=ProjectRole.MEMBER)

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