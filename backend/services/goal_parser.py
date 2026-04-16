from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from backend.models import GoalCreate
from backend.lib.llm import chatResponse, LLMProviderError


class GoalParserError(RuntimeError):
    """Raised when the goal parser cannot produce a valid response."""


@dataclass
class GoalParserService:
    def parse_goal(self, text: str) -> GoalCreate:
        prompt = (
            "You extract a user's goal from free-form text. "
            "Return a concise title and a slightly more detailed description.\n\n"
            "Return EXACTLY a JSON dictionary with 'title' and 'description' keys. "
            "Do not include any other text, no markdown blocks, no code fences. Just the raw JSON.\n\n"
            f"User input:\n{text}"
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
            
            return GoalCreate.model_validate_json(content)
        except Exception as exc:
            # Fallback defensively if LLM fails
            return self._fallback_parse(text)

    def _fallback_parse(self, text: str) -> GoalCreate:
        cleaned = " ".join(text.split()).strip()
        normalized = cleaned.rstrip(".!?")
        prefixes = (
            "i want to ",
            "i would like to ",
            "i'd like to ",
            "my goal is to ",
            "help me ",
        )

        lowered = normalized.lower()
        title_source = normalized
        for prefix in prefixes:
            if lowered.startswith(prefix):
                title_source = normalized[len(prefix) :]
                break

        title = title_source[:1].upper() + title_source[1:] if title_source else "Untitled goal"
        if len(title) > 72:
            title = f"{title[:69].rstrip()}..."

        description = cleaned
        if not description.endswith((".", "!", "?")):
            description = f"{description}."

        return GoalCreate(title=title, description=description)


goal_parser_service = GoalParserService()
