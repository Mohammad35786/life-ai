"""
Shared roadmap generation service.
Reused by both /api/roadmaps/generate and /api/chat/convert-to-roadmap
"""

import json
import re
from typing import Optional

from backend.lib.llm import (
    _invoke_openai,
    _invoke_gemini,
    _invoke_ollama,
    _invoke_groq,
    _invoke_mistral,
    chatResponse
)
from backend.lib.llm import LLMProviderError


# ── Prompt Templates ─────────────────────────────────────────────────────────

ROADMAP_PROMPT_TEMPLATE = """You are Roadmap.sh Agent. Your ONLY job is to generate visual roadmaps.

User has requested a roadmap for: {topic}
Difficulty level: {difficulty}

You MUST respond with ONLY a valid JSON object. No Markdown, no extra text, no explanations, no code blocks, no apologies — just pure JSON.

=== REQUIRED JSON SCHEMA (ALWAYS OUTPUT EXACTLY THIS STRUCTURE) ===
{{
  "title": "Roadmap Title",
  "nodes": [
    {{ "id": "1", "type": "main", "data": {{ "label": "...", "description": "..." }}, "position": {{ "x": 0, "y": 0 }} }}
  ],
  "edges": [
    {{ "id": "e1-2", "source": "1", "target": "2" }}
  ],
  "outlines": {{
    "1": {{
      "title": "...",
      "description": "...",
      "subtopics": ["...", "..."],
      "resources": ["...", "..."],
      "estimatedTime": "..."
    }}
  }}
}}

Rules:
- Use only "main", "module", or "side" for type.
- Positions must be numbers (x and y between 0 and 2000).
- Never add any text after the final }} of the JSON. Make sure you close all brackets.
- The outlines dictionary MUST contain a rich syllabus entry keyed by EVERY single node id you generate.
- Make it look exactly like the Claude Code roadmap: main vertical path + side branches.
"""

CONVERT_PLAN_PROMPT_TEMPLATE = """You are Roadmap.sh Agent. Your job is to convert a written plan into a visual roadmap JSON.

Original user request: {original_message}

Written plan to convert:
{written_plan}

Difficulty level: {difficulty}

You MUST respond with ONLY a valid JSON object. No Markdown, no extra text, no explanations, no code blocks, no apologies — just pure JSON.

=== REQUIRED JSON SCHEMA (ALWAYS OUTPUT EXACTLY THIS STRUCTURE) ===
{{
  "title": "Roadmap Title",
  "nodes": [
    {{ "id": "1", "type": "main", "data": {{ "label": "...", "description": "..." }}, "position": {{ "x": 0, "y": 0 }} }}
  ],
  "edges": [
    {{ "id": "e1-2", "source": "1", "target": "2" }}
  ],
  "outlines": {{
    "1": {{
      "title": "...",
      "description": "...",
      "subtopics": ["...", "..."],
      "resources": ["...", "..."],
      "estimatedTime": "..."
    }}
  }}
}}

Conversion Rules:
- Extract numbered steps/phases from the written plan as main nodes (type: "main")
- Extract sub-tasks or tips as module nodes (type: "module") connected to the parent main node
- Extract optional resources/details as side nodes (type: "side") branching off relevant modules
- Main path should flow vertically (main nodes at x: 250, y: 0, 150, 300, etc.)
- Module nodes should be at x: 0 (left) or x: 500 (right) with animated edges
- Side nodes should be at x: -150 or x: 650 with animated edges
- Positions must be numbers (x and y between 0 and 2000)
- The outlines dictionary MUST contain a rich syllabus entry keyed by EVERY single node id
- Never add any text after the final }} of the JSON
"""


def extract_json_from_text(text: str) -> dict:
    """
    Extract JSON object from LLM output, handling markdown code fences.
    Raises ValueError if no valid JSON found.
    """
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    try:
        data = json.loads(text)
        return data
    except json.JSONDecodeError:
        # Try finding JSON with regex
        match = re.search(r"(\{[\s\S]*\})", text, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(1))
                return data
            except Exception:
                raise ValueError("Failed to parse JSON")
        raise ValueError("No valid JSON found in AI response")


def generate_roadmap_from_topic(topic: str, difficulty: str = "beginner", provider: str = "default") -> dict:
    """
    Generate a visual roadmap from a topic string.
    Used by /api/roadmaps/generate
    """
    prompt = ROADMAP_PROMPT_TEMPLATE.format(topic=topic, difficulty=difficulty)
    
    if provider == "openai":
        response_text = _invoke_openai(prompt)
    elif provider == "gemini":
        response_text = _invoke_gemini(prompt)
    elif provider == "ollama":
        response_text = _invoke_ollama(prompt)
    elif provider == "groq":
        response_text = _invoke_groq(prompt)
    elif provider == "mistral":
        response_text = _invoke_mistral(prompt)
    else:
        response_text = chatResponse(prompt)

    roadmap_data = extract_json_from_text(response_text)
    
    # Basic validation
    if "nodes" not in roadmap_data or "edges" not in roadmap_data:
        raise ValueError("Invalid roadmap format returned by AI")
    
    return roadmap_data


def convert_plan_to_roadmap(
    written_plan: str,
    original_message: str,
    difficulty: str = "beginner",
    provider: str = "default"
) -> dict:
    """
    Convert a written plan (markdown/numbered list) into visual roadmap JSON.
    Used by /api/chat/convert-to-roadmap
    """
    prompt = CONVERT_PLAN_PROMPT_TEMPLATE.format(
        original_message=original_message,
        written_plan=written_plan,
        difficulty=difficulty
    )
    
    if provider == "openai":
        response_text = _invoke_openai(prompt)
    elif provider == "gemini":
        response_text = _invoke_gemini(prompt)
    elif provider == "ollama":
        response_text = _invoke_ollama(prompt)
    elif provider == "groq":
        response_text = _invoke_groq(prompt)
    elif provider == "mistral":
        response_text = _invoke_mistral(prompt)
    else:
        response_text = chatResponse(prompt)

    roadmap_data = extract_json_from_text(response_text)
    
    # Basic validation
    if "nodes" not in roadmap_data or "edges" not in roadmap_data:
        raise ValueError("Invalid roadmap format returned by AI")
    
    return roadmap_data
