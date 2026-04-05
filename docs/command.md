# Commands Reference

## Quick Start

```bash
cp .env.example .env          # Configure environment
npm install                   # Install all workspace deps
npm run dev                   # Start all services in parallel
```

---

## Root (Turborepo)

| Command | Action |
|---------|--------|
| `npm run dev` | `turbo run dev --parallel` — starts all packages |
| `npm run build` | `turbo run build` — builds all packages (topological) |
| `npm run test` | `turbo run test` — runs all test suites |
| `npm run lint` | `turbo run lint` — type-checks all packages |

## Reporting Backend (`packages/reporting-app/backend`)

| Command | Action |
|---------|--------|
| `npm run dev -w backend` | `ts-node-dev` hot-reload server on `:8080` |
| `npm run build -w backend` | `tsc` compile to `dist/` |
| `npm run start -w backend` | `node dist/server.js` (production) |
| `npm run test -w backend` | Jest tests (`--runInBand`) |
| `npm run lint -w backend` | `tsc --noEmit` type check |

## Reporting Frontend (`packages/reporting-app/frontend`)

| Command | Action |
|---------|--------|
| `npm run dev -w frontend` | Vite dev server on `:5173` |
| `npm run build -w frontend` | `tsc --noEmit && vite build` |
| `npm run preview -w frontend` | Vite preview of production build |
| `npm run test -w frontend` | Vitest unit tests |
| `npm run test:e2e -w frontend` | Cypress E2E (headless) |
| `npm run test:e2e:open -w frontend` | Cypress E2E (interactive) |

## Docker Compose

```bash
docker compose up --build           # Build + start full stack
docker compose up -d                # Detached mode
docker compose down                 # Stop + remove containers
docker compose logs -f <service>    # Tail logs for a service
```

**Services started:** `dicoogle` (:8080), `ohif` (:3000), `monai-server` (:5000), `medasr-server` (:5001), `wav2vec2-server` (:5002), `reporting-app-backend` (:8081)

## Deploy

### GCP Cloud Run (CI — `.github/workflows/deploy.yml`)

Triggered on push to `main`. Steps: `npm ci` → `yarn install` (OHIF) → `turbo build` → `gcloud run deploy` for reporting-api, ohif-viewer, dicoogle-server.

### Manual GCP Deploy

```bash
export GCP_PROJECT_ID=your-project-id
export GCP_REGION=us-central1       # optional, default
./deploy.sh
```

### Fly.io (legacy configs still present)

```bash
fly deploy --config packages/reporting-app/frontend/fly.toml
fly deploy --config packages/dicoogle-server/fly.toml
```

Set secrets:
```bash
bash scripts/fly-secrets.sh
```

## Scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `generate_sample_dicoms.py` | Create test DICOM files |
| `read_dicoms.py` | Read/inspect DICOM metadata |
| `post_deploy_smoke.py` | Post-deploy health verification (health, worklist-sync, webhook-connectivity) |
| `setup-dicom-local.bat` | Windows: configure local DICOM env |
| `start-dicoogle-local.bat` | Windows: launch Dicoogle locally |
| `fly-secrets.sh` | Push secrets to Fly.io apps |
| `step1-restructure.sh` | One-time monorepo migration |

## Dicoogle Server

```bash
cd packages/dicoogle-server
bash build.sh                       # Build from source (requires Java 11+)
bash build-local-installer.sh       # Build local installer
```

## OHIF Viewer

```bash
cd packages/ohif-viewer
yarn install --frozen-lockfile
yarn build                          # Production build
yarn dev                            # Dev server
```

## Python AI Services

```bash
cd packages/monai-server && pip install -r requirements.txt && uvicorn server:app --port 5000
cd packages/medasr-server && pip install -r requirements.txt && uvicorn server:app --port 5001
cd packages/wav2vec2-server && pip install -r requirements.txt && uvicorn server:app --port 5002
```

## Import External Sources

OHIF:
```bash
git clone --depth 1 https://github.com/OHIF/Viewers.git /tmp/ohif-src
cp -a /tmp/ohif-src/. packages/ohif-viewer/ && rm -rf packages/ohif-viewer/.git
```

Dicoogle:
```bash
git clone --depth 1 https://github.com/bioinformatics-ua/dicoogle.git /tmp/dicoogle-src
cp -a /tmp/dicoogle-src/. packages/dicoogle-server/ && rm -rf packages/dicoogle-server/.git
```
