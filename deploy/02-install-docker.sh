#!/usr/bin/env bash
#
# Step 3: Install Docker + Docker Compose on the GCP VM.
# Run this ON THE VM after SSH-ing in.
#
# Usage:
#   chmod +x deploy/02-install-docker.sh
#   sudo bash deploy/02-install-docker.sh
#
set -euo pipefail

echo "==> Updating system packages..."
apt-get update && apt-get upgrade -y

echo "==> Installing prerequisites..."
apt-get install -y ca-certificates curl gnupg git

echo "==> Adding Docker GPG key..."
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
fi
chmod a+r /etc/apt/keyrings/docker.gpg

echo "==> Adding Docker repository..."
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  > /etc/apt/sources.list.d/docker.list

echo "==> Installing Docker Engine + Compose plugin..."
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "==> Adding current user to docker group..."
REAL_USER="${SUDO_USER:-$USER}"
usermod -aG docker "${REAL_USER}"

echo "==> Enabling Docker to start on boot..."
systemctl enable docker
systemctl start docker

echo "==> Verifying installation..."
docker --version
docker compose version

echo ""
echo "============================================"
echo " Docker installed successfully!"
echo "============================================"
echo ""
echo "IMPORTANT: Log out and back in (or run 'newgrp docker')"
echo "so docker commands work without sudo."
echo ""
echo "Next step: bash ~/tdai/deploy/03-configure-env.sh <YOUR_STATIC_IP>"
