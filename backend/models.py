from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


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
    archived: bool | None = None


class Conversation(BaseModel):
    id: UUID
    user_id: UUID
    title: str
    messages: list[ConversationMessage]
    archived: bool = False
    created_at: datetime
    updated_at: datetime


class ConversationSummary(BaseModel):
    """Lightweight version for the History list — no full messages array."""
    id: UUID
    title: str
    preview: str                        # last assistant message snippet
    message_count: int
    archived: bool = False
    updated_at: datetime
    created_at: datetime
