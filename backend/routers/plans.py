from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from backend.auth import get_current_user
from backend.models import Plan, PlanCreate, PlanUpdate, Task, TaskCreate
from backend.services.planner import PlanningEngineError, planning_engine_service
from backend.store import store

router = APIRouter(prefix="/api/plans", tags=["plans"])


@router.post("", response_model=Plan)
async def create_plan(
    payload: PlanCreate,
    user_id: UUID = Depends(get_current_user),
) -> Plan:
    goal = store.get_goal(payload.goal_id)
    if goal is None:
        raise HTTPException(status_code=404, detail="Goal not found")

    if payload.tasks is not None:
        return store.create_plan(payload.goal_id, payload.tasks)

    try:
        generated_tasks = planning_engine_service.generate_tasks(goal)
    except PlanningEngineError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return store.create_plan(payload.goal_id, generated_tasks)


@router.get("", response_model=list[Plan])
async def list_plans(user_id: UUID = Depends(get_current_user)) -> list[Plan]:
    return store.list_plans()


@router.get("/{plan_id}", response_model=Plan)
async def get_plan(
    plan_id: UUID,
    user_id: UUID = Depends(get_current_user),
) -> Plan:
    plan = store.get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    return plan


@router.put("/{plan_id}", response_model=Plan)
async def update_plan(
    plan_id: UUID,
    payload: PlanUpdate,
    user_id: UUID = Depends(get_current_user),
) -> Plan:
    if any(task.plan_id != plan_id for task in payload.tasks):
        raise HTTPException(status_code=400, detail="All tasks must belong to the target plan")

    plan = store.update_plan(plan_id, payload.tasks)
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    return plan


@router.post("/{plan_id}/tasks", response_model=Task)
async def create_task_in_plan(
    plan_id: UUID,
    payload: TaskCreate,
    user_id: UUID = Depends(get_current_user),
) -> Task:
    plan = store.get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")

    try:
        task = store.create_task(plan_id, payload)
        return task
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
