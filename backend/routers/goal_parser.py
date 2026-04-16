from fastapi import APIRouter, HTTPException

from backend.models import GoalCreate, GoalParseRequest, ParsedGoal
from backend.services.goal_parser import GoalParserError, goal_parser_service
from backend.store import store

router = APIRouter(prefix="/api", tags=["goal parser"])


@router.post("/parse-goal", response_model=ParsedGoal)
async def parse_goal(payload: GoalParseRequest) -> ParsedGoal:
    try:
        parsed = goal_parser_service.parse_goal(payload.text)
    except GoalParserError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    goal = store.create_goal(GoalCreate(title=parsed.title, description=parsed.description))
    return ParsedGoal(id=goal.id, title=goal.title, description=goal.description)
