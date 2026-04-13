# Medical Report System

A full-stack radiology reporting application designed to work alongside Dicoogle (PACS) and OHIF (viewer).

## Project layout

- `backend/`: Node.js + Express API, Firestore/GCS/Speech integration, versioned reports, sharing.
- `frontend/`: React + Tailwind + Quill UI for templates and reporting workflow.
- `shared/`: Shared TypeScript interfaces.
- `docs/`: Architecture, deployment and integration notes.
- `integrations/`: OHIF and Dicoogle sample snippets.

## Quick start

```bash
npm install
npm run build -w shared
npm run dev -w backend
npm run dev -w frontend
```

See `docs/architecture.md` and `docs/deployment.md` for details.

## Firebase auth demo users

Seed fake Firebase login users (email/password + Firestore profile records):

```bash
npm run seed:firebase-users -w packages/reporting-app/backend
```

All seeded demo users use password `TDAI#Demo1234`:

- `super_admin@example.com` (super_admin)
- `admin@example.com` (admin)
- `developer@example.com` (developer)
- `radiologist@example.com` (radiologist)
- `radiographer@example.com` (radiographer)
- `referring@example.com` (referring)
- `billing@example.com` (billing)
- `receptionist@example.com` (receptionist)
- `viewer@example.com` (viewer)

## HIPAA Compliance

The backend implements comprehensive HIPAA compliance including:
- Immutable SHA-256 hash-chained audit trail for all PHI access (`hipaaAuditService.ts`)
- Automatic session timeout after 15 minutes of inactivity
- Account lockout after 5 failed login attempts
- Emergency break-glass access with time-limited grants
- PHI sanitization in production error responses
- HTTPS enforcement with HSTS headers
- HIPAA-compliant password policy (12+ chars, mixed case, numbers, symbols)

See [`HIPAA_COMPLIANCE.md`](../../HIPAA_COMPLIANCE.md) for full documentation.
