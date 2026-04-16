from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field


class TaskStatus(str, Enum):
    todo = "todo"
    done = "done"


class Goal(BaseModel):
    id: UUID = Field(...)
    title: str
    description: str
    created_at: datetime
    updated_at: datetime


class GoalCreate(BaseModel):
    title: str
    description: str


class Task(BaseModel):
    id: UUID = Field(...)
    plan_id: UUID
    title: str
    due_date: date | None = None
    status: TaskStatus
    priority: str
    parent_id: UUID | None = None


class TaskCreate(BaseModel):
    title: str
    due_date: date | None = None
    status: TaskStatus
    priority: str
    parent_id: UUID | None = None


class Plan(BaseModel):
    id: UUID = Field(...)
    goal_id: UUID
    tasks: list[Task]
    created_at: datetime


class PlanCreate(BaseModel):
    goal_id: UUID
    tasks: list[TaskCreate] | None = Field(default=None, min_length=1)


class PlanUpdate(BaseModel):
    tasks: list[Task] = Field(..., min_length=1)


class GoalParseRequest(BaseModel):
    text: str = Field(..., min_length=1)


class ParsedGoal(BaseModel):
    id: UUID = Field(...)
    title: str
    description: str


class TaskCompletionResponse(BaseModel):
    success: bool
    task: Task

class RoadmapFolder(BaseModel):
    id: UUID
    user_id: UUID | None = None
    name: str
    created_at: datetime

class RoadmapFolderCreate(BaseModel):
    name: str

class Roadmap(BaseModel):
    id: UUID
    folder_id: UUID | None = None
    user_id: UUID | None = None
    title: str
    topic: str
    difficulty: str
    provider: str
    data: dict
    created_at: datetime

class RoadmapCreate(BaseModel):
    folder_id: UUID | None = None
    title: str
    topic: str
    difficulty: str
    provider: str
    data: dict

class RoadmapScheduleRequest(BaseModel):
    roadmap_data: dict          # Full RoadmapData JSON (nodes, edges, outlines, title)
    weeks: int = 8              # Duration in weeks
    study_days: list[str]       # e.g. ["monday", "wednesday", "friday"]
    provider: str = "default"


# ── Conversation / Chat History Models ────────────────────────────────────────

class ConversationMessage(BaseModel):
    id: str
    role: str                           # "user" | "assistant"
    content: str
    isPlan: bool | None = None
    originalUserMsg: str | None = None
    convertedToRoadmap: bool | None = None
    created_at: str | None = None       # ISO timestamp


class ConversationCreate(BaseModel):
    title: str = "New Conversation"


class ConversationUpdate(BaseModel):
    title: str | None = None
    messages: list[ConversationMessage] | None = None


class Conversation(BaseModel):
    id: UUID
    user_id: UUID
    title: str
    messages: list[ConversationMessage]
    created_at: datetime
    updated_at: datetime


class ConversationSummary(BaseModel):
    """Lightweight version for the History list — no full messages array."""
    id: UUID
    title: str
    preview: str                        # last assistant message snippet
    message_count: int
    updated_at: datetime
    created_at: datetime
