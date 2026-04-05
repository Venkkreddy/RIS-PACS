# TD|ai — Complete Architecture Documentation

## Medical Imaging Platform with Integrated RIS + Dicoogle PACS

---

## 1. Brand Identity

### Logo Elements

| Element | Color | Hex | Meaning |
|---------|-------|-----|---------|
| **T** | Teal | `#00B4A6` | Trust, clarity, medical precision |
| **D** | Navy | `#1A2B56` | Depth, stability, intelligence |
| **\|** | Gray | `#808080` | Bridge between human expertise and AI |
| **ai** | Red | `#E03C31` | Urgency, innovation, AI-powered diagnostics |

> **TD|ai** = **Traditional Diagnostics** powered by **Artificial Intelligence**

### Color System

**Brand Primary:**
- Teal `#00B4A6` — Primary buttons, active states, links, success actions
- Navy `#1A2B56` — Navbar, headings, dark surfaces
- Red `#E03C31` — STAT priority, alerts, AI indicators

**Neutrals:**
- Background `#F8FAFC` | Surface `#FFFFFF` | Border `#E2E8F0`
- Text `#1E293B` | Muted `#64748B` | Light `#94A3B8`

**Order Status Colors:**
- ORDERED `#6B7280` | SCHEDULED `#3B82F6` | CHECKED_IN `#06B6D4`
- IN_PROGRESS `#F59E0B` | COMPLETED `#00B4A6` | PENDING_READ `#E03C31`
- PRELIMINARY `#8B5CF6` | FINAL `#10B981` | ADDENDUM `#1A2B56` | CANCELLED `#9CA3AF`

### Typography
- **Primary:** Inter (400–700) — Medical-grade clarity, tabular numbers
- **Monospace:** JetBrains Mono — Accession numbers, DICOM UIDs, MRNs
- **Body default:** 14px (radiology UIs are data-dense)

---

## 2. Executive Summary

TD|ai is a **cloud-native, RIS-first radiology platform** that unifies:

| Module | Description |
|--------|-------------|
| **RIS Core** | Patient registry, order lifecycle, scheduling, workflow orchestration |
| **Dicoogle PACS** | DICOM image storage, indexing, DICOMweb retrieval, webhooks |
| **OHIF Viewer** | Zero-footprint web DICOM viewer with custom TD|ai extensions |
| **Reporting Engine** | Structured reports, templates, voice dictation, PDF generation |
| **MONAI AI** | AI-powered medical image analysis via Project MONAI inference |
| **Analytics** | TAT, volume, productivity, and SLA dashboards |
| **Billing** | CPT/ICD coding, charge capture, revenue tracking |
| **HL7 Bridge** | HL7 v2.x MLLP inbound/outbound for EMR interoperability |
| **FHIR Server** | FHIR R4 RESTful API facade for modern integrations |

**Core Principle:** The RIS is the brain. Everything flows through it.

---

## 3. Architecture Overview

```
┌─────────────────────── EXTERNAL SYSTEMS ─────────────────────┐
│  Hospital EMR/HIS       Referring Portals       Modalities   │
└──────┬──────────────────────┬────────────────────────┬──────┘
       │ HL7/FHIR             │ REST API               │ DICOM
       ▼                      ▼                        ▼
┌─────────────────────────────────────────────────────────────┐
│         API GATEWAY (Nginx — TLS, routing, CORS)            │
└───┬──────────┬──────────┬──────────┬──────────┬─────────────┘
    │          │          │          │          │
┌───▼──┐ ┌───▼────┐ ┌──▼──────┐ ┌▼────┐ ┌──▼──────┐
│ RIS  │ │Report. │ │Dicoogle │ │OHIF │ │  Web   │
│ Core │ │Engine  │ │ PACS    │ │View │ │  App   │
│:8082 │ │:8081   │ │:8080    │ │:3000│ │ :3001  │
└──┬───┘ └──┬─────┘ └──┬─────┘ └──┬──┘ └──┬─────┘
   └────────┴──────────┬┴──────────┴───────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              EVENT BUS (Redis 7 + BullMQ)                │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                    DATA LAYER                             │
│  PostgreSQL 16  │  Dicoogle Store  │  Redis  │  S3/GCS  │
└──────────────────────────────────────────────────────────┘
```

---

## 4. Service Architecture

| Service | Tech | Port(s) | Responsibility |
|---------|------|---------|----------------|
| ris-core | Node/Express/Prisma | 8082 | Patient, orders, schedule, worklist, analytics, billing, audit, admin |
| monai-server | Python/PyTorch/MONAI | 5000 | AI inference, image segmentation, anomaly detection, findings generation |
| dicoogle-server | Java | 8080 + 104 | DICOM SCP, DICOMweb, image indexing, webhooks |
| dicom-mwl | Node/dcmjs | 4242 | DICOM MWL C-FIND SCP from RIS data |
| reporting-engine | Node/Express | 8081 | Templates, draft/sign/addendum, PDF |
| ohif-viewer | React/OHIF 3 | 3000 | Zero-footprint DICOM viewer + TD|ai reporting panel |
| web-app | React/Vite/Tailwind | 3001 | Unified frontend for all modules |
| hl7-bridge | Node | 2575 | HL7 v2.x MLLP listener, ADT/ORM/ORU |
| fhir-server | Node/Express | 8083 | FHIR R4 facade: Patient, ServiceRequest, ImagingStudy, DiagnosticReport |
| PostgreSQL | PG 16 | 5432 | RIS database |
| Redis | Redis 7 | 6379 | Event bus, session cache, real-time updates |

