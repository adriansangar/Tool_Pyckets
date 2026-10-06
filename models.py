import json
from typing import Optional, List
from sqlmodel import Field, SQLModel

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
    status: str
    epic_id: Optional[int] = Field(default=None, foreign_key="epic.id")
    release: Optional[str] = None
    
    # SQLite no tiene tipo Array nativo. Guardamos como string y usamos properties
    tags_json: Optional[str] = Field(default="[]")

    @property
    def tags(self) -> List[str]:
        return json.loads(self.tags_json) if self.tags_json else []

    @tags.setter
    def tags(self, value: List[str]):
        self.tags_json = json.dumps(value)