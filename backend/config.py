from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from typing import Optional
import os

class Settings(BaseSettings):
    # Supabase Configuration
    supabase_url: Optional[str] = Field(None, env="SUPABASE_URL")
    supabase_service_role_key: Optional[str] = Field(None, env="SUPABASE_SERVICE_ROLE_KEY")
    supabase_jwt_secret: Optional[str] = Field(None, env="SUPABASE_JWT_SECRET")
    supabase_anon_key: Optional[str] = Field(None, env="SUPABASE_ANON_KEY")

    # LLM Provider Configuration
    llm_provider: str = Field("openai", env="LLM_PROVIDER") # 'openai', 'gemini', 'ollama'
    
    openai_api_key: Optional[str] = Field(None, env="OPENAI_API_KEY")
    openai_model: str = Field("gpt-4o-mini", env="OPENAI_MODEL")
    
    gemini_api_key: Optional[str] = Field(None, env="GEMINI_API_KEY")
    gemini_model: str = Field("gemini-2.0-flash", env="GEMINI_MODEL")
    
    ollama_base_url: Optional[str] = Field(None, env="OLLAMA_BASE_URL")
    ollama_model: str = Field("llama3", env="OLLAMA_MODEL")

    groq_api_key: Optional[str] = Field(None, env="GROQ_API_KEY")
    groq_model: str = Field("llama-3.3-70b-versatile", env="GROQ_MODEL")

    mistral_api_key: Optional[str] = Field(None, env="MISTRAL_API_KEY")
    mistral_model: str = Field("mistral-small-latest", env="MISTRAL_MODEL")
    mistral_agent_id: str = Field("ag_019d775d5d3c744fafefd4fbd5c99a66", env="MISTRAL_AGENT_ID")

    model_config = SettingsConfigDict(env_file=os.path.join(os.path.dirname(__file__), ".env"), env_file_encoding="utf-8", extra="ignore")

settings = Settings()
