"""Adaptive planning API routes — scheduler, events, preferences, adjustments."""

from __future__ import annotations

from datetime import date, datetime
import json
import logging
import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

logger = logging.getLogger(__name__)

from backend.auth import get_current_user
from backend.adaptive.db import adaptive_store
from backend.adaptive.models import AdjustmentStatus, EventType, MemoryKey, MilestoneStatus, PlanPriority, PlanStatus, TaskStatus
from backend.adaptive.schemas import (
    AdjustmentActionRequest,
    AdjustmentSuggestionResponse,
    CreatePlanRequest,
    CreatePlanResponse,
    DailyTasksResponse,
    EventCreateRequest,
    EventResponse,
    ExtractMemoryRequest,
    FeedbackRequest,
    PlanSetupDurationRequest,
    PlanSetupDurationResponse,
    PlanSetupScheduleRequest,
    PlanSetupScheduleResponse,
    PlanSetupStartRequest,
    PlanSetupStartResponse,
    MemoryCreateRequest,
    MemoryResponse,
    MilestoneCreate,
    MilestoneInsightResponse,
    MilestoneResponse,
    MilestoneUpdate,
    PlanChatRequest,
    PlanChatResponse,
    PlanChatAction,
    PlanControlRequest,
    PlanDetailResponse,
    PlanDetailStats,
    PlanResponse,
    PlanUpdateRequest,
    SkipRequest,
    TaskDetailResponse,
    TaskResponse,
    TaskUpdateRequest,
    UserPreferencesResponse,
    UserPreferencesUpdate,
)
from backend.adaptive.services.adjuster import adjuster_service
from backend.adaptive.services.eod_adjuster import eod_adjuster_service
from backend.adaptive.services.events import events_service
from backend.adaptive.services.llm_adjuster import llm_adjuster_service
from backend.adaptive.services.memory_extractor import extract_and_save
from backend.adaptive.services.plan_generator import plan_generator_service
from backend.adaptive.services.milestone_generator import generate as generate_milestones
from backend.adaptive.services.plan_setup import get_setup_state, save_duration, save_schedule, start_plan_setup
from backend.adaptive.services.task_generator import generate_for_milestone
from backend.adaptive.services.scheduler import scheduler_service
from backend.adaptive.services.task_detail_generator import task_detail_generator_service
from backend.adaptive.services.context_builder import build as build_context
from backend.lib.llm import chatResponse

router = APIRouter(prefix="/api/adaptive", tags=["adaptive"])


MILESTONE_INSIGHT_PROMPT = """You are a planning assistant. Given a milestone and its tasks, generate structured insight to help the user succeed.

Return EXACTLY a JSON object with these keys:
- "summary": string
- "what_you_should_do_next": array of strings (3-7 items)
- "risks_or_blockers": array of strings (0-6 items)
- "suggested_schedule": array of objects with keys: "day" (string), "focus" (string)

Do not include any markdown blocks or code fences. Output JSON only.

Milestone: {milestone}
Tasks: {tasks}
"""


def _strip_code_fences(content: str) -> str:
    c = (content or "").strip()
    if c.startswith("```json"):
        c = c[7:]
    if c.startswith("```"):
        c = c[3:]
    if c.endswith("```"):
        c = c[:-3]
    return c.strip()


def _extract_json_object(content: str) -> str:
    """Best-effort extraction of a JSON object from model output."""
    c = _strip_code_fences(content)
    match = re.search(r"\{[\s\S]*\}", c)
    return match.group(0) if match else c


def _try_parse_json(content: str) -> tuple[dict | None, str]:
    raw = _extract_json_object(content)
    try:
        return json.loads(raw), raw
    except Exception:
        return None, raw


# ── Preferences ────────────────────────────────────────────────────────────────

@router.get("/preferences", response_model=UserPreferencesResponse)
async def get_preferences(
    user_id: UUID = Depends(get_current_user),
):
    prefs = adaptive_store.ensure_preferences(user_id)
    return UserPreferencesResponse(
        user_id=prefs.user_id,
        max_tasks_per_day=prefs.max_tasks_per_day,
        created_at=prefs.created_at,
        updated_at=prefs.updated_at,
    )


@router.put("/preferences", response_model=UserPreferencesResponse)
async def update_preferences(
    payload: UserPreferencesUpdate,
    user_id: UUID = Depends(get_current_user),
):
    prefs = adaptive_store.update_preferences(user_id, payload.max_tasks_per_day)
    if prefs is None:
        prefs = adaptive_store.create_preferences(user_id, payload.max_tasks_per_day)
    return UserPreferencesResponse(
        user_id=prefs.user_id,
        max_tasks_per_day=prefs.max_tasks_per_day,
        created_at=prefs.created_at,
        updated_at=prefs.updated_at,
    )


# ── Scheduler ──────────────────────────────────────────────────────────────────

@router.get("/scheduler/daily", response_model=DailyTasksResponse)
async def get_daily_tasks(
    on_date: date | None = None,
    user_id: UUID = Depends(get_current_user),
):
    result = scheduler_service.get_daily_tasks(user_id, on_date)
    return DailyTasksResponse(
        date=result["date"],
        tasks=[_task_to_response(t) for t in result["tasks"]],
        total_available=result["total_available"],
        selected_count=result["selected_count"],
        max_tasks_per_day=result["max_tasks_per_day"],
    )


