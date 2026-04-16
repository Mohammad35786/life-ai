from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import json
import re
from datetime import date, timedelta

from uuid import UUID
from typing import Optional

from backend.auth import get_current_user
from backend.lib.llm import (
    _invoke_openai,
    _invoke_gemini,
    _invoke_ollama,
    _invoke_groq,
    _invoke_mistral,
    chatResponse
)
from backend.store import store
from backend.models import RoadmapFolderCreate, RoadmapCreate, RoadmapScheduleRequest

router = APIRouter(prefix="/api/roadmaps", tags=["roadmaps"])

class GenerateRoadmapRequest(BaseModel):
    topic: str
    difficulty: str = "beginner"
    provider: str = "default"  # Can be "default", "openai", "gemini", "ollama", "groq", "mistral"

ROADMAP_PROMPT_TEMPLATE = """You are Roadmap.sh Agent. Your ONLY job is to generate visual roadmaps.

User has requested a roadmap for: {topic}
Difficulty level: {difficulty}

You MUST respond with ONLY a valid JSON object. No Markdown, no extra text, no explanations, no code blocks, no apologies — just pure JSON.

=== REQUIRED JSON SCHEMA (ALWAYS OUTPUT EXACTLY THIS STRUCTURE) ===
{{
  "title": "Roadmap Title",
  "nodes": [
    {{ "id": "1", "type": "main", "data": {{ "label": "...", "description": "..." }}, "position": {{ "x": 0, "y": 0 }} }}
  ],
  "edges": [
    {{ "id": "e1-2", "source": "1", "target": "2" }}
  ],
  "outlines": {{
    "1": {{
      "title": "...",
      "description": "...",
      "subtopics": ["...", "..."],
      "resources": ["...", "..."],
      "estimatedTime": "..."
    }}
  }}
}}

Rules:
- Use only "main", "module", or "side" for type.
- Positions must be numbers (x and y between 0 and 2000).
- Never add any text after the final }} of the JSON. Make sure you close all brackets.
- The outlines dictionary MUST contain a rich syllabus entry keyed by EVERY single node id you generate.
- Make it look exactly like the Claude Code roadmap: main vertical path + side branches.
"""

