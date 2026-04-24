"""End-of-day intelligent adjustment — uses LLM to rebalance plans and modify next-day tasks."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from backend.adaptive.db import adaptive_store
from backend.adaptive.models import (
    EventType,
    PlanIntensity,
    PlanPriority,
    PlanRow,
    TaskDifficulty,
    TaskRow,
    TaskStatus,
)
from backend.lib.llm import chatResponse


EOD_ADJUSTMENT_PROMPT = """You are an adaptive planning assistant performing an end-of-day review.

Analyze today's activity and produce a structured adjustment plan.

INPUT SUMMARY:
- Completed tasks: {completed}
- Missed/skipped tasks: {missed}
- Partially done tasks: {partial}
- User feedback: {feedback}
- Plan summaries: {plan_summaries}

Your job:
1. Rebalance plans: if one plan is consistently missed, lower its intensity or priority
2. Adjust difficulty: if tasks were too hard (skipped/partial), reduce difficulty; if all done easily, increase
3. Modify next-day tasks: reschedule, merge, split, or add tasks as needed

Return EXACTLY a JSON object with these keys (no markdown, no code fences):

{{
  "plan_adjustments": [
    {{
      "plan_id": "uuid-string",
      "action": "reduce_intensity" | "increase_intensity" | "reduce_priority" | "pause",
      "reason": "short explanation"
    }}
  ],
  "difficulty_adjustments": [
    {{
      "task_id": "uuid-string",
      "new_difficulty": "easy" | "intermediate" | "hard",
      "reason": "short explanation"
    }}
  ],
  "next_day_modifications": [
    {{
      "action": "reschedule" | "add" | "remove" | "merge",
      "task_id": "uuid-string or null for add",
      "plan_id": "uuid-string",
      "title": "string (for add/merge)",
      "due_in_days": 1,
      "difficulty": "easy" | "intermediate" | "hard",
      "reason": "short explanation"
    }}
  ],
  "summary": "1-2 sentence summary of the day and what you changed"
}}

