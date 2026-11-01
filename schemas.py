"""Esquemas Pydantic (entrada/salida de la API)."""
from datetime import datetime, date
from typing import Dict, List, Optional
from pydantic import BaseModel, field_validator

from models import (
    CommitLink, PullRequestLink, TicketPriority, TicketType, DependencyType,
)

def lower_enum(v):
    return v.lower() if isinstance(v, str) else v


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


class TicketUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[TicketPriority] = None
    ticket_type: Optional[TicketType] = None
    tags: Optional[List[str]] = None
    project_id: Optional[int] = None
    parent_id: Optional[int] = None
    epic: Optional[str] = None
    assignee: Optional[str] = None
    due_date: Optional[date] = None
    time_logged: Optional[int] = None
    story_points: Optional[int] = None
    resolution: Optional[str] = None

    @field_validator("priority", "ticket_type", mode="before")
    @classmethod
    def _enum_case(cls, v):
        return lower_enum(v)

    @field_validator("due_date", "epic", "assignee", mode="before")
    @classmethod
    def _empty_to_none(cls, v):
        return None if isinstance(v, str) and not v.strip() else v


class BulkStatusUpdate(BaseModel):
    ticket_ids: List[int]
    status: Optional[str] = None
    assignee: Optional[str] = None
    priority: Optional[TicketPriority] = None

    @field_validator("priority", mode="before")
    @classmethod
    def _enum_case(cls, v):
        return lower_enum(v)


class ChecklistCreate(BaseModel):
    content: str


class ChecklistUpdate(BaseModel):
    is_completed: bool


class DependencyCreate(BaseModel):
    target_ticket_id: int
    dependency_type: DependencyType = DependencyType.RELATES_TO


class ProjectOut(BaseModel):
    id: int
    name: str
    color: str
    accent_color: str
    icon: str
    is_archived: bool
    my_role: Optional[str] = None

class EpicCreate(BaseModel):
    name: str
    color: str = "#6366f1"
    description: Optional[str] = None

class EpicUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None

class EpicOut(BaseModel):
    id: int
    project_id: Optional[int] = None
    name: str
    color: str
    description: Optional[str] = None
    tickets_total: int = 0
    tickets_done: int = 0


# ---- Dashboards ----
class TicketBrief(BaseModel):
    id: int
    title: str
    status: str
    priority: str
    ticket_type: str
    due_date: Optional[date] = None
    assignee: Optional[str] = None
    epic: Optional[str] = None
    story_points: int = 0
    project_id: Optional[int] = None
    overdue: bool = False

class ProjectCard(BaseModel):
    id: int
    name: str
    color: str
    icon: str
    my_role: str
    total: int = 0
    done: int = 0
    progress: int = 0
    overdue: int = 0
    my_open: int = 0
    epics: int = 0
    members: int = 0
    by_status: Dict[str, int] = {}

class ColumnCount(BaseModel):
    status: str
    name: str
    count: int = 0
    is_done: bool = False

class EpicProgress(BaseModel):
    id: Optional[int] = None
    name: str
    color: str
    description: Optional[str] = None
    total: int = 0
    done: int = 0
    progress: int = 0
    overdue: int = 0
    story_points: int = 0

class WorkloadItem(BaseModel):
    assignee: Optional[str] = None
    open: int = 0
    overdue: int = 0
    story_points: int = 0

class ProjectDashboard(BaseModel):
    project: ProjectOut
    total: int = 0
    done: int = 0
    progress: int = 0
    overdue_count: int = 0
    story_points_total: int = 0
    story_points_done: int = 0
    my_open: int = 0
    columns: List[ColumnCount] = []
    epics: List[EpicProgress] = []
    no_epic: EpicProgress
    by_priority: Dict[str, int] = {}
    overdue: List[TicketBrief] = []
    workload: Optional[List[WorkloadItem]] = None

class WorkGroup(BaseModel):
    project_id: int
    project_name: str
    project_color: str
    tickets: List[TicketBrief] = []

class MyWork(BaseModel):
    groups: List[WorkGroup] = []
    total_open: int = 0
    overdue: int = 0
