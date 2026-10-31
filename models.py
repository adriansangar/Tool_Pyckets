from typing import Optional, List
from enum import Enum
from sqlmodel import Field, SQLModel
from sqlalchemy import Column as SAColumn, JSON
from datetime import date, datetime, timezone

class ProjectRole(str, Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"
    VIEWER = "viewer"

class TicketPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"

class TicketType(str, Enum):
    TASK = "task"
    BUG = "bug"
    FEATURE = "feature"
    EPIC = "epic"
    SUBTASK = "subtask"

class DependencyType(str, Enum):
    BLOCKS = "blocks"
    IS_BLOCKED_BY = "is_blocked_by"
    RELATES_TO = "relates_to"
    DUPLICATES = "duplicates"

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True)
    email: str = Field(unique=True, index=True)
    hashed_password: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    avatar: str = Field(default="🚀")
    theme_preference: str = Field(default="dark")
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
    wip_limit: Optional[int] = Field(default=None)

class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    color: str = "#ff5630"
    accent_color: str = "#0052cc"
    icon: str = "📦"
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
    priority: TicketPriority = Field(default=TicketPriority.MEDIUM)
    ticket_type: TicketType = Field(default=TicketType.TASK)
    
    tags: List[str] = Field(default_factory=list, sa_column=SAColumn(JSON))
    
    project_id: Optional[int] = Field(default=None, foreign_key="project.id")
    parent_id: Optional[int] = Field(default=None, foreign_key="ticket.id")
    epic: Optional[str] = None          
    assignee: Optional[str] = None
    reporter: Optional[str] = None
    due_date: Optional[date] = None     
    time_logged: Optional[int] = 0
    story_points: Optional[int] = Field(default=0)
    resolution: Optional[str] = None
    
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class TicketDependency(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    source_ticket_id: int = Field(foreign_key="ticket.id", index=True)
    target_ticket_id: int = Field(foreign_key="ticket.id", index=True)
    dependency_type: DependencyType = Field(default=DependencyType.RELATES_TO)

class ChecklistItem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
    content: str
    is_completed: bool = Field(default=False)
    order: int = Field(default=0)

class TicketHistory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
    author_username: str
    field_changed: str
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    changed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class TicketComment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
    author_username: str
    author_avatar: str = "🚀"
    content: str
    image_url: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class Repository(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    owner: str
    repo_name: str
    access_token: Optional[str] = None
    default_branch: str = "main"
    is_active: bool = Field(default=True)
    auto_move_tickets: bool = Field(default=True)
    webhook_secret: Optional[str] = None
    last_synced_at: Optional[datetime] = None
    last_sync_status: Optional[str] = Field(default="never")
    last_sync_error: Optional[str] = None

class CommitLink(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
    commit_sha: str = Field(index=True)
    message: str
    author: str
    url: str
    committed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class PullRequestLink(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="ticket.id", index=True)
    pr_number: int
    title: str
    state: str
    url: str
    author: str
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class Notification(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    title: str
    message: str
    link: Optional[str] = None
    is_read: bool = Field(default=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class SavedView(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    project_id: Optional[int] = Field(default=None)
    name: str
    query_params: str