# ── Events ─────────────────────────────────────────────────────────────────────

@router.post("/events", response_model=EventResponse)
async def create_event(
    payload: EventCreateRequest,
    user_id: UUID = Depends(get_current_user),
):
    event = events_service.record(
        user_id=user_id,
        task_id=payload.task_id,
        plan_id=payload.plan_id,
        event_type=payload.event_type,
        feedback_rating=payload.feedback_rating,
        feedback_text=payload.feedback_text,
    )
    return EventResponse(
        id=event.id,
        user_id=event.user_id,
        task_id=event.task_id,
        plan_id=event.plan_id,
        event_type=event.event_type,
        feedback_rating=event.feedback_rating,
        feedback_text=event.feedback_text,
        created_at=event.created_at,
    )


@router.get("/events", response_model=list[EventResponse])
async def list_events(
    task_id: UUID | None = None,
    event_type: EventType | None = None,
    user_id: UUID = Depends(get_current_user),
):
    if task_id:
        events = adaptive_store.get_events_for_task(task_id)
    else:
        events = adaptive_store.get_events_for_user(user_id, event_type=event_type)
    return [
        EventResponse(
            id=e.id,
            user_id=e.user_id,
            task_id=e.task_id,
            plan_id=e.plan_id,
            event_type=e.event_type,
            feedback_rating=e.feedback_rating,
            feedback_text=e.feedback_text,
            created_at=e.created_at,
        )
        for e in events
    ]


# ── Task Management ────────────────────────────────────────────────────────────

@router.get("/tasks/today", response_model=list[TaskResponse])
async def get_tasks_today(
    user_id: UUID = Depends(get_current_user),
):
    try:
        tasks = adaptive_store.get_tasks_for_date(user_id, date.today())
        return [_task_to_response(t) for t in tasks]
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"Error in get_tasks_today: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"get_tasks_today failed: {str(e)}")


@router.post("/tasks/update", response_model=TaskResponse)
async def update_task_status(
    payload: TaskUpdateRequest,
    user_id: UUID = Depends(get_current_user),
):
    try:
        task = adaptive_store.get_task(payload.task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="Task not found")

        if payload.status == TaskStatus.pending:
            # Undoing a task
            updated = adaptive_store.update_task_status(task.id, TaskStatus.pending)
            if updated is None:
                raise HTTPException(status_code=500, detail="Failed to update task to pending")
            return _task_to_response(updated)

        # Map status → event type
        status_to_event = {
            TaskStatus.done: EventType.done,
            TaskStatus.skipped: EventType.skipped,
            TaskStatus.partial: EventType.partial,
        }
        event_type = status_to_event.get(payload.status)
        if event_type is None:
            raise HTTPException(status_code=400, detail=f"Cannot update to status '{payload.status.value}'. Only done, skipped, partial allowed.")

        # Record event (also updates task status internally)
        events_service.record(
            user_id=user_id,
            task_id=task.id,
            plan_id=task.plan_id,
            event_type=event_type,
            feedback_text=payload.feedback_text,
        )

        # Auto-adjustment: if skipped, reschedule to tomorrow
        if payload.status == TaskStatus.skipped:
            adjuster_service.handle_skip(user_id, task.id)

        updated = adaptive_store.get_task(task.id)
        if updated is None:
            task.status = payload.status
            updated = task
        return _task_to_response(updated)
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"Error in update_task_status: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"update_task_status failed: {str(e)}")



# ── Task Detail (lazy generation) ──────────────────────────────────────────────

@router.get("/tasks/{task_id}/detail", response_model=TaskDetailResponse)
async def get_task_detail(
    task_id: UUID,
    user_id: UUID = Depends(get_current_user),
):
    task = adaptive_store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    # If detail already cached, return it immediately
    if task.detail_json:
        return TaskDetailResponse(
            task_id=task.id,
            detail=task.detail_json,
            generated=False,
        )

    # Lazy-generate detail via LLM
    plan = adaptive_store.get_plan(task.plan_id)
    plan_context = ""
    if plan and plan.title:
        plan_context = plan.title

    # Gather user memory for context
    all_memory = adaptive_store.list_memory(user_id)
    user_memory = {m.key.value: m.value for m in all_memory}

    # Build context-aware system prompt for personalised guide
    system_prompt = None
    try:
        session = {"active_tab": "today", "open_plan_id": str(task.plan_id), "open_task_id": str(task_id)}
        system_prompt = await build_context(str(user_id), session, adaptive_store)
    except Exception as e:
        logger.warning("context_builder failed for task detail: %s", e)

    detail = task_detail_generator_service.generate_task_detail(
        task_id=task.id,
        task_title=task.title,
        plan_context=plan_context,
        user_memory=user_memory,
        system=system_prompt,
    )

    # Cache on the task record
    adaptive_store.update_task_detail_json(task.id, detail)

    return TaskDetailResponse(
        task_id=task.id,
        detail=detail,
        generated=True,
    )


# ── Automatic Adjustments ─────────────────────────────────────────────────────

