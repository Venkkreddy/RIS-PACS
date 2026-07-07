# RIS/PACS "Missing Feature" Audit

Codebase audited: `packages/reporting-app` (main app: frontend + backend), plus adjacent services (`medasr-server`, `wav2vec2-server`, `monai-server`, `dicoogle-server`, `ohif-viewer`).

## Architecture caveat — read this before trusting the DATABASE column below

The repo contains two unrelated data layers, and only one of them is actually live:

- **`backend/migrations/001_multi_tenant_schema.sql`** defines a full Postgres schema (`tenants`, `users`, `patients`, `studies`, `reports`, `templates`, `orders`, `billing`, `referring_physicians`, `audit_logs`, etc.) and `backend/src/db/postgres.ts` sets up a `pg.Pool` for it. **Nothing imports `postgres.ts`.** Zero routes, zero services. This schema is dead code — it's not what runs in production.
- The app that actually runs is backed by **Firestore**, through two separate access layers: `StoreService` (`backend/src/services/store.ts`, falls back to an in-memory store for local dev) backs most role dashboards — admin, reports, billing, patients, orders, scans, templates. A second, newer layer, `TenantScopedStore` (`tenantScopedStore.ts`), backs the multi-tenant platform routes (tenant onboarding, tenant auth, worklist, webhooks, DICOM upload).
- There are also **two separate audit-logging mechanisms** in the live system: one inside `TenantScopedStore` (platform-level actions: tenant created, admin added) and one in `HipaaAuditService` (PHI access logging with a SHA-256 integrity chain). Neither is exposed in a single unified UI.

So below, "DATABASE" means *the field exists in the live TypeScript/Firestore data model* (`shared/src/types.ts`, `store.ts` interfaces), not a SQL column — unless I say "SQL schema only (unused)."

## How to read the table

- **EXISTS_WORKING** — backend + data model are functional end-to-end; only frontend display/wiring is missing.
- **EXISTS_PARTIAL** — real code exists (frontend, backend, or data model) but meaningful backend/data work remains, not just a UI tweak.
- **COMPLETELY_MISSING** — nothing relevant found anywhere in the repo.

---

## SUPER ADMIN

| # | Feature | Status | Frontend | Backend | Data model | Effort |
|---|---|---|---|---|---|---|
| 1 | Multi-hospital analytics | EXISTS_PARTIAL | `frontend/src/components/SuperAdminPortal.tsx` (renders tenant-count metric cards) | `backend/src/routes/tenantAdminPlatform.ts` → `GET /v1/platform/monitoring/overview` | `tenants`, `audit_logs` (Firestore, via `TenantScopedStore`) | LOW |
| 2 | License/subscription management | COMPLETELY_MISSING | none | none | `tenants` has `maxUsers`/`maxStorageGb` only — no license/plan/renewal fields | HIGH |
| 3 | Hospital onboarding workflow | EXISTS_WORKING | `SuperAdminPortal.tsx` — full create-tenant + create-admin form | `tenantAdminPlatform.ts` → `POST /v1/platform/tenants`, `POST /v1/platform/tenants/:id/admins` | `tenants`, `users`, `tenant_dicom_config` (Firestore) | LOW |
| 4 | Centralized audit dashboard | EXISTS_WORKING | `AdminDashboard.tsx` has an "audit" tab referenced but no viewer built out | `tenantAdminPlatform.ts` → `GET /admin/audit-logs`, plus separately `hipaa.ts` → `GET /hipaa/audit-log` with integrity check | `audit_logs` (Firestore, two separate stores — see caveat) | LOW |

**Notes:** #3 actually works end-to-end already — if it's showing as "missing," it's a discoverability/navigation problem, not a build problem. #4's backend is solid (two real audit log sources with full query support); it just has no frontend page pulling either one together.

---

## ADMIN

| # | Feature | Status | Frontend | Backend | Data model | Effort |
|---|---|---|---|---|---|---|
| 5 | Department-wise analytics | EXISTS_PARTIAL | `AdminDashboard.tsx` — "Uploads by Center" chart | `routes/admin.ts` → `/analytics` groups studies by a generic `location` string | `studies.location` (free-text, not a real department entity) | LOW–MEDIUM |
| 6 | Staff productivity metrics | EXISTS_PARTIAL | `AdminDashboard.tsx` — "Assigned Studies by Radiologist" pie chart | `admin.ts` computes live `assignedCount` only, no completion/throughput history | `studies.assignedTo` | MEDIUM |
| 7 | Escalation management | COMPLETELY_MISSING | none | none — no `/escalate` endpoint anywhere | no `escalatedTo`/`escalationStatus` field; `priority` exists but isn't wired to any escalation action | HIGH |
| 8 | TAT monitoring dashboard | EXISTS_WORKING | `AdminDashboard.tsx` — "Pending Reports" and "Longest TAT" KPIs | `admin.ts` computes `currentTatHours`/`longestTat` live | `studies.tatHours`, `assignedAt`, `reportedAt` | LOW |

