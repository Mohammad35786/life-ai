from __future__ import annotations

import json
import re
from typing import Any

from backend.config import settings


__all__ = ["MistralProviderError", "sendChat", "sendChatGuided", "testConnection"]


class MistralProviderError(Exception):
    pass


def _get_client():
    try:
        from mistralai.client import Mistral
    except ImportError as e:
        raise MistralProviderError(
            "Mistral SDK not installed. Please run `pip install mistralai`."
        ) from e

    if not settings.mistral_api_key:
        raise MistralProviderError("MISTRAL_API_KEY is missing.")

    return Mistral(api_key=settings.mistral_api_key)


def sendChat(messages: list[dict[str, Any]]) -> str:
    """Send a chat to Mistral and return the assistant's text."""

    print(f"[mistral_provider] api_key_loaded={bool(settings.mistral_api_key)}")
    print(f"[mistral_provider] model={settings.mistral_model}")
    print(f"[mistral_provider] messages={messages}")

    client = _get_client()

    try:
        response = client.chat.complete(
            model=settings.mistral_model,
            messages=messages,
        )
        return response.choices[0].message.content
    except Exception as e:
        status = getattr(getattr(e, "response", None), "status_code", None)
        body = getattr(getattr(e, "response", None), "text", None)
        print(f"[mistral_provider] error_type={type(e).__name__} status={status} body={body}")
        raise MistralProviderError(f"Mistral call failed: {str(e)}") from e


def sendChatGuided(user_message: str, route_type: str, system_prompt: str) -> str:
    """Send a guided chat to Mistral with structured system prompt and return the assistant's text.
    
    Args:
        user_message: The user's question from the guided panel
        route_type: The type of response expected (career, job, learn, test, general)
        system_prompt: The system prompt to use
    """
    
    print(f"[mistral_provider] guided: route_type={route_type}")
    print(f"[mistral_provider] guided: user_message={user_message}")
    
    client = _get_client()
    
    # Build messages with system prompt and user message
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message}
    ]
    
    try:
        response = client.chat.complete(
            model=settings.mistral_model,
            messages=messages,
        )
        raw_reply = response.choices[0].message.content
        
        # Try to extract and format JSON if present
        formatted_reply = _format_guided_response(raw_reply, route_type)
        return formatted_reply
        
    except Exception as e:
        status = getattr(getattr(e, "response", None), "status_code", None)
        body = getattr(getattr(e, "response", None), "text", None)
        print(f"[mistral_provider] guided error_type={type(e).__name__} status={status} body={body}")
        raise MistralProviderError(f"Mistral guided call failed: {str(e)}") from e


def _format_guided_response(raw_reply: str, route_type: str) -> str:
    """Format the guided response, extracting JSON if present and making it readable."""
    
    # Try to find JSON in the response
    json_match = re.search(r'\{[\s\S]*\}', raw_reply)
    
    if json_match:
        try:
            json_str = json_match.group()
            data = json.loads(json_str)
            
            # Format based on route type
            if route_type in ["career", "learn"]:
                return _format_roadmap_response(data)
            elif route_type == "test":
                return _format_quiz_response(data)
            else:
                # For job and general, just return formatted text
                return json.dumps(data, indent=2)
        except json.JSONDecodeError:
            # If JSON parsing fails, return raw reply
            return raw_reply
    
    # No JSON found, return raw reply
    return raw_reply


def _format_roadmap_response(data: dict) -> str:
    """Format roadmap response into readable text."""
    
    if "title" not in data:
        return json.dumps(data, indent=2)
    
    lines = []
    lines.append(f"📋 {data.get('title', 'Learning Roadmap')}\n")
    
    phases = data.get("phases", [])
    if not phases:
        return json.dumps(data, indent=2)
    
    for i, phase in enumerate(phases, 1):
        phase_name = phase.get("name", f"Phase {i}")
        lines.append(f"📦 Phase {i}: {phase_name}")
        
        tasks = phase.get("tasks", [])
        if tasks:
            for task in tasks:
                lines.append(f"   • {task}")
        lines.append("")
    
    return "\n".join(lines).strip()


def _format_quiz_response(data: dict) -> str:
    """Format quiz response into readable text."""
    
    questions = data.get("questions", [])
    if not questions:
        return json.dumps(data, indent=2)
    
    lines = []
    lines.append("📝 Knowledge Quiz\n")
    
    for i, q in enumerate(questions, 1):
        lines.append(f"Question {i}: {q.get('question', '')}")
        
        options = q.get("options", [])
        if options:
            for j, opt in enumerate(options):
                lines.append(f"   {chr(65 + j)}. {opt}")
        
        answer = q.get("answer", "")
        if answer and answer.isalpha():
            lines.append(f"   ✓ Answer: {answer}")
        lines.append("")
    
    return "\n".join(lines).strip()


def testConnection() -> bool:
    """Simple smoke test: calls Mistral with a minimal prompt."""

    _ = sendChat([{"role": "user", "content": "Say 'ok'"}])
    return True
