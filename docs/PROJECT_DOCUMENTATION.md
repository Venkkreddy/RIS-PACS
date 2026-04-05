# TD|ai Project Documentation

## 1) Project Overview

TD|ai is a medical imaging and reporting platform that combines:

- RIS/reporting workflow (patients, worklist, reports)
- PACS and DICOMweb (Dicoogle)
- Viewer (OHIF)
- AI microservices (MONAI, MedASR, wav2vec2)

Main repository root:

`tdai-main/metupalle-jpg/tdai`

## 2) Tech Stack

- `Node.js 20` + `npm workspaces` + `Turborepo`
- `TypeScript` (reporting backend/frontend)
- `Python` + `FastAPI` (AI services)
- `Java` (Dicoogle PACS)
- `React` + `Vite` (reporting frontend)
- `OHIF` (Yarn/Lerna-based viewer)
- `Docker Compose` (full local stack)

## 3) High-Level Architecture

- `reporting-app-backend` (API + integrations): `http://localhost:8081`
- `reporting-app-frontend` (Vite UI): `http://localhost:5173`
- `dicoogle` (PACS + DICOMweb): `http://localhost:8080`
- `ohif-viewer` (viewer via Docker): `http://localhost:3000`
- `monai-server` (image AI): `http://localhost:5000`
- `medasr-server` (medical ASR): `http://localhost:5001`
- `wav2vec2-server` (speech-to-text): `http://localhost:5002`

## 4) Repository Structure

- `docs/` - architecture, command references, and supporting docs
- `packages/reporting-app/backend` - Express API
- `packages/reporting-app/frontend` - React/Vite web UI
- `packages/reporting-app/shared` - shared TS types
- `packages/dicoogle-server` - Dicoogle server source/build scripts
- `packages/ohif-viewer` - OHIF viewer codebase
- `packages/monai-server` - MONAI FastAPI service
- `packages/medasr-server` - MedASR FastAPI service
- `packages/wav2vec2-server` - wav2vec2 FastAPI service
- `docker-compose.yml` - full local container orchestration

## 5) Prerequisites

Install these first:

- Node.js `20+` and npm `10+`
- Python `3.10+` and pip
- Docker Desktop + Docker Compose
- Java `11+` (for native Dicoogle development/builds)
- Yarn classic (`1.x`) for OHIF local development

Windows users can use PowerShell for all commands below.

## 6) Environment Setup

From the project root:

```powershell
cd .\tdai-main\metupalle-jpg\tdai
copy .env.example .env
npm install
```

Recommended minimum `.env` values:

- `DICOOGLE_URL=http://localhost:8080`
- `REPORTING_API_URL=http://localhost:8081`
- `FRONTEND_URL=http://localhost:5173`
- `MONAI_SERVER_URL=http://localhost:5000`
- `MEDASR_SERVER_URL=http://localhost:5001`
- `GEMINI_API_KEY=<your-key>` (if LLM features are used)

## 7) Fastest Start (All Core Services with Docker)

From project root:

```powershell
docker compose up --build
```

This starts:

- `dicoogle` on `8080` (+ DICOM port mapped as host `11112` to container `104`)
- `ohif-viewer` on `3000`
- `monai-server` on `5000`
- `medasr-server` on `5001`
- `wav2vec2-server` on `5002`
- `reporting-app-backend` on `8081`

Stop services:

```powershell
docker compose down
```

## 8) Start Servers Individually (Manual/Hybrid Mode)

Use one terminal per server.

### 8.1 Reporting Backend

```powershell
cd .\tdai-main\metupalle-jpg\tdai
npm run dev -w packages/reporting-app/backend
```

Runs on `http://localhost:8080` when launched directly from reporting workspace scripts.
In Docker Compose it is mapped as `http://localhost:8081`.

### 8.2 Reporting Frontend

```powershell
cd .\tdai-main\metupalle-jpg\tdai
npm run dev -w packages/reporting-app/frontend
```

Runs on `http://localhost:5173`.

### 8.3 MONAI Server

```powershell
cd .\tdai-main\metupalle-jpg\tdai\packages\monai-server
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 5000
```

### 8.4 MedASR Server

```powershell
cd .\tdai-main\metupalle-jpg\tdai\packages\medasr-server
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 5001
```

### 8.5 wav2vec2 Server

```powershell
cd .\tdai-main\metupalle-jpg\tdai\packages\wav2vec2-server
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 5002
```

### 8.6 Dicoogle Server

Option A (recommended local stack): run via Docker Compose.

Option B (native dev from package):

```powershell
cd .\tdai-main\metupalle-jpg\tdai
npm run dev -w packages/dicoogle-server
```

### 8.7 OHIF Viewer

OHIF uses Yarn in its own workspace:

```powershell
cd .\tdai-main\metupalle-jpg\tdai\packages\ohif-viewer
yarn install --frozen-lockfile
yarn dev
```

For most local development, running OHIF via Docker Compose is simpler.

## 9) One-Command Dev (Turborepo)

From project root:

```powershell
npm run dev
```

This runs workspace `dev` scripts in parallel where defined. Use this when your npm workspace dependencies are already installed and stable.

## 10) Health and Verification

After startup, verify:

- Reporting backend health endpoint is reachable
- Reporting frontend loads in browser
- Dicoogle UI/API is reachable
- AI service ports (`5000`, `5001`, `5002`) respond
- OHIF UI loads (if started)

Useful commands:

```powershell
docker compose logs -f reporting-app-backend
docker compose logs -f monai-server
docker compose logs -f dicoogle
```

## 11) Common Troubleshooting

- Port conflict: stop existing process or change port mapping.
- Python model install issues: create a clean virtual environment per AI service.
- OHIF dependency issues: run `yarn install --frozen-lockfile` inside `packages/ohif-viewer`.
- Docker GPU reservation errors (MONAI): remove GPU requirement or configure Docker + NVIDIA runtime.
- CORS/auth errors: verify `FRONTEND_URL`, `DICOOGLE_URL`, `CORS_ALLOWED_ORIGINS`, and Firebase/GCP settings in `.env`.

## 12) Recommended Local Workflow

1. Start infra/services: `docker compose up --build`
2. If editing UI frequently, run frontend separately (`npm run dev -w packages/reporting-app/frontend`) and keep backend/services in Docker.
3. Use `docs/ARCHITECTURE.md` for deep design details and `docs/command.md` for command reference.