**Notes:** #5 and #6 are real, working proxies (location stands in for department; assignment count stands in for productivity) — true versions need a new field/entity, which is backend work, not UI. #8's basic version genuinely works today; a trend chart or per-radiologist breakdown would be additive (see #18, #44).

---

## DEVELOPER

| # | Feature | Status | Frontend | Backend | Data model | Effort |
|---|---|---|---|---|---|---|
| 9 | Application logs viewer | COMPLETELY_MISSING | none | Winston logger (`services/logger.ts`) writes to stdout only — no query endpoint, no persistence | none | HIGH |
| 10 | Error monitoring | COMPLETELY_MISSING | none | `errorHandler` middleware catches/responds to errors but doesn't aggregate or track them (no Sentry, etc.) | none | HIGH |
| 11 | API monitoring | EXISTS_PARTIAL | none | `services.ts` → `/services/health` reports latency, but only for MONAI/Ollama, not the app's own API; a `requestLogger` middleware exists but logs aren't aggregated | none | MEDIUM |
| 12 | Service uptime dashboard | EXISTS_PARTIAL | `ServiceTogglePanel.tsx` (config UI only, no uptime history) | `health.ts` has real, working point-in-time checks (`/health`, `/ohif`, `/worklist-sync`, `/webhook-connectivity`) | none — no history stored anywhere | MEDIUM |
| 13 | Database monitoring | COMPLETELY_MISSING | none | none (only a Docker `pg_isready` healthcheck, which is infra-level, not app-level — and ironically checks Postgres, which isn't even the live datastore) | none | HIGH |

**Notes:** Across the board, the developer-facing observability features are the weakest part of the system — there's basic logging/health-check *infrastructure* but nothing that surfaces it as a dashboard or queryable history.

---

## RADIOLOGIST

| # | Feature | Status | Frontend | Backend | Data model | Effort |
|---|---|---|---|---|---|---|
| 14 | Voice dictation (MedASR) | EXISTS_PARTIAL | none — no mic/dictation control in `ReportEditor.tsx` or `TipTapEditor.tsx` | `packages/medasr-server` is a fully working standalone FastAPI service (`/v1/transcribe`, `/v1/correct`) but **zero** route in `reporting-app/backend` calls it | n/a (stateless transcription) | MEDIUM |
| 15 | Critical findings alerts | EXISTS_PARTIAL | `ReportEditor.tsx` — priority dropdown with red "critical" styling | `reports.ts` accepts `priority: "critical"` | `reports.priority` | MEDIUM |
| 16 | Peer review workflow | COMPLETELY_MISSING | `AddendumModal.tsx` only supports the *original* author correcting their own signed report | none — no `/review` or cosign endpoint | `reports` has `signedBy`/`signedAt`, no `reviewedBy` | HIGH |
| 17 | Structured reporting | EXISTS_PARTIAL | `TemplateEditor.tsx` / `ReportEditor.tsx` use named sections (clinical history, findings, impression, etc.) | `templates.ts`, `radiologyTemplates.ts` define section structure | `templates.sections`, `reports.sections` | MEDIUM |
| 18 | TAT tracking per radiologist | EXISTS_PARTIAL | none — `AdminDashboard.tsx` shows assignment counts, not per-user TAT | no per-radiologist TAT query exists; data exists, aggregation doesn't | `studies.assignedTo` + `tatHours` (data already captured) | LOW |

**Notes:** #14 is the one genuinely surprising finding — MedASR is real, deployed, and functional, but completely disconnected from the report editor. Wiring it up is mostly a backend proxy route + a UI button, not a rebuild. #15 has the field and the styling but no actual alert ever fires anywhere (no email/push/SMS). #17 is "structured" only in the sense of named sections — the content inside each section is still free-text rich text, not discrete coded fields; true structured reporting (checkboxes, dropdowns, measurements) doesn't exist (same gap as #48).

---

## RADIOGRAPHER

| # | Feature | Status | Frontend | Backend | Data model | Effort |
|---|---|---|---|---|---|---|
| 19 | Modality assignment | EXISTS_WORKING | `TechDashboard.tsx`, `SchedulePage.tsx` display modality | `orders.ts`/`scans.ts` validate a modality enum | `orders.modality`, `studies.modality`, `templates.modality` | LOW |
| 20 | Equipment status | COMPLETELY_MISSING | none | none | none — no equipment/machine entity anywhere | HIGH |
| 21 | Repeat scan tracking | COMPLETELY_MISSING | none | none | none — no repeat/retake field | HIGH |
| 22 | Study priority STAT/Urgent display | EXISTS_WORKING | `Worklist.tsx` / `TechDashboard.tsx` do **not** render a priority badge/column at all | `orders.ts` fully validates and stores `priority` incl. `"stat"` | `orders.priority` | LOW |
| 23 | Quality check indicators | COMPLETELY_MISSING | none | none | none — no QC pass/fail/sign-off field | HIGH |
| 24 | Room assignment | EXISTS_PARTIAL | `Worklist.tsx` displays/filters a `location` field (sourced from DICOM metadata — "uploading location," not an assignable room) | none for actually *assigning* a room | `studies.location` (read-only metadata); `orders` has no location/room field at all | MEDIUM |

**Notes:** #22 is the cleanest "exists, just needs UI" case in this entire audit — priority is fully validated and stored server-side, the worklist simply never displays it. #20/#21/#23 are real, total gaps — not even a stub field exists. #24's "location" is a display of where a study was uploaded from (DICOM metadata), which is a different thing from a receptionist/tech actively assigning a patient to a room — that workflow doesn't exist.

---

## RECEPTIONIST

| # | Feature | Status | Frontend | Backend | Data model | Effort |
|---|---|---|---|---|---|---|
| 25 | Insurance details | COMPLETELY_MISSING | none | none — `patients.ts` only has name/DOB/gender/phone/email/address | none | HIGH |
| 26 | Token/queue number management | EXISTS_PARTIAL | `ReceptionistDashboard.tsx` has a "Today's Queue" tab with check-in status — but it's client-side state only | none — nothing persists this to the backend | none | MEDIUM |
| 27 | SMS notifications | COMPLETELY_MISSING | none | none — no Twilio/SMS SDK anywhere in the repo | none | HIGH |
| 28 | Patient arrival tracking | EXISTS_PARTIAL | `ReceptionistDashboard.tsx` has a "Check In" button | none — click doesn't persist anywhere | `orders` has no `checkedInAt` field | MEDIUM |
| 29 | Consent forms | COMPLETELY_MISSING | none | none | none — zero matches for "consent" anywhere in the repo | HIGH |

**Notes:** #26 and #28 are the same pattern: a believable-looking UI exists, but it's a frontend mock with no backend behind it — clicking the buttons doesn't actually save anything, so the data disappears on refresh.

---

## BILLING

| # | Feature | Status | Frontend | Backend | Data model | Effort |
|---|---|---|---|---|---|---|
| 30 | Insurance claim management | COMPLETELY_MISSING | `BillingPage.tsx` has only manual amount/status (pending/invoiced/paid/cancelled) | none | `billing` has no claim number/status/payer fields | HIGH |
| 31 | Payment gateway integration | COMPLETELY_MISSING | "Mark Paid" is a manual button click | none — no Stripe/Razorpay SDK anywhere | `billing` has no transaction ID/payment method field | HIGH |
| 32 | Revenue analytics | COMPLETELY_MISSING | `BillingDashboard.tsx` shows 3 static sum cards (pending/invoiced/paid totals) — not trend/breakdown analytics | no analytics/aggregation endpoint | n/a | MEDIUM |
| 33 | Outstanding payment tracking | EXISTS_WORKING | `BillingPage.tsx` shows total pending amount | `billing.ts` filters by `status` | `billing.status`, `paidDate` | LOW |
| 34 | Package management | COMPLETELY_MISSING | none | none | none — orders only have a single modality + body part, no bundles | HIGH |

**Notes:** #33 already works for the core ask (you can see what's outstanding); an aging/overdue breakdown would be an enhancement, not a missing core feature. Everything insurance/claims/payments-related (#25, #30, #31) is a real, total gap — there is no insurance data model in this system at all, anywhere.

---

## VIEWER

First, a clarification: this system has an explicit `viewer` role (`shared/src/types.ts` role enum includes `super_admin | admin | developer | radiologist | radiographer | billing | referring | receptionist | viewer`), with view-only permissions on dashboard/patients/orders/scans/worklist/reports/billing. It is **not** a patient-portal role — there's no concept anywhere of linking a patient record to a login account.

| # | Feature | Status | Frontend | Backend | Data model | Effort |
|---|---|---|---|---|---|---|
| 35 | Download reports | EXISTS_PARTIAL | none — no download button | `PdfService.buildReportPdf()` already works, but is only wired to the email-share endpoint, not a direct download route | n/a | MEDIUM |
| 36 | Patient own studies only view | COMPLETELY_MISSING | `MyStudiesPage.tsx` scopes by *assigned radiologist*, not by patient identity | none — no patient↔user account link exists | `patients` has no `linkedUserId`; no reverse lookup | HIGH |
| 37 | Report sharing | EXISTS_WORKING | `ShareButton.tsx` | `reports.ts` → `POST /:id/share` (generates PDF, emails it, logs an audit version) | `reports.versions`/`attachments` | LOW |
| 38 | Appointment booking | COMPLETELY_MISSING | `SchedulePage.tsx` is read-only — no booking form, no slot picker | none | none | HIGH |
| 39 | Payment history | EXISTS_PARTIAL | `BillingPage.tsx` shows the full table, not scoped to "my payments" | `billing.ts` supports a `patientId` filter already | `billing.patientId` | MEDIUM (blocked on #36) |
| 40 | Image viewer access | EXISTS_WORKING | `OhifViewerEmbed.tsx` | DICOMweb endpoints gated by `scans:view`, which the `viewer` role already has | n/a | LOW |
| 41 | Notification center | COMPLETELY_MISSING | none — only ephemeral success/error toasts exist | none | none | HIGH |

**Notes:** #37 and #40 already work fully for the `viewer` role as currently defined. #36 and #39 are blocked on the same underlying gap: there is no mechanism anywhere to say "this login belongs to this patient" — that's the real prerequisite, not a dashboard tweak.

---

## OVERALL (HIGH PRIORITY) — these are system-wide restatements of role-specific gaps above

| # | Feature | Status | Same root cause as | Notes |
|---|---|---|---|---|
| 42 | Critical findings alert system | EXISTS_PARTIAL | #15 | Field + styling exist; no alert ever actually fires (no email/push/SMS) anywhere in the system. |
| 43 | STAT/Emergency workflow | EXISTS_PARTIAL | #22 | Priority is fully captured and filterable; there's no special queueing/auto-routing — a STAT order is processed identically to a routine one on the backend. |
| 44 | TAT tracking system | EXISTS_PARTIAL | #8, #18 | Works in the Admin dashboard for overall pending/longest TAT; timestamps are only captured at assignment/report stages, not at order-creation or scan-completion, and it doesn't appear in Radiologist/Tech dashboards. |
| 45 | Equipment monitoring | COMPLETELY_MISSING | #20 | Confirmed independently by two separate searches — no equipment entity exists anywhere in the codebase. |
| 46 | Audit trail | EXISTS_WORKING | #4 | The backend logging itself is genuinely solid (two real systems, one with cryptographic integrity verification) — it's the dashboard/UI surfacing it that's missing. |
| 47 | Mobile access | COMPLETELY_MISSING | — | Plain React/Vite SPA. No React Native, Capacitor, or PWA manifest anywhere. |
| 48 | Structured reporting templates | EXISTS_PARTIAL | #17 | Named sections exist and are used consistently; the content within each section is still free-text rich text, not discrete coded findings. |

---

## Honest summary

Of the 48 features:

- **Already fully working, just not surfaced/discovered (EXISTS_WORKING) — 9:** #3, #4, #8, #19, #22, #33, #37, #40, #46. (#4 and #46 describe the same backend audit-logging gap.) These are genuinely "just needs UI/navigation," cheap to ship.
- **Real partial implementations needing backend work, not just UI (EXISTS_PARTIAL) — 18:** #1, #5, #6, #11, #12, #14, #15, #17, #18, #24, #26, #28, #35, #39, #42, #43, #44, #48. These need genuine engineering — usually a new endpoint or data field — not just a dashboard tweak.
- **Totally absent, build-from-scratch (COMPLETELY_MISSING) — 21:** #2, #7, #9, #10, #13, #16, #20, #21, #23, #25, #27, #29, #30, #31, #32, #34, #36, #38, #41, #45, #47. Insurance/billing/payments, equipment/QC, peer review, mobile, and observability (logs/errors/DB monitoring) are the weakest areas, with zero existing groundwork.

Biggest "quick win" cluster: STAT priority display (#22/#43), audit dashboard UI (#4/#46), and per-radiologist TAT (#18) — all backend-ready, pure frontend work.

Biggest surprise: voice dictation (#14) — MedASR is a fully built, working service that nobody connected to the report editor.

Biggest structural gap: there is no insurance/billing-claims data model at all (#25, #30, #31), and no patient-to-login-account link (#36) — both are prerequisites for several other "missing" features (#39 depends on #36), so they should be sequenced first if you plan to build any of the Receptionist/Billing/Viewer items.
