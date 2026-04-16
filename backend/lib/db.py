import json
import urllib.request
import urllib.error
from typing import Any
from backend.config import settings


class SupabaseREST:
    """Lightweight Supabase client using the PostgREST API directly (no SDK dependency)."""

    def __init__(self, url: str, service_role_key: str):
        self.base_url = url.rstrip("/")
        self.api_url = f"{self.base_url}/rest/v1"
        self.headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    def _request(
        self,
        method: str,
        table: str,
        body: Any = None,
        params: dict[str, str] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> list[dict] | None:
        url = f"{self.api_url}/{table}"
        if params:
            query = "&".join(f"{k}={v}" for k, v in params.items())
            url = f"{url}?{query}"
        data = json.dumps(body).encode("utf-8") if body else None
        headers = dict(self.headers)
        if extra_headers:
            headers.update(extra_headers)
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read().decode("utf-8")
                if not raw.strip():
                    return None
                return json.loads(raw)
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8")
            raise RuntimeError(f"Supabase REST error ({e.code}): {err}") from e

    def table(self, name: str):
        return _TableHandle(self, name)


class _TableHandle:
    def __init__(self, client: SupabaseREST, name: str):
        self._client = client
        self._name = name
        self._filters: dict[str, str] = {}
        self._extra_headers: dict[str, str] = {}

    def insert(self, rows: dict | list[dict]) -> "_TableHandle":
        self._method = "POST"
        self._body = rows if isinstance(rows, list) else [rows]
        self._extra_headers = {}
        return self

    def upsert(self, rows: dict | list[dict], on_conflict: str | None = None) -> "_TableHandle":
        self._method = "POST"
        self._body = rows if isinstance(rows, list) else [rows]
        self._extra_headers = {
            "Prefer": "resolution=merge-duplicates,return=representation",
        }
        if on_conflict:
            self._filters["on_conflict"] = on_conflict
        return self

    def select(self, cols: str = "*") -> "_TableHandle":
        self._method = "GET"
        self._select_cols = cols
        return self

    def eq(self, col: str, val: str) -> "_TableHandle":
        self._filters[col] = f"eq.{val}"
        return self

    def update(self, body: dict) -> "_TableHandle":
        self._method = "PATCH"
        self._body = body
        return self

    def delete(self) -> "_TableHandle":
        self._method = "DELETE"
        return self

    def execute(self) -> list[list[dict]]:
        params = dict(self._filters)
        if hasattr(self, "_select_cols"):
            params["select"] = self._select_cols
        result = self._client._request(
            method=getattr(self, "_method", "GET"),
            table=self._name,
            body=getattr(self, "_body", None),
            params=params if params else None,
            extra_headers=self._extra_headers if self._extra_headers else None,
        )
        # Return shape compatible with old supabase SDK: [count, data]
        data = result if result else []
        return [None, data]


def get_supabase_client() -> SupabaseREST | None:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        return None
    return SupabaseREST(settings.supabase_url, settings.supabase_service_role_key)
