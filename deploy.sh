#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"

echo "Installing dependencies..."
npm ci

echo "Installing OHIF dependencies..."
(cd packages/ohif-viewer && yarn install --frozen-lockfile)

echo "Building monorepo with turbo..."
npx turbo run build

echo "Selecting GCP project..."
gcloud config set project "$PROJECT_ID"

echo "Deploying reporting backend..."
gcloud run deploy reporting-api \
  --source ./packages/reporting-app/backend \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated

echo "Deploying OHIF viewer..."
gcloud run deploy ohif-viewer \
  --source ./packages/ohif-viewer \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated

echo "Deploying Dicoogle service..."
gcloud run deploy dicoogle-server \
  --source ./packages/dicoogle-server \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated

echo "Deployment complete."
