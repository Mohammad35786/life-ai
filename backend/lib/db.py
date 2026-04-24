import json
import logging
import time
import urllib.request
import urllib.error
import urllib.parse
from typing import Any
from backend.config import settings

logger = logging.getLogger(__name__)


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
            # Proper URL encoding to prevent 400 errors from special characters in filters (e.g. parentheses)
            query = "&".join(f"{urllib.parse.quote(k)}={urllib.parse.quote(v)}" for k, v in params.items())
            url = f"{url}?{query}"
        data = json.dumps(body).encode("utf-8") if body else None
        headers = dict(self.headers)
        if extra_headers:
            headers.update(extra_headers)
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        max_retries = 2
        for attempt in range(max_retries):
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    raw = resp.read().decode("utf-8")
                    if not raw.strip():
                        return None
                    return json.loads(raw)
            except urllib.error.HTTPError as e:
                err_body = e.read().decode("utf-8")
                raise RuntimeError(f"Supabase REST error ({e.code}) on {method} {table}: {err_body}") from e
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                if attempt < max_retries - 1:
                    wait = 0.5 * (attempt + 1)
                    logger.warning("Supabase %s %s timeout/conn error (attempt %d), retrying in %.1fs: %s", method, table, attempt + 1, wait, e)
                    time.sleep(wait)
                    continue
                raise RuntimeError(f"Supabase connection error on {method} {table}: {str(e)}") from e
            except Exception as e:
                raise RuntimeError(f"Supabase connection error on {method} {table}: {str(e)}") from e
        return None  # unreachable but satisfies type checker

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

    def in_(self, col: str, vals: list[str]) -> "_TableHandle":
        """PostgREST 'in' filter: col=in.(val1,val2,val3)"""
        joined = ",".join(str(v) for v in vals)
        self._filters[col] = f"in.({joined})"
        return self

    def lte(self, col: str, val: str) -> "_TableHandle":
        self._filters[col] = f"lte.{val}"
        return self

    def gte(self, col: str, val: str) -> "_TableHandle":
        self._filters[col] = f"gte.{val}"
        return self

    def order(self, col: str, desc: bool = False) -> "_TableHandle":
        self._order = f"{col}.{'desc' if desc else 'asc'}"
        return self

    def limit(self, count: int) -> "_TableHandle":
        self._limit = count
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
        if hasattr(self, "_order"):
            params["order"] = self._order
        if hasattr(self, "_limit"):
            params["limit"] = str(self._limit)
        result = self._client._request(
            method=getattr(self, "_method", "GET"),
            table=self._name,
            body=getattr(self, "_body", None),
            params=params if params else None,
            extra_headers=self._extra_headers if self._extra_headers else None,
        )
        # Return shape compatible with old supabase SDK: [count, data]
        data = result if result else []
        # Reset state so the handle can be safely reused for a new query
        self._filters = {}
        self._extra_headers = {}
        for attr in ("_method", "_body", "_select_cols", "_order", "_limit"):
            self.__dict__.pop(attr, None)
        return [None, data]


_cached_supabase_client: SupabaseREST | None = None


def get_supabase_client() -> SupabaseREST | None:
    global _cached_supabase_client
    if _cached_supabase_client is not None:
        return _cached_supabase_client
    if not settings.supabase_url or not settings.supabase_service_role_key:
        return None
    _cached_supabase_client = SupabaseREST(settings.supabase_url, settings.supabase_service_role_key)
    return _cached_supabase_client
