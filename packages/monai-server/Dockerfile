FROM python:3.11-slim AS base

WORKDIR /app
ENV PYTHONUNBUFFERED=1
ENV MONAI_SERVER_PORT=5000
ENV PYTHONPATH=/app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libgl1 \
        curl \
        gcc \
        python3-dev \
    && rm -rf /var/lib/apt/lists/*

# ── Dependencies ─────────────────────────────────────────────────────
FROM base AS deps

COPY requirements.txt requirements-optional.txt ./

ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir \
        --index-url ${TORCH_INDEX_URL} \
        --extra-index-url https://pypi.org/simple \
        torch && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir -r requirements-optional.txt || true

# ── Application ──────────────────────────────────────────────────────
FROM deps AS app

COPY config.py .
COPY server.py .
COPY models/ models/
COPY transforms/ transforms/
COPY inference/ inference/
COPY outputs/ outputs/
COPY metrics/ metrics/
COPY label/ label/

RUN mkdir -p models/weights sr_output metrics_store model_repository

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=5 \
    CMD curl -f http://localhost:5000/health || exit 1

CMD ["python", "server.py"]
