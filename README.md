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
  - your deployment domain or VM public IP
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

## Local vs Docker mode

The stack supports two interchangeable runtime modes without code changes:

- `LOCAL (hybrid)`: OHIF + backend run locally, Dicoogle runs in Docker.
- `DOCKER (full compose)`: OHIF + backend + Dicoogle run in Docker.

Environment files:

- `.env.local`
- `.env.docker`

### Hybrid local development

```bash
npm run dev:local
```

This starts:

- `dicoogle` via `docker compose --env-file .env.local up -d dicoogle`
- backend via `npm run dev -w backend`
- OHIF via `npm run dev` in `packages/ohif-viewer`

### Local parity mode (matches Docker URLs)

```bash
npm run dev:local:parity
```

This mode is for local code iteration while keeping Docker-style endpoints:

- reporting frontend local: `http://localhost:5173`
- reporting backend local: `http://localhost:8081`
- OHIF (Docker): `http://localhost:3000`
- Dicoogle (Docker): `http://localhost:8080`

### Full Docker mode

```bash
npm run dev:docker
```

This runs `docker compose --env-file .env.docker up --build`.

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

## HIPAA Compliance

This platform implements comprehensive HIPAA compliance controls for handling Protected Health Information (PHI):

- **Audit Logging (§164.312(b))**: All PHI access is automatically tracked with SHA-256 hash-chained immutable audit trail stored in Firestore (`hipaa_audit_log`). Logs retained for 6 years.
- **Automatic Logoff (§164.312(a)(2)(iii))**: Sessions expire after 15 minutes of inactivity (configurable via `HIPAA_SESSION_TIMEOUT_MINUTES`).
- **Emergency Access (§164.312(a)(2)(ii))**: Break-glass procedure with time-limited grants, mandatory reason documentation, and admin revocation.
- **Encryption in Transit (§164.312(e)(1))**: HTTPS enforced in production. HSTS, CSP, and secure cookie headers applied.
- **Access Controls**: Role-based access control (9 roles), granular per-permission overrides, account lockout after 5 failed logins.
- **PHI Protection**: Error responses sanitized to prevent PHI leakage. Wildcard CORS blocked in production.
- **Password Policy**: Minimum 12 characters with uppercase, lowercase, number, and special character requirements.

### HIPAA Environment Variables

```env
HIPAA_AUDIT_ENABLED=true              # Enable audit logging
HIPAA_SESSION_TIMEOUT_MINUTES=15      # Auto-logoff after inactivity
HIPAA_MAX_FAILED_LOGINS=5             # Account lockout threshold
HIPAA_LOCKOUT_DURATION_MINUTES=30     # Lockout duration
HIPAA_REQUIRE_HTTPS=true              # Enforce TLS in production
```

### HIPAA Admin Endpoints


| Method | Path                         | Description                    |
| ------ | ---------------------------- | ------------------------------ |
| GET    | `/hipaa/audit-log`           | Query audit trail (admin only) |
| GET    | `/hipaa/audit-log/integrity` | Verify hash chain integrity    |
| POST   | `/hipaa/emergency-access`    | Request break-glass access     |
| GET    | `/hipaa/compliance-status`   | Real-time compliance dashboard |


See [HIPAA_COMPLIANCE.md](./HIPAA_COMPLIANCE.md) for full compliance documentation, PHI inventory, deployment checklist, and incident response procedures.

## Deployment Notes

This repository is deployment-platform agnostic. For VM deployments (Docker Compose):

- `DICOOGLE_BASE_URL` should point to your Dicoogle service (set in `.env.local` / `.env.docker`)
- `OHIF_BASE_URL` / `OHIF_PUBLIC_BASE_URL` should point to your OHIF URL
- `CORS_ALLOWED_ORIGINS` should include reporting UI and OHIF origins
- keep persistent volume mounts for Dicoogle storage and Postgres data

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

### DICOMweb validation checklist

Run against both modes and compare output payload shape/content:

```bash
curl "http://localhost:8081/dicom-web/studies"
curl "http://localhost:8081/dicom-web/studies/<studyUID>/series"
curl "http://localhost:8081/dicom-web/studies/<studyUID>/series/<seriesUID>/instances"
```