@router.post("/tasks/{task_id}/reschedule", response_model=TaskResponse)
async def reschedule_task(
    task_id: UUID,
    new_date: date,
    user_id: UUID = Depends(get_current_user),
):
    task = adaptive_store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    updated = adaptive_store.reschedule_task(task_id, new_date)
    if updated:
        adaptive_store.record_event(
            user_id=user_id,
            task_id=task_id,
            plan_id=task.plan_id,
            event_type=EventType.rescheduled,
            feedback_text=f"manually rescheduled to {new_date.isoformat()}",
        )
    return _task_to_response(adaptive_store.get_task(task_id))


@router.post("/tasks/busy", response_model=list[TaskResponse])
async def mark_busy(
    user_id: UUID = Depends(get_current_user),
):
    rescheduled = adjuster_service.handle_busy(user_id)
    return [_task_to_response(t) for t in rescheduled]


@router.post("/tasks/overflow", response_model=list[TaskResponse])
async def reschedule_overflow(
    user_id: UUID = Depends(get_current_user),
):
    rescheduled = adjuster_service.reschedule_overflow(user_id)
    return [_task_to_response(t) for t in rescheduled]


@router.post("/tasks/pull-next", response_model=TaskResponse)
async def pull_next_task(
    plan_id: UUID | None = None,
    user_id: UUID = Depends(get_current_user),
):
    task = adjuster_service.pull_next_task(user_id, plan_id)
    if task is None:
        raise HTTPException(status_code=404, detail="No pending tasks available to pull")
    return _task_to_response(task)


# ── End-of-Day Adjustment ─────────────────────────────────────────────────────

@router.post("/eod-adjustment")
async def run_eod_adjustment(
    user_id: UUID = Depends(get_current_user),
):
    result = eod_adjuster_service.run_eod_adjustment(user_id)
    return result


# ── Task shortcuts ─────────────────────────────────────────────────────────────

@router.post("/tasks/{task_id}/skip", response_model=TaskResponse)
async def skip_task(
    task_id: UUID,
    payload: SkipRequest = SkipRequest(),
    user_id: UUID = Depends(get_current_user),
):
    task = adaptive_store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    events_service.record(
        user_id=user_id,
        task_id=task_id,
        plan_id=task.plan_id,
        event_type=EventType.skipped,
        feedback_text=payload.feedback_text,
    )
    updated = adaptive_store.get_task(task_id)
    return _task_to_response(updated)


@router.post("/tasks/{task_id}/feedback", response_model=EventResponse)
async def submit_feedback(
    task_id: UUID,
    payload: FeedbackRequest,
    user_id: UUID = Depends(get_current_user),
):
    task = adaptive_store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    event = events_service.record(
        user_id=user_id,
        task_id=task_id,
        plan_id=task.plan_id,
        event_type=EventType.feedback,
        feedback_rating=payload.feedback_rating,
        feedback_text=payload.feedback_text,
    )
    return EventResponse(
        id=event.id,
        user_id=event.user_id,
        task_id=event.task_id,
        plan_id=event.plan_id,
        event_type=event.event_type,
        feedback_rating=event.feedback_rating,
        feedback_text=event.feedback_text,
        created_at=event.created_at,
    )


# ── Memory ─────────────────────────────────────────────────────────────────────

@router.post("/memory", response_model=MemoryResponse)
async def create_memory(
    payload: MemoryCreateRequest,
    user_id: UUID = Depends(get_current_user),
):
    mem = adaptive_store.create_memory(
        user_id=user_id,
        key=payload.key,
        value=payload.value,
        source=payload.source,
        goal_id=payload.goal_id,
    )
    return _memory_to_response(mem)


@router.get("/memory", response_model=list[MemoryResponse])
async def list_memory(
    key: MemoryKey | None = None,
    user_id: UUID = Depends(get_current_user),
):
    mems = adaptive_store.list_memory(user_id, key=key)
    return [_memory_to_response(m) for m in mems]


@router.delete("/memory/{memory_id}")
async def delete_memory(
    memory_id: UUID,
    user_id: UUID = Depends(get_current_user),
):
    mem = adaptive_store.get_memory(memory_id)
    if mem is None or mem.user_id != user_id:
        raise HTTPException(status_code=404, detail="Memory item not found")
    # Delete via Supabase
    res = adaptive_store.client.table("memory").delete().eq("id", str(memory_id)).eq("user_id", str(user_id)).execute()
    return {"deleted": True}


@router.post("/memory/extract", response_model=MemoryResponse)
async def extract_memory_v2(
    payload: ExtractMemoryRequest,
    user_id: UUID = Depends(get_current_user),
):
    """Extract structured memory from conversation and save as a single memory row."""
    conversation = [{"role": "user", "content": payload.conversation}]
    mem = await extract_and_save(str(user_id), conversation, adaptive_store)
    return MemoryResponse(
        id=mem.id,
        user_id=mem.user_id,
        key=mem.key,
        value=mem.value,
        source=mem.source,
        goal_id=mem.goal_id,
        created_at=mem.created_at,
        updated_at=mem.updated_at,
    )


# ── Plans (adaptive extensions) ────────────────────────────────────────────────

@router.get("/plans", response_model=list[PlanResponse])
async def list_active_plans(
    user_id: UUID = Depends(get_current_user),
):
    try:
        plans = adaptive_store.list_active_plans(user_id)
        return [_plan_to_response(p) for p in plans]
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"Error in list_active_plans: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"list_active_plans failed: {str(e)}")


