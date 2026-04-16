import logging
from datetime import datetime, timezone
from uuid import UUID

from backend.models import (
    Goal, GoalCreate, Plan, Task, TaskCreate, TaskStatus,
    RoadmapFolder, RoadmapFolderCreate, Roadmap, RoadmapCreate,
    Conversation, ConversationCreate, ConversationUpdate,
    ConversationMessage, ConversationSummary,
)

from backend.lib.db import get_supabase_client

logger = logging.getLogger(__name__)

class DbStore:
    def __init__(self) -> None:
        self.memory_log: list[str] = []

    @property
    def client(self):
        client = get_supabase_client()
        if not client:
            raise RuntimeError("Database not configured. Set Supabase credentials in .env")
        return client

    def ensure_user(self, user_id: UUID | str) -> None:
        """Ensure the public.users row exists before writing dependent records."""
        user_id_str = str(user_id)
        try:
            self.client.table('users').upsert({"id": user_id_str}, on_conflict="id").execute()
        except Exception:
            logger.exception("Failed to ensure public.users row for user_id=%s", user_id_str)
            raise

    def create_goal(self, payload: GoalCreate, user_id: UUID | None = None) -> Goal:
        data = {'title': payload.title, 'description': payload.description}
        if user_id:
            self.ensure_user(user_id)
            data['user_id'] = str(user_id)
        res = self.client.table('goals').insert(data).execute()
        return self._map_goal(res[1][0])

    def list_goals(self, user_id: UUID | None = None) -> list[Goal]:
        query = self.client.table('goals').select()
        if user_id:
            query = query.eq('user_id', str(user_id))
        res = query.execute()
        return [self._map_goal(row) for row in res[1]]

    def get_goal(self, goal_id: UUID) -> Goal | None:
        res = self.client.table('goals').select().eq('id', str(goal_id)).execute()
        return self._map_goal(res[1][0]) if res[1] else None

    def create_plan(self, goal_id: UUID, tasks_payload: list[TaskCreate]) -> Plan:
        plan_res = self.client.table('plans').insert({'goal_id': str(goal_id)}).execute()
        plan_data = plan_res[1][0]
        plan_id = plan_data['id']
        
        tasks = []
        if tasks_payload:
            tasks_to_insert = [
                {
                    'plan_id': plan_id,
                    'title': t.title,
                    'due_date': t.due_date.isoformat() if t.due_date else None,
                    'status': t.status.value,
                    'priority': t.priority,
                    'parent_id': str(t.parent_id) if t.parent_id else None
                } for t in tasks_payload
            ]
            tasks_res = self.client.table('tasks').insert(tasks_to_insert).execute()
            tasks = [self._map_task(row) for row in tasks_res[1]]
            
        return self._map_plan(plan_data, tasks)

    def list_plans(self) -> list[Plan]:
        plans_res = self.client.table('plans').select().execute()
        tasks_res = self.client.table('tasks').select().execute()
        
        from collections import defaultdict
        tasks_by_plan = defaultdict(list)
        for t_row in tasks_res[1]:
            tasks_by_plan[t_row['plan_id']].append(self._map_task(t_row))
            
        return [self._map_plan(p_row, tasks_by_plan.get(p_row['id'], [])) for p_row in plans_res[1]]

    def get_plan(self, plan_id: UUID) -> Plan | None:
        plan_res = self.client.table('plans').select().eq('id', str(plan_id)).execute()
        if not plan_res[1]:
            return None
            
        tasks_res = self.client.table('tasks').select().eq('plan_id', str(plan_id)).execute()
        tasks = [self._map_task(row) for row in tasks_res[1]]
        return self._map_plan(plan_res[1][0], tasks)

    def update_plan(self, plan_id: UUID, tasks_payload: list[Task]) -> Plan | None:
        plan = self.get_plan(plan_id)
        if plan is None:
            return None

        # Delete all tasks for this plan, and insert new ones
        self.client.table('tasks').delete().eq('plan_id', str(plan_id)).execute()
        
        if tasks_payload:
            tasks_to_insert = [
                {
                    'id': str(t.id),
                    'plan_id': str(plan_id),
                    'title': t.title,
                    'due_date': t.due_date.isoformat() if t.due_date else None,
                    'status': t.status.value,
                    'priority': t.priority
                } for t in tasks_payload
            ]
            self.client.table('tasks').insert(tasks_to_insert).execute()
            
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        self.memory_log.append(f"Plan {plan_id} manually updated on {timestamp}.")
        return self.get_plan(plan_id)

    def replace_plan_tasks(self, plan_id: UUID, tasks_payload: list[TaskCreate]) -> Plan | None:
        plan = self.get_plan(plan_id)
        if plan is None:
            return None

        # Delete pending tasks manually 
        pending_ids = [str(t.id) for t in plan.tasks if t.status != TaskStatus.done]
        for task_id in pending_ids:
            self.client.table('tasks').delete().eq('id', task_id).execute()
            
        if tasks_payload:
            tasks_to_insert = [
                {
                    'plan_id': str(plan_id),
                    'title': t.title,
                    'due_date': t.due_date.isoformat() if t.due_date else None,
                    'status': t.status.value,
                    'priority': t.priority,
                    'parent_id': str(t.parent_id) if t.parent_id else None
                } for t in tasks_payload
            ]
            self.client.table('tasks').insert(tasks_to_insert).execute()

        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        self.memory_log.append(f"Plan {plan_id} adjusted on {timestamp}.")
        return self.get_plan(plan_id)

    def complete_task(self, task_id: UUID) -> Task | None:
        res = self.client.table('tasks').update({'status': TaskStatus.done.value}).eq('id', str(task_id)).execute()
        if not res[1]:
            return None
            
        completed_task = self._map_task(res[1][0])
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        self.memory_log.append(f"Task {completed_task.id} completed on {timestamp}.")
        return completed_task

    def create_task(self, plan_id: UUID, payload: TaskCreate) -> Task:
        task_to_insert = {
            'plan_id': str(plan_id),
            'title': payload.title,
            'due_date': payload.due_date.isoformat() if payload.due_date else None,
            'status': payload.status.value,
            'priority': payload.priority,
            'parent_id': str(payload.parent_id) if payload.parent_id else None
        }
        res = self.client.table('tasks').insert(task_to_insert).execute()
        return self._map_task(res[1][0])

    def create_roadmap_folder(self, payload: RoadmapFolderCreate, user_id: UUID | None = None) -> RoadmapFolder:
        data = {'name': payload.name}
        if user_id:
            self.ensure_user(user_id)
            data['user_id'] = str(user_id)
        try:
            res = self.client.table('roadmap_folders').insert(data).execute()
        except Exception:
            logger.exception("Failed to create roadmap folder for user_id=%s", str(user_id) if user_id else None)
            raise
        return self._map_roadmap_folder(res[1][0])

    def list_roadmap_folders(self, user_id: UUID | None = None) -> list[RoadmapFolder]:
        query = self.client.table('roadmap_folders').select('*')
        if user_id:
            query = query.eq('user_id', str(user_id))
        res = query.execute()
        return [self._map_roadmap_folder(row) for row in res[1]]

    def create_roadmap(self, payload: RoadmapCreate, user_id: UUID | None = None) -> Roadmap:
        data = {
            'title': payload.title,
            'topic': payload.topic,
            'difficulty': payload.difficulty,
            'provider': payload.provider,
            'data': payload.data
        }
        if payload.folder_id:
            data['folder_id'] = str(payload.folder_id)
        if user_id:
            self.ensure_user(user_id)
            data['user_id'] = str(user_id)

        try:
            res = self.client.table('roadmaps').insert(data).execute()
        except Exception:
            logger.exception(
                "Failed to create roadmap for user_id=%s folder_id=%s",
                str(user_id) if user_id else None,
                str(payload.folder_id) if payload.folder_id else None,
            )
            raise
        return self._map_roadmap(res[1][0])

    def get_roadmap(self, roadmap_id: UUID) -> Roadmap | None:
        res = self.client.table('roadmaps').select('*').eq('id', str(roadmap_id)).execute()
        if not res[1]:
            return None
        return self._map_roadmap(res[1][0])

    def list_roadmaps(self, folder_id: UUID | None = None, user_id: UUID | None = None) -> list[Roadmap]:
        query = self.client.table('roadmaps').select('*')
        if folder_id:
            query = query.eq('folder_id', str(folder_id))
        if user_id:
            query = query.eq('user_id', str(user_id))
        res = query.execute()
        return [self._map_roadmap(row) for row in res[1]]

    def _map_roadmap_folder(self, row: dict) -> RoadmapFolder:
        return RoadmapFolder(
            id=UUID(row['id']),
            user_id=UUID(row['user_id']) if row.get('user_id') else None,
            name=row['name'],
            created_at=datetime.fromisoformat(row['created_at'])
        )

    def _map_roadmap(self, row: dict) -> Roadmap:
        return Roadmap(
            id=UUID(row['id']),
            folder_id=UUID(row['folder_id']) if row.get('folder_id') else None,
            user_id=UUID(row['user_id']) if row.get('user_id') else None,
            title=row['title'],
            topic=row['topic'],
            difficulty=row['difficulty'],
            provider=row['provider'],
            data=row['data'],
            created_at=datetime.fromisoformat(row['created_at'])
        )

    def _map_goal(self, row: dict) -> Goal:
        return Goal(
            id=UUID(row['id']),
            title=row['title'],
            description=row.get('description') or '',
            created_at=datetime.fromisoformat(row['created_at']),
            updated_at=datetime.fromisoformat(row.get('updated_at', row['created_at']))
        )

    def _map_task(self, row: dict) -> Task:
        return Task(
            id=UUID(row['id']),
            plan_id=UUID(row['plan_id']),
            title=row['title'],
            due_date=datetime.fromisoformat(row['due_date']).date() if row.get('due_date') else None,
            status=TaskStatus(row['status']),
            priority=row['priority'],
            parent_id=UUID(row['parent_id']) if row.get('parent_id') else None
        )

    def _map_plan(self, row: dict, tasks: list[Task]) -> Plan:
        return Plan(
            id=UUID(row['id']),
            goal_id=UUID(row['goal_id']),
            tasks=tasks,
            created_at=datetime.fromisoformat(row['created_at'])
        )

    # ── Conversation Methods ──────────────────────────────────────────────────

    def create_conversation(self, user_id: UUID, payload: ConversationCreate) -> Conversation:
        data = {
            'user_id': str(user_id),
            'title': payload.title,
            'messages': [],
        }
        res = self.client.table('conversations').insert(data).execute()
        return self._map_conversation(res[1][0])

    def list_conversations(self, user_id: UUID) -> list[ConversationSummary]:
        res = (
            self.client.table('conversations')
            .select('id,title,messages,created_at,updated_at')
            .eq('user_id', str(user_id))
            .execute()
        )
        summaries = []
        for row in res[1]:
            msgs = row.get('messages') or []
            # Find last assistant message for preview
            preview = ''
            for m in reversed(msgs):
                if isinstance(m, dict) and m.get('role') == 'assistant':
                    preview = (m.get('content') or '')[:120]
                    break
            if not preview and msgs:
                preview = (msgs[-1].get('content') or '')[:120]
            summaries.append(ConversationSummary(
                id=UUID(row['id']),
                title=row['title'],
                preview=preview,
                message_count=len(msgs),
                updated_at=datetime.fromisoformat(row['updated_at']),
                created_at=datetime.fromisoformat(row['created_at']),
            ))
        # Sort by most recently updated first
        summaries.sort(key=lambda c: c.updated_at, reverse=True)
        return summaries

    def get_conversation(self, conversation_id: UUID, user_id: UUID) -> Conversation | None:
        res = (
            self.client.table('conversations')
            .select('*')
            .eq('id', str(conversation_id))
            .eq('user_id', str(user_id))
            .execute()
        )
        if not res[1]:
            return None
        return self._map_conversation(res[1][0])

    def update_conversation(self, conversation_id: UUID, user_id: UUID, payload: ConversationUpdate) -> Conversation | None:
        updates: dict = {}
        if payload.title is not None:
            updates['title'] = payload.title
        if payload.messages is not None:
            updates['messages'] = [m.model_dump(exclude_none=True) for m in payload.messages]
        if not updates:
            return self.get_conversation(conversation_id, user_id)

        res = (
            self.client.table('conversations')
            .update(updates)
            .eq('id', str(conversation_id))
            .eq('user_id', str(user_id))
            .execute()
        )
        if not res[1]:
            return None
        return self._map_conversation(res[1][0])

    def delete_conversation(self, conversation_id: UUID, user_id: UUID) -> bool:
        self.client.table('conversations').delete().eq('id', str(conversation_id)).eq('user_id', str(user_id)).execute()
        return True

    def _map_conversation(self, row: dict) -> Conversation:
        raw_msgs = row.get('messages') or []
        messages = []
        for m in raw_msgs:
            if isinstance(m, dict):
                messages.append(ConversationMessage(
                    id=m.get('id', ''),
                    role=m.get('role', 'user'),
                    content=m.get('content', ''),
                    isPlan=m.get('isPlan'),
                    originalUserMsg=m.get('originalUserMsg'),
                    convertedToRoadmap=m.get('convertedToRoadmap'),
                    created_at=m.get('created_at'),
                ))
        return Conversation(
            id=UUID(row['id']),
            user_id=UUID(row['user_id']),
            title=row['title'],
            messages=messages,
            created_at=datetime.fromisoformat(row['created_at']),
            updated_at=datetime.fromisoformat(row['updated_at']),
        )


store = DbStore()
