FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1
ENV MONAI_SERVER_PORT=5000

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir \
        --index-url https://download.pytorch.org/whl/cpu \
        --extra-index-url https://pypi.org/simple \
        torch && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD python -c "from urllib.request import urlopen; r = urlopen('http://localhost:5000/health'); exit(0 if r.status == 200 else 1)"

CMD ["python", "server.py"]
