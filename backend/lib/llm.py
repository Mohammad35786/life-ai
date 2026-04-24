import logging
import requests
from typing import Any
from backend.config import settings

logger = logging.getLogger(__name__)

class LLMProviderError(Exception):
    pass

def _get_headers(auth_token: str = None) -> dict:
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"
    return headers

def _invoke_openai(prompt: str, system: str | None = None) -> str:
    if not settings.openai_api_key:
        raise LLMProviderError("OPENAI_API_KEY is missing.")
    
    url = "https://api.openai.com/v1/chat/completions"
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    payload = {
        "model": settings.openai_model,
        "messages": messages
    }
    
    try:
        response = requests.post(url, json=payload, headers=_get_headers(settings.openai_api_key), timeout=30)
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]
    except requests.exceptions.HTTPError as e:
        raise LLMProviderError(f"OpenAI error: {e.response.text}")
    except Exception as e:
        raise LLMProviderError(f"OpenAI connection error: {str(e)}")

def _invoke_gemini(prompt: str, system: str | None = None) -> str:
    if not settings.gemini_api_key:
        raise LLMProviderError("GEMINI_API_KEY is missing.")
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent?key={settings.gemini_api_key}"
    payload: dict[str, Any] = {
        "contents": [{"parts": [{"text": prompt}]}]
    }
    if system:
        payload["system_instruction"] = {"parts": [{"text": system}]}
    
    try:
        response = requests.post(url, json=payload, headers=_get_headers(), timeout=30)
        response.raise_for_status()
        return response.json()["candidates"][0]["content"]["parts"][0]["text"]
    except requests.exceptions.HTTPError as e:
        raise LLMProviderError(f"Gemini error: {e.response.text}")
    except Exception as e:
        raise LLMProviderError(f"Gemini connection error: {str(e)}")

def _invoke_ollama(prompt: str, system: str | None = None) -> str:
    if not settings.ollama_base_url:
        raise LLMProviderError("OLLAMA_BASE_URL is missing.")
    
    url = f"{settings.ollama_base_url.rstrip('/')}/api/generate"
    payload: dict[str, Any] = {
        "model": settings.ollama_model,
        "prompt": prompt,
        "stream": False
    }
    if system:
        payload["system"] = system
    
    try:
        response = requests.post(url, json=payload, headers=_get_headers(), timeout=30)
        response.raise_for_status()
        return response.json()["response"]
    except requests.exceptions.HTTPError as e:
        raise LLMProviderError(f"Ollama error: {e.response.text}")
    except Exception as e:
        raise LLMProviderError(f"Ollama connection error: {str(e)}")

def _invoke_groq(prompt: str, system: str | None = None) -> str:
    if not settings.groq_api_key:
        raise LLMProviderError("GROQ_API_KEY is missing.")

    url = "https://api.groq.com/openai/v1/chat/completions"
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    payload = {
        "model": settings.groq_model,
        "messages": messages
    }

    try:
        response = requests.post(url, json=payload, headers=_get_headers(settings.groq_api_key), timeout=30)
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]
    except requests.exceptions.HTTPError as e:
        raise LLMProviderError(f"Groq error: {e.response.text}")
    except Exception as e:
        raise LLMProviderError(f"Groq connection error: {str(e)}")

def _invoke_mistral(prompt: str, system: str | None = None) -> str:
    try:
        from mistralai.client import Mistral
    except ImportError:
        raise LLMProviderError("Mistral SDK not installed. Please run `pip install mistralai`.")
    
    logger.debug("_invoke_mistral: api_key_loaded=%s", bool(settings.mistral_api_key))
    logger.debug("_invoke_mistral: model=%s", getattr(settings, 'mistral_model', None))

    if not settings.mistral_api_key:
        raise LLMProviderError("MISTRAL_API_KEY is missing.")

    client = Mistral(api_key=settings.mistral_api_key)
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    try:
        response = client.chat.complete(
            model=settings.mistral_model,
            messages=messages,
        )
        return response.choices[0].message.content
    except Exception as e:
        status = getattr(getattr(e, "response", None), "status_code", None)
        body = getattr(getattr(e, "response", None), "text", None)
        logger.error("_invoke_mistral error: type=%s status=%s body=%s", type(e).__name__, status, body)
        raise LLMProviderError(f"Mistral error: {str(e)}")

def chatResponse(prompt: str, system: str | None = None) -> str:
    provider = settings.llm_provider.lower()
    if provider == "openai":
        return _invoke_openai(prompt, system=system)
    elif provider == "gemini":
        return _invoke_gemini(prompt, system=system)
    elif provider == "ollama":
        return _invoke_ollama(prompt, system=system)
    elif provider == "groq":
        return _invoke_groq(prompt, system=system)
    elif provider == "mistral":
        return _invoke_mistral(prompt, system=system)
    else:
        raise LLMProviderError(f"Unknown LLM provider: {provider}")
