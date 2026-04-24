"""Scheduler — selects tasks for today across multiple plans with fairness."""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from uuid import UUID

from backend.adaptive.db import adaptive_store
from backend.adaptive.models import PlanPriority, PlanRow, TaskRow


_PRIORITY_ORDER = {
    PlanPriority.high: 0,
    PlanPriority.medium: 1,
    PlanPriority.low: 2,
}


def _task_sort_key(on_date: date):
    """Return a sort key for tasks within a plan: carry_over desc, then due_date asc."""
    def key(t: TaskRow):
        return (-t.carry_over_count, t.due_date or on_date)
    return key


class SchedulerService:
    """Selects daily tasks across multiple plans with round-robin fairness."""

    def get_today_tasks(self, user_id: UUID, on_date: date | None = None) -> dict:
        """
        Pure function — no LLM.

        1. Load user preferences (max_tasks_per_day, default 4)
        2. Collect all due tasks from active plans (pending/partial, due_date <= today)
        3. Increment carry_over_count for overdue tasks
        4. Group tasks by plan, sort plans by priority (high → low)
        5. Within each plan, sort tasks by urgency (carry_over desc, due_date asc)
        6. Round-robin pick: take 1 task from each plan in priority order,
           repeat until max_tasks reached or no tasks left
        7. Return selected tasks + metadata
        """
        if on_date is None:
            on_date = date.today()

        prefs = adaptive_store.ensure_preferences(user_id)
        max_tasks = prefs.max_tasks_per_day

        due_tasks = adaptive_store.get_due_tasks(user_id, on_date)

        # Increment carry-over for overdue tasks
        for task in due_tasks:
            if task.due_date and task.due_date < on_date:
                adaptive_store.increment_carry_over(task.id)

        # Re-fetch after carry-over updates
        due_tasks = adaptive_store.get_due_tasks(user_id, on_date)

        # Load active plans and sort by priority
        active_plans = adaptive_store.list_active_plans(user_id)
        active_plans.sort(key=lambda p: _PRIORITY_ORDER.get(p.priority, 1))

        # Group tasks by plan_id
        tasks_by_plan: dict[UUID, list[TaskRow]] = defaultdict(list)
        for t in due_tasks:
            tasks_by_plan[t.plan_id].append(t)

        # Sort tasks within each plan by urgency
        sort_key = _task_sort_key(on_date)
        for plan_id in tasks_by_plan:
            tasks_by_plan[plan_id].sort(key=sort_key)

        # Round-robin selection across plans in priority order
        selected: list[TaskRow] = []
        plan_ids_ordered = [p.id for p in active_plans if p.id in tasks_by_plan]

        while len(selected) < max_tasks and plan_ids_ordered:
            # One pass: take the top task from each plan that still has tasks
            exhausted = []
            for pid in plan_ids_ordered:
                if len(selected) >= max_tasks:
                    break
                queue = tasks_by_plan[pid]
                if queue:
                    selected.append(queue.pop(0))
                if not queue:
                    exhausted.append(pid)
            # Remove plans that ran out of tasks
            for pid in exhausted:
                plan_ids_ordered.remove(pid)
            # If no plan had tasks this round, stop
            if not exhausted and all(not tasks_by_plan[pid] for pid in plan_ids_ordered):
                break

        return {
            "date": on_date,
            "tasks": selected,
            "total_available": len(due_tasks),
            "selected_count": len(selected),
            "max_tasks_per_day": max_tasks,
            "plans_queried": len(active_plans),
        }

    # Keep backward-compat alias
    def get_daily_tasks(self, user_id: UUID, on_date: date | None = None) -> dict:
        return self.get_today_tasks(user_id, on_date)


scheduler_service = SchedulerService()
