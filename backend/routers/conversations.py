"""
routers/conversations.py — Chat conversation history CRUD.

All endpoints are protected by JWT auth.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from backend.auth import get_current_user
from backend.models import Conversation, ConversationCreate, ConversationSummary, ConversationUpdate
from backend.store import store

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


@router.post("", response_model=Conversation)
async def create_conversation(
    payload: ConversationCreate,
    user_id: UUID = Depends(get_current_user),
) -> Conversation:
    """Create a new empty conversation session (call on first user message)."""
    try:
        return store.create_conversation(user_id, payload)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("", response_model=list[ConversationSummary])
async def list_conversations(
    user_id: UUID = Depends(get_current_user),
) -> list[ConversationSummary]:
    """List all conversations for the current user, newest first."""
    try:
        return store.list_conversations(user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{conversation_id}", response_model=Conversation)
async def get_conversation(
    conversation_id: UUID,
    user_id: UUID = Depends(get_current_user),
) -> Conversation:
    """Get a single conversation with full message history."""
    conv = store.get_conversation(conversation_id, user_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.patch("/{conversation_id}", response_model=Conversation)
async def update_conversation(
    conversation_id: UUID,
    payload: ConversationUpdate,
    user_id: UUID = Depends(get_current_user),
) -> Conversation:
    """Update conversation title and/or messages array."""
    conv = store.update_conversation(conversation_id, user_id, payload)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.delete("/{conversation_id}")
async def delete_conversation(
    conversation_id: UUID,
    user_id: UUID = Depends(get_current_user),
) -> dict:
    """Delete a conversation and all its messages."""
    # Verify ownership
    conv = store.get_conversation(conversation_id, user_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    store.delete_conversation(conversation_id, user_id)
    return {"success": True}
