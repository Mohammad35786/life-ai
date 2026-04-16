from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any
import uuid

from backend.lib.db import get_supabase_client
from backend.lib.llm import chatResponse
from backend.config import settings

router = APIRouter(prefix="/api/debug", tags=["debug"])

class DebugResponse(BaseModel):
    success: bool
    data: Any = None
    error: str | None = None

@router.post("/test-db")
def test_supabase_db() -> dict[str, Any]:
    print(f"[DEBUG] supabase_url={settings.supabase_url!r}, key_set={bool(settings.supabase_service_role_key)}")
    supabase = get_supabase_client()
    if not supabase:
        return {"success": False, "error": f"Supabase client not configured. url={settings.supabase_url!r}, key_set={bool(settings.supabase_service_role_key)}"}
    
    try:
        # Write a sample row to chat_history
        test_id = str(uuid.uuid4())
        supabase.table("chat_history").insert({
            "id": test_id,
            "role": "system",
            "content": "Debug DB test write"
        }).execute()
        
        # Read it back
        _, read_rows = supabase.table("chat_history").select("*").eq("id", test_id).execute()
        
        return {
            "success": True,
            "data": read_rows[0] if read_rows else None
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.post("/test-llm")
def test_llm_provider() -> dict[str, Any]:
    try:
        response = chatResponse("Say hello and confirm the provider is working.")
        return {"success": True, "data": {"response": response}}
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.post("/sample-plan")
def create_sample_plan() -> dict[str, Any]:
    supabase = get_supabase_client()
    if not supabase:
        return {"success": False, "error": "Supabase client not configured."}
    
    try:
        goal_id = str(uuid.uuid4())
        plan_id = str(uuid.uuid4())
        
        # Insert goal
        supabase.table("goals").insert({
            "id": goal_id,
            "title": "Debug Test Goal",
            "description": "This is a sample goal automatically generated from the debug panel."
        }).execute()
        
        # Insert plan
        supabase.table("plans").insert({
            "id": plan_id,
            "goal_id": goal_id
        }).execute()
        
        # Insert tasks
        tasks = [
            {"id": str(uuid.uuid4()), "plan_id": plan_id, "title": "Verify setup", "due_date": "2026-05-01", "status": "todo", "priority": "high"},
            {"id": str(uuid.uuid4()), "plan_id": plan_id, "title": "Explore features", "due_date": "2026-05-02", "status": "todo", "priority": "medium"}
        ]
        supabase.table("tasks").insert(tasks).execute()
        
        return {"success": True, "data": {"goal_id": goal_id, "plan_id": plan_id}}
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.get("/sample-plan/{plan_id}")
def load_sample_plan(plan_id: str) -> dict[str, Any]:
    supabase = get_supabase_client()
    if not supabase:
        return {"success": False, "error": "Supabase client not configured."}
    
    try:
        # Fetch plan
        _, plan_rows = supabase.table("plans").select("*").eq("id", plan_id).execute()
        if not plan_rows:
            return {"success": False, "error": "Sample plan not found"}
        plan_data = plan_rows[0]
        
        # Fetch goal
        _, goal_rows = supabase.table("goals").select("*").eq("id", plan_data["goal_id"]).execute()
        goal_data = goal_rows[0] if goal_rows else None
        
        # Fetch tasks
        _, tasks_rows = supabase.table("tasks").select("*").eq("plan_id", plan_id).execute()
        tasks_data = tasks_rows or []
        
        plan_data["tasks"] = tasks_data
        
        return {"success": True, "data": {"goal": goal_data, "plan": plan_data}}
    except Exception as e:
        return {"success": False, "error": str(e)}
