#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
FRONTEND_BUCKET="${FRONTEND_BUCKET:?FRONTEND_BUCKET is required}"

echo "Deploying backend to App Engine..."
cd backend
gcloud config set project "$PROJECT_ID"
gcloud app deploy app.yaml --quiet
cd ..

echo "Building frontend..."
cd frontend
npm ci
npm run build
cd ..

echo "Uploading frontend to GCS bucket..."
gsutil -m rsync -r frontend/dist "gs://$FRONTEND_BUCKET"

echo "Deployment complete"
