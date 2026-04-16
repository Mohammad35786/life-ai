from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from backend.auth import get_current_user
from backend.models import Goal, GoalCreate
from backend.store import store

router = APIRouter(prefix="/api/goals", tags=["goals"])


@router.post("", response_model=Goal)
async def create_goal(
    payload: GoalCreate,
    user_id: UUID = Depends(get_current_user),
) -> Goal:
    return store.create_goal(payload, user_id=user_id)


@router.get("", response_model=list[Goal])
async def list_goals(user_id: UUID = Depends(get_current_user)) -> list[Goal]:
    return store.list_goals(user_id=user_id)


@router.get("/{goal_id}", response_model=Goal)
async def get_goal(
    goal_id: UUID,
    user_id: UUID = Depends(get_current_user),
) -> Goal:
    goal = store.get_goal(goal_id)
    if goal is None:
        raise HTTPException(status_code=404, detail="Goal not found")
    return goal
