#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   export SENDGRID_API_KEY="..."
#   export GOOGLE_CLIENT_ID="..."
#   export GOOGLE_CLIENT_SECRET="..."
#   export DICOOGLE_BASE_URL="https://dicoogle.tdairad.com"
#   ./scripts/fly-secrets.sh tdairad-api

APP_NAME="${1:-tdairad-api}"

# Required inputs that should be exported in your shell.
: "${SENDGRID_API_KEY:?SENDGRID_API_KEY is required}"
: "${GOOGLE_CLIENT_ID:?GOOGLE_CLIENT_ID is required}"
: "${GOOGLE_CLIENT_SECRET:?GOOGLE_CLIENT_SECRET is required}"
: "${DICOOGLE_BASE_URL:?DICOOGLE_BASE_URL is required}"

# Auto-generate a random 64-char hex secret if not provided.
SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}"

# Defaults requested for production.
MASTER_ADMIN_EMAILS="${MASTER_ADMIN_EMAILS:-metupalle@gmail.com,praveenk1006@gmail.com,gunapiano24@gmail.com}"
SENDGRID_FROM_EMAIL="${SENDGRID_FROM_EMAIL:-noreply@tdairad.com}"
OHIF_BASE_URL="${OHIF_BASE_URL:-https://viewer.tdairad.com}"
FRONTEND_URL="${FRONTEND_URL:-https://tdairad.com}"
CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-${OHIF_BASE_URL}}"
DICOOGLE_FALLBACK_BASE_URL="${DICOOGLE_FALLBACK_BASE_URL:-http://tdairad-dicoogle.flycast}"

echo "Setting Fly secrets for app: ${APP_NAME}"
flyctl secrets set \
  SENDGRID_API_KEY="${SENDGRID_API_KEY}" \
  SESSION_SECRET="${SESSION_SECRET}" \
  GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID}" \
  GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET}" \
  MASTER_ADMIN_EMAILS="${MASTER_ADMIN_EMAILS}" \
  SENDGRID_FROM_EMAIL="${SENDGRID_FROM_EMAIL}" \
  DICOOGLE_BASE_URL="${DICOOGLE_BASE_URL}" \
  DICOOGLE_FALLBACK_BASE_URL="${DICOOGLE_FALLBACK_BASE_URL}" \
  OHIF_BASE_URL="${OHIF_BASE_URL}" \
  FRONTEND_URL="${FRONTEND_URL}" \
  CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS}" \
  --app "${APP_NAME}"

echo "Secrets configured successfully."
