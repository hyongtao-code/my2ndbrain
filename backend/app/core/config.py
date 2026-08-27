"""Application configuration loaded from env or .env."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


# Resolve repo-root .env regardless of the CWD the process was launched from.
# .env is ignored by .gitignore (never committed); .env.example is the
# canonical template users copy to .env and edit.
def _repo_root() -> Path:
    # this file lives at <repo>/backend/app/core/config.py
    return Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    # DB
    db_host: str = "127.0.0.1"
    db_port: int = 5432
    db_user: str = "my2ndbrain"
    db_password: str = ""   # MUST be supplied via env (.env or DB_PASSWORD=***    db_name: str = "my2ndbrain"
    db_name: str = "my2ndbrain"

    # Embedding
    embed_dim: int = 384
    embed_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embed_device: str = "cpu"

    # LLM (mockable by default)
    llm_provider: str = "heuristic"   # heuristic | openai | ollama
    llm_model: str = "gpt-4o-mini"
    openai_api_key: str = ""
    ollama_base_url: str = "http://127.0.0.1:11434"

    # Behaviour
    auto_edge_threshold: float = 0.55
    top_k_neighbors: int = 6
    cluster_min_size: int = 3

    model_config = SettingsConfigDict(
        env_file=str(_repo_root() / ".env"),
        env_prefix="",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()