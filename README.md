# Medical Imaging Platform 

Monorepo for a web-based medical imaging ecosystem integrating:

- **Reporting App** (Node/Express + React)
- **Dicoogle Server** (PACS/indexing/webhook customization)
- **OHIF Viewer** (custom extension for reporting integration)

## Monorepo layout

```text
packages/
  reporting-app/     # Existing reporting solution
  dicoogle-server/   # Dicoogle source + custom plugins/config
  ohif-viewer/       # OHIF source + reporting extension
```

## Prerequisites

- Node.js 20+
- npm 10+
- Docker + Docker Compose
- Java 11+ (for Dicoogle local workflows)

## Setup

```bash
cp .env.example .env
npm install
```

## Authentication setup (required for tdairad.com)

The app now supports:
- **Master admin Google sign-in** (`metupalle@gmail.com`, `praveenk1006@gmail.com`, `gunapiano24@gmail.com`)
- **Email/password self-registration** with admin approval from `/admin`

To enable this in production:

1. Configure frontend env (`packages/reporting-app/frontend/.env`):
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_APP_ID`
2. In Firebase Authentication, enable providers:
   - Google
   - Email/Password
3. Add authorized domains in Firebase Auth:
   - `tdairad.com`
   - your Fly/Firebase preview domains
4. Set backend env:
   - `ENABLE_AUTH=true`
   - `MASTER_ADMIN_EMAILS`
   - `GCP_PROJECT_ID` (must match Firebase project for token verification)

## Run locally

```bash
# Run package dev commands in parallel via turbo
npm run dev

# Or run integrated stack
docker compose up --build
```

The integrated compose stack starts:

- Dicoogle (`http://localhost:8080`)
- Reporting backend (`http://localhost:8081`)
- OHIF viewer (`http://localhost:3000`)

## Build, test, lint

```bash
npm run build
npm run test
npm run lint
```

## Deploy to Fly.io (full workflow)

The root GitHub Actions workflow deploys all four apps on push to `main`:

- `tdairad-dicoogle` (PACS/search + webhook source)
- `tdairad-api` (reporting backend)
- `tdairad-ohif` (viewer with reporting extension)
- `tdairad-frontend` (landing + reporting UI)

Required runtime wiring:

- `tdairad-api` secret `DICOOGLE_BASE_URL` should point to Dicoogle (recommended private: `http://tdairad-dicoogle.internal:8080`)
- `tdairad-api` secret `DICOOGLE_FALLBACK_BASE_URL` should point to Fly private proxy (`http://tdairad-dicoogle.flycast`) as fallback
- `tdairad-api` secret `OHIF_BASE_URL` should point to your OHIF URL
- `tdairad-api` secret `CORS_ALLOWED_ORIGINS` should include OHIF origin(s)
- `tdairad-dicoogle` env `REPORTING_WEBHOOK_URL` should point to `${API_URL}/webhook/study`

The Dicoogle Fly app also uses a persistent volume mount (`dicoogle_data`) for storage.

### Automated post-deploy smoke test

After all deployments finish, CI runs:

- `scripts/post_deploy_smoke.py`

It verifies:

1. `GET /health` on `tdairad-api`
2. API-side Dicoogle sync via `GET /health/worklist-sync`
3. webhook metadata connectivity via `GET /health/webhook-connectivity`

The JSON report is uploaded as a workflow artifact (`post-deploy-smoke-report`).

### Landing/Internal deployment note

- Deploy the **landing page** (`/`) as the Firebase Hosting entrypoint for `tdairad.com`.
- Keep internal pages (`/worklist`, `/admin`, `/reports`) behind app authentication/role guards.
- For custom domains, point Firebase Hosting to `tdairad.com` and ensure backend/OHIF service URLs are configured via environment variables.
