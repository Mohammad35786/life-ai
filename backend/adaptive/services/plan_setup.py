"""Plan Setup — manages the multi-step interactive dialogue for creating a plan."""

from __future__ import annotations

import json
from uuid import UUID

from backend.adaptive.db import AdaptiveStore
from backend.adaptive.models import PlanRow, PlanStatus


DURATION_OPTIONS = [
    {"label": "1 week", "value": 7},
    {"label": "2 weeks", "value": 14},
    {"label": "1 month", "value": 30},
    {"label": "3 months", "value": 90},
    {"label": "6 months", "value": 180},
    {"label": "1 year", "value": 365},
]

SCHEDULE_OPTIONS = [
    {"label": "Every day", "value": "daily"},
    {"label": "Weekdays only", "value": "weekdays"},
    {"label": "3 days a week", "value": "3x_week"},
    {"label": "Weekends only", "value": "weekends"},
    {"label": "I'll pick days", "value": "custom"},
]


async def start_plan_setup(
    user_id: str,
    memory_id: str,
    db: AdaptiveStore,
) -> dict:
    """
    Create a plan record with status='setup', linked to the memory row.
    Returns the first setup step payload (ask_duration).
    """
    uid = UUID(user_id) if isinstance(user_id, str) else user_id
    mid = UUID(memory_id) if isinstance(memory_id, str) else memory_id

    # Derive a title from the memory row
    memory = db.get_memory(mid)
    title = "Untitled Plan"
    description = None
    if memory:
        try:
            parsed = json.loads(memory.value)
            title = parsed.get("goal") or parsed.get("summary") or title
            description = parsed.get("motivation") or parsed.get("summary")
        except (json.JSONDecodeError, AttributeError):
            title = memory.value[:80] if memory.value else title

    # Create a goals row first (plans.goal_id FK references goals, not memory)
    goal_id = db.create_goal(user_id=uid, title=title, description=description)

    plan = db.create_plan(
        user_id=uid,
        goal_id=goal_id,
        memory_id=mid,
        title=title,
        status=PlanStatus.setup,
    )

    return {
        "plan_id": str(plan.id),
        "setup_step": "ask_duration",
        "message": (
            "Great! I've captured your goal. Now — how long do you want "
            "to give yourself for this plan? Be honest with yourself."
        ),
        "quick_options": DURATION_OPTIONS,
    }


async def save_duration(
    user_id: str,
    plan_id: str,
    duration_days: int,
    db: AdaptiveStore,
) -> dict:
    """
    Save duration_days to the plan record.
    Returns the next setup step payload (ask_schedule).
    """
    pid = UUID(plan_id) if isinstance(plan_id, str) else plan_id

    plan = db.update_plan(pid, duration_days=duration_days)
    if plan is None:
        raise ValueError(f"Plan {plan_id} not found")

    return {
        "setup_step": "ask_schedule",
        "message": f"Got it — {duration_days} days. Now, how do you want to structure your work sessions?",
        "quick_options": SCHEDULE_OPTIONS,
    }


async def save_schedule(
    user_id: str,
    plan_id: str,
    schedule_prefs: dict,
    db: AdaptiveStore,
) -> dict:
    """
    Save schedule_prefs to the plan record.
    schedule_prefs: { type: string, days?: [0-6] (0=Mon) }
    Returns setup complete payload.
    """
    pid = UUID(plan_id) if isinstance(plan_id, str) else plan_id

    plan = db.update_plan(pid, schedule_prefs=schedule_prefs)
    if plan is None:
        raise ValueError(f"Plan {plan_id} not found")

    return {
        "setup_step": "complete",
        "plan_id": str(plan.id),
    }


async def get_setup_state(
    user_id: str,
    plan_id: str,
    db: AdaptiveStore,
) -> dict:
    """
    Return the current setup state for a plan.
    Determines which step the user is on based on what's filled in.
    """
    pid = UUID(plan_id) if isinstance(plan_id, str) else plan_id

    plan = db.get_plan(pid)
    if plan is None:
        raise ValueError(f"Plan {plan_id} not found")

    if plan.duration_days is None:
        return {
            "plan_id": str(plan.id),
            "setup_step": "ask_duration",
            "message": (
                "Great! I've captured your goal. Now — how long do you want "
                "to give yourself for this plan? Be honest with yourself."
            ),
            "quick_options": DURATION_OPTIONS,
        }

    if plan.schedule_prefs is None:
        return {
            "plan_id": str(plan.id),
            "setup_step": "ask_schedule",
            "message": f"Got it — {plan.duration_days} days. Now, how do you want to structure your work sessions?",
            "quick_options": SCHEDULE_OPTIONS,
        }

    return {
        "plan_id": str(plan.id),
        "setup_step": "complete",
    }