---

## 5. Data Architecture

### Entity Relationships

```
Patient (1:N) → Order (1:1) → Schedule
                  │
        ┌─────────┼─────────┐
        │ 1:N     │ 1:1     │ 1:N
        ▼         ▼         ▼
      Study     Report   BillingEntry

Cross-cutting: User, AuditLog, Facility
```

### Order State Machine

```
ORDERED → SCHEDULED → CHECKED_IN → IN_PROGRESS
  → COMPLETED (Dicoogle webhook) → PENDING_READ
  → PRELIMINARY → FINAL → ADDENDUM / CANCELLED

Every transition: validated → logged → event emitted → color-coded in UI
```

---

## 6. Dicoogle PACS Integration

### Data Flow

1. **Inbound:** Modality → DICOM C-STORE → Dicoogle stores + indexes → Webhook → RIS Core
2. **Viewing:** Radiologist → OHIF → DICOMweb (QIDO/WADO) → Dicoogle
3. **MWL:** Modality → C-FIND → Dicoogle MWL Plugin → RIS API → Scheduled orders

### Configuration
- AE Title: `TDAI_PACS`
- DICOMweb base: `/dicom-web` (WADO-RS, STOW-RS, QIDO-RS)
- Webhook: POST to RIS on `STUDY_ARRIVED`
- MWL: REST-backed from RIS scheduled orders

---

## 7. API Design

```
BASE: /api/v1

Health:     GET /health, /health/db, /health/redis, /health/dicoogle
AI:         GET /ai/models | POST /ai/analyze | GET /ai/results/:studyId
Auth:       POST /auth/login, /auth/register | GET /auth/me
Patients:   CRUD /patients, /patients/:id, /patients/merge, /patients/:id/timeline
Orders:     CRUD /orders, PATCH /orders/:id/status, POST /orders/:id/assign
Scheduling: CRUD /schedules, GET /schedules/calendar, /schedules/availability
Worklist:   GET /worklist, /worklist/mine | PATCH /worklist/:orderId/claim
MWL:        GET /mwl (Dicoogle integration)
Reports:    CRUD /reports, POST /reports/:id/sign, GET /reports/:id/pdf
Billing:    CRUD /billing, GET /billing/summary
Analytics:  GET /analytics/tat, /analytics/volume, /analytics/productivity
Webhooks:   POST /webhooks/study-arrived
FHIR:       GET /fhir/Patient, /fhir/ServiceRequest, /fhir/ImagingStudy
Admin:      GET /admin/users, PATCH /admin/users/:id/approve, GET /admin/audit-log
```

---

## 8. Security & Compliance

| Layer | Implementation |
|-------|---------------|
| Transport | TLS 1.3 on all connections |
| Auth | Firebase JWT + admin approval gate |
| RBAC | Admin, Radiologist, Technologist, Referring, Billing |
| Audit | Immutable append-only log, every mutation |
| Data | Encryption at rest, no PHI in logs |
| Network | Private mesh, only Gateway + Web App public |
| Dicoogle | Admin UI not public, webhook secret validation, CORS restricted |

---

## 9. Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 + TypeScript |
| API | Express.js |
| Database | PostgreSQL 16 + Prisma |
| Cache/Queue | Redis 7 + BullMQ |
| Auth | Firebase Auth |
| AI Engine | Project MONAI (PyTorch) |
| PACS | Dicoogle |
| Viewer | OHIF 3.x |
| Frontend | React 18 + Vite + Tailwind |
| Monorepo | Turborepo |
| CI/CD | GitHub Actions |
| Hosting | Fly.io |

---

## 10. Implementation Roadmap

| Phase | Weeks | Focus |
|-------|-------|-------|
| 1 — Foundation | 1–6 | Monorepo, DB schema, RIS Core API, Auth, Web App login/patients/orders, Dicoogle PACS |
| 2 — Core Workflow | 7–12 | Scheduling, MWL, study-arrival webhook, worklist, OHIF integration |
| 3 — Reporting | 13–16 | Reporting engine, OHIF extension, PDF, TAT calculation |
| 4 — Interoperability | 17–22 | HL7 Bridge, FHIR Server, EMR testing |
| 5 — Analytics & Billing | 23–26 | Dashboards, CPT/ICD coding, charge capture |
| 6 — Production | 27–30 | Fly.io deploy, API gateway, E2E tests, HIPAA audit |
