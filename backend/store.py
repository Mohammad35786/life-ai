import logging
from datetime import datetime, timezone
from uuid import UUID

from backend.models import (
    Conversation, ConversationCreate, ConversationUpdate,
    ConversationMessage, ConversationSummary,
)

from backend.lib.db import get_supabase_client

logger = logging.getLogger(__name__)

class DbStore:
    def __init__(self) -> None:
        self.memory_log: list[str] = []
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
            self.client.table('users').upsert({"id": user_id_str}, on_conflict="id").execute()
        except Exception:
            logger.exception("Failed to ensure public.users row for user_id=%s", user_id_str)
            raise

    # ── Conversation Methods ──────────────────────────────────────────────────

    def create_conversation(self, user_id: UUID, payload: ConversationCreate) -> Conversation:
        data = {
            'user_id': str(user_id),
            'title': payload.title,
            'messages': [],
        }
        res = self.client.table('conversations').insert(data).execute()
        if not res[1]:
            raise RuntimeError(f"Failed to create conversation: no data returned. Payload: {data}")
        return self._map_conversation(res[1][0])

    def list_conversations(self, user_id: UUID, include_archived: bool = False) -> list[ConversationSummary]:
        query = (
            self.client.table('conversations')
            .select('id,title,messages,archived,created_at,updated_at')
            .eq('user_id', str(user_id))
            .order('updated_at', desc=True)
        )
        if not include_archived:
            query = query.eq('archived', 'false')
        res = query.execute()
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
                archived=row.get('archived', False),
                updated_at=datetime.fromisoformat(row['updated_at']),
                created_at=datetime.fromisoformat(row['created_at']),
            ))
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
        if payload.archived is not None:
            updates['archived'] = payload.archived
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
            archived=row.get('archived', False),
            created_at=datetime.fromisoformat(row['created_at']),
            updated_at=datetime.fromisoformat(row['updated_at']),
        )


store = DbStore()
