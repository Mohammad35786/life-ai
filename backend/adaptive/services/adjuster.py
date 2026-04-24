"""Rule-based automatic adjustment logic — no LLM."""

from __future__ import annotations

from datetime import date, timedelta
from uuid import UUID

from backend.adaptive.db import adaptive_store
from backend.adaptive.models import EventType, TaskDifficulty, TaskRow, TaskStatus


class AdjusterService:
    """Pure rule-based adjustments. Every action also records an event."""

    # ── 1. Task skipped → move to next day + increase carry_over ────────────

    def handle_skip(self, user_id: UUID, task_id: UUID) -> TaskRow | None:
        """
        When a task is skipped:
        - increment carry_over_count
        - move due_date to tomorrow
        - reset status to pending
        - record a 'rescheduled' event
        """
        task = adaptive_store.get_task(task_id)
        if task is None:
            return None

        # Increment carry-over
        adaptive_store.increment_carry_over(task_id)

        # Move to next day + reset status
        tomorrow = date.today() + timedelta(days=1)
        updated = adaptive_store.reschedule_task(task_id, tomorrow)

        # Record rescheduled event
        if updated:
            adaptive_store.record_event(
                user_id=user_id,
                task_id=task_id,
                plan_id=task.plan_id,
                event_type=EventType.rescheduled,
                feedback_text="auto-rescheduled after skip",
            )

            # Check if carry_over now exceeds threshold → reduce difficulty
            refreshed = adaptive_store.get_task(task_id)
            if refreshed and refreshed.carry_over_count > 2:
                self.reduce_difficulty(user_id, task_id)

        return adaptive_store.get_task(task_id)

    # ── 2. carry_over_count > 2 → reduce difficulty ─────────────────────────

    def reduce_difficulty(self, user_id: UUID, task_id: UUID) -> TaskRow | None:
        """
        Step difficulty down one level: hard → intermediate → easy.
        If already easy, no change. Records a 'rescheduled' event with reason.
        """
        task = adaptive_store.get_task(task_id)
        if task is None:
            return None

        updated = adaptive_store.reduce_task_difficulty(task_id)
        if updated and updated.difficulty != task.difficulty:
            adaptive_store.record_event(
                user_id=user_id,
                task_id=task_id,
                plan_id=task.plan_id,
                event_type=EventType.rescheduled,
                feedback_text=f"difficulty reduced: {task.difficulty.value} → {updated.difficulty.value} (carry_over={updated.carry_over_count})",
            )
        return updated

    # ── 3. "I'm busy" → move all today's tasks to next day ──────────────────

    def handle_busy(self, user_id: UUID) -> list[TaskRow]:
        """
        User says they're busy — reschedule ALL pending/partial tasks
        due today (or overdue) to tomorrow.
        """
        today = date.today()
        tomorrow = today + timedelta(days=1)
        due_tasks = adaptive_store.get_due_tasks(user_id, today)

        rescheduled = []
        for task in due_tasks:
            updated = adaptive_store.reschedule_task(task.id, tomorrow)
            if updated:
                adaptive_store.record_event(
                    user_id=user_id,
                    task_id=task.id,
                    plan_id=task.plan_id,
                    event_type=EventType.rescheduled,
                    feedback_text="rescheduled due to busy day",
                )
                rescheduled.append(updated)

        return rescheduled

    # ── 4. Too many tasks → reschedule overflow ─────────────────────────────

    def reschedule_overflow(self, user_id: UUID) -> list[TaskRow]:
        """
        If user has more due tasks than max_tasks_per_day,
        keep the top N (by scheduler priority) and push the rest to tomorrow.
        """
        today = date.today()
        tomorrow = today + timedelta(days=1)
        prefs = adaptive_store.ensure_preferences(user_id)
        max_tasks = prefs.max_tasks_per_day

        due_tasks = adaptive_store.get_due_tasks(user_id, today)

        if len(due_tasks) <= max_tasks:
            return []  # no overflow

        # Use scheduler to pick which tasks to keep
        from backend.adaptive.services.scheduler import scheduler_service
        scheduled = scheduler_service.get_today_tasks(user_id, today)
        kept_ids = {t.id for t in scheduled["tasks"]}

        overflow = [t for t in due_tasks if t.id not in kept_ids]
        rescheduled = []
        for task in overflow:
            updated = adaptive_store.reschedule_task(task.id, tomorrow)
            if updated:
                adaptive_store.record_event(
                    user_id=user_id,
                    task_id=task.id,
                    plan_id=task.plan_id,
                    event_type=EventType.rescheduled,
                    feedback_text="rescheduled: overflow beyond daily limit",
                )
                rescheduled.append(updated)

        return rescheduled

    # ── 5. User wants more → pull next task from plan ───────────────────────

    def pull_next_task(self, user_id: UUID, plan_id: UUID | None = None) -> TaskRow | None:
        """
        Pull the next pending task from a plan and set its due_date to today.
        If no plan_id given, picks from the highest-priority active plan
        that has pending tasks beyond today.
        """
        today = date.today()

        if plan_id is None:
            # Find highest-priority plan with upcoming tasks
            active_plans = adaptive_store.list_active_plans(user_id)
            active_plans.sort(key=lambda p: {"high": 0, "medium": 1, "low": 2}.get(p.priority.value, 1))
            for plan in active_plans:
                next_task = adaptive_store.get_next_pending_task(plan.id, after_date=today)
                if next_task:
                    plan_id = plan.id
                    break
            if plan_id is None:
                return None

        next_task = adaptive_store.get_next_pending_task(plan_id, after_date=today)
        if next_task is None:
            return None

        updated = adaptive_store.reschedule_task(next_task.id, today)
        if updated:
            adaptive_store.record_event(
                user_id=user_id,
                task_id=next_task.id,
                plan_id=plan_id,
                event_type=EventType.rescheduled,
                feedback_text="pulled forward by user request",
            )
        return updated


adjuster_service = AdjusterService()