def extract_json_array_from_text(text: str) -> list:
    """Extract a JSON array from LLM output, handling markdown code fences."""
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "tasks" in data:
            return data["tasks"]
        raise ValueError("Parsed JSON is not a list")
    except json.JSONDecodeError:
        match = re.search(r"(\[.*\])", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except Exception:
                raise ValueError("Failed to parse JSON array")
        raise ValueError("No valid JSON array found in AI response")

def extract_json_from_text(text: str) -> dict:
    # Remove markdown code blocks if the AI accidentally added them
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    try:
        data = json.loads(text)
        return data
    except json.JSONDecodeError:
        # Try finding JSON with regex
        match = re.search(r"(\{.*\})", text, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(1))
                return data
            except Exception:
                raise ValueError("Failed to parse JSON")
        raise ValueError("No valid JSON found in AI response")

@router.post("/generate")
async def generate_roadmap(
    request: GenerateRoadmapRequest,
    user_id: UUID = Depends(get_current_user),
):
    prompt = ROADMAP_PROMPT_TEMPLATE.format(
        topic=request.topic,
        difficulty=request.difficulty
    )

    try:
        provider = request.provider.lower()
        if provider == "openai":
            response_text = _invoke_openai(prompt)
        elif provider == "gemini":
            response_text = _invoke_gemini(prompt)
        elif provider == "ollama":
            response_text = _invoke_ollama(prompt)
        elif provider == "groq":
            response_text = _invoke_groq(prompt)
        elif provider == "mistral":
            response_text = _invoke_mistral(prompt)
        else:
            response_text = chatResponse(prompt)

        roadmap_data = extract_json_from_text(response_text)
        
        # Basic validation
        if "nodes" not in roadmap_data or "edges" not in roadmap_data:
            raise ValueError("Invalid roadmap format returned by AI")

        return {
            "success": True,
            "data": roadmap_data
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

# ── Schedule endpoint helpers ─────────────────────────────────────────────

DAY_NAME_TO_WEEKDAY = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
    "friday": 4, "saturday": 5, "sunday": 6
}

def compute_study_dates(weeks: int, study_days: list[str]) -> list[str]:
    """Return all ISO-format dates in the next `weeks` weeks that fall on study_days."""
    target_weekdays = {
        DAY_NAME_TO_WEEKDAY[d.lower()]
        for d in study_days
        if d.lower() in DAY_NAME_TO_WEEKDAY
    }
    if not target_weekdays:
        return []
    dates: list[str] = []
    today = date.today()
    end = today + timedelta(weeks=weeks)
    current = today
    while current < end:
        if current.weekday() in target_weekdays:
            dates.append(current.isoformat())
        current += timedelta(days=1)
    return dates

def extract_topics_from_roadmap(roadmap_data: dict) -> list[str]:
    """Flatten all outline subtopics (or node labels as fallback) into a topic list."""
    topics: list[str] = []
    outlines: dict = roadmap_data.get("outlines", {})
    nodes: list = roadmap_data.get("nodes", [])
    node_label_map = {n["id"]: n["data"].get("label", "") for n in nodes}

    if outlines:
        for node_id, outline in outlines.items():
            label = node_label_map.get(node_id, outline.get("title", ""))
            subtopics = outline.get("subtopics", [])
            if subtopics:
                for sub in subtopics:
                    topics.append(f"{label}: {sub}")
            else:
                topics.append(label)
    elif nodes:
        for n in nodes:
            label = n["data"].get("label", "")
            if label:
                topics.append(label)

    return [t for t in topics if t.strip()]

SCHEDULE_PROMPT_TEMPLATE = """You are a study schedule planner. Assign every study topic below to one of the available dates.

Available study dates (use ONLY dates from this list):
{dates_list}

Topics to schedule (assign ALL of them — do not skip any):
{topics_list}

Rules:
- Distribute topics evenly. Each date gets 1-3 tasks maximum.
- Keep the original topic order (foundational topics first).
- Use concise, action-oriented task titles: "Study: <topic>", "Practice: <skill>", "Review: <concept>".
- Return ONLY a raw JSON array — no markdown, no explanation, nothing else:
[{{"title": "Study: Topic", "due_date": "YYYY-MM-DD", "priority": "medium"}}]
"""

@router.post("/schedule")
async def schedule_roadmap(
    request: RoadmapScheduleRequest,
    user_id: UUID = Depends(get_current_user),
):
    """Generate a full study schedule from a roadmap and save it as a Plan in the DB."""
    try:
        # 1. Compute all study dates
        study_dates = compute_study_dates(request.weeks, request.study_days)
        if not study_dates:
            return {"success": False, "error": "No valid study dates. Please select at least one study day."}

        # 2. Extract topics from roadmap outlines
        topics = extract_topics_from_roadmap(request.roadmap_data)
        if not topics:
            return {"success": False, "error": "No topics found in roadmap outlines."}

        # 3. Build prompt
        dates_text = "\n".join(f"- {d}" for d in study_dates)
        topics_text = "\n".join(f"{i+1}. {t}" for i, t in enumerate(topics))
        prompt = SCHEDULE_PROMPT_TEMPLATE.format(dates_list=dates_text, topics_list=topics_text)

        # 4. Call LLM
        provider = request.provider.lower()
        if provider == "openai":
            response_text = _invoke_openai(prompt)
        elif provider == "gemini":
            response_text = _invoke_gemini(prompt)
        elif provider == "ollama":
            response_text = _invoke_ollama(prompt)
        elif provider == "groq":
            response_text = _invoke_groq(prompt)
        elif provider == "mistral":
            response_text = _invoke_mistral(prompt)
        else:
            response_text = chatResponse(prompt)

        # 5. Parse the task list
        raw_tasks = extract_json_array_from_text(response_text)
        if not raw_tasks:
            raise ValueError("LLM returned an empty task list")

        cleaned_tasks = [
            {"title": str(t["title"]), "due_date": str(t["due_date"]), "priority": str(t.get("priority", "medium"))}
            for t in raw_tasks if "title" in t and "due_date" in t
        ]
        if not cleaned_tasks:
            raise ValueError("No valid tasks parsed from LLM output")

        # 6. Persist to DB — create Goal + Plan + Tasks
        from backend.models import GoalCreate, TaskCreate, TaskStatus
        roadmap_title = request.roadmap_data.get("title") or "My Roadmap Plan"
        goal = store.create_goal(GoalCreate(
            title=roadmap_title,
            description=f"Study plan auto-generated from roadmap: {roadmap_title}"
        ))

        task_creates = [
            TaskCreate(
                title=t["title"],
                due_date=date.fromisoformat(t["due_date"]),
                status=TaskStatus.todo,
                priority=t["priority"]
            )
            for t in cleaned_tasks
        ]
        plan = store.create_plan(goal.id, task_creates)

        # 7. Return the plan in frontend-friendly format
        return {
            "success": True,
            "plan": {
                "id": str(plan.id),
                "goal_id": str(plan.goal_id),
                "tasks": [
                    {
                        "id": str(t.id),
                        "plan_id": str(t.plan_id),
                        "title": t.title,
                        "due_date": t.due_date.isoformat() if t.due_date else None,
                        "status": t.status.value,
                        "priority": t.priority
                    }
                    for t in plan.tasks
                ],
                "created_at": plan.created_at.isoformat(),
                "textSummary": f"Study plan for: {roadmap_title}",
            },
            "total_sessions": len(study_dates),
            "total_topics": len(topics),
        }

    except Exception as e:
        return {"success": False, "error": str(e)}

@router.post("/folders")
async def create_folder(
    request: RoadmapFolderCreate,
    user_id: UUID = Depends(get_current_user),
):
    try:
        folder = store.create_roadmap_folder(request, user_id=user_id)
        return {"success": True, "folder": folder}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/folders")
async def list_folders(user_id: UUID = Depends(get_current_user)):
    try:
        folders = store.list_roadmap_folders(user_id=user_id)
        return {"success": True, "folders": folders}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/")
async def create_roadmap_db(
    request: RoadmapCreate,
    user_id: UUID = Depends(get_current_user),
):
    try:
        roadmap = store.create_roadmap(request, user_id=user_id)
        return {"success": True, "roadmap": roadmap}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/")
async def list_roadmaps(
    folder_id: Optional[UUID] = None,
    user_id: UUID = Depends(get_current_user),
):
    try:
        roadmaps = store.list_roadmaps(folder_id, user_id=user_id)
        return {"success": True, "roadmaps": roadmaps}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{roadmap_id}")
async def get_roadmap(
    roadmap_id: UUID,
    user_id: UUID = Depends(get_current_user),
):
    try:
        roadmap = store.get_roadmap(roadmap_id)
        if not roadmap:
            raise HTTPException(status_code=404, detail="Roadmap not found")
        # Verify ownership
        if roadmap.user_id and roadmap.user_id != user_id:
            raise HTTPException(status_code=403, detail="Forbidden")
        return {"success": True, "roadmap": roadmap}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
