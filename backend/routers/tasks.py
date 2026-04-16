from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from backend.auth import get_current_user
from backend.models import TaskCompletionResponse
from backend.store import store

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.post("/{task_id}/complete", response_model=TaskCompletionResponse)
async def complete_task(
    task_id: UUID,
    user_id: UUID = Depends(get_current_user),
) -> TaskCompletionResponse:
    task = store.complete_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return TaskCompletionResponse(success=True, task=task)
