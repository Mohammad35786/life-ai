"""Events — record task actions and detect patterns via rule-based checks."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from backend.adaptive.db import adaptive_store
from backend.adaptive.models import AdjustmentSuggestionRow, EventType


class EventsService:
    """Record events and detect behavioral patterns that may need plan adjustments."""

    def record(
        self,
        user_id: UUID,
        task_id: UUID,
        plan_id: UUID,
        event_type: EventType,
        feedback_rating: int | None = None,
        feedback_text: str | None = None,
    ) -> dict:
        """Record an event and then run pattern detection."""
        event = adaptive_store.record_event(
            user_id=user_id,
            task_id=task_id,
            plan_id=plan_id,
            event_type=event_type,
            feedback_rating=feedback_rating,
            feedback_text=feedback_text,
        )
        # Update task status to match the event
        from backend.adaptive.models import TaskStatus
        status_map = {
            EventType.done: TaskStatus.done,
            EventType.skipped: TaskStatus.skipped,
            EventType.partial: TaskStatus.partial,
        }
        if event_type in status_map:
            adaptive_store.update_task_status(task_id, status_map[event_type])

        # Run pattern detection after recording
        self._detect_and_suggest(user_id)

        return event

    # ── Rule-based pattern detection ──────────────────────────────────────

    def detect_patterns(self, user_id: UUID) -> list[dict]:
        """Run all pattern detectors. Returns list of detected issues."""
        patterns: list[dict] = []
        patterns.extend(self._detect_skip_streak(user_id))
        patterns.extend(self._detect_low_energy(user_id))
        patterns.extend(self._detect_stalled_plans(user_id))
        return patterns

    def _detect_skip_streak(self, user_id: UUID, threshold: int = 3) -> list[dict]:
        """3+ consecutive skips in the last 7 days → flag."""
        skip_count = adaptive_store.get_recent_skip_count(user_id, days=7)
        if skip_count >= threshold:
            return [{
                "type": "skip_streak",
                "message": f"User skipped {skip_count} tasks in the last 7 days",
                "severity": "high" if skip_count >= 5 else "medium",
            }]
        return []

    def _detect_low_energy(self, user_id: UUID) -> list[dict]:
        """Average feedback rating < 2.5 over last 7 days → flag."""
        since = datetime.now(timezone.utc) - timedelta(days=7)
        events = adaptive_store.get_events_for_user(
            user_id, event_type=EventType.feedback, since=since,
        )
        rated = [e for e in events if e.feedback_rating is not None]
        if len(rated) < 3:
            return []
        avg_rating = sum(e.feedback_rating for e in rated) / len(rated)
        if avg_rating < 2.5:
            return [{
                "type": "low_energy",
                "message": f"Average feedback rating is {avg_rating:.1f}/5 over last 7 days",
                "severity": "medium",
            }]
        return []

    def _detect_stalled_plans(self, user_id: UUID) -> list[dict]:
        """No completions in 7+ days on an active plan → flag."""
        active_plans = adaptive_store.list_active_plans(user_id)
        since = datetime.now(timezone.utc) - timedelta(days=7)
        stalled = []
        for plan in active_plans:
            done_events = adaptive_store.get_events_for_user(
                user_id, event_type=EventType.done, since=since,
            )
            plan_done = [e for e in done_events if e.plan_id == plan.id]
            if not plan_done:
                stalled.append({
                    "type": "stalled_plan",
                    "plan_id": str(plan.id),
                    "message": f"No task completions on plan '{plan.title or plan.id}' in 7+ days",
                    "severity": "medium",
                })
        return stalled

    def _detect_and_suggest(self, user_id: UUID) -> None:
        """Run detection and create adjustment suggestions for detected patterns."""
        patterns = self.detect_patterns(user_id)
        for pattern in patterns:
            if pattern["type"] == "stalled_plan":
                adaptive_store.create_suggestion(
                    user_id=user_id,
                    plan_id=UUID(pattern["plan_id"]),
                    reason=pattern["type"],
                    suggested_tasks=[],  # LLM adjuster will fill these when user views
                )
            elif pattern["type"] in ("skip_streak", "low_energy"):
                # These affect all active plans — pick the highest priority one
                active_plans = adaptive_store.list_active_plans(user_id)
                if active_plans:
                    target = max(active_plans, key=lambda p: p.priority.value == "high")
                    adaptive_store.create_suggestion(
                        user_id=user_id,
                        plan_id=target.id,
                        reason=pattern["type"],
                        suggested_tasks=[],
                    )


events_service = EventsService()
