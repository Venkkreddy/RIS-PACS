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
    PORT: int = int(os.getenv("WAV2VEC2_PORT", "5002"))

    ASR_BACKEND: str = os.getenv("ASR_BACKEND", "faster-whisper")
    FASTER_WHISPER_MODEL: str = os.getenv("FASTER_WHISPER_MODEL", "small.en")
    FASTER_WHISPER_DEVICE: str = os.getenv("FASTER_WHISPER_DEVICE", "auto")
    FASTER_WHISPER_COMPUTE_TYPE: str = os.getenv("FASTER_WHISPER_COMPUTE_TYPE", "int8")
    FASTER_WHISPER_BEAM_SIZE: int = int(os.getenv("FASTER_WHISPER_BEAM_SIZE", "5"))

    WAV2VEC2_MODEL: str = os.getenv("WAV2VEC2_MODEL", "facebook/wav2vec2-large-960h-lv60-self")
    WAV2VEC2_CHUNK_SECONDS: float = float(os.getenv("WAV2VEC2_CHUNK_SECONDS", "18"))
    WAV2VEC2_CHUNK_OVERLAP_SECONDS: float = float(os.getenv("WAV2VEC2_CHUNK_OVERLAP_SECONDS", "1.5"))

    OLLAMA_URL: str = os.getenv("OLLAMA_URL", "http://localhost:11434")
    OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "llama3")


settings = Settings()
