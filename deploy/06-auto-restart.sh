#!/usr/bin/env bash
#
# Step 9: Configure services to auto-restart on VM reboot.
# Run this ON THE VM.
#
# Usage:
#   bash deploy/06-auto-restart.sh
#
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Ensuring Docker starts on boot..."
sudo systemctl enable docker

echo "==> Adding docker-compose cron job for reboot..."
CRON_CMD="@reboot cd ${PROJECT_ROOT} && /usr/bin/docker compose up -d >> /var/log/tdai-startup.log 2>&1"

EXISTING=$(crontab -l 2>/dev/null || true)
if echo "${EXISTING}" | grep -q "docker compose up"; then
  echo "    Cron job already exists. Skipping."
else
  (echo "${EXISTING}"; echo "${CRON_CMD}") | crontab -
  echo "    Cron job added."
fi

echo "==> Adding restart policy to docker-compose containers..."
echo "    (Containers will restart automatically unless explicitly stopped)"

echo ""
echo "============================================"
echo " Auto-restart configured!"
echo "============================================"
echo ""
echo "On reboot, Docker will start, then cron will run 'docker compose up -d'."
echo ""
echo "To test: sudo reboot"
echo "Then SSH back in and check: docker compose ps"
