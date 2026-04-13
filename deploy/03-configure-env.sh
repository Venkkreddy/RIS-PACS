#!/usr/bin/env bash
#
# Step 5: Configure environment variables with your VM's public IP.
# Run this ON THE VM, inside the project root (~/tdai).
#
# Usage:
#   cd ~/tdai
#   bash deploy/03-configure-env.sh <YOUR_STATIC_IP>
#
set -euo pipefail

VM_IP="${1:?Usage: $0 <VM_STATIC_IP>}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "${PROJECT_ROOT}"

echo "==> Configuring environment for IP: ${VM_IP}"
echo "==> Project root: ${PROJECT_ROOT}"

# Generate secure random secrets
SESSION_SECRET=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
WEBHOOK_SECRET=$(openssl rand -hex 16)
INTERNAL_SERVICE_SECRET=$(openssl rand -hex 16)
PLATFORM_ADMIN_KEY=$(openssl rand -hex 16)
POSTGRES_PASSWORD=$(openssl rand -hex 16)

# --- Root .env ---
echo "==> Creating root .env..."
cat > .env << ENVEOF
# --- GCP VM Deployment (auto-generated) ---

# Postgres
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

# Service URLs (public-facing)
DICOOGLE_URL=http://${VM_IP}:8080
OHIF_URL=http://${VM_IP}:3000
REPORTING_API_URL=http://${VM_IP}:8081
FRONTEND_URL=http://${VM_IP}:5173
VITE_API_BASE_URL=http://${VM_IP}:8081

MASTER_ADMIN_EMAILS=metupalle@gmail.com,praveenk1006@gmail.com,gunapiano24@gmail.com
CORS_ALLOWED_ORIGINS=http://${VM_IP}:5173,http://${VM_IP}:3000

# GCP / AI
GCP_PROJECT_ID=ris-pacs-9859a
GCP_LOCATION=us-central1
GCS_BUCKET=ris-pacs-9859a.firebasestorage.app

SENDGRID_API_KEY=your-sendgrid-api-key
SENDGRID_FROM_EMAIL=reports@example.com

MONAI_SERVER_URL=http://monai-server:5000
MONAI_ENABLED=true
MEDASR_SERVER_URL=http://medasr-server:5001
MEDASR_ENABLED=true
MEDASR_MODEL=google/medasr

GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
MEDGEMMA_MODEL=medgemma-4b
MEDGEMMA_ENDPOINT=
VERTEX_AI_ENABLED=false

# Secrets
SESSION_SECRET=${SESSION_SECRET}
JWT_SECRET=${JWT_SECRET}
WEBHOOK_SECRET=${WEBHOOK_SECRET}
INTERNAL_SERVICE_SECRET=${INTERNAL_SERVICE_SECRET}
PLATFORM_ADMIN_KEY=${PLATFORM_ADMIN_KEY}
MULTI_TENANT_ENABLED=true

# Firebase (frontend build-time)
VITE_FIREBASE_API_KEY=AIzaSyC1VRHBcDWlkdUfu3-qrG5_l9qDHaZ-doQ
VITE_FIREBASE_AUTH_DOMAIN=ris-pacs-9859a.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=ris-pacs-9859a
VITE_FIREBASE_APP_ID=1:502102007740:web:092fc6257497ddc86bd5b9
ENVEOF

# --- Backend .env ---
echo "==> Creating backend .env..."
cat > packages/reporting-app/backend/.env << ENVEOF
NODE_ENV=production
PORT=8081
ENABLE_AUTH=true
FRONTEND_URL=http://${VM_IP}:5173
OHIF_BASE_URL=${OHIF_BASE_URL:-http://${VM_IP}:3000}
OHIF_PUBLIC_BASE_URL=http://${VM_IP}:3000
CORS_ALLOWED_ORIGINS=http://${VM_IP}:5173,http://${VM_IP}:3000
DEFAULT_DEV_ROLE=admin
MASTER_ADMIN_EMAILS=metupalle@gmail.com,praveenk1006@gmail.com,gunapiano24@gmail.com
SESSION_SECRET=${SESSION_SECRET}
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret

FIREBASE_PROJECT_ID=ris-pacs-9859a
GCP_PROJECT_ID=ris-pacs-9859a
GCS_BUCKET=ris-pacs-9859a.firebasestorage.app

SENDGRID_API_KEY=your-sendgrid-key
SENDGRID_FROM_EMAIL=reports@example.com
DICOOGLE_BASE_URL=${DICOOGLE_BASE_URL:-http://localhost:8080}
MEDASR_SERVER_URL=http://medasr-server:5001
MEDASR_ENABLED=true

JWT_SECRET=${JWT_SECRET}
MULTI_TENANT_ENABLED=true
PLATFORM_ADMIN_KEY=${PLATFORM_ADMIN_KEY}
TENANT_STORAGE_ROOT=/storage

DATABASE_URL=postgresql://tdai:${POSTGRES_PASSWORD}@postgres:5432/tdai_multitenant
ENVEOF

# --- Frontend .env ---
echo "==> Creating frontend .env..."
cat > packages/reporting-app/frontend/.env << ENVEOF
VITE_API_BASE_URL=http://${VM_IP}:8081
VITE_BACKEND_PROXY_TARGET=${VITE_BACKEND_PROXY_TARGET:-http://${VM_IP}:8081}
VITE_FIREBASE_API_KEY=AIzaSyC1VRHBcDWlkdUfu3-qrG5_l9qDHaZ-doQ
VITE_FIREBASE_AUTH_DOMAIN=ris-pacs-9859a.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=ris-pacs-9859a
VITE_FIREBASE_STORAGE_BUCKET=ris-pacs-9859a.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=502102007740
VITE_FIREBASE_APP_ID=1:502102007740:web:092fc6257497ddc86bd5b9
ENVEOF

echo ""
echo "============================================"
echo " Environment configured!"
echo "============================================"
echo ""
echo "IMPORTANT: Edit .env files to fill in real values for:"
echo "  - GEMINI_API_KEY (if using AI features)"
echo "  - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (if using Google OAuth)"
echo "  - SENDGRID_API_KEY (if sending emails)"
echo "  - Any other API keys for your specific setup"
echo ""
echo "Files created:"
echo "  - .env (root)"
echo "  - packages/reporting-app/backend/.env"
echo "  - packages/reporting-app/frontend/.env"
echo ""
echo "Next step: bash deploy/04-start-services.sh"
