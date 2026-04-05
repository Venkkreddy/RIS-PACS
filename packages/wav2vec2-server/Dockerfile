FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libsndfile1 && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV WAV2VEC2_PORT=5002
ENV ASR_BACKEND=faster-whisper
ENV FASTER_WHISPER_MODEL=small.en
ENV FASTER_WHISPER_DEVICE=auto
ENV FASTER_WHISPER_COMPUTE_TYPE=int8
ENV FASTER_WHISPER_BEAM_SIZE=5
ENV WAV2VEC2_MODEL=facebook/wav2vec2-large-960h-lv60-self
ENV WAV2VEC2_CHUNK_SECONDS=18
ENV WAV2VEC2_CHUNK_OVERLAP_SECONDS=1.5
ENV OLLAMA_URL=http://host.docker.internal:11434
ENV OLLAMA_MODEL=llama3

EXPOSE 5002

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5002/health')" || exit 1

CMD ["python", "server.py"]
