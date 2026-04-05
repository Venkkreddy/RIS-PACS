# Memory — Project Context & Decisions

## Identity

**TD|ai** = Traditional Diagnostics powered by Artificial Intelligence.
Cloud-native, RIS-first radiology platform. Domain: `tdairad.com`.

## Core Architecture

- **Monorepo** managed by npm workspaces + Turborepo
- 6 packages: `reporting-app` (backend/frontend/shared), `monai-server`, `medasr-server`, `wav2vec2-server`, `dicoogle-server`, `ohif-viewer`
- Event flow: Modality → Dicoogle PACS → webhook → RIS backend → OHIF viewer → Report

## Key Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Monorepo tool | Turborepo | Fast, incremental, task-graph caching |
| Package manager | npm 10 (root + reporting-app), yarn (OHIF only) | OHIF upstream uses yarn; rest standardized on npm |
| Frontend framework | React 18 + Vite 6 + Tailwind | Fast DX, medical-grade data-dense UI |
| Rich text editor | TipTap | Extensible, structured content, table support for radiology templates |
| Backend | Express + TypeScript | Familiar, fast iteration, large middleware ecosystem |
| Auth | Firebase Auth (Google OAuth + email/password) | Managed auth, admin approval gate, no custom auth server |
| PACS | Dicoogle (self-hosted) | Open-source, webhook support, DICOMweb, Java extensible |
| Viewer | OHIF 3.x fork | Industry standard, custom `reporting-extension` integrated |
| AI inference | MONAI + MedGemma (Vertex AI) | Medical imaging AI, Google health models |
| Speech-to-text | Google Cloud Speech, MedASR, wav2vec2 + LLM correction | Multi-model ASR pipeline for radiology dictation |
| LLM correction | Gemini (primary), Ollama/llama3 (fallback) | Medical text correction post-ASR |
| Database | In-memory store (current), PostgreSQL 16 (target) | MVP uses in-memory; Prisma migration planned |
| Infra | GCP Cloud Run (CI), Fly.io (legacy configs) | Cloud Run for prod via GitHub Actions; Fly.io configs retained |
| PDF | pdf-lib | Client-side PDF generation for reports |
| Email | SendGrid | Transactional report sharing |

## Auth Model

- **Master admins:** `metupalle@gmail.com`, `praveenk1006@gmail.com`, `gunapiano24@gmail.com`
- **Roles:** Admin, Radiologist, Technologist, Referring, Receptionist, Billing
- **Flow:** Firebase JWT → backend validates → role checked → admin approval gate for new users
- **RBAC:** `PermissionGate` + `RoleGate` components, `middleware/auth.ts` server-side

## Environment Variables

Required (see `.env.example`):
- `DICOOGLE_URL`, `OHIF_URL`, `REPORTING_API_URL`, `FRONTEND_URL`
- `GCP_PROJECT_ID`, `GCP_LOCATION`, `GCS_BUCKET`
- `GEMINI_API_KEY`, `GEMINI_MODEL`
- `VITE_FIREBASE_*` (4 vars for Firebase client)
- `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`
- `MASTER_ADMIN_EMAILS`
- AI toggles: `MONAI_ENABLED`, `MEDASR_ENABLED`, `VERTEX_AI_ENABLED`

## Service Ports

| Service | Port | Protocol |
|---------|------|----------|
| Dicoogle | 8080 (HTTP), 104 (DICOM) | REST, DICOMweb, C-STORE |
| OHIF Viewer | 3000 | HTTP |
| MONAI Server | 5000 | FastAPI |
| MedASR Server | 5001 | FastAPI |
| Wav2vec2 Server | 5002 | FastAPI |
| Reporting Backend | 8081 (docker) / 8080 (direct) | Express |
| Frontend (Vite) | 5173 | HTTP |

## API Surface

Base: `/api/v1` (planned), currently flat routes.

Core routes: `/health`, `/auth/*`, `/admin/*`, `/worklist`, `/orders`, `/patients`, `/reports`, `/templates`, `/billing`, `/webhook/study`, `/transcribe`, `/ai/*`, `/dicomweb/*`, `/services/*`, `/permissions/*`.

See `shared/api-endpoints.md` for Dicoogle + Reporting API details.

## Order Lifecycle

```
ORDERED → SCHEDULED → CHECKED_IN → IN_PROGRESS
→ COMPLETED (Dicoogle webhook) → PENDING_READ
→ PRELIMINARY → FINAL → ADDENDUM / CANCELLED
```

## Coding Rules (`.cursor/rules.md`)

1. Use `shared/types/*.d.ts` for cross-package API interfaces
2. Keep backend endpoints backward compatible
3. Document new Dicoogle/OHIF integrations in `shared/api-endpoints.md`
4. No hardcoded URLs — use env vars with local fallbacks
5. Reports use append-only immutable versioning (addendums)

## Brand

| Token | Hex | Use |
|-------|-----|-----|
| Teal | `#00B4A6` | Primary actions, success |
| Navy | `#1A2B56` | Navbar, headings |
| Red | `#E03C31` | STAT priority, AI indicators |
| Font | Inter (body), JetBrains Mono (codes) | 14px base |

## Known Gaps / TODOs

- `monai-server` has no Dockerfile (docker-compose references it — needs adding)
- Database is in-memory; PostgreSQL + Prisma migration pending
- Redis/BullMQ event bus not yet implemented (in architecture doc but not in code)
- HL7 Bridge and FHIR Server are roadmap items, not yet built
- RIS Core service (`:8082`) is an architecture target, currently merged into reporting backend
