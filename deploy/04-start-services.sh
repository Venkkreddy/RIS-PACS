#!/usr/bin/env bash
#
# Step 6: Build and start all services with Docker Compose.
# Run this ON THE VM, inside the project root (~/tdai).
#
# Usage:
#   cd ~/tdai
#   bash deploy/04-start-services.sh
#
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${PROJECT_ROOT}"

echo "==> Project root: ${PROJECT_ROOT}"

# Pre-flight checks
if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is not installed. Run deploy/02-install-docker.sh first."
  exit 1
fi

if ! docker info &>/dev/null; then
  echo "ERROR: Docker daemon not running or current user lacks permission."
  echo "       Try: sudo systemctl start docker"
  echo "       Or:  newgrp docker"
  exit 1
fi

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Run deploy/03-configure-env.sh <IP> first."
  exit 1
fi

echo "==> Creating required host directories..."
mkdir -p storage monai-models dicoogle-index

echo "==> Building Docker images (this may take 10-20 minutes on first run)..."
docker compose build

echo "==> Starting all services..."
docker compose up -d

echo "==> Waiting 30 seconds for services to initialize..."
sleep 30

echo "==> Container status:"
docker compose ps

echo ""
echo "==> Checking service health..."
SERVICES_OK=true

check_service() {
  local name="$1"
  local url="$2"
  if curl -sf --max-time 5 "${url}" >/dev/null 2>&1; then
    echo "  [OK] ${name} is reachable at ${url}"
  else
    echo "  [--] ${name} not yet responding at ${url} (may still be starting)"
    SERVICES_OK=false
  fi
}

check_service "Reporting Backend"  "http://localhost:8081"
check_service "Reporting Frontend" "http://localhost:5173"
check_service "OHIF Viewer"        "http://localhost:3000"
check_service "Dicoogle PACS"      "http://localhost:8080"
check_service "MONAI Server"       "http://localhost:5000"
check_service "MedASR Server"      "http://localhost:5001"

# Get public IP for convenience
VM_IP=$(curl -sf http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip -H "Metadata-Flavor: Google" 2>/dev/null || echo "YOUR_IP")

echo ""
echo "============================================"
echo " Services started!"
echo "============================================"
echo ""
echo "Access your app at:"
echo "  Frontend:  http://${VM_IP}:5173"
echo "  Backend:   http://${VM_IP}:8081"
echo "  OHIF:      http://${VM_IP}:3000"
echo "  Dicoogle:  http://${VM_IP}:8080"
echo ""
echo "Useful commands:"
echo "  docker compose logs -f              # watch all logs"
echo "  docker compose logs -f <service>    # watch one service"
echo "  docker compose ps                   # list containers"
echo "  docker compose restart <service>    # restart a service"
echo "  docker compose down                 # stop everything"
echo ""
if [ "${SERVICES_OK}" = false ]; then
  echo "Some services haven't responded yet. Give them 1-2 more minutes,"
  echo "then check: docker compose logs -f"
fi
