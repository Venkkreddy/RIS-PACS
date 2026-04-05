FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libsndfile1 \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir \
        --index-url https://download.pytorch.org/whl/cpu \
        --extra-index-url https://pypi.org/simple \
        torch torchaudio && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

ENV MEDASR_PORT=5001
ENV MEDASR_MODEL=google/medasr
ENV VERTEX_AI_ENABLED=false
ENV PYTHONUNBUFFERED=1

EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD python -c "from urllib.request import urlopen; r = urlopen('http://localhost:5001/health'); exit(0 if r.status == 200 else 1)"

CMD ["python", "server.py"]