Rules:
- Only include items that need changing, not everything
- "reschedule" moves a task to a later day (set due_in_days)
- "add" creates a new task (task_id is null, provide title)
- "remove" deletes a task that is no longer needed
- "merge" combines two tasks into one (provide new title, task_id is the primary one)
- Be conservative: only adjust when the data clearly supports it
- Do NOT modify completed tasks"""


_DIFFICULTY_RANK = {"easy": 0, "intermediate": 1, "hard": 2}


class EODAdjusterService:
    """End-of-day LLM-powered adjustment. Reviews the day and rebalances."""

    def run_eod_adjustment(self, user_id: UUID) -> dict:
        """
        1. Gather today's completed, missed, partial tasks + feedback + plan summaries
        2. Call LLM once with the EOD prompt
        3. Apply plan adjustments, difficulty changes, and next-day modifications
        4. Return the full adjustment result
        """
        today = date.today()

        # ── Gather input ────────────────────────────────────────────────
        all_today_tasks = adaptive_store.get_tasks_for_date(user_id, today)

        completed = [self._task_snapshot(t) for t in all_today_tasks if t.status == TaskStatus.done]
        missed = [self._task_snapshot(t) for t in all_today_tasks if t.status == TaskStatus.skipped]
        partial = [self._task_snapshot(t) for t in all_today_tasks if t.status == TaskStatus.partial]

        since = datetime.combine(today, datetime.min.time()).replace(tzinfo=timezone.utc)
        feedback_events = adaptive_store.get_events_for_user(
            user_id, event_type=EventType.feedback, since=since,
        )
        feedback = [
            {"task_id": str(e.task_id), "rating": e.feedback_rating, "text": e.feedback_text}
            for e in feedback_events
            if e.feedback_rating is not None or e.feedback_text
        ]

        active_plans = adaptive_store.list_active_plans(user_id)
        plan_summaries = [self._plan_snapshot(p, user_id) for p in active_plans]

        # ── Call LLM ─────────────────────────────────────────────────────
        prompt = EOD_ADJUSTMENT_PROMPT.format(
            completed=json.dumps(completed) if completed else "[]",
            missed=json.dumps(missed) if missed else "[]",
            partial=json.dumps(partial) if partial else "[]",
            feedback=json.dumps(feedback) if feedback else "none",
            plan_summaries=json.dumps(plan_summaries),
        )

        try:
            content = chatResponse(prompt)
            content = content.strip()
            if content.startswith("```json"):
                content = content[7:]
            if content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()
            parsed = json.loads(content)
        except Exception as exc:
            print(f"EOD adjustment LLM failed: {exc}")
            return self._fallback_adjustment(user_id, missed, partial)

        # ── Apply adjustments ───────────────────────────────────────────
        applied = {
            "plan_adjustments": [],
            "difficulty_adjustments": [],
            "next_day_modifications": [],
            "summary": parsed.get("summary", ""),
            "llm_raw": parsed,
        }

        for adj in parsed.get("plan_adjustments", []):
            result = self._apply_plan_adjustment(user_id, adj)
            if result:
                applied["plan_adjustments"].append(result)

        for adj in parsed.get("difficulty_adjustments", []):
            result = self._apply_difficulty_adjustment(user_id, adj)
            if result:
                applied["difficulty_adjustments"].append(result)

        for mod in parsed.get("next_day_modifications", []):
            result = self._apply_next_day_modification(user_id, mod)
            if result:
                applied["next_day_modifications"].append(result)

        return applied

    # ── Apply helpers ────────────────────────────────────────────────────────

    def _apply_plan_adjustment(self, user_id: UUID, adj: dict) -> dict | None:
        plan_id_str = adj.get("plan_id")
        action = adj.get("action", "")
        reason = adj.get("reason", "")
        if not plan_id_str:
            return None

        try:
            plan_id = UUID(plan_id_str)
        except ValueError:
            return None

        plan = adaptive_store.get_plan(plan_id)
        if plan is None or plan.user_id != user_id:
            return None

        intensity = None
        priority = None
        status = None

        if action == "reduce_intensity":
            downgrade = {PlanIntensity.intense: PlanIntensity.moderate, PlanIntensity.moderate: PlanIntensity.light}
            intensity = downgrade.get(plan.intensity)
        elif action == "increase_intensity":
            upgrade = {PlanIntensity.light: PlanIntensity.moderate, PlanIntensity.moderate: PlanIntensity.intense}
            intensity = upgrade.get(plan.intensity)
        elif action == "reduce_priority":
            downgrade = {PlanPriority.high: PlanPriority.medium, PlanPriority.medium: PlanPriority.low}
            priority = downgrade.get(plan.priority)
        elif action == "pause":
            from backend.adaptive.models import PlanStatus
            status = PlanStatus.paused

        if not any([intensity, priority, status]):
            return None

        updated = adaptive_store.update_plan(plan_id, status=status, priority=priority, intensity=intensity)
        if updated is None:
            return None

        return {"plan_id": plan_id_str, "action": action, "reason": reason, "applied": True}

    def _apply_difficulty_adjustment(self, user_id: UUID, adj: dict) -> dict | None:
        task_id_str = adj.get("task_id")
        new_diff_str = adj.get("new_difficulty", "")
        reason = adj.get("reason", "")
        if not task_id_str:
            return None

        try:
            task_id = UUID(task_id_str)
            new_diff = TaskDifficulty(new_diff_str)
        except ValueError:
            return None

        task = adaptive_store.get_task(task_id)
        if task is None or task.status == TaskStatus.done or new_diff == task.difficulty:
            return None

        # Directly set the new difficulty
        res = adaptive_store.client.table("tasks").update({
            "difficulty": new_diff.value,
        }).eq("id", str(task_id)).execute()
        if not res[1]:
            return None

        adaptive_store.record_event(
            user_id=user_id, task_id=task_id, plan_id=task.plan_id,
            event_type=EventType.rescheduled,
            feedback_text=f"EOD difficulty: {task.difficulty.value} -> {new_diff.value} ({reason})",
        )

        return {
            "task_id": task_id_str,
            "old_difficulty": task.difficulty.value,
            "new_difficulty": new_diff.value,
            "reason": reason,
            "applied": True,
        }

    def _apply_next_day_modification(self, user_id: UUID, mod: dict) -> dict | None:
        action = mod.get("action", "")
        plan_id_str = mod.get("plan_id")
        reason = mod.get("reason", "")
        if not plan_id_str:
            return None

        try:
            plan_id = UUID(plan_id_str)
        except ValueError:
            return None

        plan = adaptive_store.get_plan(plan_id)
        if plan is None or plan.user_id != user_id:
            return None

        due_in = max(1, min(int(mod.get("due_in_days", 1)), 14))
        target_date = date.today() + timedelta(days=due_in)

        if action == "reschedule":
            return self._mod_reschedule(user_id, mod, plan_id, target_date, reason)
        elif action == "add":
            return self._mod_add(user_id, mod, plan_id, target_date, reason)
        elif action == "remove":
            return self._mod_remove(user_id, mod, plan_id, reason)
        elif action == "merge":
            return self._mod_merge(user_id, mod, plan_id, reason)
        return None

    def _mod_reschedule(self, user_id: UUID, mod: dict, plan_id: UUID, target_date: date, reason: str) -> dict | None:
        task_id_str = mod.get("task_id")
        if not task_id_str:
            return None
        try:
            task_id = UUID(task_id_str)
        except ValueError:
            return None
        task = adaptive_store.get_task(task_id)
        if task is None or task.status == TaskStatus.done:
            return None
        updated = adaptive_store.reschedule_task(task_id, target_date)
        if updated:
            adaptive_store.record_event(
                user_id=user_id, task_id=task_id, plan_id=plan_id,
                event_type=EventType.rescheduled,
                feedback_text=f"EOD rescheduled: {reason}",
            )
        return {"action": "reschedule", "task_id": task_id_str, "new_date": target_date.isoformat(), "reason": reason, "applied": True}

    def _mod_add(self, user_id: UUID, mod: dict, plan_id: UUID, target_date: date, reason: str) -> dict | None:
        title = mod.get("title", "").strip()
        if not title:
            return None
        task_data = {
            "title": title,
            "due_date": target_date.isoformat(),
            "status": "pending",
            "priority": mod.get("priority", "medium"),
            "difficulty": mod.get("difficulty", "intermediate"),
            "plan_id": str(plan_id),
        }
        res = adaptive_store.client.table("tasks").insert(task_data).execute()
        if res[1]:
            new_task = adaptive_store._map_task(res[1][0])
            adaptive_store.record_event(
                user_id=user_id, task_id=new_task.id, plan_id=plan_id,
                event_type=EventType.rescheduled,
                feedback_text=f"EOD added task: {reason}",
            )
            return {"action": "add", "task_id": str(new_task.id), "title": title, "reason": reason, "applied": True}
        return None

    def _mod_remove(self, user_id: UUID, mod: dict, plan_id: UUID, reason: str) -> dict | None:
        task_id_str = mod.get("task_id")
        if not task_id_str:
            return None
        try:
            task_id = UUID(task_id_str)
        except ValueError:
            return None
        task = adaptive_store.get_task(task_id)
        if task is None or task.status == TaskStatus.done:
            return None
        adaptive_store.client.table("tasks").delete().eq("id", str(task_id)).execute()
        adaptive_store.record_event(
            user_id=user_id, task_id=task_id, plan_id=plan_id,
            event_type=EventType.rescheduled,
            feedback_text=f"EOD removed task: {reason}",
        )
        return {"action": "remove", "task_id": task_id_str, "reason": reason, "applied": True}

    def _mod_merge(self, user_id: UUID, mod: dict, plan_id: UUID, reason: str) -> dict | None:
        task_id_str = mod.get("task_id")
        title = mod.get("title", "").strip()
        if not task_id_str or not title:
            return None
        try:
            task_id = UUID(task_id_str)
        except ValueError:
            return None
        task = adaptive_store.get_task(task_id)
        if task is None:
            return None
        res = adaptive_store.client.table("tasks").update({"title": title}).eq("id", str(task_id)).execute()
        if res[1]:
            adaptive_store.record_event(
                user_id=user_id, task_id=task_id, plan_id=plan_id,
                event_type=EventType.rescheduled,
                feedback_text=f"EOD merged task: {reason}",
            )
            return {"action": "merge", "task_id": task_id_str, "new_title": title, "reason": reason, "applied": True}
        return None

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _task_snapshot(self, t: TaskRow) -> dict:
        return {
            "id": str(t.id),
            "plan_id": str(t.plan_id),
            "title": t.title,
            "due_date": t.due_date.isoformat() if t.due_date else None,
            "status": t.status.value,
            "difficulty": t.difficulty.value,
            "carry_over_count": t.carry_over_count,
        }

    def _plan_snapshot(self, p: PlanRow, user_id: UUID) -> dict:
        due_tasks = adaptive_store.get_due_tasks(user_id, date.today())
        plan_tasks = [t for t in due_tasks if t.plan_id == p.id]
        return {
            "plan_id": str(p.id),
            "title": p.title,
            "priority": p.priority.value,
            "intensity": p.intensity.value,
            "status": p.status.value,
            "tasks_today": len(plan_tasks),
            "tasks_done": len([t for t in plan_tasks if t.status == TaskStatus.done]),
            "tasks_skipped": len([t for t in plan_tasks if t.status == TaskStatus.skipped]),
        }

    def _fallback_adjustment(self, user_id: UUID, missed: list[dict], partial: list[dict]) -> dict:
        """Rule-based fallback if LLM fails."""
        adjustments = {
            "plan_adjustments": [],
            "difficulty_adjustments": [],
            "next_day_modifications": [],
            "summary": "EOD adjustment via fallback rules (LLM unavailable).",
            "llm_raw": None,
        }

        # Reduce difficulty for all missed/partial tasks and reschedule to tomorrow
        tomorrow = date.today() + timedelta(days=1)
        for t in missed + partial:
            task_id_str = t.get("id")
            if not task_id_str:
                continue
            try:
                task_id = UUID(task_id_str)
            except ValueError:
                continue
            updated = adaptive_store.reduce_task_difficulty(task_id)
            if updated:
                adjustments["difficulty_adjustments"].append({
                    "task_id": task_id_str,
                    "new_difficulty": updated.difficulty.value,
                    "reason": "auto-reduced after skip/partial (fallback)",
                    "applied": True,
                })
            rescheduled = adaptive_store.reschedule_task(task_id, tomorrow)
            if rescheduled:
                adjustments["next_day_modifications"].append({
                    "action": "reschedule",
                    "task_id": task_id_str,
                    "new_date": tomorrow.isoformat(),
                    "reason": "auto-rescheduled after skip/partial (fallback)",
                    "applied": True,
                })

        return adjustments


eod_adjuster_service = EODAdjusterService()
