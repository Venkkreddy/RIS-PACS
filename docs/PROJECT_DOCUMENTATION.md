# TD|ai — Complete Project Documentation

## Medical Imaging Platform: Integrated RIS + PACS + AI

**Version:** 0.2.0  
**Last updated:** 9 July 2026  
**Repository:** `tdai-main/metupalle-jpg/tdai`

> **Session: 9 July 2026** — Smart Patient Intake system built (AI-powered DICOM tag generator).
> New files: `intake_service.py`, `intake.ts` (backend proxy), `SmartIntake.tsx` (frontend modal).
> See Section 12 for full AI Services reference.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Monorepo Structure](#3-monorepo-structure)
4. [Technology Stack](#4-technology-stack)
5. [Packages](#5-packages)
  - 5.1 [Reporting App — Backend](#51-reporting-app--backend)
  - 5.2 [Reporting App — Frontend](#52-reporting-app--frontend)
  - 5.3 [Reporting App — Shared Types](#53-reporting-app--shared-types)
  - 5.4 [Orthanc PACS Server](#54-orthanc-pacs-server)
  - 5.5 [Dicoogle Server](#55-dicoogle-server)
  - 5.6 [OHIF Viewer](#56-ohif-viewer)
  - 5.7 [MONAI Server](#57-monai-server)
  - 5.8 [MedASR Server](#58-medasr-server)
  - 5.9 [Wav2Vec2 Server](#59-wav2vec2-server)
  - 5.10 [Electron Desktop App Wrapper](#510-electron-desktop-app-wrapper)
6. [Shared Assets](#6-shared-assets)
7. [API Reference](#7-api-reference)
8. [Authentication & Authorization](#8-authentication--authorization)
9. [Multi-Tenant Architecture](#9-multi-tenant-architecture)
10. [Database & Persistence](#10-database--persistence)
11. [DICOM Pipeline](#11-dicom-pipeline)
12. [AI Services](#12-ai-services)
13. [Infrastructure & Deployment](#13-infrastructure--deployment)
  - 13.1 [Docker Compose Configuration](#131-docker-compose-configuration)
  - 13.2 [Production Dockerfiles](#132-production-dockerfiles)
  - 13.3 [GCP VM Deployment](#133-gcp-vm-deployment)
  - 13.4 [Electron Desktop App Builder](#134-electron-desktop-app-builder)
14. [Environment Variables](#14-environment-variables)
15. [Scripts & Tooling](#15-scripts--tooling)
16. [Testing](#16-testing)
17. [CI/CD Pipeline](#17-cicd-pipeline)
18. [Design System](#18-design-system)
19. [Security & Compliance](#19-security--compliance)
20. [HIPAA Compliance](#20-hipaa-compliance)

---

## 1. Project Overview

**TD|ai** (Traditional Diagnostics powered by Artificial Intelligence) is a cloud-native, RIS-first radiology platform that unifies:


| Module                | Description                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RIS Core**          | Patient registry, radiology order lifecycle, scheduling, workflow orchestration                                                                                              |
| **Orthanc PACS**      | Primary PACS registry with DICOM C-STORE, C-FIND Modality Worklist (MWL), and MPPS status tracking services (port 4242/11115).                                                |
| **Dicoogle Server**   | Secondary PACS image storage, Lucene indexing, and DICOMweb retrieval endpoints (port 11112).                                                                                 |
| **OHIF Viewer**       | Zero-footprint web DICOM viewer with custom TD branding (port 3000).                                                                                                         |
| **Reporting Engine**  | Structured radiology reports, templates, voice dictation, TipTap rich editor, PDF generation, email sharing                                                                  |
| **MONAI AI**          | AI-powered medical image analysis (chest X-ray, lung nodule, brain MRI, CT segmentation, cardiac), GradCAM heatmaps, DICOM SR/GSPS/SC generation, MedGemma narrative reports |
| **MedASR / Wav2Vec2** | Medical speech recognition for voice-to-report dictation with LLM-based correction                                                                                           |
| **Analytics**         | TAT, volume, productivity, center-level dashboards                                                                                                                           |
| **Billing**           | CPT/ICD coding, charge capture, revenue tracking                                                                                                                             |
| **Multi-Tenant**      | Tenant-isolated data, JWT auth, per-tenant RBAC, scoped DICOMweb, platform admin API                                                                                         |
| **Electron Wrapper**  | Single-click Windows desktop wrapper app running all Docker services silently with splash loading screens and tray icon.                                                      |


### Brand Identity


| Element | Color | Hex       | Meaning                                     |
| ------- | ----- | --------- | ------------------------------------------- |
| **T**   | Teal  | `#00B4A6` | Trust, clarity, medical precision           |
| **D**   | Navy  | `#1A2B56` | Depth, stability, intelligence              |
| **      | **    | Gray      | `#808080`                                   |
| **ai**  | Red   | `#E03C31` | Urgency, innovation, AI-powered diagnostics |


---

## 2. Architecture

```
┌──────────────────────── EXTERNAL SYSTEMS ───────────────────────┐
│  Hospital EMR/HIS       Referring Portals         Modalities    │
└───────┬──────────────────────┬──────────────────────────┬───────┘
        │ HL7/FHIR             │ REST API                 │ DICOM C-STORE
        ▼                      ▼                          ▼
┌────────────────────────────────────────────────────────────────────┐
│          API GATEWAY / LOAD BALANCER (Nginx — TLS, routing, CORS) │
│          /api/*  →  Backend     /ohif/*  →  OHIF Viewer           │
│          /dicoogle/* → Dicoogle  /weasis → Weasis launcher        │
└───┬──────────┬──────────┬──────────┬──────────┬───────────────────┘
    │          │          │          │          │
┌───▼──────┐ ┌▼────────┐ ┌▼────────┐ ┌▼──────┐ ┌▼──────────┐
│Reporting │ │Dicoogle │ │  OHIF   │ │MONAI  │ │  MedASR   │
│Backend   │ │  PACS   │ │ Viewer  │ │Server │ │  Server   │
│  :8081   │ │  :8080  │ │  :3000  │ │ :5000 │ │  :5001    │
└────┬─────┘ └────┬────┘ └────┬────┘ └───┬───┘ └─────┬─────┘
     │            │           │          │            │
     └────────────┴───────────┴──────────┴────────────┘
                              │
     ┌────────────────────────▼─────────────────────────┐
     │                    DATA LAYER                     │
     │  Firestore (single-tenant)  │  PostgreSQL (MT)    │
     │  GCS Object Storage         │  Local filesystem   │
     └──────────────────────────────────────────────────┘
```

### Service Ports


| Service              | Default Port                   | Protocol        |
| -------------------- | ------------------------------ | --------------- |
| Reporting Backend    | 8081 (host) → 8080 (container) | HTTP REST       |
| Reporting Frontend   | 5173                           | HTTP (Vite dev) |
| Dicoogle PACS        | 8080 (HTTP), 104/11112 (DICOM) | HTTP + DICOM    |
| OHIF Viewer          | 3000 → 80 (nginx)              | HTTP            |
| MONAI Server         | 5000                           | HTTP REST       |
| MedASR Server        | 5001                           | HTTP REST       |
| Wav2Vec2 Server      | 5002                           | HTTP REST       |
| PostgreSQL           | 5432                           | PostgreSQL      |
| Orthanc (pacs-stack) | 8042 (HTTP), 4242 (DICOM)      | HTTP + DICOM    |


---

## 3. Monorepo Structure

```
tdai/
├── .cursor/                  # Cursor IDE rules
├── .github/workflows/        # CI/CD pipeline
├── .turbo/                   # Turborepo cache
├── confs/                    # Dicoogle server.xml config
├── deploy/                   # GCP VM deployment scripts (01–06)
├── docs/                     # Architecture, documentation
├── monai-models/             # AI model weights (runtime, not committed)
├── packages/
│   ├── reporting-app/
│   │   ├── backend/          # Express + Firestore reporting API
│   │   ├── frontend/         # React + Vite + Tailwind reporting UI
│   │   ├── shared/           # TypeScript types shared between FE/BE
│   │   ├── integrations/     # OHIF plugin + Dicoogle webhook Lua
│   │   ├── scripts/          # Package-level utility scripts
│   │   └── docs/             # Package docs
│   ├── dicoogle-server/      # Dicoogle fork (Maven + Docker)
│   ├── ohif-viewer/          # OHIF 3.x with custom reporting extension
│   ├── monai-server/         # Python FastAPI AI inference server
│   ├── medasr-server/        # Google MedASR speech recognition server
│   └── wav2vec2-server/      # Open-source ASR server (Wav2Vec2/Whisper)
├── pacs-stack/               # Alternative Orthanc-based PACS stack
├── Plugins/                  # Dicoogle plugin settings (legacy mount)
├── scripts/                  # Dev tooling, DICOM generators, smoke tests
├── shared/
│   ├── types/report.d.ts     # Cross-package report type contract
│   ├── api-endpoints.md      # API overview document
│   ├── tailwind.preset.js    # Shared Tailwind color/font config
│   └── styles/tdai-tokens.css# CSS design tokens
├── storage/                  # DICOM file storage (gitignored)
├── tests/                    # E2E Selenium bot
├── docker-compose.yml        # Full-stack Docker Compose
├── Dockerfile                # Production reporting API image
├── turbo.json                # Turborepo task config
├── package.json              # Root monorepo package
├── start.bat / start.ps1     # Windows startup helpers
├── deploy.sh                 # GCP Cloud Run deploy script
├── MULTI_TENANT_ARCHITECTURE.md
└── README.md
```

---

## 4. Technology Stack


| Layer                  | Technology                                                           |
| ---------------------- | -------------------------------------------------------------------- |
| **Runtime**            | Node.js 20 + TypeScript                                              |
| **Backend Framework**  | Express.js                                                           |
| **Frontend Framework** | React 18 + Vite 6 + Tailwind CSS 3                                   |
| **Rich Text Editor**   | TipTap (ProseMirror)                                                 |
| **Data Tables**        | TanStack Table                                                       |
| **Charts**             | Recharts                                                             |
| **Animations**         | Framer Motion                                                        |
| **Server State**       | TanStack Query (React Query)                                         |
| **Database**           | Google Cloud Firestore (single-tenant), PostgreSQL 16 (multi-tenant) |
| **Authentication**     | Firebase Auth (Google + Email/Password) + Passport.js + JWT          |
| **PACS**               | Dicoogle (primary) / Orthanc (alternative)                           |
| **DICOM Viewer**       | OHIF Viewer 3.x (Cornerstone.js)                                     |
| **AI Inference**       | Python 3.11 + PyTorch + Project MONAI                                |
| **Speech Recognition** | Google MedASR / Facebook Wav2Vec2 / Faster-Whisper                   |
| **LLM Integration**    | Google Gemini API / Vertex AI / Ollama (local)                       |
| **Object Storage**     | Google Cloud Storage (GCS)                                           |
| **Email**              | SendGrid                                                             |
| **PDF Generation**     | pdf-lib                                                              |
| **DICOM Parsing**      | dicom-parser (JS), pydicom (Python)                                  |
| **Monorepo**           | Turborepo                                                            |
| **Containerization**   | Docker + Docker Compose                                              |
| **CI/CD**              | GitHub Actions → GCP Cloud Run                                       |
| **Package Manager**    | npm 10                                                               |


---

## 5. Packages

### 5.1 Reporting App — Backend

**Path:** `packages/reporting-app/backend`  
**Package:** `medical-report-system-backend`  
**Runtime:** Node.js 20 + TypeScript + Express

#### Route Map

##### Health (`/health`)


| Method | Path                           | Auth    | Description                            |
| ------ | ------------------------------ | ------- | -------------------------------------- |
| GET    | `/health/`                     | None    | Basic health check                     |
| GET    | `/health/ohif`                 | None    | OHIF viewer availability probe         |
| GET    | `/health/worklist-sync`        | Session | Dicoogle study search diagnostics      |
| GET    | `/health/webhook-connectivity` | Session | Dicoogle connectivity + metadata probe |


##### Auth (`/auth`)


| Method | Path                     | Description                                   |
| ------ | ------------------------ | --------------------------------------------- |
| GET    | `/auth/google`           | Start Google OAuth flow                       |
| GET    | `/auth/google/callback`  | OAuth callback → session → redirect           |
| POST   | `/auth/firebase-login`   | Verify Firebase ID token → session            |
| POST   | `/auth/register-request` | Submit access request (session)               |
| GET    | `/auth/me`               | Current session user                          |
| POST   | `/auth/logout`           | Destroy session                               |
| GET    | `/auth/failure`          | 401 OAuth failure                             |


##### Admin


| Method | Path                               | Auth          | Description                                          |
| ------ | ---------------------------------- | ------------- | ---------------------------------------------------- |
| POST   | `/admin/invite`                    | Admin         | Invite user by email with role (SendGrid)            |
| POST   | `/users`                           | Auth off only | Dev seed user                                        |
| GET    | `/users`                           | Session       | List users (admins see all; others see radiologists) |
| PATCH  | `/users/:id`                       | Admin         | Update role and displayName                          |
| GET    | `/admin/user-requests`             | Admin         | Pending user approval queue                          |
| POST   | `/admin/user-requests/:id/approve` | Admin         | Approve with optional role                           |
| POST   | `/admin/user-requests/:id/reject`  | Admin         | Reject access request                                |
| GET    | `/analytics`                       | Admin         | Center, radiologist, TAT statistics                  |
| POST   | `/admin/reminder`                  | Admin         | TAT reminder email for a study                       |


##### AI (`/ai`)


| Method | Path                   | Permission        | Description                       |
| ------ | ---------------------- | ----------------- | --------------------------------- |
| GET    | `/ai/models`           | Authenticated     | List MONAI models + enabled flag  |
| POST   | `/ai/analyze`          | `ai:analyze`      | Run AI analysis on study/series   |
| GET    | `/ai/results/:studyId` | `ai:view_results` | Cached AI metadata for a study    |
| GET    | `/ai/heatmap/:studyId` | `ai:view_results` | GradCAM heatmap (PNG or DICOM SC) |
| GET    | `/ai/gsps/:studyId`    | `ai:view_results` | GSPS DICOM annotation download    |
| GET    | `/ai/sr/:studyId`      | `ai:view_results` | DICOM Structured Report download  |


##### Reports (`/reports`)


| Method | Path                         | Permission         | Description                             |
| ------ | ---------------------------- | ------------------ | --------------------------------------- |
| POST   | `/reports/`                  | `reports:create`   | Create draft report                     |
| GET    | `/reports/`                  | `reports:view`     | List reports for current user           |
| GET    | `/reports/by-study/:studyId` | `reports:view`     | Report by study UID                     |
| GET    | `/reports/:id`               | `reports:view`     | Report by report ID                     |
| PUT    | `/reports/:id`               | `reports:edit`     | Update content/sections/priority        |
| PATCH  | `/reports/:id/status`        | `reports:sign`     | Status transition (draft→final)         |
| PATCH  | `/reports/:id/addendum`      | `reports:addendum` | Append addendum                         |
| POST   | `/reports/:id/attach`        | `reports:edit`     | Upload image attachment (JPEG/PNG/WebP) |
| POST   | `/reports/:id/voice`         | `reports:edit`     | Upload audio for transcription          |
| POST   | `/reports/:id/share`         | `reports:share`    | Email report as PDF                     |


##### Templates (`/templates`)


| Method | Path          | Permission         |
| ------ | ------------- | ------------------ |
| POST   | `/templates/` | `templates:create` |
| GET    | `/templates/` | `templates:view`   |


##### Transcription (`/transcribe`)


| Method | Path                    | Description                                   |
| ------ | ----------------------- | --------------------------------------------- |
| POST   | `/transcribe/`          | Audio file → transcript                       |
| POST   | `/transcribe/radiology` | Full radiology transcription pipeline         |
| POST   | `/transcribe/browser`   | LLM correction of browser-captured transcript |


##### Webhook (`/webhook`)


| Method | Path             | Auth                        | Description                                        |
| ------ | ---------------- | --------------------------- | -------------------------------------------------- |
| POST   | `/webhook/study` | Optional `x-webhook-secret` | Dicoogle/Orthanc study notification → draft report |


##### Worklist


| Method | Path                               | Permission               | Description                        |
| ------ | ---------------------------------- | ------------------------ | ---------------------------------- |
| GET    | `/worklist`                        | `worklist:view`          | Filterable study worklist          |
| GET    | `/worklist/:studyId/viewer-access` | `worklist:view`          | DICOMweb validation + OHIF URL     |
| POST   | `/assign`                          | `worklist:assign`        | Bulk assign studies to radiologist |
| POST   | `/update-status`                   | `worklist:update_status` | Update study status                |


##### Patients (`/patients`)


| Method | Path            | Permission        |
| ------ | --------------- | ----------------- |
| GET    | `/patients/`    | `patients:view`   |
| GET    | `/patients/:id` | `patients:view`   |
| POST   | `/patients/`    | `patients:create` |
| PATCH  | `/patients/:id` | `patients:edit`   |
| DELETE | `/patients/:id` | `patients:delete` |


##### Orders (`/orders`)


| Method | Path          | Permission      |
| ------ | ------------- | --------------- |
| GET    | `/orders/`    | `orders:view`   |
| GET    | `/orders/:id` | `orders:view`   |
| POST   | `/orders/`    | `orders:create` |
| PATCH  | `/orders/:id` | `orders:edit`   |


##### Scans (`/scans`)


| Method | Path         | Permission     |
| ------ | ------------ | -------------- |
| GET    | `/scans/`    | `scans:view`   |
| GET    | `/scans/:id` | `scans:view`   |
| POST   | `/scans/`    | `scans:create` |
| PATCH  | `/scans/:id` | `scans:edit`   |


##### Billing (`/billing`)


| Method | Path           | Permission       |
| ------ | -------------- | ---------------- |
| GET    | `/billing/`    | `billing:view`   |
| GET    | `/billing/:id` | `billing:view`   |
| POST   | `/billing/`    | `billing:create` |
| PATCH  | `/billing/:id` | `billing:edit`   |


##### Referring Physicians (`/referring-physicians`)


| Method | Path                        | Permission                    |
| ------ | --------------------------- | ----------------------------- |
| GET    | `/referring-physicians/`    | `referring_physicians:view`   |
| GET    | `/referring-physicians/:id` | `referring_physicians:view`   |
| POST   | `/referring-physicians/`    | `referring_physicians:create` |
| PATCH  | `/referring-physicians/:id` | `referring_physicians:edit`   |


##### DICOM Upload (`/dicom`)


| Method | Path            | Permission     | Description                                                                        |
| ------ | --------------- | -------------- | ---------------------------------------------------------------------------------- |
| POST   | `/dicom/upload` | `dicom:upload` | Multi-file DICOM upload (max 50 files, 500MB/file), tag rewrite, Dicoogle indexing |


##### DICOMweb Proxy (`/dicomweb`, `/dicom-web`, `/wado`)


| Method | Path                                                                       | Description                    |
| ------ | -------------------------------------------------------------------------- | ------------------------------ |
| POST   | `.../warm`                                                                 | Clear DIM cache, warm query    |
| GET    | `.../`                                                                     | WADO-URI retrieve (raw DICOM)  |
| GET    | `.../studies`                                                              | QIDO-RS study search           |
| GET    | `.../studies/:studyUID/validate`                                           | Study readiness validation     |
| GET    | `.../studies/:studyUID/series`                                             | QIDO-RS series list            |
| GET    | `.../studies/:studyUID/series/:seriesUID/instances`                        | QIDO-RS instance list          |
| GET    | `.../studies/:studyUID`                                                    | WADO-RS full study (multipart) |
| GET    | `.../studies/:studyUID/series/:seriesUID`                                  | WADO-RS full series            |
| GET    | `.../studies/:studyUID/series/:seriesUID/instances/:sopUID`                | WADO-RS instance               |
| GET    | `.../studies/:studyUID/series/:seriesUID/instances/:sopUID/frames/:frames` | Frame-level pixel data         |
| GET    | `.../studies/:studyUID/metadata`                                           | Study metadata JSON            |
| GET    | `.../studies/:studyUID/series/:seriesUID/metadata`                         | Series metadata JSON           |


All DICOMweb routes also available via `/weasis/:accessToken/...` prefix for Weasis desktop viewer deep links.

##### DICOMweb Multi-Tenant (`/api/v1/dicomweb`) — requires `MULTI_TENANT_ENABLED`

Same DICOMweb operations scoped by JWT tenant context with `validateStudyAccess()`.

##### Permissions (`/permissions`)


| Method | Path                          | Auth    | Description              |
| ------ | ----------------------------- | ------- | ------------------------ |
| GET    | `/permissions/`               | Admin   | All roles + permissions  |
| PUT    | `/permissions/:role`          | Admin   | Set role permissions     |
| POST   | `/permissions/:role/reset`    | Admin   | Reset to defaults        |
| GET    | `/permissions/my-permissions` | Session | Current user permissions |


##### Services (`/services`)


| Method | Path               | Permission                  | Description           |
| ------ | ------------------ | --------------------------- | --------------------- |
| GET    | `/services/config` | Authenticated               | Service configuration |
| PUT    | `/services/config` | `developer:toggle_services` | Update service config |
| GET    | `/services/health` | `developer:view_health`     | Service health status |


##### Tenant Auth (`/api/v1/auth`) — Multi-Tenant


| Method | Path                    | Description                        |
| ------ | ----------------------- | ---------------------------------- |
| POST   | `/api/v1/auth/login`    | Email + password + tenantSlug      |
| POST   | `/api/v1/auth/register` | Tenant user registration (pending) |
| POST   | `/api/v1/auth/refresh`  | Refresh JWT tokens                 |
| POST   | `/api/v1/auth/logout`   | Revoke tokens                      |
| GET    | `/api/v1/auth/me`       | Current user + tenant context      |


##### Tenant/Platform Admin (`/api/v1/platform`, `/api/v1`)


| Method | Path                              | Auth               | Description                |
| ------ | --------------------------------- | ------------------ | -------------------------- |
| POST   | `.../tenants`                     | Platform admin     | Create tenant + admin user |
| GET    | `.../tenants`                     | Platform admin     | List all tenants           |
| PATCH  | `.../tenants/:tenantId`           | Platform admin     | Update tenant              |
| POST   | `.../tenants/:tenantId/admins`    | Platform admin     | Add tenant admin           |
| GET    | `.../monitoring/overview`         | Platform admin     | System monitoring          |
| GET    | `.../admin/users`                 | Tenant admin (JWT) | List tenant users          |
| PATCH  | `.../admin/users/:userId/approve` | Tenant admin       | Approve user               |
| GET    | `.../admin/audit-logs`            | Tenant admin       | Tenant audit trail         |


##### HIPAA Compliance (`/hipaa`)


| Method | Path                             | Auth    | Description                                       |
| ------ | -------------------------------- | ------- | ------------------------------------------------- |
| GET    | `/hipaa/audit-log`               | Admin   | Query PHI audit trail with filters                |
| GET    | `/hipaa/audit-log/integrity`     | Admin   | Verify SHA-256 hash chain integrity               |
| POST   | `/hipaa/emergency-access`        | Session | Request break-glass emergency PHI access          |
| POST   | `/hipaa/emergency-access/revoke` | Admin   | Revoke emergency access grant                     |
| GET    | `/hipaa/emergency-access`        | Admin   | List all emergency access records                 |
| GET    | `/hipaa/compliance-status`       | Admin   | Real-time compliance dashboard (audit, integrity) |


#### Services


| Service                | Purpose                      | Key Methods                                                                                                                                                                                                                              |
| ---------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store.ts`             | Firestore single-tenant CRUD | `createTemplate`, `listTemplates`, `createReport`, `getReport`, `updateReport`, `appendVersion`, `upsertStudyRecord`, `listStudyRecords`, `assignStudies`, `listUsers`, `upsertUser`, RBAC, patients, orders, scans, billing, physicians |
| `tenantScopedStore.ts` | Firestore per-tenant CRUD    | Same operations scoped to `tenants/{tenantId}/...` subcollections + audit log                                                                                                                                                            |
| `inMemoryStore.ts`     | Dev/test store               | In-memory implementation of StoreService                                                                                                                                                                                                 |
| `jwtService.ts`        | Multi-tenant JWT             | `generateTokenPair`, `verifyAccessToken`, `verifyRefreshToken`, token storage/revocation                                                                                                                                                 |
| `dicoogleService.ts`   | Dicoogle HTTP client         | `searchStudies`, `fetchStudyMetadata`, `getTenantDicomConfig`, tenant-scoped operations                                                                                                                                                  |
| `dicoogleAuth.ts`      | Dicoogle auth                | `getDicoogleToken`, `getDicoogleAuthHeaders`                                                                                                                                                                                             |
| `monaiService.ts`      | MONAI AI client              | `listModels`, `runInference`, `analyzeDicomFile`, `analyzeDicomWithMedGemma`                                                                                                                                                             |
| `speechService.ts`     | STT + LLM                    | `transcribeAudio`, `transcribeRadiology`, `correctWithLLM`                                                                                                                                                                               |
| `pdfService.ts`        | PDF generation               | `buildReportPdf` (via pdf-lib)                                                                                                                                                                                                           |
| `emailService.ts`      | SendGrid email               | `sendReportShareEmail`, `sendInviteEmail`, `sendTatReminderEmail`                                                                                                                                                                        |
| `reportService.ts`     | Report orchestration         | `createReport`, `addAddendum`                                                                                                                                                                                                            |
| `serviceRegistry.ts`   | Dynamic service URLs         | `getConfig`, `getSttUrl`, `getLlmProvider`, `getStorageConfig`                                                                                                                                                                           |
| `storageService.ts`    | GCS file upload              | `uploadBuffer`, `deleteObject`, `uploadFile`                                                                                                                                                                                             |
| `firebaseAdmin.ts`     | Firebase init                | `getFirebaseAuth`, `getFirestore`                                                                                                                                                                                                        |
| `weasisAccess.ts`      | Weasis deep links            | `createWeasisAccessToken`, `verifyWeasisAccessToken`                                                                                                                                                                                     |
| `permissions.ts`       | RBAC resolver                | `resolvePermissions`, `hasPermission`, `DEFAULT_PERMISSIONS`                                                                                                                                                                             |
| `ohifHealthCheck.ts`   | OHIF probe                   | `isOhifAvailable`, `resetOhifCache`                                                                                                                                                                                                      |
| `logger.ts`            | Winston logger               | HIPAA-compliant structured JSON logging with service metadata, timestamps, hostname                                                                                                                                                      |
| `hipaaAuditService.ts` | HIPAA audit trail            | `log`, `logPhiAccess`, `queryAuditLog`, `verifyAuditIntegrity`, `grantEmergencyAccess`, `revokeEmergencyAccess`, `listEmergencyAccess` — SHA-256 hash-chained immutable audit log                                                        |


#### Middleware


| Middleware           | Purpose                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `auth.ts`            | `ensureAuthenticated`, `ensureRole`, `ensurePermission` with presets + HIPAA automatic session timeout (15 min)   |
| `hipaaMiddleware.ts` | HIPAA PHI access logger, session timeout, account lockout, HTTPS enforcement, password strength validation        |
| `tenantContext.ts`   | JWT → tenant context resolution, role enforcement                                                                 |
| `tenantGuard.ts`     | `validateResourceOwnership`, `validateStudyAccess`, `injectTenantId`, per-tenant rate limit                       |
| `apiGateway.ts`      | Optional JWT tenant resolution, `x-tenant-id` fallback, rate limit 300/min                                        |
| `security.ts`        | Helmet, HSTS, CSP, CORS (wildcard blocked in production), JSON body limit 4MB, rate limit, HIPAA security headers |
| `errorHandler.ts`    | Zod → 400, message-based HTTP status mapping, PHI sanitization in production error responses                      |
| `requestLogger.ts`   | Logs method, path, status, duration, IP address, userId, userRole                                                 |
| `asyncHandler.ts`    | Async route → `next(err)` wrapper                                                                                 |


---

### 5.2 Reporting App — Frontend

**Path:** `packages/reporting-app/frontend`  
**Package:** `medical-report-system-frontend`  
**Runtime:** React 18 + Vite 6 + TypeScript + Tailwind CSS

#### Pages (22)


| Page                      | Route                                   | Purpose                                                          |
| ------------------------- | --------------------------------------- | ---------------------------------------------------------------- |
| `LandingPage`             | `/`                                     | Public marketing page with animated hero, capability tiles, CTAs |
| `LoginPage`               | `/login`                                | Firebase email/password + Google popup + dev quick-login         |
| `PendingApprovalPage`     | `/pending-approval`                     | Static "account pending" with admin contact                      |
| `WorklistPage`            | `/worklist`                             | Global study worklist                                            |
| `MyStudiesPage`           | `/my-studies`                           | Worklist filtered to current radiologist                         |
| `MyUploadsPage`           | `/my-uploads`                           | DICOM upload + user's uploaded studies                           |
| `ReportPage`              | `/reports/:id`, `/reports/study/:id`    | Single report view/editor                                        |
| `ReportsPage`             | `/reports`                              | Report list hub                                                  |
| `TemplatesPage`           | `/templates`                            | Report template creator                                          |
| `PatientsPage`            | `/patients`                             | Patient CRUD with search + DICOM upload                          |
| `OrdersPage`              | `/orders`                               | Radiology order management                                       |
| `ScansPage`               | `/scans`                                | Imaging scan records                                             |
| `SchedulePage`            | `/schedule`                             | Weekly calendar of scheduled orders                              |
| `BillingPage`             | `/billing`                              | Billing records + status management                              |
| `ReferringPhysiciansPage` | `/referring-physicians`                 | Physician directory                                              |
| `AdminPage`               | `/admin`                                | Master admin (users, analytics, permissions)                     |
| `AdminDashboardPage`      | `/admin-dashboard`, `/developer-portal` | Admin/developer portal                                           |
| `RadiologistPage`         | `/radiologist`, `/dr-portal`            | Radiologist workspace                                            |
| `TechPage`                | `/tech`                                 | Technologist portal                                              |
| `ReferringPage`           | `/referring`                            | Referring physician portal                                       |
| `BillingDashboardPage`    | `/billing-dashboard`                    | Billing specialist portal                                        |
| `ReceptionistPage`        | `/receptionist`                         | Front-desk portal                                                |


#### Key Components (27)


| Component               | Purpose                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| `InternalNavbar`        | Sticky nav with permission-filtered links, role dashboard, logout              |
| `RoleGate`              | Render children only if user role matches `allow` list                         |
| `PermissionGate`        | Render children if user has any of required permissions                        |
| `RadiologistDashboard`  | Main radiologist workspace: worklist, OHIF embed, DICOM upload, MONAI panel    |
| `AdminDashboard`        | Admin analytics, users, approvals, permissions matrix, services                |
| `AdminSection`          | Tabs: Users, Analytics, Permissions                                            |
| `Worklist`              | TanStack Table worklist with filters, OHIF/Weasis links, bulk assign           |
| `ReportEditor`          | Full report UI: sections, TipTap editor, templates, status, attachments, share |
| `TipTapEditor`          | Rich text editor with radiology macros                                         |
| `MonaiPanel`            | AI model selection, cached results, run analysis                               |
| `DicomUpload`           | Multi-file DICOM upload with patient registry integration                      |
| `OhifViewerEmbed`       | OHIF iframe with reachability probe                                            |
| `Dashboard`             | Recharts analytics (TAT, volume) + study reminders                             |
| `PermissionsManager`    | Per-role permission matrix editor                                              |
| `TemplateEditor`        | Report template form with TipTap sections                                      |
| `ReportList`            | Report listing with draft creation                                             |
| `AddendumModal`         | Modal addendum entry                                                           |
| `ShareButton`           | Email report sharing                                                           |
| `InviteForm`            | User invitation form                                                           |
| `ServiceTogglePanel`    | Service status cards (OHIF, MONAI, Weasis)                                     |
| `BrandLogo`             | TD                                                                             |
| `TechDashboard`         | Technologist scheduled orders + check-in                                       |
| `ReceptionistDashboard` | Patient registry + scheduling                                                  |
| `ReferringDashboard`    | Referring physician order view + KPIs                                          |
| `BillingDashboard`      | Billing workflow (queue/coded/paid)                                            |
| `LocalDicoogleDownload` | Local Dicoogle ZIP download link                                               |
| `UserAccountBar`        | Top notification bar (not currently mounted)                                   |


#### Routing & Guards

**Public routes:** `/`, `/login`, `/pending-approval`

**Permission-gated routes** (require at least one listed permission):


| Route                      | Required Permission(s)             |
| -------------------------- | ---------------------------------- |
| `/patients`                | `patients:view`                    |
| `/orders`                  | `orders:view`                      |
| `/scans`                   | `scans:view`                       |
| `/schedule`                | `scheduling:view`                  |
| `/billing`                 | `billing:view`                     |
| `/referring-physicians`    | `referring_physicians:view`        |
| `/worklist`                | `worklist:view`                    |
| `/my-uploads`              | `dicom:upload`                     |
| `/my-studies`              | `reports:create` or `reports:view` |
| `/templates`               | `templates:view`                   |
| `/reports`, `/reports/:id` | `reports:view`                     |


**Role-gated routes:**


| Route                                   | Allowed Roles           |
| --------------------------------------- | ----------------------- |
| `/admin`                                | `admin`                 |
| `/radiologist`, `/dr-portal`            | `radiologist`, `admin`  |
| `/admin-dashboard`, `/developer-portal` | `admin`, `developer`    |
| `/tech`                                 | `radiographer`, `admin` |
| `/referring`                            | `referring`, `admin`    |
| `/billing-dashboard`                    | `billing`, `admin`      |
| `/receptionist`                         | `receptionist`, `admin` |


#### State Management

- **React Context:** `AuthContext` (user, role, permissions), `ServiceStatusContext`
- **TanStack Query:** Server state cache for worklist, patients, analytics, permissions, MONAI, etc.
- **Hooks:** `useAuthRole`, `useReport`, `useServiceStatus`, `useDebouncedValue`, `useTheme`

#### API Client (`src/api/client.ts`)

- Axios instance with `baseURL: "/api"`, `withCredentials: true`, 30s timeout
- Request interceptor for JWT bearer token and tenant headers
- 401 response interceptor with refresh token flow
- Vite dev proxy: `/api` → `VITE_BACKEND_PROXY_TARGET` (default `http://localhost:8080`)

---

### 5.3 Reporting App — Shared Types

**Path:** `packages/reporting-app/shared`  
**Package:** `@medical-report-system/shared`

Canonical TypeScript type contracts shared between backend and frontend:

**Multi-Tenant:** `Tenant`, `TenantDicomConfig`, `AuditLogEntry`

**RBAC:**

- `UserRole`: `super_admin`, `admin`, `developer`, `radiologist`, `radiographer`, `billing`, `referring`, `receptionist`, `viewer`
- `PermissionModule`, `PermissionAction`, `Permission` (full string union), `ALL_PERMISSIONS`
- `RolePermissions`

**Reports:** `ReportVersionType`, `AuditVersion`, `ReportStatus`, `CriticalPriority`, `ReportSection`, `Template`, `RadiologyTranscript`, `ReportVoice`, `Report`

**RIS Domain:** `Gender`, `Patient`, `ReferringPhysician`, `OrderStatus`, `OrderPriority`, `Modality`, `RadiologyOrder`, `ScanType`, `ScanStatus`, `Scan`, `BillingStatus`, `BillingRecord`

---

### 5.4 Orthanc PACS Server

**Path:** `pacs-stack/orthanc`  
**Runtime:** Orthanc Team Docker Image + Python Scripting

The primary PACS (Picture Archiving and Communication System) engine for the workstation:

- **DICOM Listening services:** Port `4242` for incoming DICOM C-STORE and C-FIND queries.
- **Modality Worklist (MWL):** Custom Python engine (`worklist.py`) reading scheduled order entries from the database and rendering them to modalities on demand via C-FIND.
- **MPPS (Modality Performed Procedure Step) SCP:** Listens on port `11115` for exposure status tracking notifications (`N-CREATE` and `N-SET`), triggering real-time RIS worklist state updates.
- **Web Administration interface:** Orthanc REST API exposed on port `8042`.

---

### 5.5 Dicoogle Server

**Path:** `packages/dicoogle-server`  
**Runtime:** Java 11 + Maven, Dockerized

A fork/customization of the open-source Dicoogle PACS server with:

- **Lucene indexing** for DICOM metadata search
- **File-based storage** plugin
- **Custom webhook Lua script** (`custom-webhook.lua`): On DICOM store, fires `POST /webhook/study` to reporting backend with study ID, tenant slug (extracted from storage path), and metadata
- **DICOMweb support** (QIDO-RS, WADO-RS via reporting backend proxy)

**Dockerfile:** Multi-stage Maven build → `dicoogle.jar` + plugin JARs. Runtime `eclipse-temurin:11-jre`.

**Configuration:**

- `server.xml`: Web port 8080, AE Title `DICOOGLE-STORAGE`, DICOM storage port 6666, Q/R port 1045
- `lucene.xml`, `filestorage.xml`: Index and storage plugin config
- `users.xml`: Default user `dicoogle` (admin)
- `tags.xml`: DIM tag dictionary + modality whitelist

**OpenAPI spec:** `dicoogle_web_api.yaml` (Dicoogle 3.3.1 public API)

---

### 5.6 OHIF Viewer

**Path:** `packages/ohif-viewer`  
**Runtime:** OHIF 3.x + React + Nginx, Dockerized

Built on top of upstream `ohif/app:latest` with:

- **Custom `default.js` config:** White-labeled as "TDAI Rad / Trivitron Digital", DICOMweb data source pointing to reporting backend (`/dicom-web`, `/wado`)
- **Reporting Extension** (`extensions/reporting-extension/`):
  - Package: `@medical-imaging-platform/extension-reporting`
  - Toolbar button to capture viewport as JPEG and POST to reporting API
  - Opens report page for the current study
  - *Note: Extension exists in tree but is not wired into `pluginImports.js` by default*
- **Extensions loaded:** `@ohif/extension-default`, `@ohif/extension-cornerstone`, plus modes for longitudinal, segmentation, TMTV, microscopy, etc.

**Dockerfile:** Based on `ohif/app:latest`, adds custom `default.conf` (nginx) and `app-config.js`.

---

### 5.7 MONAI Server

**Path:** `packages/monai-server`  
**Runtime:** Python 3.11 + PyTorch + FastAPI

AI inference microservice supporting:

**Models:**


| Key                     | Type              | Labels                                                          |
| ----------------------- | ----------------- | --------------------------------------------------------------- |
| `monai_chest_xray`      | Classification    | 14 chest findings (Atelectasis, Cardiomegaly, Effusion, ...)    |
| `monai_lung_nodule`     | Detection         | Nodule, GGO, Solid, Calcified                                   |
| `monai_brain_mri`       | Classification    | Normal, Tumor, Hemorrhage, Ischemia, Edema, Atrophy             |
| `monai_ct_segmentation` | Segmentation      | Liver, Spleen, Pancreas, Kidney L/R, Aorta                      |
| `monai_cardiac`         | Classification    | Normal, Cardiomegaly, Pericardial Effusion, Valve Calcification |
| `medgemma_report`       | Report generation | LLM narrative via Gemini/Ollama                                 |


**Endpoints:**


| Method | Path                        | Description                                |
| ------ | --------------------------- | ------------------------------------------ |
| GET    | `/`                         | Service metadata (version, device, models) |
| GET    | `/health`                   | Health check                               |
| GET    | `/v1/models`                | Model catalog                              |
| POST   | `/v1/configure`             | Set LLM provider (gemini/ollama/off)       |
| POST   | `/v1/analyze-dicom`         | DICOM → MONAI + GradCAM + DICOM SC/GSPS/SR |
| POST   | `/v1/analyze-medgemma`      | DICOM + optional MONAI + LLM narrative     |
| POST   | `/v1/infer`                 | Legacy inference                           |
| POST   | `/v1/infer-with-sr`         | Legacy + SR                                |
| GET    | `/v1/infer/{job_id}/status` | Job status                                 |


**LLM backends:** Gemini API, Vertex AI, Ollama (configurable via `LLM_PROVIDER`)

---

### 5.8 MedASR Server

**Path:** `packages/medasr-server`  
**Runtime:** Python 3.11 + torch + torchaudio + FastAPI

Medical speech recognition using Google's MedASR model with LLM-based report formatting.

**Endpoints:**


| Method | Path                       | Description                         |
| ------ | -------------------------- | ----------------------------------- |
| GET    | `/`, `/health`             | Health + model info                 |
| POST   | `/v1/transcribe`           | Audio → transcript (max 50MB)       |
| POST   | `/v1/transcribe/radiology` | Audio → structured radiology report |
| POST   | `/v1/correct`              | Text → formatted report via LLM     |


---

### 5.9 Wav2Vec2 Server

**Path:** `packages/wav2vec2-server`  
**Runtime:** Python 3.11 + torch + FastAPI

Open-source alternative ASR tier using Faster-Whisper or Facebook Wav2Vec2 with Ollama-based LLM correction.

**Endpoints:** Same API surface as MedASR (`/v1/transcribe`, `/v1/transcribe/radiology`, `/v1/correct`).

**Config:** Port 5002, `ASR_BACKEND` env (default `faster-whisper`).

---

### 5.10 Electron Desktop App Wrapper

**Path:** `desktop-app`  
**Runtime:** Electron JS + NodeJS, Packaged via Electron Builder

A desktop application shell that acts as a secure container control plane and local presentation layer:

- **Background Services Daemon:** Starts the WSL/Docker engine silently, monitors container health checks, and coordinates port bindings.
- **SSL Verification Bypass:** Injects Chromium flags to skip certificate validation constraints for local `https://localhost:5173` endpoints.
- **Port Conflict Resolution:** Executes force-cleanup commands (`docker rm -f`) at launch to free ports occupied by leftover dev containers.
- **System Tray Native Interface:** Closes the primary window to the system tray to ensure servers keep running in the background.

---

## 6. Shared Assets

### Cross-Package Type Contract (`shared/types/report.d.ts`)

```typescript
interface ReportVersion {
  id: string;
  type: 'initial' | 'addendum' | 'voice-transcript' | 'attachment' | 'share';
  content: string;
  authorId: string;
  createdAt: string;
}

interface Report {
  id: string;
  studyId: string;
  templateId?: string;
  content: string;
  ownerId: string;
  metadata?: Record<string, unknown>;
  attachments: string[];
  voice?: ReportVoice;
  versions: ReportVersion[];
  createdAt: string;
  updatedAt: string;
}
```

### Design Tokens (`shared/styles/tdai-tokens.css`)

CSS custom properties for brand colors, neutrals, semantic colors, order status colors, typography, spacing, radius, and layout dimensions. Includes dark mode overrides via `prefers-color-scheme`.

### Tailwind Preset (`shared/tailwind.preset.js`)

Shared Tailwind configuration with:

- `tdai-teal`, `tdai-navy`, `tdai-red`, `tdai-gray` color scales (50–950)
- `brand.*` and `status.*` semantic color aliases
- Inter + JetBrains Mono font families
- Medical-grade font size scale (display → tiny)
- Custom shadows and border radius

### Integration Modules (`packages/reporting-app/integrations/`)


| File                    | Purpose                                                                    |
| ----------------------- | -------------------------------------------------------------------------- |
| `ohif-export-plugin.ts` | `sendViewportCapture(reportId, imageBlob)` → POST to report attachment API |
| `dicoogle-webhook.lua`  | Sample Lua: `onStudyIndexed` → POST to `/webhook/study`                    |


---

## 7. API Reference

### Base URLs


| Environment | Backend API                         | Frontend                             |
| ----------- | ----------------------------------- | ------------------------------------ |
| Local dev   | `http://localhost:8081`             | `http://localhost:5173`              |
| Docker      | `http://reporting-app-backend:8080` | `http://reporting-app-frontend:5173` |
| Production  | `https://tdairad.com/api`           | `https://tdairad.com`                |


### API Path Mapping


| Consumer              | Path                 | Backend Route        |
| --------------------- | -------------------- | -------------------- |
| Frontend (Vite proxy) | `/api/reports`       | `/reports`           |
| OHIF Viewer           | `/dicom-web/studies` | `/dicomweb/studies`  |
| Multi-tenant client   | `/api/v1/auth/login` | `/api/v1/auth/login` |
| Dicoogle webhook      | `/webhook/study`     | `/webhook/study`     |
| MONAI server          | `/v1/analyze-dicom`  | Direct to `:5000`    |
| MedASR server         | `/v1/transcribe`     | Direct to `:5001`    |


---

## 8. Authentication & Authorization

### Authentication Flows

**Single-Tenant (Session-based):**

1. **Google OAuth:** `/auth/google` → Google consent → `/auth/google/callback` → Passport session → redirect to frontend
2. **Firebase ID Token:** Firebase Auth client → `getIdToken()` → `POST /auth/firebase-login` → server verifies with Firebase Admin → session created
3. **Email/Password Registration:** Firebase `createUserWithEmailAndPassword` → `POST /auth/firebase-login` + `POST /auth/register-request` → admin approval required

**Multi-Tenant (JWT-based):**

1. `POST /api/v1/auth/login` with `{ email, password, tenantSlug }` → bcrypt verification → JWT access + refresh token pair
2. Access token (15min): includes `sub`, `tid`, `email`, `role`, `tslug`, `iss`, `exp`
3. Refresh token (7 days): stored as SHA-256 hash in Firestore

### Role-Based Access Control

**Roles:** `super_admin`, `admin`, `developer`, `radiologist`, `radiographer`, `billing`, `referring`, `receptionist`, `viewer`

**Permission Modules:** `worklist`, `reports`, `templates`, `patients`, `orders`, `scans`, `scheduling`, `billing`, `referring_physicians`, `ai`, `dicom`, `developer`, `admin`

**Permission Format:** `module:action` (e.g., `reports:create`, `worklist:view`, `ai:analyze`)

**Master Admins:** Emails in `MASTER_ADMIN_EMAILS` env var are auto-promoted to `super_admin` on login.

**Per-tenant permission overrides** supported via `setRolePermissions`.

---

## 9. Multi-Tenant Architecture

Controlled by `MULTI_TENANT_ENABLED` feature flag. When enabled:

### Isolation Layers

1. **Application Layer:** All queries include `tenant_id` parameter
2. **Database Layer:** PostgreSQL RLS policies enforce `tenant_id = current_setting('app.current_tenant_id')`
3. **Connection Layer:** `tenantQuery()` sets RLS variable before every query
4. **DICOM Layer:** Tenant-scoped storage paths (`TENANT_STORAGE_ROOT/{tenantSlug}/`), per-tenant DICOMweb proxy

### Data Flow

```
Modality → C-STORE → Dicoogle/Orthanc
  → Lua: CallingAET → tenant lookup
  → Accept + stamp tenant_id (or reject unknown AET)
  → OnStableStudy → POST /webhook/study { tenantSlug, studyId }
  → Backend upserts study in tenant-scoped store
```

### Key Components


| Component       | File                     | Purpose                                          |
| --------------- | ------------------------ | ------------------------------------------------ |
| JWT Service     | `jwtService.ts`          | Token generation/verification with tenant claims |
| Tenant Context  | `tenantContext.ts`       | JWT → tenant resolution middleware               |
| Tenant Guard    | `tenantGuard.ts`         | IDOR prevention, study access validation         |
| Tenant Store    | `tenantScopedStore.ts`   | Firestore per-tenant subcollections              |
| Tenant Auth     | `tenantAuth.ts`          | Login/register/refresh/logout routes             |
| Tenant Admin    | `tenantAdmin.ts`         | Platform + tenant admin routes                   |
| Tenant DICOMweb | `dicomwebMultiTenant.ts` | JWT-scoped DICOMweb proxy                        |
| API Gateway     | `apiGateway.ts`          | JWT tenant resolution, rate limiting             |


### Database Schema (PostgreSQL)

```
tenants
  ├── users (tenant_id FK)
  ├── patients (tenant_id FK)
  ├── studies (tenant_id FK)
  │     ├── reports (tenant_id + study_id FK)
  │     └── orders (tenant_id + study_id FK)
  ├── templates (tenant_id FK)
  ├── billing (tenant_id FK)
  ├── referring_physicians (tenant_id FK)
  ├── role_permissions (tenant_id FK)
  ├── tenant_dicom_config (tenant_id FK, 1:1)
  └── audit_logs (tenant_id FK)
```

See `MULTI_TENANT_ARCHITECTURE.md` for the complete migration plan, security checklist, and advanced features.

---

## 10. Database & Persistence

### Primary: Google Cloud Firestore

**Single-tenant mode** (`store.ts`):

- Top-level collections: `templates`, `reports`, `studies`, `users`, `patients`, `orders`, `scans`, `billing`, `referringPhysicians`, `rolePermissions`
- Append-only versioning for reports

**Multi-tenant mode** (`tenantScopedStore.ts`):

- `tenants_meta` collection for tenant metadata
- Per-tenant subcollections: `tenants/{tenantId}/users`, `tenants/{tenantId}/studies`, etc.
- Audit logs at `tenants/{tenantId}/audit_logs`

### PostgreSQL 16 (Multi-Tenant)

- Container: `postgres:16-alpine`, database `tdai_multitenant`
- Row-Level Security on all tenant tables
- Migrations in `packages/reporting-app/backend/migrations/`
- Named volume `pgdata` for persistence

### In-Memory Store (Dev/Test)

- `USE_INMEMORY_STORE=true` enables `InMemoryStoreService`
- No external dependencies; seeded with dev data via `seedDevData.ts`

### Object Storage

- **Google Cloud Storage** for report attachments (via `storageService.ts`)
- **Local filesystem** for DICOM files (`DICOOGLE_STORAGE_DIR`)
- **Tenant-scoped paths** when multi-tenant: `{TENANT_STORAGE_ROOT}/{tenantSlug}/`

---

## 11. DICOM Pipeline

### Upload Flow

```
Browser (DicomUpload component)
  → POST /dicom/upload (multipart, max 50 files × 500MB)
  → Multer disk storage → DICOOGLE_STORAGE_DIR
  → Parse DICOM headers (dicom-parser)
  → Optional tag rewrite (patient ID/name, new SOP/Study/Series UIDs)
  → Move to tenant path if multi-tenant
  → POST {DICOOGLE_BASE_URL}/management/tasks/index?uri=...
  → Clear DIM cache
  → Upsert Firestore study record
```

### Webhook Flow (Dicoogle → Backend)

```
Dicoogle receives DICOM via C-STORE
  → custom-webhook.lua fires onStore()
  → Extracts studyId, tenantSlug from storage path
  → POST /webhook/study { studyId, tenantSlug, metadata }
  → Backend creates draft report + updates worklist
```

### DICOMweb Proxy

The reporting backend proxies DICOMweb requests to Dicoogle, handling:

- QIDO-RS (study/series/instance search)
- WADO-RS (instance retrieval, frame-level pixel data)
- WADO-URI (legacy retrieve)
- DIM cache for performance
- Study availability validation
- Weasis deep link token authentication

### Alternative: Orthanc PACS (pacs-stack/)

A separate Docker Compose stack using Orthanc as the primary PACS:

- Orthanc with DICOMweb plugin (port 4242 DICOM, 8042 HTTP)
- Stock OHIF viewer with Orthanc + Dicoogle dual data sources
- Nginx proxy for SPA + DICOMweb routing
- Optional Dicoogle profile for parallel operation

---

## 12. AI Services

### MONAI Server (`:5000`)


| Model           | Modality | Output                                                                           |
| --------------- | -------- | -------------------------------------------------------------------------------- |
| Chest X-ray     | XR       | 14-class classification + GradCAM heatmap                                        |
| Lung Nodule     | CT       | Detection (Nodule, GGO, Solid, Calcified)                                        |
| Brain MRI       | MR       | Classification (Normal, Tumor, Hemorrhage, Ischemia, Edema, Atrophy)             |
| CT Segmentation | CT       | Organ segmentation (Liver, Spleen, Pancreas, Kidneys, Aorta)                     |
| Cardiac         | XR/CT    | Classification (Normal, Cardiomegaly, Pericardial Effusion, Valve Calcification) |
| MedGemma        | Any      | LLM-generated narrative report                                                   |


**Output artifacts:** DICOM Secondary Capture (heatmap overlay), GSPS (annotation), Structured Report (findings), base64-encoded in JSON response.

**LLM providers:** Google Gemini API, Vertex AI, Ollama (local). Configurable via `LLM_PROVIDER` env var and `/v1/configure` endpoint.

### MedASR Server (`:5001`)

- Google's MedASR model for medical speech recognition
- LLM correction pipeline (Gemini/Vertex/MedGemma)
- Structured radiology report output: `{ findings, impression, raw_input, corrections_applied }`

### Wav2Vec2 Server (`:5002`)

- Open-source alternative: Faster-Whisper (default) or Facebook Wav2Vec2
- Ollama-based LLM correction
- Same API surface as MedASR for drop-in replacement

### Frontend Integration

The `MonaiPanel` component provides:

- Model selection dropdown
- Cached results display per study
- One-click analysis trigger
- Permission-gated (`ai:analyze`, `ai:view_results`)

The `ReportEditor` and `RadiologistDashboard` integrate voice dictation via the transcription API.

---

## 13. Infrastructure & Deployment

### 13.1 Docker Compose Configuration (`docker-compose.yml`)

The platform services run inside a coordinated Docker environment:

| Service                  | Image / Build Context              | Host Port Mapping    | Depends On                        |
| ------------------------ | ---------------------------------- | -------------------- | --------------------------------- |
| `orthanc`                | `tdai-orthanc-custom:latest`       | `8042, 4242, 11115`  | —                                 |
| `dicoogle`               | Build `./packages/dicoogle-server` | `8080, 11112`        | —                                 |
| `ohif`                   | Build `./packages/ohif-viewer`     | `3000`               | dicoogle, backend, orthanc        |
| `monai-server`           | Build `./packages/monai-server`    | `5000`               | —                                 |
| `medasr-server`          | Build `./packages/medasr-server`   | `5001`               | —                                 |
| `reporting-app-backend`  | `node:20-alpine`                   | `8081`               | postgres, monai, medasr, orthanc  |
| `reporting-app-frontend` | `node:20-alpine`                   | `5173`               | backend                           |
| `postgres`               | `postgres:16-alpine`               | `5432`               | —                                 |

**Network:** `imaging-net` (bridge)  
**Volumes:** `pgdata` (PostgreSQL), `orthanc-storage` (Orthanc PACS DB), `dicoogle-storage` (Dicoogle storage bind mount).

### 13.2 Production Dockerfile (Root)

Two-stage build for the reporting API:

1. **Builder:** `node:20-slim`, installs deps, runs `turbo build --filter=medical-report-system-backend`
2. **Runtime:** `node:20-slim`, copies built artifacts, `PORT=8080`, `CMD node packages/reporting-app/backend/dist/server.js`

### 13.3 GCP VM Deployment (`deploy/`)


| Script                         | Purpose                                                                   |
| ------------------------------ | ------------------------------------------------------------------------- |
| `01-create-vm-and-firewall.sh` | Create GCP VM (`e2-standard-4`), reserve static IP, configure firewall    |
| `02-install-docker.sh`         | Install Docker + Compose plugin on VM                                     |
| `03-configure-env.sh`          | Generate `.env` files with random secrets                                 |
| `04-start-services.sh`         | Build + start Docker Compose, health checks                               |
| `05-setup-nginx.sh`            | Install nginx reverse proxy (`/` → 5173, `/api/` → 8081, `/ohif/` → 3000) |
| `06-auto-restart.sh`           | Enable Docker on boot, cron `@reboot`                                     |


### GCP Cloud Run Deployment (`deploy.sh`)

```bash
npm ci && turbo build
gcloud run deploy reporting-api --source ./packages/reporting-app/backend
gcloud run deploy ohif-viewer --source ./packages/ohif-viewer
gcloud run deploy dicoogle-server --source ./packages/dicoogle-server
```

### 13.4 Electron Desktop App Builder (`desktop-app/`)

For self-contained on-premise installations, the system is bundled into a desktop setup installer:

- **Packaging configuration (`package.json`):** Uses `electron-builder` to compile code. It references `extraResources` to bundle database migrations, Nginx reverse proxy configuration (`default.conf`), and Orthanc configuration parameters (`orthanc.json`, `worklist.py`) directly alongside the executable binary files.
- **Silent Service Manager (`main.js`):** Coordinates background daemon execution. On window launch, it silently ensures that the Docker service is active, cleans conflicting dev containers, and runs `docker compose up -d` internally before loading the presentation layer.
- **SSL Certificate Errors Override:** Globally overrides certificate warnings for local secure `https://localhost:5173` routing.
- **Tray Daemonization:** Binds the window `close` event to minimize to system tray, ensuring PACS storage indexing and background DICOM listeners remain operational.

---

## 14. Environment Variables

### Backend (`packages/reporting-app/backend/.env`)


| Variable                         | Required | Default       | Description                           |
| -------------------------------- | -------- | ------------- | ------------------------------------- |
| `APP_ENV_MODE`                   | No       | `local`       | Run mode (`local` or `docker`)        |
| `APP_ENV_FILE`                   | No       | —             | Explicit path to env file             |
| `NODE_ENV`                       | No       | `development` | Node environment                      |
| `PORT`                           | No       | `8080`        | Server listen port                    |
| `ENABLE_AUTH`                    | No       | `false`       | Enable authentication                 |
| `BACKEND_URL`                    | Yes      | —             | Public backend URL                    |
| `FRONTEND_URL`                   | Yes      | —             | Frontend origin for CORS/redirects    |
| `OHIF_BASE_URL`                  | Yes      | —             | OHIF internal URL                     |
| `OHIF_PUBLIC_BASE_URL`           | No       | —             | OHIF public URL                       |
| `CORS_ALLOWED_ORIGINS`           | Yes      | —             | Comma-separated allowed origins       |
| `CORS_ALLOW_ALL`                 | No       | `false`       | Allow all CORS origins                |
| `SESSION_SECRET`                 | Yes      | —             | Express session secret                |
| `MASTER_ADMIN_EMAILS`            | No       | —             | Comma-separated super admin emails    |
| `DEFAULT_DEV_ROLE`               | No       | —             | Default role when auth is disabled    |
| `GOOGLE_CLIENT_ID`               | No       | —             | Google OAuth client ID                |
| `GOOGLE_CLIENT_SECRET`           | No       | —             | Google OAuth client secret            |
| `FIREBASE_PROJECT_ID`            | No       | —             | Firebase project (token verification) |
| `GCP_PROJECT_ID`                 | No       | —             | Google Cloud project                  |
| `GCS_BUCKET`                     | No       | —             | GCS bucket for attachments            |
| `SENDGRID_API_KEY`               | No       | —             | SendGrid email API key                |
| `SENDGRID_FROM_EMAIL`            | No       | —             | SendGrid sender email                 |
| `DICOOGLE_BASE_URL`              | Yes      | —             | Dicoogle HTTP base URL                |
| `DICOOGLE_FALLBACK_BASE_URL`     | No       | —             | Fallback Dicoogle URL                 |
| `DICOOGLE_STORAGE_DIR`           | Yes      | —             | DICOM file storage path               |
| `DICOOGLE_INDEX_URI`             | No       | —             | Dicoogle indexing URI prefix          |
| `DICOOGLE_USERNAME`              | No       | —             | Dicoogle auth username                |
| `DICOOGLE_PASSWORD`              | No       | —             | Dicoogle auth password                |
| `TENANT_STORAGE_ROOT`            | No       | —             | Multi-tenant storage root             |
| `MONAI_SERVER_URL`               | No       | —             | MONAI server URL                      |
| `MONAI_ENABLED`                  | No       | `false`       | Enable MONAI integration              |
| `MEDASR_SERVER_URL`              | No       | —             | MedASR server URL                     |
| `MEDASR_ENABLED`                 | No       | `false`       | Enable MedASR integration             |
| `WAV2VEC2_SERVER_URL`            | No       | —             | Wav2Vec2 server URL                   |
| `WEASIS_BASE_URL`                | No       | —             | Weasis launcher URL                   |
| `GEMINI_API_KEY`                 | No       | —             | Google Gemini API key                 |
| `GEMINI_MODEL`                   | No       | —             | Gemini model name                     |
| `OLLAMA_URL`                     | No       | —             | Ollama server URL                     |
| `OLLAMA_MODEL`                   | No       | —             | Ollama model name                     |
| `JWT_SECRET`                     | Yes (MT) | —             | JWT signing secret (multi-tenant)     |
| `MULTI_TENANT_ENABLED`           | No       | `false`       | Enable multi-tenant mode              |
| `PLATFORM_ADMIN_KEY`             | No       | —             | Platform admin API key                |
| `WEBHOOK_SECRET`                 | No       | —             | Webhook verification secret           |
| `INTERNAL_SERVICE_SECRET`        | No       | —             | Inter-service auth secret             |
| `ORTHANC_BASE_URL`               | No       | —             | Orthanc PACS URL (alternative)        |
| `ORTHANC_AUTH`                   | No       | —             | Orthanc basic auth                    |
| `DATABASE_URL`                   | No       | —             | PostgreSQL connection string          |
| `USE_INMEMORY_STORE`             | No       | `false`       | Use in-memory store (dev)             |
| `HIPAA_AUDIT_ENABLED`            | No       | `true`        | Enable HIPAA PHI audit logging        |
| `HIPAA_AUDIT_RETENTION_DAYS`     | No       | `2190`        | Audit log retention (6 years default) |
| `HIPAA_SESSION_TIMEOUT_MINUTES`  | No       | `15`          | Session inactivity timeout (minutes)  |
| `HIPAA_MAX_FAILED_LOGINS`        | No       | `5`           | Failed login attempts before lockout  |
| `HIPAA_LOCKOUT_DURATION_MINUTES` | No       | `30`          | Account lockout duration (minutes)    |
| `HIPAA_REQUIRE_HTTPS`            | No       | `true`        | Enforce HTTPS in production           |
| `HIPAA_MIN_PASSWORD_LENGTH`      | No       | `12`          | Minimum password length               |


### Frontend (`packages/reporting-app/frontend/.env`)


| Variable                            | Description                            |
| ----------------------------------- | -------------------------------------- |
| `VITE_API_BASE_URL`                 | Backend API base URL                   |
| `VITE_BACKEND_PROXY_TARGET`         | Vite dev server proxy target           |
| `VITE_FIREBASE_API_KEY`             | Firebase Web API key                   |
| `VITE_FIREBASE_AUTH_DOMAIN`         | Firebase auth domain                   |
| `VITE_FIREBASE_PROJECT_ID`          | Firebase project ID                    |
| `VITE_FIREBASE_STORAGE_BUCKET`      | Firebase storage bucket                |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID           |
| `VITE_FIREBASE_APP_ID`              | Firebase app ID                        |
| `VITE_LOCAL_DICOOGLE_ZIP_URL`       | Local Dicoogle download URL (optional) |


### AI Services


| Variable                               | Service               | Description                    |
| -------------------------------------- | --------------------- | ------------------------------ |
| `MONAI_SERVER_PORT`                    | MONAI                 | Server port (default 5000)     |
| `LLM_PROVIDER`                         | MONAI/MedASR          | `gemini`, `ollama`, or `off`   |
| `GEMINI_API_KEY`                       | MONAI/MedASR          | Gemini API key                 |
| `VERTEX_AI_ENABLED`                    | MONAI/MedASR          | Use Vertex AI endpoint         |
| `GCP_PROJECT_ID` / `GCP_LOCATION`      | MONAI/MedASR          | Vertex AI project/region       |
| `MEDGEMMA_MODEL` / `MEDGEMMA_ENDPOINT` | MONAI/MedASR          | MedGemma configuration         |
| `OLLAMA_URL` / `OLLAMA_MODEL`          | MONAI/MedASR/Wav2Vec2 | Local Ollama endpoint          |
| `MEDASR_PORT`                          | MedASR                | Server port (default 5001)     |
| `MEDASR_MODEL`                         | MedASR                | HuggingFace model ID           |
| `WAV2VEC2_PORT`                        | Wav2Vec2              | Server port (default 5002)     |
| `ASR_BACKEND`                          | Wav2Vec2              | `faster-whisper` or `wav2vec2` |


---

## 15. Scripts & Tooling

### Root Scripts (`scripts/` and Root Directory)


| Script                      | Description                                                              |
| --------------------------- | ------------------------------------------------------------------------ |
| `build-client-package.bat`  | Builds local Docker images, saves them to `.tar`, packages the Electron setup, and assembles the `TDAI-RIS-PACS` distribution folder. |
| `dev-local.mjs`             | Hybrid dev: Dicoogle in Docker, backend + OHIF locally                   |
| `dev-local-parity.mjs`      | Docker-like ports: Dicoogle + OHIF in Docker, backend + frontend locally |
| `post_deploy_smoke.py`      | POST-deploy health check (backend, worklist-sync, webhook-connectivity)  |
| `generate_sample_dicoms.py` | Generate synthetic multi-modality DICOM files                            |
| `assign_split_dicoms.py`    | Split real DICOM series into synthetic patients                          |
| `setup-dicom-local.bat`     | Windows: install pydicom, generate DICOMs, index in Dicoogle             |
| `start-dicoogle-local.bat`  | Run Dicoogle locally from built distribution                             |
| `read_dicoms.py`            | Read and dump DICOM metadata                                             |
| `step1-restructure.sh`      | One-time monorepo migration helper                                       |


### npm Scripts (Root `package.json`)


| Command                    | Description                          |
| -------------------------- | ------------------------------------ |
| `npm run dev`              | Run all packages in parallel (turbo) |
| `npm run dev:local`        | Hybrid local development             |
| `npm run dev:local:parity` | Docker-parity local development      |
| `npm run dev:docker`       | Full Docker Compose stack            |
| `npm run build`            | Build all packages                   |
| `npm run test`             | Run all tests                        |
| `npm run lint`             | Lint all packages                    |


### Backend Scripts


| Command         | Description                 |
| --------------- | --------------------------- |
| `npm run dev`   | `ts-node-dev src/server.ts` |
| `npm run build` | `tsc`                       |
| `npm run start` | `node dist/server.js`       |
| `npm run test`  | `jest --runInBand`          |
| `npm run lint`  | `tsc --noEmit`              |


### Frontend Scripts


| Command            | Description                  |
| ------------------ | ---------------------------- |
| `npm run dev`      | `vite` (port 5173)           |
| `npm run build`    | `tsc --noEmit && vite build` |
| `npm run test`     | `vitest`                     |
| `npm run test:e2e` | Cypress E2E                  |
| `npm run lint`     | `tsc --noEmit`               |


---

## 16. Testing

### Backend Tests (`packages/reporting-app/backend/tests/`)


| Test File                                                 | Focus                                                |
| --------------------------------------------------------- | ---------------------------------------------------- |
| `exhaustive.test.ts`                                      | Large RBAC matrix, report workflows, route behaviors |
| `dicomUpload.multi-image.test.ts`                         | Multi-file DICOM upload, storage layout              |
| `thousand.test.ts`, `mega.test.ts`, `final-batch.test.ts` | Breadth/regression suites                            |
| `comprehensive.test.ts`, `bugs.test.ts`                   | Bug regression tests                                 |
| `inMemoryStore.test.ts`                                   | In-memory store operations                           |
| `transcription.route.test.ts`                             | Transcription route                                  |
| `templates.route.test.ts`                                 | Template CRUD                                        |
| `share.route.test.ts`                                     | Report sharing                                       |
| `webhook.route.test.ts`                                   | Webhook processing                                   |
| `reportService.test.ts`                                   | ReportService unit tests                             |


**Framework:** Jest + supertest + ts-jest

### Frontend Tests

- `TemplateEditor.test.tsx` — Vitest unit test
- Cypress E2E available via `npm run test:e2e`

### E2E Bot (`tests/e2e_bot.py`)

Selenium-based workflow automation for `tdairad.com`:

- Admin invites and user registration
- Radiographer DICOM upload and worklist polling
- Study assignment to radiologist
- Radiologist OHIF viewing + reporting + attachment
- Physician report access
- Edge cases (invalid login, filter validation)
- Outputs screenshots and JSON logs to `tests/artifacts/`

### Post-Deploy Smoke Test (`scripts/post_deploy_smoke.py`)

Validates after deployment:

1. `GET /health` — backend alive
2. `GET /health/worklist-sync` — Dicoogle integration
3. `GET /health/webhook-connectivity` — webhook pipeline

Outputs JSON report to `tests/artifacts/post_deploy_smoke.json`.

---

## 17. CI/CD Pipeline

### GitHub Actions (`.github/workflows/deploy.yml`)

**Trigger:** Push to `main` branch

**Steps:**

1. Checkout repository
2. Setup Node.js 20 with npm cache
3. `npm ci` (root)
4. `yarn install --frozen-lockfile` in `packages/ohif-viewer`
5. `npx turbo run build`
6. Authenticate with GCP via service account key
7. Deploy three services to **GCP Cloud Run**:
  - `reporting-api` ← `./packages/reporting-app/backend`
  - `ohif-viewer` ← `./packages/ohif-viewer`
  - `dicoogle-server` ← `./packages/dicoogle-server`
8. All services deployed with `--allow-unauthenticated`

### Turborepo Configuration (`turbo.json`)


| Task             | Dependencies | Cache | Outputs                                     |
| ---------------- | ------------ | ----- | ------------------------------------------- |
| `build`          | `^build`     | Yes   | `dist/`**, `build/`**, `.next/**`           |
| `dev`            | —            | No    | Persistent                                  |
| `lint`           | `^lint`      | Yes   | —                                           |
| `test`           | `^test`      | Yes   | `coverage/**`                               |
| `build:dicoogle` | —            | No    | `packages/dicoogle-server/bin/*.jar`        |
| `build:ohif`     | —            | No    | `packages/ohif-viewer/platform/app/dist/**` |


---

## 18. Design System

### Brand Colors


| Name    | Hex       | Usage                                   |
| ------- | --------- | --------------------------------------- |
| Teal    | `#00B4A6` | Primary buttons, active states, success |
| Navy    | `#1A2B56` | Navbar, headings, dark surfaces         |
| Red     | `#E03C31` | STAT priority, alerts, AI indicators    |
| Divider | `#808080` | Logo separator                          |


### Order Status Colors


| Status       | Color  | Hex       |
| ------------ | ------ | --------- |
| Ordered      | Gray   | `#6B7280` |
| Scheduled    | Blue   | `#3B82F6` |
| Checked In   | Cyan   | `#06B6D4` |
| In Progress  | Amber  | `#F59E0B` |
| Completed    | Teal   | `#00B4A6` |
| Pending Read | Red    | `#E03C31` |
| Preliminary  | Purple | `#8B5CF6` |
| Final        | Green  | `#10B981` |
| Addendum     | Navy   | `#1A2B56` |
| Cancelled    | Gray   | `#9CA3AF` |


### Typography


| Token         | Family         | Usage                         |
| ------------- | -------------- | ----------------------------- |
| `--font-sans` | Inter          | All UI text (400–700)         |
| `--font-mono` | JetBrains Mono | Accession numbers, UIDs, MRNs |


### Font Scale


| Name    | Size      | Weight | Line Height |
| ------- | --------- | ------ | ----------- |
| Display | 2.25rem   | 700    | 2.5rem      |
| H1      | 1.875rem  | 700    | 2.25rem     |
| H2      | 1.5rem    | 600    | 2rem        |
| H3      | 1.25rem   | 600    | 1.75rem     |
| H4      | 1rem      | 600    | 1.5rem      |
| Body    | 0.875rem  | 400    | 1.25rem     |
| Small   | 0.75rem   | 400    | 1rem        |
| Tiny    | 0.6875rem | 400    | 0.875rem    |


### Layout Tokens


| Token                 | Value |
| --------------------- | ----- |
| `--navbar-height`     | 56px  |
| `--sidebar-width`     | 260px |
| `--sidebar-collapsed` | 64px  |


---

## 19. Security & Compliance

### Transport

- TLS 1.2+ enforced on all public connections (via Nginx/Cloud Run)
- HSTS header with 1-year max-age, includeSubDomains, preload
- HTTP requests rejected with 403 in production (`HIPAA_REQUIRE_HTTPS`)
- Internal Docker network (`imaging-net`) for service-to-service

### Authentication

- Firebase JWT verification for session-based auth
- Short-lived access tokens (15 min) + refresh tokens (7 days)
- Refresh tokens stored as SHA-256 hashes
- bcrypt password hashing (cost factor 12)
- **Account lockout** after 5 failed login attempts (30 min lockout, configurable)
- **HIPAA password policy**: minimum 12 characters, uppercase, lowercase, number, special character
- Rate limiting per tenant (300/min) and global (300/15min in production)
- All login success, failure, logout, and session timeout events are audit-logged

### Authorization

- Role-based access control with 9 roles
- Module-level permissions (13 modules × create/view/edit/delete/sign/share)
- Per-tenant permission overrides
- Middleware chain: HTTPS Check → Security Headers → PHI Access Logger → JWT → Tenant Context → Role/Permission Check → Handler

### Session Management (HIPAA §164.312(a)(2)(iii))

- **Automatic logoff** after 15 minutes of inactivity (configurable via `HIPAA_SESSION_TIMEOUT_MINUTES`)
- Session cookie `maxAge` enforced at 15 minutes
- `httpOnly`, `secure`, `sameSite` flags on all session cookies
- Session timeout logged as audit event

### Data Isolation (Multi-Tenant)

- `tenant_id` column on every data table
- Every SQL query includes `WHERE tenant_id = $1`
- PostgreSQL RLS as defense-in-depth
- `tenantQuery()` sets RLS session variable per connection
- No cross-tenant joins possible

### IDOR Prevention

- `validateResourceOwnership()` verifies resource belongs to requesting tenant
- `validateStudyAccess()` checks Study UID against tenant's studies
- `injectTenantId()` overrides client-supplied tenant_id
- URL tenant slug matched against JWT tenant

### DICOM Security

- C-STORE filtered by CallingAET → tenant mapping
- Unknown AE Titles rejected at PACS level
- Study metadata tagged with tenant_id on ingestion
- DICOMweb proxy validates study ownership before serving

### Infrastructure Security

- Helmet security headers (HSTS, X-Content-Type-Options, X-Frame-Options, X-XSS-Protection)
- Content-Security-Policy restricting script/style/image sources
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: camera=(), geolocation=() restricted
- Cache-Control: no-store, no-cache, must-revalidate, private (prevents PHI caching)
- **CORS wildcard automatically blocked in production** even if `CORS_ALLOW_ALL=true` is misconfigured
- Request rate limiting (global + per-tenant)
- Secrets via environment variables (never in code)
- X-Powered-By header removed

### Error Handling (PHI Protection)

- Production error responses sanitized to prevent PHI leakage
- SSN, MRN, patient name, and date patterns scrubbed from error messages
- Error IDs assigned for tracing without exposing internal details
- Stack traces only included in non-production environments
- Generic safe error messages returned for 5xx errors in production

---

## 20. HIPAA Compliance

The platform implements comprehensive HIPAA (Health Insurance Portability and Accountability Act) Security Rule compliance. Full details in `[HIPAA_COMPLIANCE.md](../HIPAA_COMPLIANCE.md)`.

### HIPAA Security Rule Mapping


| HIPAA Requirement            | Section             | Implementation                                                                                               |
| ---------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Unique User Identification   | §164.312(a)(2)(i)   | Firebase UID / UUID on all actions, `userId` tracked in every audit entry                                    |
| Emergency Access Procedure   | §164.312(a)(2)(ii)  | Break-glass access via `/hipaa/emergency-access` with time-limited grants, reason tracking, admin revocation |
| Automatic Logoff             | §164.312(a)(2)(iii) | 15-minute session inactivity timeout in `auth.ts` middleware, cookie `maxAge` enforcement                    |
| Encryption & Decryption      | §164.312(a)(2)(iv)  | TLS in transit (HTTPS enforced), Firebase/GCP managed encryption at rest                                     |
| Audit Controls               | §164.312(b)         | SHA-256 hash-chained immutable audit log in Firestore (`hipaa_audit_log`), automatic PHI route detection     |
| Integrity Controls           | §164.312(c)(1)      | Report versioning with `versions[]` array, audit log integrity verification endpoint                         |
| Person/Entity Authentication | §164.312(d)         | Firebase Auth (MFA capable), account lockout, HIPAA password policy                                          |
| Transmission Security        | §164.312(e)(1)      | HTTPS enforced, HSTS, secure cookies, wildcard CORS blocked in production                                    |


### PHI Data Inventory

All access to the following data categories is automatically audit-logged:


| Category             | Route Pattern             | Firestore Collection  | PHI Fields                                                   |
| -------------------- | ------------------------- | --------------------- | ------------------------------------------------------------ |
| Patients             | `/patients/`*             | `patients`            | MRN, name, DOB, gender, phone, email, address                |
| Reports              | `/reports/*`              | `reports`             | Clinical content, findings, signed status, voice transcripts |
| Studies              | `/worklist/*`             | `studies`             | Patient name, study date, modality, DICOM metadata           |
| Orders               | `/orders/*`               | `orders`              | Patient ID/name, clinical history, body part                 |
| Scans                | `/scans/*`                | `scans`               | Patient ID/name, findings, body part                         |
| Billing              | `/billing/*`              | `billing`             | Patient ID/name, amount, invoice                             |
| DICOM                | `/dicomweb/*`, `/wado/*`  | —                     | Full DICOM objects with all patient identifiers              |
| Transcripts          | `/transcribe/*`           | —                     | Voice recordings and clinical transcriptions                 |
| Referring Physicians | `/referring-physicians/*` | `referringPhysicians` | Name, phone, email, hospital                                 |


### Audit Log Architecture

Every audit entry contains:

- **Identity**: `userId`, `userEmail`, `userRole`, `ipAddress`, `userAgent`
- **Action**: One of 30+ action types (`PHI_ACCESS`, `PHI_CREATE`, `PHI_UPDATE`, `PHI_DELETE`, `LOGIN_SUCCESS`, `LOGIN_FAILURE`, `EMERGENCY_ACCESS`, etc.)
- **Resource**: `resourceType` (patient, report, study, etc.), `resourceId`
- **Context**: `httpMethod`, `httpPath`, `httpStatus`, `tenantId`, `timestamp`
- **Integrity**: SHA-256 `integrityHash` chained to `previousEntryHash` (tamper detection)
- **Severity**: `info`, `warning`, or `critical`

Audit logs are retained for **6 years** (2,190 days) per HIPAA §164.530(j)(2).

### Emergency Access (Break-Glass)

For urgent clinical situations requiring immediate PHI access outside normal role permissions:

1. Authenticated user submits `POST /hipaa/emergency-access` with reason (min 10 chars) and patient ID
2. Time-limited access granted (default 60 min, max 8 hours)
3. Critical-severity audit entry recorded
4. Admin can revoke via `POST /hipaa/emergency-access/revoke`
5. All emergency access visible on compliance dashboard

### Compliance Dashboard

`GET /hipaa/compliance-status` returns real-time compliance overview:

- Audit logging status and recent activity
- Critical events in last 24 hours
- Active emergency access grants
- Audit log integrity verification (last 7 days)
- Encryption and access control configuration summary

### HIPAA Configuration


| Variable                         | Default | Description                      |
| -------------------------------- | ------- | -------------------------------- |
| `HIPAA_AUDIT_ENABLED`            | `true`  | Enable/disable PHI audit logging |
| `HIPAA_AUDIT_RETENTION_DAYS`     | `2190`  | Audit log retention (6 years)    |
| `HIPAA_SESSION_TIMEOUT_MINUTES`  | `15`    | Auto-logoff after inactivity     |
| `HIPAA_MAX_FAILED_LOGINS`        | `5`     | Lock account after N failures    |
| `HIPAA_LOCKOUT_DURATION_MINUTES` | `30`    | Account lockout duration         |
| `HIPAA_REQUIRE_HTTPS`            | `true`  | Enforce TLS in production        |
| `HIPAA_MIN_PASSWORD_LENGTH`      | `12`    | Minimum password length          |


### New Files for HIPAA


| File                            | Purpose                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `config/hipaaConfig.ts`         | Central HIPAA configuration (session timeout, password policy, PHI route patterns, audit settings) |
| `services/hipaaAuditService.ts` | Immutable audit log with SHA-256 hash chain, emergency access, integrity verification              |
| `middleware/hipaaMiddleware.ts` | PHI access logger, session timeout, account lockout, HTTPS enforcement, password validation        |
| `routes/hipaa.ts`               | Admin endpoints for audit log queries, emergency access, compliance dashboard                      |
| `HIPAA_COMPLIANCE.md`           | Full compliance documentation with deployment checklist and incident response procedures           |


---

## Prerequisites

- **Node.js** 20+
- **npm** 10+
- **Docker** + Docker Compose
- **Java** 11+ (for local Dicoogle workflows)
- **Python** 3.11+ (for AI services and tooling scripts)

## Quick Start

```bash
# Clone and install
cd tdai
cp .env.example .env
npm install

# Local development (hybrid)
npm run dev:local

# Full Docker stack
npm run dev:docker

# Build all packages
npm run build

# Run tests
npm run test
```

## Local Development URLs


| Service       | URL                                            |
| ------------- | ---------------------------------------------- |
| Frontend      | [http://localhost:5173](http://localhost:5173) |
| Backend API   | [http://localhost:8081](http://localhost:8081) |
| OHIF Viewer   | [http://localhost:3000](http://localhost:3000) |
| Dicoogle      | [http://localhost:8080](http://localhost:8080) |
| MONAI Server  | [http://localhost:5000](http://localhost:5000) |
| MedASR Server | [http://localhost:5001](http://localhost:5001) |


---

*TD|ai — Traditional Diagnostics powered by Artificial Intelligence*  
*Trivitron Digital*

---

## Smart Patient Intake System (Added: 9 July 2026)

### Overview

The Smart Patient Intake is an AI-powered DICOM tag generator built for the Radiographer Workstation.
A radiographer types (or speaks) a free-text complaint, and the system automatically fills all DICOM tags in ~5 seconds.

### Architecture

```
Radiographer types: "right knee pain after fall"
           ↓
Frontend: SmartIntake.tsx (modal, 4 screens)
           ↓
Backend Proxy: POST /intake/analyze  (intake.ts)
           ↓
AI Service: IntakeAIService (intake_service.py in medasr-server)
           ↓  tries AI first
BioMistral 7B via Ollama → returns JSON DICOM tags
           ↓  fallback if AI unavailable
RuleBasedIntake (keyword matching, covers 80% of cases)
           ↓
Result: body_part_examined, laterality, view_positions, ICD-10, urgency
           ↓
Confirm → Creates/Updates RadiologyOrder in Firestore
```

### AI Engine Configuration

| Env Variable | Default | Description |
|---|---|---|
| `INTAKE_AI_ENGINE` | `ollama` | `ollama`, `kompact_ai`, or `rule_based` |
| `INTAKE_AI_MODEL` | `biomistral:7b` | Any model compatible with Ollama |
| `INTAKE_AI_URL` | `http://localhost:11434` | Ollama or Kompact AI base URL |

**Phase 1** (now): BioMistral 7B via Ollama  
**Phase 2** (Kompact AI arrives): Change `INTAKE_AI_ENGINE=kompact_ai` and `INTAKE_AI_URL` — zero code changes.

### API Endpoint

```
POST /intake/analyze
Body: { complaint, patient_age?, patient_sex?, laterality_answer? }
Returns: {
  body_part_examined, laterality, study_description,
  view_positions, series_descriptions, reason_for_exam,
  icd10_codes, urgency, follow_up_needed, follow_up_question,
  source ("ai" | "rule_based")
}
```

### Frontend UX (SmartIntake.tsx)

| Screen | Description |
|---|---|
| Screen 1 | Input: name, age, sex, complaint text + 🎤 voice button |
| Screen 2 | AI Results: body part, views, ICD-10, urgency badge |
| Follow-up | If laterality missing: `[LEFT]` `[RIGHT]` `[BOTH SIDES]` buttons |
| Screen 3 | Edit mode: override any field (body part dropdown, add/remove views) |
| STAT banner | Red banner if urgency = stat |
| Screen 4 | Done: "Study Created/Updated. Device worklist updated." |

### Voice Pipeline Integration

```
Radiographer speaks (5s) → MedASR transcribes (2s) → BioMistral analyzes (2s)
→ All DICOM tags filled → 1-click confirm
Total: ~10 seconds from speech to study created
```

### Files Added

| File | Purpose |
|---|---|
| `packages/medasr-server/intake_service.py` | Python AI + rule-based fallback + FastAPI router |
| `packages/reporting-app/backend/src/routes/intake.ts` | Node.js proxy → medasr-server |
| `packages/reporting-app/frontend/src/components/SmartIntake.tsx` | Full modal UI component |
| `packages/reporting-app/backend/src/app.ts` | Registered `/intake` route |
| `packages/reporting-app/frontend/src/components/RadiographerWorkstation.tsx` | Added `⚡ Smart Intake` toolbar button + per-row `⚡ Intake` button |

### Buttons Added to Radiographer Workstation

- **Toolbar**: `⚡ Smart Intake` — opens intake for a new walk-in patient  
- **Per-row**: `⚡ Intake` — opens intake pre-filled with that patient's data, updates their existing order

### Dual Mode (Option C)

- **Walk-in**: no pre-selected row → creates brand-new `RadiologyOrder` via `POST /orders`  
- **Existing order**: row selected → updates via `PATCH /orders/:id` + `PATCH /worklist/:id/fields` with full triage metadata