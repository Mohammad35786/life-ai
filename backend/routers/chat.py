from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Any
from uuid import UUID

from backend.auth import get_current_user
from backend.lib.mistral_provider import sendChat, sendChatGuided, MistralProviderError
from backend.lib.roadmap_generator import convert_plan_to_roadmap
from backend.store import store
from backend.models import RoadmapCreate

router = APIRouter(prefix="/api/chat", tags=["chat"])

class ChatRequest(BaseModel):
    message: str
    mode: str | None = "chat"          # ignored for now; kept for frontend compatibility
    source: str | None = "chat"        # "chat" or "guided"
    conversation_id: str | None = None # persist messages to this conversation

# System prompt for guided AI interactions
GUIDED_SYSTEM_PROMPT = """You are an AI planning assistant. Based on the user query, respond in a structured, helpful way. If the query is about learning or planning, provide step-by-step roadmap or actionable plan.

For career-related queries: Respond with structured career options and roadmap.
For job-related queries: Respond with job plan and resume/interview advice.
For learning/roadmap queries: Generate roadmap with phases and tasks.
For quiz/test queries: Generate quiz questions with MCQ or short questions format.

Response format for learning/roadmap:
{
  "title": "Roadmap Title",
  "phases": [
    {
      "name": "Phase Name",
      "tasks": ["Task 1", "Task 2", "Task 3"]
    }
  ]
}

Response format for quiz:
{
  "questions": [
    {
      "question": "Question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answer": "A"
    }
  ]
}

Always provide helpful, actionable responses."""

def _route_query(message: str) -> str:
    """Determine routing based on message content."""
    msg_lower = message.lower()
    
    if any(word in msg_lower for word in ["career", "career path", "career option"]):
        return "career"
    elif any(word in msg_lower for word in ["job", "resume", "interview", "hiring"]):
        return "job"
    elif any(word in msg_lower for word in ["learn", "learning", "roadmap", "topic", "plan", "7-day", "7 day"]):
        return "learn"
    elif any(word in msg_lower for word in ["test", "quiz", "practice", "knowledge", "skill level", "evaluate"]):
        return "test"
    else:
        return "general"

@router.post("")
@router.post("/")
def chat_endpoint(
    data: ChatRequest,
    user_id: UUID = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        print("[api/chat] request_body=", data.model_dump())
    except Exception:
        print("[api/chat] request_body=<failed to dump>")

    if not data.message or not data.message.strip():
        raise HTTPException(status_code=400, detail="Empty input")

    try:
        # Use guided handler for guided panel inputs
        if data.source == "guided":
            route_type = _route_query(data.message)
            reply = sendChatGuided(data.message, route_type, GUIDED_SYSTEM_PROMPT)
            return {"reply": reply, "route_type": route_type}
        
        # Regular chat handler
        reply = sendChat([{"role": "user", "content": data.message}])
        return {"reply": reply}
    except MistralProviderError as e:
        detail = str(e)
        print(f"[api/chat] mistral_error={detail}")
        raise HTTPException(status_code=500, detail=detail)
    except Exception as e:
        detail = f"Chat failed: {str(e)}"
        print(f"[api/chat] error={detail}")
        raise HTTPException(status_code=500, detail=detail)


class ConvertToRoadmapRequest(BaseModel):
    written_plan: str
    original_message: str
    difficulty: str = "beginner"
    provider: str = "default"
    folder_id: str | None = None


@router.post("/convert-to-roadmap")
async def convert_to_roadmap_endpoint(
    data: ConvertToRoadmapRequest,
    user_id: UUID = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Takes a written plan (from chat) + original user message,
    converts it into a visual roadmap JSON using the existing
    roadmap generator, saves it to DB, and returns the roadmap data.
    """
    if not data.written_plan or not data.written_plan.strip():
        raise HTTPException(status_code=400, detail="Empty written plan")

    try:
        # 1. Convert written plan → roadmap JSON (reuses existing logic)
        roadmap_data = convert_plan_to_roadmap(
            written_plan=data.written_plan,
            original_message=data.original_message,
            difficulty=data.difficulty,
            provider=data.provider,
        )

        # 2. Auto-save to DB so it appears in "Roadmaps" tab
        folder_uuid = UUID(data.folder_id) if data.folder_id else None

        saved = store.create_roadmap(RoadmapCreate(
            folder_id=folder_uuid,
            title=roadmap_data.get("title", "Chat Roadmap"),
            topic=data.original_message[:120],
            difficulty=data.difficulty,
            provider=data.provider,
            data=roadmap_data,
        ), user_id=user_id)

        # 3. Return both the roadmap data AND the saved DB record
        return {
            "success": True,
            "data": roadmap_data,
            "roadmap": {
                "id": str(saved.id),
                "folder_id": str(saved.folder_id) if saved.folder_id else None,
                "title": saved.title,
                "topic": saved.topic,
                "difficulty": saved.difficulty,
                "provider": saved.provider,
                "data": saved.data,
                "created_at": saved.created_at.isoformat(),
            },
        }
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        detail = f"Conversion failed: {str(e)}"
        print(f"[api/chat/convert-to-roadmap] error={detail}")
        raise HTTPException(status_code=500, detail=detail)
