# HIPAA Compliance — TD|ai Medical Imaging Platform

This document describes the HIPAA (Health Insurance Portability and Accountability Act) compliance controls implemented in the TD|ai platform. It maps each HIPAA Security Rule requirement to the corresponding implementation in the codebase.

---

## Table of Contents

1. [Technical Safeguards](#1-technical-safeguards)
2. [Administrative Safeguards](#2-administrative-safeguards)
3. [PHI Inventory](#3-phi-inventory)
4. [Audit Logging](#4-audit-logging)
5. [API Endpoints](#5-hipaa-api-endpoints)
6. [Configuration Reference](#6-configuration-reference)
7. [Deployment Checklist](#7-deployment-checklist)
8. [Incident Response](#8-incident-response)

---

## 1. Technical Safeguards

### 1.1 Access Controls (§164.312(a)(1))


| Requirement                    | Implementation                                                                                                               | File(s)                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Unique User Identification** | Every user has a unique `id` (Firebase UID or UUID). All actions tied to `userId`.                                           | `services/store.ts`, `middleware/auth.ts`                 |
| **Emergency Access Procedure** | Break-glass emergency access with time-limited grants, reason tracking, and admin revocation.                                | `services/hipaaAuditService.ts`, `routes/hipaa.ts`        |
| **Automatic Logoff**           | Sessions expire after 15 minutes of inactivity (configurable via `HIPAA_SESSION_TIMEOUT_MINUTES`). Cookie `maxAge` enforced. | `middleware/auth.ts`, `config/hipaaConfig.ts`             |
| **Encryption**                 | TLS required in production. HSTS headers enforced. Firebase/GCP handles encryption at rest.                                  | `middleware/security.ts`, `middleware/hipaaMiddleware.ts` |


### 1.2 Audit Controls (§164.312(b))


| Requirement                | Implementation                                                                                                      | File(s)                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **Audit Trail**            | Every PHI access (view, create, update, delete, export, share) is logged to `hipaa_audit_log` Firestore collection. | `services/hipaaAuditService.ts` |
| **Integrity Hash Chain**   | Each audit entry includes a SHA-256 integrity hash linked to the previous entry, preventing tampering.              | `services/hipaaAuditService.ts` |
| **Automatic PHI Tracking** | Middleware automatically detects PHI routes and logs access without requiring per-route instrumentation.            | `middleware/hipaaMiddleware.ts` |
| **Login/Logout Auditing**  | All authentication events (success, failure, logout, timeout, lockout) are recorded.                                | `routes/auth.ts`                |


### 1.3 Integrity Controls (§164.312(c)(1))


| Requirement             | Implementation                                                          | File(s)                                            |
| ----------------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| **Data Integrity**      | Report versioning with audit trail (`versions[]` array on each report). | `services/store.ts`                                |
| **Audit Log Integrity** | SHA-256 hash chain on audit entries. Integrity verification endpoint.   | `services/hipaaAuditService.ts`, `routes/hipaa.ts` |
| **Input Validation**    | Zod schema validation on all API inputs.                                | All route files                                    |


### 1.4 Person or Entity Authentication (§164.312(d))


| Requirement           | Implementation                                                                                | File(s)                                                  |
| --------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Authentication**    | Firebase Authentication (email/password, Google OAuth). Session-based + JWT for multi-tenant. | `routes/auth.ts`, `middleware/apiGateway.ts`             |
| **Account Lockout**   | Accounts locked after 5 failed login attempts for 30 minutes (configurable).                  | `middleware/hipaaMiddleware.ts`                          |
| **Password Policy**   | Minimum 12 characters, uppercase, lowercase, number, special character required.              | `middleware/hipaaMiddleware.ts`, `config/hipaaConfig.ts` |
| **Role-Based Access** | Granular RBAC with 9 roles and per-permission overrides.                                      | `middleware/auth.ts`, `services/permissions.ts`          |


### 1.5 Transmission Security (§164.312(e)(1))


| Requirement               | Implementation                                                                      | File(s)                         |
| ------------------------- | ----------------------------------------------------------------------------------- | ------------------------------- |
| **Encryption in Transit** | HTTPS enforced in production. HTTP requests rejected with 403.                      | `middleware/hipaaMiddleware.ts` |
| **HSTS**                  | `Strict-Transport-Security` header with 1-year max-age, includeSubDomains, preload. | `middleware/security.ts`        |
| **Secure Cookies**        | `httpOnly`, `secure`, `sameSite` flags on session cookies.                          | `app.ts`                        |
| **CORS Hardening**        | Wildcard CORS automatically disabled in production even if `CORS_ALLOW_ALL=true`.   | `middleware/security.ts`        |


---

## 2. Administrative Safeguards

### 2.1 Security Management (§164.308(a)(1))

- **Risk Analysis**: PHI routes automatically identified and monitored.
- **Compliance Dashboard**: `/hipaa/compliance-status` provides real-time compliance overview.
- **Audit Log Integrity Verification**: `/hipaa/audit-log/integrity` validates no tampering.

### 2.2 Workforce Security (§164.308(a)(3))

- **Authorization**: Users require admin approval before accessing the system.
- **Access Termination**: Admin can reject or deactivate users.
- **Minimum Necessary**: Role-based permissions limit PHI access to job function.

### 2.3 Information Access Management (§164.308(a)(4))

- **Access Authorization**: Granular permissions per role (e.g., `patients:view`, `reports:sign`).
- **Access Modification**: Admin can modify role permissions via `/permissions` API.

### 2.4 Security Awareness (§164.308(a)(5))

- **Login Monitoring**: Failed login attempts tracked and logged.
- **Account Lockout Alerts**: Critical severity audit events for locked accounts.

### 2.5 Contingency Plan (§164.308(a)(7))

- **Emergency Access**: Break-glass procedure allows time-limited access with mandatory reason documentation.
- **Data Backup**: Firebase/GCP automatic backups. DICOM storage via Dicoogle with configurable storage paths.

---

## 3. PHI Inventory

The following data categories are treated as PHI and fully audited:


| Category                 | Collection / Path     | PHI Fields                                                                       |
| ------------------------ | --------------------- | -------------------------------------------------------------------------------- |
| **Patients**             | `patients`            | patientId (MRN), firstName, lastName, dateOfBirth, gender, phone, email, address |
| **Reports**              | `reports`             | content, findings, signedBy, studyId, voice transcripts                          |
| **Studies**              | `studies`             | patientName, studyDate, modality, metadata (DICOM tags)                          |
| **Orders**               | `orders`              | patientId, patientName, clinicalHistory, bodyPart                                |
| **Scans**                | `scans`               | patientId, patientName, findings, bodyPart                                       |
| **Billing**              | `billing`             | patientId, patientName, amount, invoiceNumber                                    |
| **DICOM**                | `/dicomweb`, `/wado`  | Full DICOM objects including all patient identifiers                             |
| **Transcripts**          | `/transcribe`         | Voice recordings and transcriptions of clinical data                             |
| **Referring Physicians** | `referringPhysicians` | name, phone, email, hospital affiliation                                         |


---

## 4. Audit Logging

### Audit Entry Structure

Every audit log entry contains:

```
{
  id: string,               // Unique event ID
  timestamp: string,         // ISO 8601 timestamp
  action: AuditAction,       // PHI_ACCESS, LOGIN_SUCCESS, etc.
  severity: "info" | "warning" | "critical",
  userId: string,
  userEmail: string,
  userRole: string,
  ipAddress: string,         // Client IP (X-Forwarded-For aware)
  userAgent: string,
  resourceType: PhiCategory, // patient, report, study, etc.
  resourceId: string,
  tenantId?: string,
  description: string,
  httpMethod: string,
  httpPath: string,
  httpStatus: number,
  phiAccessed: boolean,
  integrityHash: string,     // SHA-256 hash chain
  previousEntryHash?: string
}
```

### Audit Actions Tracked

- `PHI_ACCESS` — Any read of PHI data
- `PHI_CREATE` — Creation of PHI records
- `PHI_UPDATE` — Modification of PHI records
- `PHI_DELETE` — Deletion of PHI records
- `PHI_EXPORT` — Export/download of PHI
- `PHI_SHARE` — Sharing PHI (email, etc.)
- `LOGIN_SUCCESS` / `LOGIN_FAILURE` — Authentication events
- `LOGOUT` / `SESSION_TIMEOUT` — Session events
- `ACCOUNT_LOCKED` / `ACCOUNT_UNLOCKED` — Lockout events
- `EMERGENCY_ACCESS` / `EMERGENCY_ACCESS_REVOKE` — Break-glass events
- `REPORT_SIGN` / `REPORT_ADDENDUM` — Report workflow events
- `ROLE_CHANGE` / `PERMISSION_CHANGE` — Access control changes
- `AUDIT_LOG_ACCESS` — Meta-auditing of who views audit logs

### Retention

Audit logs are retained for **6 years** (2,190 days) per HIPAA requirements (§164.530(j)(2)). Configurable via `HIPAA_AUDIT_RETENTION_DAYS`.

---

## 5. HIPAA API Endpoints

All endpoints require authentication. Admin-only endpoints require `admin` or `super_admin` role.


| Method | Path                             | Access        | Description                            |
| ------ | -------------------------------- | ------------- | -------------------------------------- |
| `GET`  | `/hipaa/audit-log`               | Admin         | Query audit trail with filters         |
| `GET`  | `/hipaa/audit-log/integrity`     | Admin         | Verify audit log hash chain integrity  |
| `POST` | `/hipaa/emergency-access`        | Authenticated | Request emergency (break-glass) access |
| `POST` | `/hipaa/emergency-access/revoke` | Admin         | Revoke emergency access                |
| `GET`  | `/hipaa/emergency-access`        | Admin         | List emergency access records          |
| `GET`  | `/hipaa/compliance-status`       | Admin         | Real-time compliance dashboard         |


---

## 6. Configuration Reference

Add these to your `.env` file:

```env
# HIPAA Compliance Configuration
HIPAA_AUDIT_ENABLED=true              # Enable/disable audit logging
HIPAA_AUDIT_RETENTION_DAYS=2190       # 6 years per HIPAA (§164.530(j)(2))
HIPAA_SESSION_TIMEOUT_MINUTES=15      # Auto-logoff after inactivity
HIPAA_MAX_FAILED_LOGINS=5             # Lock account after N failures
HIPAA_LOCKOUT_DURATION_MINUTES=30     # Account lockout duration
HIPAA_REQUIRE_HTTPS=true              # Enforce TLS in production
HIPAA_MIN_PASSWORD_LENGTH=12          # Minimum password length
```

---

## 7. Deployment Checklist

Before deploying to production with PHI, verify:

### Infrastructure

- TLS/HTTPS enabled on all endpoints (load balancer + application)
- Firebase Security Rules restrict direct Firestore access
- GCP encryption at rest is enabled (default for Firebase)
- Network segmentation isolates PHI datastores
- Backup and disaster recovery tested

### Application

- `NODE_ENV=production` is set
- `ENABLE_AUTH=true` is set
- `CORS_ALLOW_ALL=false` is set (enforced in production regardless)
- `SESSION_SECRET` is a strong, unique 32+ character value
- `JWT_SECRET` is a strong, unique 32+ character value
- `HIPAA_AUDIT_ENABLED=true` is set
- `HIPAA_REQUIRE_HTTPS=true` is set
- All default passwords and secrets are changed

### Access Controls

- Master admin emails configured in `MASTER_ADMIN_EMAILS`
- User approval workflow enabled
- Role permissions reviewed and configured
- Emergency access procedures documented and tested

### Monitoring

- Audit log integrity verification scheduled (weekly recommended)
- Critical audit events monitored (failed logins, emergency access)
- Log aggregation configured (stdout → centralized logging)
- Alerting set up for `ACCOUNT_LOCKED` and `EMERGENCY_ACCESS` events

### Legal

- Business Associate Agreement (BAA) signed with Google Cloud/Firebase
- BAA signed with SendGrid (if sending PHI via email)
- Privacy policies and notices published
- Workforce HIPAA training completed

---

## 8. Incident Response

### Breach Detection

The system provides automated detection through:

- Failed login monitoring with automatic lockout
- Audit log integrity verification (detects tampering)
- Critical severity events for emergency access

### Breach Response Procedure

1. **Identify**: Review `/hipaa/audit-log` for anomalous access patterns
2. **Contain**: Revoke emergency access, lock compromised accounts
3. **Assess**: Use `/hipaa/audit-log/integrity` to verify log completeness
4. **Notify**: Per HIPAA Breach Notification Rule (§164.404-410):
  - Notify affected individuals within 60 days
  - Notify HHS if breach affects 500+ individuals
  - Notify media if breach affects 500+ individuals in a state
5. **Document**: All response actions logged in audit trail

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Browser)                         │
│                    TLS 1.2+ Required in Production              │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS
┌──────────────────────────▼──────────────────────────────────────┐
│                    Express Application                          │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │ HTTPS Check │→ │Security Hdrs │→ │  PHI Access Logger   │   │
│  │  (HIPAA)    │  │(HSTS, CSP)   │  │(Auto-audit all PHI) │   │
│  └─────────────┘  └──────────────┘  └─────────────────────┘   │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │Session Mgmt │→ │ Auth + RBAC  │→ │  Route Handlers      │   │
│  │(15m timeout)│  │(Lockout/MFA) │  │  (Zod validated)     │   │
│  └─────────────┘  └──────────────┘  └─────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              HIPAA Audit Service                          │  │
│  │  • SHA-256 hash chain  • 6-year retention                 │  │
│  │  • Emergency access    • Compliance dashboard             │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│           Firebase / GCP (Encryption at Rest)                   │
│  ┌──────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────┐  │
│  │Firestore │ │  GCS Bucket  │ │ Firebase Auth│ │Audit Logs│  │
│  │(PHI Data)│ │(DICOM/Files) │ │ (Identity)   │ │(Immutable│  │
│  └──────────┘ └──────────────┘ └──────────────┘ └──────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

*This document should be reviewed and updated at least annually, or whenever significant changes are made to the platform's architecture or data handling practices.*