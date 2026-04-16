from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from backend.auth import get_current_user
from backend.models import Plan
from backend.services.planner import PlanningEngineError, planning_engine_service
from backend.store import store

router = APIRouter(prefix="/api", tags=["plans"])


@router.post("/adjust-plan/{plan_id}", response_model=Plan)
async def adjust_plan(
    plan_id: UUID,
    user_id: UUID = Depends(get_current_user),
) -> Plan:
    plan = store.get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")

    goal = store.get_goal(plan.goal_id)
    if goal is None:
        raise HTTPException(status_code=404, detail="Goal not found")

    try:
        adjusted_tasks = planning_engine_service.adjust_tasks(goal, plan)
    except PlanningEngineError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    updated_plan = store.replace_plan_tasks(plan_id, adjusted_tasks)
    if updated_plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    return updated_plan
