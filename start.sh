#!/usr/bin/env bash
set -euo pipefail

# cd into the directory where this script lives
cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           TDAI RIS/PACS — Medical Imaging Platform          ║"
echo "║                  Starting all services...                   ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Check Docker ────────────────────────────────────────
echo "[1/6] Checking Docker..."
if ! docker info > /dev/null 2>&1; then
    echo ""
    echo "  ERROR: Docker is not running."
    echo "  Please start Docker Desktop first, then run this script again."
    echo ""
    exit 1
fi
echo "      Docker is running."

# ── Step 2: Load pre-built images if available ──────────────────
if [ -f "./tdai-images.tar" ]; then
    echo ""
    echo "[2/6] Loading pre-built images from tdai-images.tar..."
    echo "      This may take a few minutes on first run."
    docker load -i ./tdai-images.tar
    echo "      Images loaded."
else
    echo "[2/6] No pre-built images found — will build from source."
fi

# -- Step 3: Clean up any previous session --
echo ""
echo "[3/6] Cleaning up any previous session..."
docker compose down > /dev/null 2>&1 || true
docker rm -f tdai-postgres 2>/dev/null || true
docker rm -f reporting-app-backend 2>/dev/null || true
docker rm -f reporting-app-frontend 2>/dev/null || true
docker rm -f ohif-viewer 2>/dev/null || true
docker rm -f monai-server 2>/dev/null || true
docker rm -f medasr-server 2>/dev/null || true
docker rm -f dicoogle 2>/dev/null || true
docker rm -f orthanc 2>/dev/null || true

# -- Step 4: Start all containers --
echo ""
echo "[4/6] Loading all components (this may take 2-3 minutes on first run)..."
echo "      Starting 8 services..."
echo ""
docker compose up -d

# -- Step 5: Wait for frontend to become healthy --
echo ""
echo "[5/6] Waiting for system to become ready..."

attempts=0
max_attempts=24

while [ "$attempts" -lt "$max_attempts" ]; do
    attempts=$((attempts + 1))
    elapsed=$((attempts * 5))

    echo "      Checking... (${elapsed}s / 120s)"

    if curl -sk -o /dev/null -w "" https://localhost:5173 > /dev/null 2>&1; then
        # ── Success ──────────────────────────────────────────────
        echo ""
        echo "╔══════════════════════════════════════════════════════════════╗"
        echo "║                   System is ready!                          ║"
        echo "╚══════════════════════════════════════════════════════════════╝"
        echo ""

        # ── Seed demo data on first run only ──────────────────────
        if [ ! -f "./.seeded" ] && [ -f "./seed-data.sh" ]; then
            echo "  Loading demo data (first run only)..."
            bash ./seed-data.sh
            touch ./.seeded
        fi

        # ── Step 6: Open browser ─────────────────────────────────
        echo "[6/6] Opening browser..."
        if [ "$(uname)" = "Darwin" ]; then
            open "https://localhost:5173" 2>/dev/null || true
        else
            xdg-open "https://localhost:5173" 2>/dev/null || true
        fi

        echo ""
        echo "══════════════════════════════════════════════════════════════"
        echo "  DEMO LOGIN CREDENTIALS"
        echo "══════════════════════════════════════════════════════════════"
        echo ""
        echo "  Password for ALL accounts:  TDAI#Demo1234"
        echo ""
        echo "  Email                         Role"
        echo "  ─────────────────────────────────────────────────"
        echo "  super_admin@example.com       Super Admin"
        echo "  admin@example.com             Admin"
        echo "  radiologist@example.com       Radiologist"
        echo "  radiographer@example.com      Radiographer"
        echo "  developer@example.com         Developer"
        echo "  billing@example.com           Billing"
        echo "  reception@example.com         Reception"
        echo "  viewer@example.com            Viewer"
        echo ""
        echo "══════════════════════════════════════════════════════════════"
        echo ""
        echo "  Service URLs:"
        echo "    Frontend:     https://localhost:5173"
        echo "    Backend API:  http://localhost:8081"
        echo "    OHIF Viewer:  https://localhost:3000"
        echo "    Orthanc:      http://localhost:8042"
        echo "    Dicoogle:     http://localhost:8080"
        echo "    MONAI:        http://localhost:5000"
        echo "    MedASR:       http://localhost:5001"
        echo ""
        echo "  To stop the system, run: ./stop.sh"
        echo ""
        exit 0
    fi

    sleep 5
done

# ── Timeout ──────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   Something went wrong. The system did not start in time.   ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Troubleshooting:"
echo "    1. Run 'docker compose logs' to check for errors"
echo "    2. Make sure ports 5173, 8081, 3000, 8042, 8080 are free"
echo "    3. Try 'docker compose down' then run this script again"
echo ""
echo "  If the problem persists, please contact support."
echo ""
exit 1
