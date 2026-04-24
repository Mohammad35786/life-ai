"""Pydantic schemas — request/response models for the API layer."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from backend.adaptive.models import (
    AdjustmentStatus,
    EventType,
    MemoryKey,
    MilestoneStatus,
    PlanIntensity,
    PlanPriority,
    PlanStatus,
    TaskDifficulty,
    TaskStatus,
)


# ── User Preferences ──────────────────────────────────────────────────────────

class UserPreferencesResponse(BaseModel):
    user_id: UUID
    max_tasks_per_day: int
    created_at: datetime
    updated_at: datetime


class UserPreferencesUpdate(BaseModel):
    max_tasks_per_day: int = Field(..., ge=1, le=10)


# ── Plans ──────────────────────────────────────────────────────────────────────

class PlanResponse(BaseModel):
    id: UUID
    goal_id: UUID | None = None
    memory_id: UUID | None = None
    user_id: UUID | None = None
    title: str | None = None
    status: PlanStatus
    priority: PlanPriority
    intensity: PlanIntensity
    duration_days: int | None = None
    schedule_prefs: dict | None = None
    created_at: datetime
    updated_at: datetime


class PlanUpdateRequest(BaseModel):
    title: str | None = None
    status: PlanStatus | None = None
    priority: PlanPriority | None = None
    intensity: PlanIntensity | None = None


class PlanControlRequest(BaseModel):
    plan_id: UUID


# ── Tasks ──────────────────────────────────────────────────────────────────────

class TaskResponse(BaseModel):
    id: UUID
    plan_id: UUID
    title: str
    description: str | None = None
    due_date: date | None = None
    status: TaskStatus
    priority: str
    difficulty: TaskDifficulty
    parent_id: UUID | None = None
    carry_over_count: int = 0
    milestone_id: UUID | None = None
    order_index: int = 0
    duration_minutes: int | None = None
    detail_json: dict | None = None
    created_at: datetime
    updated_at: datetime


class TaskCreateRequest(BaseModel):
    title: str
    due_date: date | None = None
    priority: str = "medium"
    parent_id: UUID | None = None


class TaskUpdateRequest(BaseModel):
    task_id: UUID
    status: TaskStatus = Field(..., description="New status: done, skipped, or partial")
    feedback_text: str | None = None


# ── Memory ─────────────────────────────────────────────────────────────────────

class MemoryResponse(BaseModel):
    id: UUID
    user_id: UUID
    key: MemoryKey
    value: str
    source: str
    goal_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


class MemoryCreateRequest(BaseModel):
    key: MemoryKey
    value: str = Field(..., min_length=1)
    source: str = "chat_extraction"
    goal_id: UUID | None = None


# ── Events ──────────────────────────────────────────────────────────────────────

class EventResponse(BaseModel):
    id: UUID
    user_id: UUID
    task_id: UUID
    plan_id: UUID
    event_type: EventType
    feedback_rating: int | None = None
    feedback_text: str | None = None
    created_at: datetime


class EventCreateRequest(BaseModel):
    task_id: UUID
    plan_id: UUID
    event_type: EventType
    feedback_rating: int | None = Field(None, ge=1, le=5)
    feedback_text: str | None = None


# ── Skip / Feedback shortcuts ─────────────────────────────────────────────────

class SkipRequest(BaseModel):
    feedback_text: str | None = None


class FeedbackRequest(BaseModel):
    feedback_rating: int = Field(..., ge=1, le=5)
    feedback_text: str | None = None


# ── Scheduler ──────────────────────────────────────────────────────────────────

class DailyTasksResponse(BaseModel):
    date: date
    tasks: list[TaskResponse]
    total_available: int
    selected_count: int
    max_tasks_per_day: int


# ── Milestones ─────────────────────────────────────────────────────────────────

class MilestoneCreate(BaseModel):
    title: str = Field(..., min_length=1)
    description: str | None = None
    order_index: int = 0


class MilestoneUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: MilestoneStatus | None = None


class MilestoneResponse(BaseModel):
    id: UUID
    plan_id: UUID
    user_id: UUID
    title: str
    description: str | None = None
    order_index: int = 0
    status: MilestoneStatus
    suggested_days: int | None = None
    outcome: str | None = None
    tasks: list[TaskResponse] = []
    created_at: datetime
    updated_at: datetime


class MilestoneInsightResponse(BaseModel):
    milestone_id: UUID
    insight: dict[str, Any]
    raw: str | None = None
    generated: bool = True


# ── Adjustment Suggestions ─────────────────────────────────────────────────────

class AdjustmentSuggestionResponse(BaseModel):
    id: UUID
    plan_id: UUID
    reason: str
    suggested_tasks: list[dict]
    status: AdjustmentStatus
    created_at: datetime
    resolved_at: datetime | None = None


class AdjustmentActionRequest(BaseModel):
    """Used for both approve and dismiss — empty body, action is in the URL."""
    pass


# ── Memory Extraction ──────────────────────────────────────────────────────────

class ExtractMemoryRequest(BaseModel):
    conversation: str = Field(..., min_length=10)


class ExtractedField(BaseModel):
    key: str                              # "goal", "preference", "constraint", "context"
    value: str
    id: str | None = None


class ExtractMemoryResponse(BaseModel):
    extracted: list[ExtractedField]
    count: int


# ── Create Plan from Memory ────────────────────────────────────────────────────

class CreatePlanRequest(BaseModel):
    memory_id: UUID = Field(..., description="ID of the goal memory entry to create a plan from")


class CreatePlanResponse(BaseModel):
    plan: PlanResponse
    milestones: list[MilestoneResponse]
    task_count: int


class TaskDetailResponse(BaseModel):
    task_id: UUID
    detail: dict
    generated: bool


# ── Plan Detail ──────────────────────────────────────────────────────────────────

class PlanDetailStats(BaseModel):
    total_tasks: int = 0
    completed_tasks: int = 0
    remaining_tasks: int = 0
    total_milestones: int = 0
    completed_milestones: int = 0
    progress_pct: int = 0
    current_milestone: dict | None = None
    next_milestone: dict | None = None
    next_task: dict | None = None


class PlanDetailResponse(BaseModel):
    plan: PlanResponse
    stats: PlanDetailStats
    milestones: list[MilestoneResponse]


# ── Plan Chat ────────────────────────────────────────────────────────────────────

class PlanChatRequest(BaseModel):
    message: str = Field(..., min_length=1)


class PlanChatAction(BaseModel):
    action: str  # e.g. "reframe_milestone", "rename_milestone", "add_task", "skip_task", etc.
    target_id: str | None = None
    params: dict = {}


class PlanChatResponse(BaseModel):
    reply: str
    actions: list[PlanChatAction] = []


# ── Plan Setup ──────────────────────────────────────────────────────────────────

class PlanSetupStartRequest(BaseModel):
    memory_id: str = Field(default="", min_length=0)
    conversation: list[dict] = Field(..., min_length=1)


class QuickOption(BaseModel):
    label: str
    value: int | str


class PlanSetupStartResponse(BaseModel):
    plan_id: str
    setup_step: str
    message: str
    quick_options: list[QuickOption]
    memory_summary: str | None = None


class PlanSetupDurationRequest(BaseModel):
    duration_days: int = Field(..., ge=1)


class PlanSetupDurationResponse(BaseModel):
    setup_step: str
    message: str
    quick_options: list[QuickOption]


class PlanSetupScheduleRequest(BaseModel):
    type: str = Field(..., min_length=1)
    days: list[int] | None = None


class PlanSetupScheduleResponse(BaseModel):
    setup_step: str
    plan_id: str
    milestone_count: int | None = None
    first_milestone: str | None = None
    tasks_today: int | None = None
    message: str | None = None
