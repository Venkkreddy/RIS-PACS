# GCP Deployment Guide

## Required services and APIs

Enable in your GCP project:

- Firestore API
- Cloud Storage API

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

## HIPAA Compliance Variables

Required for production deployments handling PHI:

- `HIPAA_AUDIT_ENABLED=true`
- `HIPAA_SESSION_TIMEOUT_MINUTES=15`
- `HIPAA_MAX_FAILED_LOGINS=5`
- `HIPAA_LOCKOUT_DURATION_MINUTES=30`
- `HIPAA_REQUIRE_HTTPS=true`
- `HIPAA_MIN_PASSWORD_LENGTH=12`

Also ensure:

- `CORS_ALLOW_ALL=false` (wildcard CORS is blocked in production regardless)
- `SESSION_SECRET` is a strong, unique 32+ character value
- `ENABLE_AUTH=true`
- TLS/HTTPS enabled at load balancer level
- BAA signed with Google Cloud/Firebase and SendGrid

See [`HIPAA_COMPLIANCE.md`](../../../HIPAA_COMPLIANCE.md) for full compliance documentation and deployment checklist.

## CI/CD

The GitHub Actions workflow `.github/workflows/deploy.yml` deploys backend and frontend on push to `main`.
