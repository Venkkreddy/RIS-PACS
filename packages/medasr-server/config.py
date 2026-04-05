import os
from pathlib import Path

def _load_env() -> None:
    resolved = Path(__file__).resolve()
    parents = list(resolved.parents)
    candidates = []

    # In local dev this resolves to repo root/.env.
    if len(parents) > 2:
        candidates.append(parents[2] / ".env")
    # In containers, /app/.env (if present) should also be supported.
    candidates.append(resolved.parent / ".env")

    seen = set()
    for env_path in candidates:
        if env_path in seen:
            continue
        seen.add(env_path)
        if env_path.exists():
            with env_path.open() as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, _, val = line.partition("=")
                        os.environ.setdefault(key.strip(), val.strip())
            break


_load_env()


class Settings:
    PORT: int = int(os.getenv("MEDASR_PORT", "5001"))

    MEDASR_MODEL_NAME: str = os.getenv("MEDASR_MODEL", "google/medasr")

    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

    GCP_PROJECT_ID: str = os.getenv("GCP_PROJECT_ID", "")
    GCP_LOCATION: str = os.getenv("GCP_LOCATION", "us-central1")

    MEDGEMMA_ENDPOINT: str = os.getenv("MEDGEMMA_ENDPOINT", "")
    MEDGEMMA_MODEL: str = os.getenv("MEDGEMMA_MODEL", "medgemma-4b")

    VERTEX_AI_ENABLED: bool = os.getenv("VERTEX_AI_ENABLED", "false").lower() == "true"


settings = Settings()
