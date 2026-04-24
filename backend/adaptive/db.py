"""Database connection and store — reuses the existing SupabaseREST client."""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from uuid import UUID

from backend.adaptive.models import (
    AdjustmentSuggestionRow,
    AdjustmentStatus,
    EventRow,
    EventType,
    MemoryKey,
    MemoryRow,
    MilestoneRow,
    MilestoneStatus,
    PlanIntensity,
    PlanPriority,
    PlanRow,
    PlanStatus,
    TaskDifficulty,
    TaskRow,
    TaskStatus,
    UserPreferences,
)
from backend.lib.db import get_supabase_client

logger = logging.getLogger(__name__)


class AdaptiveStore:
    """All DB operations for the adaptive planning system."""

    def __init__(self) -> None:
        self._client = None

    @property
    def client(self):
        if self._client is not None:
            return self._client
        client = get_supabase_client()
        if not client:
            raise RuntimeError("Database not configured. Set Supabase credentials in .env")
        self._client = client
        return self._client

    def ensure_user(self, user_id: UUID | str) -> None:
        """Ensure the public.users row exists before writing dependent records."""
        user_id_str = str(user_id)
        try:
            self.client.table("users").upsert({"id": user_id_str}, on_conflict="id").execute()
        except Exception:
            logger.exception("Failed to ensure public.users row for user_id=%s", user_id_str)
            raise

    # ── User Preferences ───────────────────────────────────────────────────

    def get_preferences(self, user_id: UUID) -> UserPreferences | None:
        res = self.client.table("user_preferences").select().eq("user_id", str(user_id)).execute()
        if not res or not res[1]:
            return None
        return self._map_preferences(res[1][0])

    def create_preferences(self, user_id: UUID, max_tasks_per_day: int = 4) -> UserPreferences:
        self.ensure_user(user_id)
        res = self.client.table("user_preferences").insert({
            "user_id": str(user_id),
            "max_tasks_per_day": max_tasks_per_day,
        }).execute()
        if not res or not res[1]:
            raise RuntimeError(f"Failed to create user preferences for user_id={user_id}")
        return self._map_preferences(res[1][0])

    def update_preferences(self, user_id: UUID, max_tasks_per_day: int) -> UserPreferences | None:
        res = self.client.table("user_preferences").update({
            "max_tasks_per_day": max_tasks_per_day,
        }).eq("user_id", str(user_id)).execute()
        if not res or not res[1]:
            return None
        return self._map_preferences(res[1][0])

    def ensure_preferences(self, user_id: UUID) -> UserPreferences:
        prefs = self.get_preferences(user_id)
        if prefs:
            return prefs
        return self.create_preferences(user_id)

    # ── Plans ──────────────────────────────────────────────────────────────

    def list_active_plans(self, user_id: UUID) -> list[PlanRow]:
        """Active plans including those still in setup."""
        res = (
            self.client.table("plans")
            .select()
            .eq("user_id", str(user_id))
            .in_("status", ["setup", "active"])
            .order("created_at", desc=True)
            .execute()
        )
        if not res or not res[1]:
            return []
        return [self._map_plan(row) for row in res[1]]

    def list_all_plans(self, user_id: UUID) -> list[PlanRow]:
        """All plans for a user regardless of status (active, paused, completed)."""
        res = (
            self.client.table("plans")
            .select()
            .eq("user_id", str(user_id))
            .order("created_at", desc=True)
            .execute()
        )
        if not res or not res[1]:
            return []
        return [self._map_plan(row) for row in res[1]]

    def create_goal(self, user_id: UUID, title: str, description: str | None = None) -> UUID:
        """Create a goals row and return its UUID."""
        self.ensure_user(user_id)
        data = {"user_id": str(user_id), "title": title}
        if description:
            data["description"] = description
        res = self.client.table("goals").insert(data).execute()
        if not res or not res[1]:
            raise RuntimeError(f"Failed to create goal: no data returned. Payload: {data}")
        return UUID(res[1][0]["id"])

    def get_plan(self, plan_id: UUID) -> PlanRow | None:
        res = self.client.table("plans").select().eq("id", str(plan_id)).execute()
        if not res or not res[1]:
            return None
        return self._map_plan(res[1][0])

    def create_plan(
        self,
        user_id: UUID,
        goal_id: UUID | None = None,
        memory_id: UUID | None = None,
        title: str | None = None,
        priority: PlanPriority = PlanPriority.medium,
        intensity: PlanIntensity = PlanIntensity.moderate,
        status: PlanStatus = PlanStatus.active,
    ) -> PlanRow:
        """Create a plan row without tasks. Returns the PlanRow."""
        self.ensure_user(user_id)
        plan_data = {
            "user_id": str(user_id),
            "title": title or "Untitled Plan",
            "priority": priority.value,
            "intensity": intensity.value,
            "status": status.value,
        }
        if goal_id:
            plan_data["goal_id"] = str(goal_id)
        if memory_id:
            plan_data["memory_id"] = str(memory_id)
        plan_res = self.client.table("plans").insert(plan_data).execute()
        if not plan_res[1]:
            raise RuntimeError(f"Failed to create plan: no data returned. Payload: {plan_data}")
        return self._map_plan(plan_res[1][0])

    def update_plan(self, plan_id: UUID, status: PlanStatus | None = None, priority: PlanPriority | None = None, title: str | None = None, intensity: PlanIntensity | None = None, duration_days: int | None = None, schedule_prefs: dict | None = None) -> PlanRow | None:
        updates: dict = {}
        if status is not None:
            updates["status"] = status.value
        if priority is not None:
            updates["priority"] = priority.value
        if title is not None:
            updates["title"] = title
        if intensity is not None:
            updates["intensity"] = intensity.value
        if duration_days is not None:
            updates["duration_days"] = duration_days
        if schedule_prefs is not None:
            import json as _json
            updates["schedule_prefs"] = _json.dumps(schedule_prefs) if isinstance(schedule_prefs, dict) else schedule_prefs
        if not updates:
            return self.get_plan(plan_id)
        res = self.client.table("plans").update(updates).eq("id", str(plan_id)).execute()
        if not res or not res[1]:
            return None
        return self._map_plan(res[1][0])

    def create_plan_with_tasks(
        self,
        user_id: UUID,
        goal_id: UUID | None,
        title: str,
        priority: PlanPriority,
        intensity: PlanIntensity,
        tasks: list[dict],
    ) -> tuple[PlanRow, list[TaskRow]]:
        """Create a plan row + insert its tasks in one call. Returns (plan, tasks)."""
        self.ensure_user(user_id)

        plan_data = {
            "user_id": str(user_id),
            "title": title,
            "priority": priority.value,
            "intensity": intensity.value,
            "status": "active",
        }
        if goal_id:
            plan_data["goal_id"] = str(goal_id)
        plan_res = self.client.table("plans").insert(plan_data).execute()
        if not plan_res[1]:
            raise RuntimeError(f"Failed to create plan: no data returned. Payload: {plan_data}")
        plan = self._map_plan(plan_res[1][0])

        task_rows = []
        if tasks:
            for t in tasks:
                t["plan_id"] = str(plan.id)
            task_res = self.client.table("tasks").insert(tasks).execute()
            if not task_res[1]:
                # If plan was created but tasks failed, we still returning the plan
                # but might want to log this inconsistency.
                logger.warning("Plan %s created but tasks insertion returned no data", plan.id)
            else:
                task_rows = [self._map_task(row) for row in task_res[1]]

        return plan, task_rows

    # ── Tasks ──────────────────────────────────────────────────────────────

    def get_due_tasks(self, user_id: UUID, on_date: date) -> list[TaskRow]:
        active_plans = self.list_active_plans(user_id)
        if not active_plans:
            return []
        plan_ids = [str(p.id) for p in active_plans]

        res = (
            self.client.table("tasks")
            .select()
            .in_("plan_id", plan_ids)
            .in_("status", ["pending", "partial"])
            .lte("due_date", on_date.isoformat())
            .execute()
        )
        return [self._map_task(row) for row in res[1]]

    def get_tasks_for_date(self, user_id: UUID, on_date: date) -> list[TaskRow]:
        """All tasks due on a specific date across all plans (any status)."""
        active_plans = self.list_active_plans(user_id)
        if not active_plans:
            return []
        plan_ids = [str(p.id) for p in active_plans]

        res = (
            self.client.table("tasks")
            .select()
            .in_("plan_id", plan_ids)
            .eq("due_date", on_date.isoformat())
            .execute()
        )
        if not res or not res[1]:
            return []
        return [self._map_task(row) for row in res[1]]

    def get_task(self, task_id: UUID) -> TaskRow | None:
        res = self.client.table("tasks").select().eq("id", str(task_id)).execute()
        if not res or not res[1]:
            return None
        return self._map_task(res[1][0])

    def update_task_status(self, task_id: UUID, status: TaskStatus) -> TaskRow | None:
        res = self.client.table("tasks").update({"status": status.value}).eq("id", str(task_id)).execute()
        if not res or not res[1]:
            return None
        # Invalidate milestone insight cache since task status changed
        self.clear_milestone_insight_for_task(task_id)
        return self._map_task(res[1][0])

    def increment_carry_over(self, task_id: UUID) -> TaskRow | None:
        """Increment carry_over_count using a single PATCH with raw SQL expression via PostgREST."""
        # PostgREST doesn't support atomic increment directly,
        # so we still need read-then-write, but we combine into minimal round-trips.
        task = self.get_task(task_id)
        if task is None:
            return None
        new_count = task.carry_over_count + 1
        res = self.client.table("tasks").update({"carry_over_count": new_count}).eq("id", str(task_id)).execute()
        if not res or not res[1]:
            return None
        return self._map_task(res[1][0])

    def reschedule_task(self, task_id: UUID, new_date: date) -> TaskRow | None:
        """Move a task's due_date to a new date and reset status to pending."""
        res = self.client.table("tasks").update({
            "due_date": new_date.isoformat(),
            "status": "pending",
        }).eq("id", str(task_id)).execute()
        if not res or not res[1]:
            return None
        return self._map_task(res[1][0])

    def reschedule_tasks_batch(self, task_ids: list[UUID], new_date: date) -> list[TaskRow]:
        """Reschedule multiple tasks to a new date in a single DB call."""
        if not task_ids:
            return []
        date_str = new_date.isoformat()
        ids_str = [str(tid) for tid in task_ids]
        res = (
            self.client.table("tasks")
            .update({"due_date": date_str, "status": "pending"})
            .in_("id", ids_str)
            .execute()
        )
        if not res or not res[1]:
            return []
        return [self._map_task(row) for row in res[1]]

    def reduce_task_difficulty(self, task_id: UUID) -> TaskRow | None:
        """Step difficulty down one level: hard→intermediate→easy. No-op if already easy."""
        from backend.adaptive.models import TaskDifficulty
        downgrade = {
            TaskDifficulty.hard: TaskDifficulty.intermediate.value,
            TaskDifficulty.intermediate: TaskDifficulty.easy.value,
        }
        # Read current difficulty in a single select, then update — avoids full task mapping
        res = self.client.table("tasks").select("difficulty").eq("id", str(task_id)).execute()
        if not res or not res[1]:
            return None
        current = res[1][0].get("difficulty", "")
        new_diff_val = downgrade.get(TaskDifficulty(current))
        if new_diff_val is None:
            # Already easy or unknown — return the full task
            return self.get_task(task_id)
        res = self.client.table("tasks").update({
            "difficulty": new_diff_val,
        }).eq("id", str(task_id)).execute()
        if not res or not res[1]:
            return None
        return self._map_task(res[1][0])

    def update_task_detail_json(self, task_id: UUID, detail_json: dict) -> TaskRow | None:
        """Store the generated detail JSON on the task record."""
        import json as _json
        res = self.client.table("tasks").update({
            "detail_json": _json.dumps(detail_json) if isinstance(detail_json, dict) else detail_json,
        }).eq("id", str(task_id)).execute()
        if not res or not res[1]:
            return None
        return self._map_task(res[1][0])

    def get_next_pending_task(self, plan_id: UUID, after_date: date | None = None) -> TaskRow | None:
        """Get the earliest pending task in a plan that's after a given date."""
        query = (
            self.client.table("tasks")
            .select()
            .eq("plan_id", str(plan_id))
            .eq("status", "pending")
        )
        if after_date:
            query = query.gte("due_date", after_date.isoformat())
        res = query.execute()
        if not res or not res[1]:
            return None
        # Return the one with the earliest due_date
        tasks = [self._map_task(row) for row in res[1]]
        tasks.sort(key=lambda t: t.due_date or date.today())
        return tasks[0]

    # ── Milestones ─────────────────────────────────────────────────────────

    def create_milestone(self, user_id: UUID, plan_id: UUID, data: dict) -> MilestoneRow:
        self.ensure_user(user_id)
        row_data = {
            "plan_id": str(plan_id),
            "user_id": str(user_id),
            "title": data["title"],
            "order_index": data.get("order_index", 0),
        }
        if data.get("description"):
            row_data["description"] = data["description"]
        if data.get("status") is not None:
            row_data["status"] = data["status"].value if isinstance(data["status"], MilestoneStatus) else data["status"]
        if data.get("suggested_days") is not None:
            row_data["suggested_days"] = data["suggested_days"]
        if data.get("outcome"):
            row_data["outcome"] = data["outcome"]
        res = self.client.table("milestones").insert(row_data).execute()
        if not res or not res[1]:
            raise RuntimeError(f"Failed to create milestone: no data returned. Payload: {row_data}")
        return self._map_milestone(res[1][0])

    def get_milestones_for_plan(self, user_id: UUID, plan_id: UUID) -> list[MilestoneRow]:
        res = (
            self.client.table("milestones")
            .select()
            .eq("user_id", str(user_id))
            .eq("plan_id", str(plan_id))
            .order("order_index")
            .execute()
        )
        return [self._map_milestone(row) for row in res[1]]

    def update_milestone(self, user_id: UUID, milestone_id: UUID, data: dict) -> MilestoneRow | None:
        updates: dict = {}
        if "title" in data and data["title"] is not None:
            updates["title"] = data["title"]
        if "description" in data:
            updates["description"] = data["description"]
        if "status" in data and data["status"] is not None:
            updates["status"] = data["status"].value if isinstance(data["status"], MilestoneStatus) else data["status"]
        # Invalidate cached insight when milestone data changes
        if updates:
            updates["insight_json"] = None
        if not updates:
            res = self.client.table("milestones").select().eq("id", str(milestone_id)).eq("user_id", str(user_id)).execute()
            if not res or not res[1]:
                return None
            return self._map_milestone(res[1][0])
        res = self.client.table("milestones").update(updates).eq("id", str(milestone_id)).eq("user_id", str(user_id)).execute()
        if not res or not res[1]:
            return None
        return self._map_milestone(res[1][0])

    def get_tasks_for_milestone(self, user_id: UUID, milestone_id: UUID) -> list[TaskRow]:
        res = (
            self.client.table("tasks")
            .select()
            .eq("milestone_id", str(milestone_id))
            .order("order_index")
            .execute()
        )
        return [self._map_task(row) for row in res[1]]

    def check_milestone_completion(self, user_id: UUID, milestone_id: UUID) -> bool:
        tasks = self.get_tasks_for_milestone(user_id, milestone_id)
        if not tasks:
            return False
        return all(t.status == TaskStatus.done for t in tasks)

    def activate_next_milestone(self, user_id: UUID, plan_id: UUID) -> MilestoneRow | None:
        """Set the next locked milestone to active. Returns the newly activated milestone or None."""
        res = (
            self.client.table("milestones")
            .select()
            .eq("user_id", str(user_id))
            .eq("plan_id", str(plan_id))
            .eq("status", "locked")
            .order("order_index")
            .limit(1)
            .execute()
        )
        if not res or not res[1]:
            return None
        next_ms = self._map_milestone(res[1][0])
        updated = self.update_milestone(user_id, next_ms.id, {"status": MilestoneStatus.active})
        return updated

    # ── Events ─────────────────────────────────────────────────────────────

    def record_event(
        self,
        user_id: UUID,
        task_id: UUID,
        plan_id: UUID,
        event_type: EventType,
        feedback_rating: int | None = None,
        feedback_text: str | None = None,
    ) -> EventRow:
        self.ensure_user(user_id)
        data = {
            "user_id": str(user_id),
            "task_id": str(task_id),
            "plan_id": str(plan_id),
            "event_type": event_type.value,
        }
        if feedback_rating is not None:
            data["feedback_rating"] = feedback_rating
        if feedback_text is not None:
            data["feedback_text"] = feedback_text
        res = self.client.table("events").insert(data).execute()
        if not res or not res[1]:
            raise RuntimeError(f"Failed to record event: no data returned. Payload: {data}")
        return self._map_event(res[1][0])

    def get_events_for_task(self, task_id: UUID) -> list[EventRow]:
        res = self.client.table("events").select().eq("task_id", str(task_id)).execute()
        return [self._map_event(row) for row in res[1]]

    def get_events_for_user(
        self,
        user_id: UUID,
        event_type: EventType | None = None,
        since: datetime | None = None,
    ) -> list[EventRow]:
        query = self.client.table("events").select().eq("user_id", str(user_id))
        if event_type:
            query = query.eq("event_type", event_type.value)
        if since:
            query = query.gte("created_at", since.isoformat())
        res = query.execute()
        return [self._map_event(row) for row in res[1]]

    def get_recent_skip_count(self, user_id: UUID, days: int = 7) -> int:
        """Count skip events in the last N days for a user."""
        from datetime import timedelta
        since = datetime.now(timezone.utc) - timedelta(days=days)
        res = (
            self.client.table("events")
            .select()
            .eq("user_id", str(user_id))
            .eq("event_type", "skipped")
            .gte("created_at", since.isoformat())
            .execute()
        )
        return len(res[1])

    # ── Memory ─────────────────────────────────────────────────────────────

    def create_memory(
        self,
        user_id: UUID,
        key: MemoryKey,
        value: str,
        source: str = "chat_extraction",
        goal_id: UUID | None = None,
    ) -> MemoryRow:
        self.ensure_user(user_id)
        data = {
            "user_id": str(user_id),
            "key": key.value,
            "value": value,
            "source": source,
        }
        if goal_id:
            data["goal_id"] = str(goal_id)
        res = self.client.table("memory").insert(data).execute()
        if not res or not res[1]:
            raise RuntimeError(f"Failed to create memory entry: no data returned. Payload: {data}")
        return self._map_memory(res[1][0])

    def get_memory(self, memory_id: UUID) -> MemoryRow | None:
        res = self.client.table("memory").select().eq("id", str(memory_id)).execute()
        if not res or not res[1]:
            return None
        return self._map_memory(res[1][0])

    def list_memory(self, user_id: UUID, key: MemoryKey | None = None) -> list[MemoryRow]:
        query = self.client.table("memory").select().eq("user_id", str(user_id))
        if key:
            query = query.eq("key", key.value)
        res = query.execute()
        return [self._map_memory(row) for row in res[1]]

    # ── Adjustment Suggestions ─────────────────────────────────────────────

    def create_suggestion(
        self,
        user_id: UUID,
        plan_id: UUID,
        reason: str,
        suggested_tasks: list[dict],
    ) -> AdjustmentSuggestionRow:
        self.ensure_user(user_id)
        data = {
            "user_id": str(user_id),
            "plan_id": str(plan_id),
            "reason": reason,
            "suggested_tasks": suggested_tasks,
        }
        res = self.client.table("adjustment_suggestions").insert(data).execute()
        if not res or not res[1]:
            raise RuntimeError(f"Failed to create adjustment suggestion: no data returned. Payload: {data}")
        return self._map_suggestion(res[1][0])

    def list_pending_suggestions(self, user_id: UUID) -> list[AdjustmentSuggestionRow]:
        res = (
            self.client.table("adjustment_suggestions")
            .select()
            .eq("user_id", str(user_id))
            .eq("status", "pending")
            .execute()
        )
        return [self._map_suggestion(row) for row in res[1]]

    def get_suggestion(self, suggestion_id: UUID) -> AdjustmentSuggestionRow | None:
        res = self.client.table("adjustment_suggestions").select().eq("id", str(suggestion_id)).execute()
        if not res or not res[1]:
            return None
        return self._map_suggestion(res[1][0])

    def resolve_suggestion(self, suggestion_id: UUID, status: AdjustmentStatus) -> AdjustmentSuggestionRow | None:
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        res = self.client.table("adjustment_suggestions").update({
            "status": status.value,
            "resolved_at": now,
        }).eq("id", str(suggestion_id)).execute()
        if not res or not res[1]:
            return None
        return self._map_suggestion(res[1][0])

    # ── Row Mappers ────────────────────────────────────────────────────────

    def _safe_date(self, val: any) -> datetime:
        if not val:
            return datetime.now(timezone.utc)
        if isinstance(val, datetime):
            return val
        try:
            return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
        except Exception:
            return datetime.now(timezone.utc)

    def _safe_uuid(self, val: any, fallback: str = "00000000-0000-0000-0000-000000000000") -> UUID:
        if not val:
            return UUID(fallback)
        if isinstance(val, UUID):
            return val
        try:
            return UUID(str(val))
        except Exception:
            return UUID(fallback)

    def _safe_enum(self, enum_cls: any, val: any, fallback: any) -> any:
        if not val:
            return fallback
        try:
            return enum_cls(val)
        except Exception:
            return fallback

    def _safe_json_dict(self, val: any) -> dict | None:
        if not val:
            return None
        if isinstance(val, dict):
            return val
        if isinstance(val, str):
            import json
            try:
                parsed = json.loads(val)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                pass
        return None

    def _map_preferences(self, row: dict) -> UserPreferences:
        return UserPreferences(
            id=self._safe_uuid(row.get("id")),
            user_id=self._safe_uuid(row.get("user_id")),
            max_tasks_per_day=row.get("max_tasks_per_day", 4),
            created_at=self._safe_date(row.get("created_at")),
            updated_at=self._safe_date(row.get("updated_at") or row.get("created_at")),
        )

    def _map_plan(self, row: dict) -> PlanRow:
        return PlanRow(
            id=self._safe_uuid(row.get("id")),
            goal_id=self._safe_uuid(row.get("goal_id")) if row.get("goal_id") else None,
            memory_id=self._safe_uuid(row.get("memory_id")) if row.get("memory_id") else None,
            user_id=self._safe_uuid(row.get("user_id")) if row.get("user_id") else None,
            title=row.get("title") or "Untitled Plan",
            status=self._safe_enum(PlanStatus, row.get("status"), PlanStatus.active),
            priority=self._safe_enum(PlanPriority, row.get("priority"), PlanPriority.medium),
            intensity=self._safe_enum(PlanIntensity, row.get("intensity"), PlanIntensity.moderate),
            duration_days=row.get("duration_days"),
            schedule_prefs=self._safe_json_dict(row.get("schedule_prefs")),
            created_at=self._safe_date(row.get("created_at")),
            updated_at=self._safe_date(row.get("updated_at") or row.get("created_at")),
        )

    def _map_task(self, row: dict) -> TaskRow:
        due_val = row.get("due_date")
        due_date = None
        if due_val:
            try:
                due_date = datetime.fromisoformat(str(due_val)).date()
            except Exception:
                pass

        return TaskRow(
            id=self._safe_uuid(row.get("id")),
            plan_id=self._safe_uuid(row.get("plan_id")),
            title=row.get("title") or "Untitled Task",
            description=row.get("description"),
            due_date=due_date,
            status=self._safe_enum(TaskStatus, row.get("status"), TaskStatus.pending),
            priority=str(row.get("priority", "medium")),
            difficulty=self._safe_enum(TaskDifficulty, row.get("difficulty"), TaskDifficulty.intermediate),
            parent_id=self._safe_uuid(row.get("parent_id")) if row.get("parent_id") else None,
            carry_over_count=row.get("carry_over_count", 0),
            milestone_id=self._safe_uuid(row.get("milestone_id")) if row.get("milestone_id") else None,
            order_index=row.get("order_index", 0),
            duration_minutes=row.get("duration_minutes"),
            detail_json=self._safe_json_dict(row.get("detail_json")),
            created_at=self._safe_date(row.get("created_at")),
            updated_at=self._safe_date(row.get("updated_at") or row.get("created_at")),
        )

    def update_milestone_insight_json(self, milestone_id: UUID, insight_json: dict) -> MilestoneRow | None:
        """Store the generated insight JSON on the milestone record."""
        import json as _json
        res = self.client.table("milestones").update({
            "insight_json": _json.dumps(insight_json) if isinstance(insight_json, dict) else insight_json,
        }).eq("id", str(milestone_id)).execute()
        if not res or not res[1]:
            return None
        return self._map_milestone(res[1][0])

    def clear_milestone_insight_json(self, milestone_id: UUID) -> MilestoneRow | None:
        """Clear the cached insight JSON so it will be regenerated on next access."""
        res = self.client.table("milestones").update({
            "insight_json": None,
        }).eq("id", str(milestone_id)).execute()
        if not res or not res[1]:
            return None
        return self._map_milestone(res[1][0])

    def clear_milestone_insight_for_task(self, task_id: UUID) -> None:
        """Clear the cached insight for the milestone that owns this task (best-effort)."""
        task = self.get_task(task_id)
        if task and task.milestone_id:
            try:
                self.clear_milestone_insight_json(task.milestone_id)
            except Exception:
                logger.warning("Failed to clear insight cache for milestone %s", task.milestone_id)

    def _map_milestone(self, row: dict) -> MilestoneRow:
        return MilestoneRow(
            id=self._safe_uuid(row.get("id")),
            plan_id=self._safe_uuid(row.get("plan_id")),
            user_id=self._safe_uuid(row.get("user_id")),
            title=row.get("title") or "Untitled Milestone",
            description=row.get("description"),
            order_index=row.get("order_index", 0),
            status=self._safe_enum(MilestoneStatus, row.get("status"), MilestoneStatus.locked),
            suggested_days=row.get("suggested_days"),
            outcome=row.get("outcome"),
            insight_json=self._safe_json_dict(row.get("insight_json")),
            created_at=self._safe_date(row.get("created_at")),
            updated_at=self._safe_date(row.get("updated_at") or row.get("created_at")),
        )

    def _map_event(self, row: dict) -> EventRow:
        return EventRow(
            id=self._safe_uuid(row.get("id")),
            user_id=self._safe_uuid(row.get("user_id")),
            task_id=self._safe_uuid(row.get("task_id")),
            plan_id=self._safe_uuid(row.get("plan_id")),
            event_type=self._safe_enum(EventType, row.get("event_type"), EventType.done),
            feedback_rating=row.get("feedback_rating"),
            feedback_text=row.get("feedback_text"),
            created_at=self._safe_date(row.get("created_at")),
        )

    def _map_memory(self, row: dict) -> MemoryRow:
        return MemoryRow(
            id=self._safe_uuid(row.get("id")),
            user_id=self._safe_uuid(row.get("user_id")),
            key=self._safe_enum(MemoryKey, row.get("key"), MemoryKey.context),
            value=row.get("value") or "",
            source=row.get("source", "chat_extraction"),
            goal_id=self._safe_uuid(row.get("goal_id")) if row.get("goal_id") else None,
            created_at=self._safe_date(row.get("created_at")),
            updated_at=self._safe_date(row.get("updated_at") or row.get("created_at")),
        )

    def _map_suggestion(self, row: dict) -> AdjustmentSuggestionRow:
        res_at = row.get("resolved_at")
        return AdjustmentSuggestionRow(
            id=self._safe_uuid(row.get("id")),
            user_id=self._safe_uuid(row.get("user_id")),
            plan_id=self._safe_uuid(row.get("plan_id")),
            reason=row.get("reason") or "",
            suggested_tasks=row.get("suggested_tasks") or [],
            status=self._safe_enum(AdjustmentStatus, row.get("status"), AdjustmentStatus.pending),
            created_at=self._safe_date(row.get("created_at")),
            resolved_at=self._safe_date(res_at) if res_at else None,
        )


adaptive_store = AdaptiveStore()
