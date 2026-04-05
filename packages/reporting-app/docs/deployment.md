# GCP Deployment Guide

## Required services and APIs

Enable in your GCP project:

- Firestore API
- Cloud Storage API
- Speech-to-Text API
- App Engine Admin API (if App Engine)
- Cloud Run API (optional alternative)

## Environment variables

Set for backend runtime:

- `NODE_ENV=production`
- `PORT=8080`
- `GCP_PROJECT_ID=<project-id>`
- `GCS_BUCKET=<bucket-name>`
- `GOOGLE_CLIENT_ID=<oauth-client-id>`
- `GOOGLE_CLIENT_SECRET=<oauth-client-secret>`
- `SESSION_SECRET=<secure-session-secret>`
- `SENDGRID_API_KEY=<sendgrid-key>`
- `SENDGRID_FROM_EMAIL=<from-email>`
- `FRONTEND_URL=<frontend-origin>`
- `DICOOGLE_BASE_URL=<dicoogle-api-url>`

## Backend deployment (App Engine)

```bash
cd backend
gcloud app deploy app.yaml
```

## Frontend deployment (Cloud Storage static hosting)

```bash
cd frontend
npm ci
npm run build
gsutil -m rsync -r dist gs://$FRONTEND_BUCKET
```

## CI/CD

The GitHub Actions workflow `.github/workflows/deploy.yml` deploys backend and frontend on push to `main`.