@router.get("/plans/all", response_model=list[PlanResponse])
async def list_all_plans(
    user_id: UUID = Depends(get_current_user),
):
    """All plans including paused and completed."""
    try:
        plans = adaptive_store.list_all_plans(user_id)
        return [_plan_to_response(p) for p in plans]
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"Error in list_all_plans: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"list_all_plans failed: {str(e)}")


@router.delete("/plans/{plan_id}")
async def delete_plan(
    plan_id: UUID,
    user_id: UUID = Depends(get_current_user),
):
    plan = adaptive_store.get_plan(plan_id)
    if plan is None or (plan.user_id and plan.user_id != user_id):
        raise HTTPException(status_code=404, detail="Plan not found")
    # Delete tasks, milestones, then plan
    adaptive_store.client.table("tasks").delete().eq("plan_id", str(plan_id)).execute()
    adaptive_store.client.table("milestones").delete().eq("plan_id", str(plan_id)).execute()
    adaptive_store.client.table("plans").delete().eq("id", str(plan_id)).execute()
    return {"deleted": True}


@router.post("/plans/generate", response_model=CreatePlanResponse)
async def generate_plan(
    payload: CreatePlanRequest,
    user_id: UUID = Depends(get_current_user),
):
    """Alias for /create-plan — same logic, friendlier URL."""
    result = plan_generator_service.create_plan_from_memory(user_id, payload.memory_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    plan = result["plan"]
    milestone_results = result["milestones"]
    total_tasks = sum(len(ms["tasks"]) for ms in milestone_results)

    milestone_responses = []
    for ms_data in milestone_results:
        ms = ms_data["milestone"]
        tasks = ms_data["tasks"]
        milestone_responses.append(_milestone_to_response(ms, tasks))

    return CreatePlanResponse(
        plan=PlanResponse(
            id=plan.id,
            goal_id=plan.goal_id,
            memory_id=getattr(plan, 'memory_id', None),
            user_id=plan.user_id,
            title=plan.title,
            status=plan.status,
            priority=plan.priority,
            intensity=plan.intensity,
            created_at=plan.created_at,
            updated_at=plan.updated_at,
        ),
        milestones=milestone_responses,
        task_count=total_tasks,
    )


@router.post("/plan/pause", response_model=PlanResponse)
async def pause_plan(
    payload: PlanControlRequest,
    user_id: UUID = Depends(get_current_user),
):
    plan = adaptive_store.get_plan(payload.plan_id)
    if plan is None or plan.user_id != user_id:
        raise HTTPException(status_code=404, detail="Plan not found")
    if plan.status == PlanStatus.paused:
        raise HTTPException(status_code=400, detail="Plan is already paused")
    updated = adaptive_store.update_plan(payload.plan_id, status=PlanStatus.paused)
    if updated is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    return _plan_to_response(updated)


@router.post("/plan/resume", response_model=PlanResponse)
async def resume_plan(
    payload: PlanControlRequest,
    user_id: UUID = Depends(get_current_user),
):
    plan = adaptive_store.get_plan(payload.plan_id)
    if plan is None or plan.user_id != user_id:
        raise HTTPException(status_code=404, detail="Plan not found")
    if plan.status != PlanStatus.paused:
        raise HTTPException(status_code=400, detail="Only paused plans can be resumed")
    updated = adaptive_store.update_plan(payload.plan_id, status=PlanStatus.active)
    if updated is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    return _plan_to_response(updated)


@router.post("/plan/update", response_model=PlanResponse)
async def update_plan(
    payload: PlanUpdateRequest,
    plan_id: UUID,
    user_id: UUID = Depends(get_current_user),
):
    plan = adaptive_store.get_plan(plan_id)
    if plan is None or plan.user_id != user_id:
        raise HTTPException(status_code=404, detail="Plan not found")
    updated = adaptive_store.update_plan(
        plan_id,
        status=payload.status,
        priority=payload.priority,
        title=payload.title,
        intensity=payload.intensity,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    return _plan_to_response(updated)


@router.patch("/plans/{plan_id}", response_model=PlanResponse)
async def patch_plan(
    plan_id: UUID,
    payload: PlanUpdateRequest,
    user_id: UUID = Depends(get_current_user),
):
    plan = adaptive_store.get_plan(plan_id)
    if plan is None or (plan.user_id and plan.user_id != user_id):
        raise HTTPException(status_code=404, detail="Plan not found")
    updated = adaptive_store.update_plan(
        plan_id,
        status=payload.status,
        priority=payload.priority,
        title=payload.title,
        intensity=payload.intensity,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    return _plan_to_response(updated)


# ── Plan Detail ──────────────────────────────────────────────────────────────────

PLAN_CHAT_SYSTEM_PROMPT = """You are Life Agent — an AI planning assistant embedded inside a Plan Detail view. You have full context about this plan, its milestones, and tasks.

When the user asks for changes, respond with a JSON block wrapped in ```plan-actions``` code fences containing an array of action objects. Each action has:
- "action": one of "reframe_milestone", "rename_milestone", "add_task", "remove_task", "reorder_task", "change_next_task", "split_milestone", "skip_task", "mark_blocked"
- "target_id": the UUID of the milestone or task being modified (if applicable)
- "params": object with action-specific parameters (e.g. {"title": "new name"}, {"description": "..."})

You may include explanatory text BEFORE the code fence. If no actions are needed, just respond with helpful text and no code fence.

Always be specific — reference actual milestone and task names from the plan context."""


@router.get("/plans/{plan_id}/detail", response_model=PlanDetailResponse)
async def get_plan_detail(
    plan_id: UUID,
    user_id: UUID = Depends(get_current_user),
):
    """Full plan detail with aggregated stats, milestones, and tasks."""
    plan = adaptive_store.get_plan(plan_id)
    if plan is None or (plan.user_id and plan.user_id != user_id):
        raise HTTPException(status_code=404, detail="Plan not found")

    milestones = adaptive_store.get_milestones_for_plan(user_id, plan_id)

    # Aggregate stats
    total_tasks = 0
    completed_tasks = 0
    current_ms = None
    next_ms = None
    next_task = None

    for i, ms in enumerate(milestones):
        tasks = adaptive_store.get_tasks_for_milestone(user_id, ms.id)
        ms_tasks_count = len(tasks)
        ms_done = sum(1 for t in tasks if t.status.value == "done")
        total_tasks += ms_tasks_count
        completed_tasks += ms_done

        if ms.status.value == "active" and current_ms is None:
            current_ms = {"id": str(ms.id), "title": ms.title, "order_index": ms.order_index}
            # Next milestone
            if i + 1 < len(milestones):
                next_ms_item = milestones[i + 1]
                next_ms = {"id": str(next_ms_item.id), "title": next_ms_item.title, "order_index": next_ms_item.order_index}
            # Next pending task
            for t in tasks:
                if t.status.value == "pending" and next_task is None:
                    next_task = {"id": str(t.id), "title": t.title, "milestone_id": str(t.milestone_id) if t.milestone_id else None}

    completed_milestones = sum(1 for m in milestones if m.status.value == "completed")
    remaining_tasks = total_tasks - completed_tasks
    progress_pct = int((completed_tasks / total_tasks) * 100) if total_tasks > 0 else 0

    stats = PlanDetailStats(
        total_tasks=total_tasks,
        completed_tasks=completed_tasks,
        remaining_tasks=remaining_tasks,
        total_milestones=len(milestones),
        completed_milestones=completed_milestones,
        progress_pct=progress_pct,
        current_milestone=current_ms,
        next_milestone=next_ms,
        next_task=next_task,
    )

    milestone_responses = []
    for ms in milestones:
        tasks = adaptive_store.get_tasks_for_milestone(user_id, ms.id)
        milestone_responses.append(_milestone_to_response(ms, tasks))

    return PlanDetailResponse(
        plan=_plan_to_response(plan),
        stats=stats,
        milestones=milestone_responses,
    )


@router.post("/plans/{plan_id}/chat", response_model=PlanChatResponse)
async def plan_chat(
    plan_id: UUID,
    payload: PlanChatRequest,
    user_id: UUID = Depends(get_current_user),
):
    """AI chat about a specific plan — returns reply + optional structured actions."""
    plan = adaptive_store.get_plan(plan_id)
    if plan is None or (plan.user_id and plan.user_id != user_id):
        raise HTTPException(status_code=404, detail="Plan not found")

    # Build plan-specific context summary (no heavy build_context call)
    milestones = adaptive_store.get_milestones_for_plan(user_id, plan_id)
    plan_summary_lines = [f"Plan: {plan.title} (status: {plan.status.value})"]
    for ms in milestones:
        tasks = adaptive_store.get_tasks_for_milestone(user_id, ms.id)
        done = sum(1 for t in tasks if t.status.value == "done")
        plan_summary_lines.append(
            f"  Milestone {ms.order_index + 1}: {ms.title} [{ms.status.value}] — {done}/{len(tasks)} tasks done"
        )
        for t in tasks[:8]:
            plan_summary_lines.append(f"    - {t.title} [{t.status.value}]")

    context_block = "\n".join(plan_summary_lines)

    # System prompt = plan context + plan chat instructions
    full_system = f"{PLAN_CHAT_SYSTEM_PROMPT}\n\n=== CURRENT PLAN CONTEXT ===\n{context_block}"
    prompt = payload.message

    try:
        content = chatResponse(prompt, system=full_system)
    except Exception as exc:
        logger.exception("Plan chat LLM call failed")
        return PlanChatResponse(reply=f"Sorry, I couldn't process that: {exc}", actions=[])

    # Parse actions from ```plan-actions``` code fences
    actions: list[PlanChatAction] = []
    reply_text = content
    action_match = re.search(r"```plan-actions\s*\n([\s\S]*?)\n```", content)
    if action_match:
        try:
            action_json = json.loads(action_match.group(1))
            if isinstance(action_json, list):
                for a in action_json:
                    actions.append(PlanChatAction(
                        action=a.get("action", ""),
                        target_id=a.get("target_id"),
                        params=a.get("params", {}),
                    ))
            elif isinstance(action_json, dict):
                actions.append(PlanChatAction(
                    action=action_json.get("action", ""),
                    target_id=action_json.get("target_id"),
                    params=action_json.get("params", {}),
                ))
        except json.JSONDecodeError:
            pass
        # Remove the code fence from the reply text
        reply_text = content[:action_match.start()] + content[action_match.end():]
        reply_text = reply_text.strip()

    return PlanChatResponse(reply=reply_text, actions=actions)


# ── Plan Setup (interactive dialogue) ──────────────────────────────────────────

@router.post("/plans/setup/start", response_model=PlanSetupStartResponse)
async def plan_setup_start(
    payload: PlanSetupStartRequest,
    user_id: UUID = Depends(get_current_user),
):
    """Extract memory from conversation and start the interactive plan setup dialogue."""
    # Step 1: Extract memory
    mem = await extract_and_save(str(user_id), payload.conversation, adaptive_store)

    # Step 2: Start plan setup linked to the memory row
    result = await start_plan_setup(str(user_id), str(mem.id), adaptive_store)

    # Derive a short summary from the memory value
    memory_summary = None
    try:
        parsed = json.loads(mem.value)
        memory_summary = parsed.get("summary") or parsed.get("goal")
    except (json.JSONDecodeError, AttributeError):
        memory_summary = mem.value[:120] if mem.value else None

    return PlanSetupStartResponse(
        plan_id=result["plan_id"],
        setup_step=result["setup_step"],
        message=result["message"],
        quick_options=result["quick_options"],
        memory_summary=memory_summary,
    )


@router.post("/plans/{plan_id}/setup/duration", response_model=PlanSetupDurationResponse)
async def plan_setup_duration(
    plan_id: UUID,
    payload: PlanSetupDurationRequest,
    user_id: UUID = Depends(get_current_user),
):
    """Save the chosen duration for a plan in setup."""
    plan = adaptive_store.get_plan(plan_id)
    if plan is None or (plan.user_id and plan.user_id != user_id):
        raise HTTPException(status_code=404, detail="Plan not found")

    result = await save_duration(str(user_id), str(plan_id), payload.duration_days, adaptive_store)
    return PlanSetupDurationResponse(
        setup_step=result["setup_step"],
        message=result["message"],
        quick_options=result["quick_options"],
    )


@router.post("/plans/{plan_id}/setup/schedule", response_model=PlanSetupScheduleResponse)
async def plan_setup_schedule(
    plan_id: UUID,
    payload: PlanSetupScheduleRequest,
    user_id: UUID = Depends(get_current_user),
):
    """Save schedule preferences for a plan in setup. Triggers milestone generation when complete."""
    plan = adaptive_store.get_plan(plan_id)
    if plan is None or (plan.user_id and plan.user_id != user_id):
        raise HTTPException(status_code=404, detail="Plan not found")

    schedule_prefs = {"type": payload.type}
    if payload.days is not None:
        schedule_prefs["days"] = payload.days

    result = await save_schedule(str(user_id), str(plan_id), schedule_prefs, adaptive_store)

    # If setup is complete, trigger milestone + task generation
    if result["setup_step"] == "complete":
        milestones = []
        first_milestone_title = None
        tasks_today = 0
        try:
            milestones = await generate_milestones(str(plan_id), str(user_id), adaptive_store)
            # Generate tasks for the first (active) milestone only
            if milestones:
                first_milestone_title = milestones[0].title
                tasks = await generate_for_milestone(str(milestones[0].id), str(user_id), adaptive_store)
                today_iso = date.today().isoformat()
                tasks_today = sum(1 for t in tasks if t.due_date and t.due_date.isoformat() == today_iso)
        except Exception as e:
            logger.warning("Milestone/task generation failed for plan %s: %s", plan_id, e)

        milestone_count = len(milestones)
        message = f"Your plan is ready. You have {tasks_today} task{'s' if tasks_today != 1 else ''} scheduled for today."

        return PlanSetupScheduleResponse(
            setup_step="ready",
            plan_id=str(plan.id),
            milestone_count=milestone_count,
            first_milestone=first_milestone_title,
            tasks_today=tasks_today,
            message=message,
        )

    return PlanSetupScheduleResponse(
        setup_step=result["setup_step"],
        plan_id=result.get("plan_id", str(plan.id)),
    )


# ── Create Plan from Memory ───────────────────────────────────────────────────

@router.post("/create-plan", response_model=CreatePlanResponse)
async def create_plan_from_memory(
    payload: CreatePlanRequest,
    user_id: UUID = Depends(get_current_user),
):
    result = plan_generator_service.create_plan_from_memory(user_id, payload.memory_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    plan = result["plan"]
    milestone_results = result["milestones"]
    total_tasks = sum(len(ms["tasks"]) for ms in milestone_results)

    milestone_responses = []
    for ms_data in milestone_results:
        ms = ms_data["milestone"]
        tasks = ms_data["tasks"]
        milestone_responses.append(_milestone_to_response(ms, tasks))

    return CreatePlanResponse(
        plan=PlanResponse(
            id=plan.id,
            goal_id=plan.goal_id,
            memory_id=getattr(plan, 'memory_id', None),
            user_id=plan.user_id,
            title=plan.title,
            status=plan.status,
            priority=plan.priority,
            intensity=plan.intensity,
            created_at=plan.created_at,
            updated_at=plan.updated_at,
        ),
        milestones=milestone_responses,
        task_count=total_tasks,
    )


# ── Memory Extraction ──────────────────────────────────────────────────────────

@router.post("/extract-memory", response_model=MemoryResponse)
async def extract_memory(
    payload: ExtractMemoryRequest,
    user_id: UUID = Depends(get_current_user),
):
    conversation = [{"role": "user", "content": payload.conversation}]
    mem = await extract_and_save(str(user_id), conversation, adaptive_store)
    return MemoryResponse(
        id=mem.id,
        user_id=mem.user_id,
        key=mem.key,
        value=mem.value,
        source=mem.source,
        goal_id=mem.goal_id,
        created_at=mem.created_at,
        updated_at=mem.updated_at,
    )


# ── Adjustment Suggestions ─────────────────────────────────────────────────────

@router.get("/adjustments", response_model=list[AdjustmentSuggestionResponse])
async def list_adjustments(
    user_id: UUID = Depends(get_current_user),
):
    suggestions = adaptive_store.list_pending_suggestions(user_id)
    results = []
    for s in suggestions:
        # If suggestion has no tasks yet, try generating via LLM
        if not s.suggested_tasks:
            generated = llm_adjuster_service.generate_suggestions(s.id)
            if generated:
                # Re-fetch after LLM fills in
                s = adaptive_store.get_suggestion(s.id)
        results.append(_suggestion_to_response(s))
    return results


@router.post("/adjustments/{suggestion_id}/approve", response_model=AdjustmentSuggestionResponse)
async def approve_adjustment(
    suggestion_id: UUID,
    user_id: UUID = Depends(get_current_user),
):
    suggestion = adaptive_store.get_suggestion(suggestion_id)
    if suggestion is None or suggestion.user_id != user_id:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    if suggestion.status != AdjustmentStatus.pending:
        raise HTTPException(status_code=400, detail="Suggestion is not pending")

    success = llm_adjuster_service.apply_approved_suggestion(suggestion_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to apply suggestion")
    updated = adaptive_store.get_suggestion(suggestion_id)
    return _suggestion_to_response(updated)


@router.post("/adjustments/{suggestion_id}/dismiss", response_model=AdjustmentSuggestionResponse)
async def dismiss_adjustment(
    suggestion_id: UUID,
    user_id: UUID = Depends(get_current_user),
):
    suggestion = adaptive_store.get_suggestion(suggestion_id)
    if suggestion is None or suggestion.user_id != user_id:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    if suggestion.status != AdjustmentStatus.pending:
        raise HTTPException(status_code=400, detail="Suggestion is not pending")

    adaptive_store.resolve_suggestion(suggestion_id, AdjustmentStatus.dismissed)
    updated = adaptive_store.get_suggestion(suggestion_id)
    return _suggestion_to_response(updated)


# ── Milestones ─────────────────────────────────────────────────────────────────

@router.get("/plans/{plan_id}/milestones", response_model=list[MilestoneResponse])
async def list_milestones(
    plan_id: UUID,
    user_id: UUID = Depends(get_current_user),
):
    milestones = adaptive_store.get_milestones_for_plan(user_id, plan_id)
    results = []
    for ms in milestones:
        tasks = adaptive_store.get_tasks_for_milestone(user_id, ms.id)
        results.append(_milestone_to_response(ms, tasks))
    return results


@router.post("/plans/{plan_id}/milestones", response_model=MilestoneResponse)
async def create_milestone(
    plan_id: UUID,
    payload: MilestoneCreate,
    user_id: UUID = Depends(get_current_user),
):
    plan = adaptive_store.get_plan(plan_id)
    if plan is None or (plan.user_id and plan.user_id != user_id):
        raise HTTPException(status_code=404, detail="Plan not found")
    ms = adaptive_store.create_milestone(user_id, plan_id, payload.model_dump())
    return _milestone_to_response(ms, [])


@router.patch("/milestones/{milestone_id}", response_model=MilestoneResponse)
async def update_milestone(
    milestone_id: UUID,
    payload: MilestoneUpdate,
    user_id: UUID = Depends(get_current_user),
):
    ms = adaptive_store.update_milestone(user_id, milestone_id, payload.model_dump(exclude_unset=True))
    if ms is None:
        raise HTTPException(status_code=404, detail="Milestone not found")
    tasks = adaptive_store.get_tasks_for_milestone(user_id, ms.id)
    return _milestone_to_response(ms, tasks)


@router.get("/milestones/{milestone_id}/check-completion")
async def check_milestone_completion(
    milestone_id: UUID,
    user_id: UUID = Depends(get_current_user),
):
    is_complete = adaptive_store.check_milestone_completion(user_id, milestone_id)
    if not is_complete:
        return {"completed": False, "next_milestone": None}
    # Mark milestone as completed
    ms = adaptive_store.update_milestone(user_id, milestone_id, {"status": MilestoneStatus.completed})
    if ms is None:
        raise HTTPException(status_code=404, detail="Milestone not found")
    # Activate the next locked milestone in the same plan
    next_ms = adaptive_store.activate_next_milestone(user_id, ms.plan_id)
    # Auto-generate tasks for the newly activated milestone
    if next_ms:
        try:
            await generate_for_milestone(str(next_ms.id), str(user_id), adaptive_store)
        except Exception as e:
            logger.warning("Task generation for milestone %s failed: %s", next_ms.id, e)
    return {
        "completed": True,
        "milestone": _milestone_to_response(ms, []),
        "next_milestone": _milestone_to_response(next_ms, []) if next_ms else None,
    }


@router.get("/milestones/{milestone_id}/insight", response_model=MilestoneInsightResponse)
async def get_milestone_insight(
    milestone_id: UUID,
    user_id: UUID = Depends(get_current_user),
):
    ms_res = (
        adaptive_store.client.table("milestones")
        .select()
        .eq("id", str(milestone_id))
        .eq("user_id", str(user_id))
        .limit(1)
        .execute()
    )
    if not ms_res or not ms_res[1]:
        raise HTTPException(status_code=404, detail="Milestone not found")
    ms_row = ms_res[1][0]

    # ── Cache check: if insight_json already stored, return it immediately ──
    cached_insight = adaptive_store._safe_json_dict(ms_row.get("insight_json"))
    if cached_insight:
        return MilestoneInsightResponse(
            milestone_id=milestone_id,
            insight=cached_insight,
            raw=None,
            generated=False,
        )

    # ── No cache — generate via LLM ──
    tasks = adaptive_store.get_tasks_for_milestone(user_id, milestone_id)

    milestone_snapshot = {
        "id": ms_row.get("id"),
        "plan_id": ms_row.get("plan_id"),
        "title": ms_row.get("title"),
        "description": ms_row.get("description"),
        "status": ms_row.get("status"),
        "order_index": ms_row.get("order_index"),
    }
    task_snapshots = [
        {
            "id": str(t.id),
            "title": t.title,
            "status": t.status.value,
            "due_date": t.due_date.isoformat() if t.due_date else None,
            "duration_minutes": t.duration_minutes,
        }
        for t in tasks[:12]
    ]

    prompt = MILESTONE_INSIGHT_PROMPT.format(
        milestone=json.dumps(milestone_snapshot, ensure_ascii=False),
        tasks=json.dumps(task_snapshots, ensure_ascii=False),
    )

    content = ""
    parsed, raw = None, ""
    try:
        content = chatResponse(prompt)
        parsed, raw = _try_parse_json(content)
        if parsed is None:
            retry_prompt = (
                "Return valid JSON only. Do not include any markdown, code fences, or extra text. "
                "The response must be a single JSON object.\n\n" + prompt
            )
            content2 = chatResponse(retry_prompt)
            parsed, raw = _try_parse_json(content2)
            content = content2
    except Exception as exc:
        parsed = None
        raw = str(exc)

    if parsed is None:
        return MilestoneInsightResponse(
            milestone_id=milestone_id,
            insight={"raw": _strip_code_fences(content) if content else ""},
            raw=_strip_code_fences(content) if content else raw,
            generated=True,
        )

    # Cache the successfully parsed insight on the milestone record
    adaptive_store.update_milestone_insight_json(milestone_id, parsed)

    return MilestoneInsightResponse(
        milestone_id=milestone_id,
        insight=parsed,
        raw=None,
        generated=True,
    )


# ── Helpers ────────────────────────────────────────────────────────────────────

def _plan_to_response(p) -> PlanResponse:
    return PlanResponse(
        id=p.id,
        goal_id=p.goal_id,
        memory_id=getattr(p, 'memory_id', None),
        user_id=p.user_id,
        title=p.title,
        status=p.status,
        priority=p.priority,
        intensity=p.intensity,
        duration_days=getattr(p, 'duration_days', None),
        schedule_prefs=getattr(p, 'schedule_prefs', None),
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


def _task_to_response(t) -> TaskResponse:
    return TaskResponse(
        id=t.id,
        plan_id=t.plan_id,
        title=t.title,
        description=t.description,
        due_date=t.due_date,
        status=t.status,
        priority=t.priority,
        difficulty=t.difficulty,
        parent_id=t.parent_id,
        carry_over_count=t.carry_over_count,
        milestone_id=t.milestone_id,
        order_index=t.order_index,
        duration_minutes=t.duration_minutes,
        detail_json=t.detail_json,
        created_at=t.created_at,
        updated_at=t.updated_at,
    )


def _milestone_to_response(ms, tasks=None) -> MilestoneResponse:
    return MilestoneResponse(
        id=ms.id,
        plan_id=ms.plan_id,
        user_id=ms.user_id,
        title=ms.title,
        description=ms.description,
        order_index=ms.order_index,
        status=ms.status,
        suggested_days=getattr(ms, 'suggested_days', None),
        outcome=getattr(ms, 'outcome', None),
        tasks=[_task_to_response(t) for t in (tasks or [])],
        created_at=ms.created_at,
        updated_at=ms.updated_at,
    )


def _memory_to_response(m) -> MemoryResponse:
    return MemoryResponse(
        id=m.id,
        user_id=m.user_id,
        key=m.key,
        value=m.value,
        source=m.source,
        goal_id=m.goal_id,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


def _suggestion_to_response(s) -> AdjustmentSuggestionResponse:
    return AdjustmentSuggestionResponse(
        id=s.id,
        plan_id=s.plan_id,
        reason=s.reason,
        suggested_tasks=s.suggested_tasks,
        status=s.status,
        created_at=s.created_at,
        resolved_at=s.resolved_at,
    )
