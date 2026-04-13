# Multi-Tenant RIS/PACS Architecture

Production-ready multi-tenant transformation for the TDAI medical imaging platform.

---

## 1. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LOAD BALANCER / GATEWAY                          │
│                        (nginx / Cloud LB / Traefik)                        │
│                   ┌──────────────┬──────────────────────┐                  │
│                   │  /api/v1/*   │  /ohif/*  │ /weasis  │                  │
└───────────────────┼──────────────┼──────────────────────┼──────────────────┘
                    │              │                      │
        ┌───────────▼───────────┐  │   ┌─────────────────▼──────────────────┐
        │  REPORTING BACKEND    │  │   │  OHIF Viewer (per-tenant config)   │
        │  (Express/TypeScript) │  │   │  JWT token → DICOMweb proxy        │
        │                       │  │   └────────────────────────────────────┘
        │  ┌─────────────────┐  │  │
        │  │ JWT Auth MW     │  │  │   ┌────────────────────────────────────┐
        │  │ tenant_id in    │  │  │   │  Weasis Desktop                   │
        │  │ every token     │  │  │   │  HMAC-signed token + tenant scope │
        │  └────────┬────────┘  │  │   └────────────────────────────────────┘
        │           │           │  │
        │  ┌────────▼────────┐  │  │
        │  │ Tenant Context  │  │  │
        │  │ Middleware       │  │  │
        │  │ • resolve tenant│  │  │
        │  │ • set RLS var   │  │  │
        │  │ • IDOR guard    │  │  │
        │  └────────┬────────┘  │  │
        │           │           │  │
        │  ┌────────▼────────┐  │  │
        │  │ Tenant-Scoped   │──┼──┘
        │  │ Store Service   │  │
        │  │ (all queries    │  │
        │  │  have tenant_id)│  │
        │  └───────┬─────────┘  │
        └──────────┼────────────┘
                   │
     ┌─────────────┼─────────────────────────────────────┐
     │             │                                     │
┌────▼─────┐  ┌───▼───────────┐  ┌────────────────────┐ │
│PostgreSQL │  │  Orthanc PACS │  │  Object Storage    │ │
│           │  │               │  │                    │ │
│• RLS on   │  │• Lua routing  │  │ /storage/          │ │
│  every    │  │• AE Title →   │  │   {tenant_id}/     │ │
│  table    │  │  tenant map   │  │     studies/       │ │
│• tenant_id│  │• C-STORE      │  │                    │ │
│  indexed  │  │  filter       │  │  OR S3:            │ │
│           │  │• Webhook →    │  │  s3://{bucket}/    │ │
│           │  │  backend      │  │    {tenant_id}/    │ │
└───────────┘  └───────────────┘  └────────────────────┘ │
     │                                                   │
     │         ┌────────────────────────────┐             │
     │         │  AI Microservices          │             │
     │         │  (MONAI / MedASR)          │             │
     │         │  x-tenant-id header        │             │
     │         │  per-tenant model routing  │             │
     │         └────────────────────────────┘             │
     └───────────────────────────────────────────────────-┘
```

### Data Flow: Study Acquisition

```
Modality (CT/MR) ──C-STORE──► Orthanc (port 4242)
                                  │
                        Lua: IncomingCStoreRequestFilter
                                  │
                        ┌─────────▼──────────┐
                        │ CallingAET lookup   │
                        │ in ae_tenant_map    │
                        └─────────┬──────────┘
                                  │
                     ┌────────────▼────────────┐
                     │ Accept: stamp tenant_id │
                     │ Reject: unknown AET     │
                     └────────────┬────────────┘
                                  │
                    OnStableStudy callback
                                  │
                     ┌────────────▼────────────┐
                     │ POST /webhook/study     │
                     │ {tenantId, studyUID...} │
                     └────────────┬────────────┘
                                  │
                     ┌────────────▼────────────┐
                     │ Backend upserts study   │
                     │ in studies table with   │
                     │ tenant_id               │
                     └─────────────────────────┘
```

---

## 2. Database Schema

See `packages/reporting-app/backend/migrations/001_multi_tenant_schema.sql`.

**Key tables and their tenant relationships:**

```
tenants
  ├── users (tenant_id FK)
  ├── patients (tenant_id FK)
  ├── studies (tenant_id FK)
  │     ├── reports (tenant_id FK, study_id FK)
  │     └── orders (tenant_id FK, study_id FK)
  ├── templates (tenant_id FK)
  ├── billing (tenant_id FK)
  ├── referring_physicians (tenant_id FK)
  ├── role_permissions (tenant_id FK)
  ├── tenant_dicom_config (tenant_id FK, 1:1)
  └── audit_logs (tenant_id FK)
```

**Indexing strategy:** Every table has a composite index starting with `tenant_id`:


| Table      | Key Indexes                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| users      | `(tenant_id)`, `(tenant_id, email)`, `(tenant_id, role)`                                                |
| patients   | `(tenant_id)`, `(tenant_id, patient_id)`, `(tenant_id, last_name, first_name)`                          |
| studies    | `(tenant_id)`, `(tenant_id, study_instance_uid)`, `(tenant_id, status)`, `(tenant_id, study_date DESC)` |
| reports    | `(tenant_id)`, `(tenant_id, study_id)`, `(tenant_id, owner_id)`                                         |
| audit_logs | `(tenant_id, created_at DESC)`, `(tenant_id, action)`                                                   |


**Row-Level Security (RLS):** Defense-in-depth via PostgreSQL RLS policies:

```sql
-- Applied to ALL tenant tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_users ON users
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

The application sets `SET LOCAL app.current_tenant_id = '<uuid>'` on every connection.

---

## 3. Backend Code Examples

### 3a. JWT with tenant_id

See `src/services/jwtService.ts`.

**Token payload structure:**

```json
{
  "sub": "user-uuid",
  "tid": "tenant-uuid",
  "email": "dr.smith@hospital.com",
  "role": "radiologist",
  "tslug": "city-hospital",
  "iss": "tdai-platform",
  "exp": 1711382400
}
```

### 3b. Tenant Context Middleware

See `src/middleware/tenantContext.ts`.

**Flow:**

1. Extract Bearer token from `Authorization` header
2. Verify JWT signature + expiry
3. Extract `tid` (tenant ID) from payload
4. Query `tenants` table (cached 60s) to validate tenant exists + is active
5. Attach `req.tenant` and `req.tokenPayload` to the request
6. All downstream handlers access `req.tenant.id` for scoping

### 3c. Sample Secured Query

```typescript
// Every query method requires tenantId as the first parameter.
// There is no way to query without specifying a tenant.

async listStudies(tenantId: string, filters?: StudyFilters): Promise<StudyRow[]> {
    const conditions = ["tenant_id = $1"];       // Always present
    const params: unknown[] = [tenantId];         // Always first param

    if (filters?.status) {
        conditions.push(`status = $2`);
        params.push(filters.status);
    }

    // tenantQuery() also sets RLS session variable as defense-in-depth
    const result = await tenantQuery(
        tenantId,
        `SELECT * FROM studies WHERE ${conditions.join(" AND ")}`,
        params,
    );
    return result.rows;
}
```

**Triple-layer isolation:**

1. Application layer: `WHERE tenant_id = $1` in every query
2. Database layer: RLS policy enforces `tenant_id = current_setting('app.current_tenant_id')`
3. Connection layer: `tenantQuery()` sets the RLS variable before every query

---

## 4. Orthanc Configuration

See `config/orthanc-multi-tenant.json` and `config/orthanc-lua/multi-tenant-routing.lua`.

**AE Title per tenant:**

```json
{
  "DicomModalities": {
    "CITY_HOSPITAL_AE": ["CITY_HOSPITAL_AE", "10.0.1.10", 104],
    "RURAL_CLINIC_AE": ["RURAL_CLINIC_AE", "10.0.2.10", 104]
  }
}
```

**Lua routing logic (simplified):**

```lua
function IncomingCStoreRequestFilter(dicom, origin)
    local calling_aet = origin["CallingAet"]
    local tenant_id = ae_tenant_map[calling_aet]

    if not tenant_id then
        return false  -- REJECT unknown source
    end

    dicom:SetInstanceMetadata("tenant_id", tenant_id)
    return true  -- ACCEPT and tag
end
```

---

## 5. API Design (REST Endpoints)

### Authentication


| Method | Endpoint                | Description                              |
| ------ | ----------------------- | ---------------------------------------- |
| POST   | `/api/v1/auth/login`    | Login with email + password + tenantSlug |
| POST   | `/api/v1/auth/register` | Register under a tenant                  |
| POST   | `/api/v1/auth/refresh`  | Exchange refresh token                   |
| POST   | `/api/v1/auth/logout`   | Revoke tokens                            |
| GET    | `/api/v1/auth/me`       | Current user + tenant context            |


### Platform Admin (super-admin key)


| Method | Endpoint                       | Description                    |
| ------ | ------------------------------ | ------------------------------ |
| POST   | `/api/v1/platform/tenants`     | Create new tenant + admin user |
| GET    | `/api/v1/platform/tenants`     | List all tenants               |
| PATCH  | `/api/v1/platform/tenants/:id` | Update tenant settings         |


### Tenant Admin (JWT + admin role)


| Method | Endpoint                          | Description             |
| ------ | --------------------------------- | ----------------------- |
| GET    | `/api/v1/admin/users`             | List tenant users       |
| PATCH  | `/api/v1/admin/users/:id/approve` | Approve/reject user     |
| GET    | `/api/v1/admin/audit-logs`        | View tenant audit trail |


### Clinical Data (JWT + role-based)


| Method | Endpoint           | Description                   |
| ------ | ------------------ | ----------------------------- |
| GET    | `/api/v1/patients` | List patients (tenant-scoped) |
| POST   | `/api/v1/patients` | Create patient                |
| GET    | `/api/v1/studies`  | List studies (tenant-scoped)  |
| GET    | `/api/v1/reports`  | List reports (tenant-scoped)  |
| POST   | `/api/v1/reports`  | Create report                 |
| GET    | `/api/v1/orders`   | List orders (tenant-scoped)   |
| GET    | `/api/v1/billing`  | List billing (tenant-scoped)  |


### DICOMweb (JWT + tenant-scoped)


| Method | Endpoint                                                   | Description                       |
| ------ | ---------------------------------------------------------- | --------------------------------- |
| GET    | `/api/v1/dicomweb/studies`                                 | QIDO-RS: search (tenant-filtered) |
| GET    | `/api/v1/dicomweb/studies/:uid/series`                     | QIDO-RS: series                   |
| GET    | `/api/v1/dicomweb/studies/:uid/series/:uid/instances`      | QIDO-RS: instances                |
| GET    | `/api/v1/dicomweb/studies/:uid/series/:uid/instances/:uid` | WADO-RS: retrieve                 |


---

## 6. Security Checklist

### Authentication

- JWT tokens include `tenant_id` (`tid` claim)
- Tokens are short-lived (15 min access, 7 day refresh)
- Refresh tokens stored as SHA-256 hashes, not plaintext
- Token revocation on logout (all user tokens)
- Password hashing with bcrypt (cost factor 12)
- Rate limiting per tenant (prevents resource monopolization)

### Authorization

- Role-based access control (admin, radiologist, technician, etc.)
- Per-tenant role permission overrides
- Middleware chain: JWT → Tenant Context → Role Check → Handler

### Data Isolation

- `tenant_id` column on every data table
- Every SQL query includes `WHERE tenant_id = $1`
- PostgreSQL RLS as defense-in-depth backup
- `tenantQuery()` sets RLS session variable per connection
- No cross-tenant joins possible at database level

### IDOR Prevention

- `validateResourceOwnership()` middleware verifies resource belongs to tenant
- `validateStudyAccess()` checks Study UID against tenant's studies
- `injectTenantId()` overrides any client-supplied tenant_id in request body
- URL tenant slug matched against JWT tenant (prevents token replay)

### DICOM Security

- C-STORE filtered by CallingAET → tenant mapping
- Unknown AE Titles rejected at PACS level
- Study metadata tagged with tenant_id on ingestion
- DICOMweb proxy validates study ownership before serving

### Infrastructure

- Helmet security headers
- CORS restricted to configured origins
- Request rate limiting (500/15min global + per-tenant)
- Audit logging for all sensitive operations
- Secrets via environment variables (never in code)

### Compliance (HIPAA)

- **HIPAA audit trail**: SHA-256 hash-chained immutable audit log (`hipaa_audit_log` Firestore collection) for all PHI access
- **Automatic PHI tracking**: Middleware auto-detects PHI routes (patients, reports, studies, orders, scans, billing, DICOM) and logs every access
- **Session timeout**: 15-minute automatic logoff per HIPAA §164.312(a)(2)(iii)
- **Account lockout**: Accounts locked after 5 failed login attempts (30-minute lockout)
- **Emergency access**: Break-glass procedure with time-limited grants, mandatory reason, admin revocation
- **Error sanitization**: PHI scrubbed from production error responses (SSN, MRN, names, dates redacted)
- **HTTPS enforcement**: HTTP requests rejected in production; HSTS with 1-year max-age
- **CORS hardening**: Wildcard CORS automatically blocked in production even if misconfigured
- **Audit integrity**: Hash chain verification endpoint detects log tampering
- **6-year retention**: Audit logs retained per HIPAA §164.530(j)(2)
- Tenant data isolation meets HIPAA BAA requirements
- No PHI in logs (structured logging with Winston)
- Token-based session (no server-side session for multi-tenant routes)
- See [`HIPAA_COMPLIANCE.md`](./HIPAA_COMPLIANCE.md) for full compliance documentation

---

## 7. Migration Steps

### Phase 1: Infrastructure (Week 1)

1. **Deploy PostgreSQL** alongside existing Firestore
  ```bash
   docker-compose up -d postgres
  ```
2. **Run migration scripts**
  ```bash
   psql $DATABASE_URL -f migrations/001_multi_tenant_schema.sql
   psql $DATABASE_URL -f migrations/002_backfill_tenant_id.sql
  ```
3. **Create default tenant** for existing data
  - The migration creates a "Default Hospital" tenant automatically
  - All backfilled data maps to this tenant

### Phase 2: Backend Multi-Tenant Layer (Week 2)

1. **Install new dependencies**
  ```bash
   cd packages/reporting-app && npm install
  ```
2. **Set environment variables**
  ```bash
   MULTI_TENANT_ENABLED=false    # Keep disabled initially
   DATABASE_URL=postgresql://tdai:password@postgres:5432/tdai_multitenant
   JWT_SECRET=<generate-64-char-random-string>
   PLATFORM_ADMIN_KEY=<generate-32-char-random-string>
  ```
3. **Deploy with multi-tenant code** (but disabled)
  - All existing `/` routes continue using Firestore (unchanged)
  - `/api/v1/`* routes exist but are gated behind `MULTI_TENANT_ENABLED`

### Phase 3: Data Migration (Week 3)

1. **Export Firestore data** to CSV/JSON
  ```bash
   # Use firestore-export or custom script
   node scripts/export-firestore.js --collections users,patients,studies,reports
  ```
2. **Load into staging tables** and map IDs
  ```bash
   psql $DATABASE_URL -c "\copy _staging_users FROM 'firestore_users.csv' CSV HEADER"
   # Run the INSERT...SELECT statements from 002_backfill_tenant_id.sql
  ```
3. **Verify data integrity**
  ```sql
   SELECT 'users' AS tbl, COUNT(*) FROM users WHERE tenant_id IS NULL
   UNION ALL SELECT 'studies', COUNT(*) FROM studies WHERE tenant_id IS NULL;
   -- Expected: 0 rows with NULL tenant_id
  ```

### Phase 4: Enable Multi-Tenant (Week 4)

1. **Enable multi-tenant mode**
  ```bash
    MULTI_TENANT_ENABLED=true
  ```
2. **Create additional tenants** via platform API
  ```bash
    curl -X POST http://localhost:8081/api/v1/platform/tenants \
      -H "X-Platform-Key: $PLATFORM_ADMIN_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "name": "City Hospital",
        "slug": "city-hospital",
        "aeTitle": "CITY_HOSP_AE",
        "adminEmail": "admin@cityhospital.com",
        "adminPassword": "SecurePass123!",
        "adminDisplayName": "Hospital Admin"
      }'
  ```
3. **Configure Orthanc** with tenant AE Titles
  - Update `orthanc-multi-tenant.json` with real AE Title → IP mappings
    - Restart Orthanc container

### Phase 5: Cut Over (Week 5)

1. **Migrate frontend** to use `/api/v1/`* endpoints with JWT
2. **Update OHIF** viewer configuration to pass JWT in DICOMweb requests
3. **Decommission** Firestore-backed routes (or keep as fallback)
4. **Drop staging tables** from migration

### Zero-Downtime Strategy

- Both old (Firestore) and new (PostgreSQL) routes coexist
- Feature flag `MULTI_TENANT_ENABLED` controls which path is active
- Frontend can be migrated per-tenant (tenant A on v1, tenant B on legacy)
- Rollback: set `MULTI_TENANT_ENABLED=false` to revert to single-tenant

---

## 8. Folder Structure

```
packages/reporting-app/backend/
├── config/
│   ├── orthanc-multi-tenant.json       # Orthanc PACS configuration
│   └── orthanc-lua/
│       └── multi-tenant-routing.lua    # Lua script for tenant routing
├── migrations/
│   ├── 001_multi_tenant_schema.sql     # Full PostgreSQL schema with RLS
│   └── 002_backfill_tenant_id.sql      # Data migration from Firestore
├── src/
│   ├── config/
│   │   └── env.ts                      # Updated: DATABASE_URL, JWT_SECRET, etc.
│   ├── db/
│   │   └── postgres.ts                 # Connection pool + tenantQuery()
│   ├── middleware/
│   │   ├── auth.ts                     # Existing session auth (unchanged)
│   │   ├── tenantContext.ts            # NEW: JWT → tenant context
│   │   ├── tenantGuard.ts             # NEW: IDOR prevention + study access
│   │   ├── security.ts                 # Existing Helmet/CORS (unchanged)
│   │   └── asyncHandler.ts             # Existing (unchanged)
│   ├── routes/
│   │   ├── auth.ts                     # Existing session auth routes
│   │   ├── tenantAuth.ts              # NEW: JWT login/register/refresh
│   │   ├── tenantAdmin.ts            # NEW: tenant + user management
│   │   ├── dicomweb.ts                 # Existing Dicoogle proxy (unchanged)
│   │   ├── dicomwebMultiTenant.ts     # NEW: Orthanc proxy with tenant scope
│   │   └── ... (existing routes)
│   ├── services/
│   │   ├── store.ts                    # Existing Firestore store (unchanged)
│   │   ├── jwtService.ts             # NEW: JWT generation + refresh tokens
│   │   ├── tenantScopedStore.ts      # NEW: PostgreSQL tenant-scoped CRUD
│   │   └── ... (existing services)
│   ├── app.ts                          # Updated: mounts /api/v1/* routes
│   └── server.ts                       # Unchanged
└── package.json                        # Updated: pg, jsonwebtoken, bcryptjs
```

---

## 9. Bonus: Advanced Features

### Audit Logs

Already implemented in `TenantScopedStore.writeAuditLog()`:

```typescript
await store.writeAuditLog(tenantId, {
  userId: req.tokenPayload.sub,
  action: "report_signed",
  resourceType: "report",
  resourceId: reportId,
  details: { previousStatus: "draft", newStatus: "final" },
  ipAddress: req.ip,
  userAgent: req.get("user-agent"),
});
```

Queryable by tenant, user, action, resource type, and time range.

### Multi-Tenant Billing

Add a `tenant_billing` table:

```sql
CREATE TABLE tenant_billing (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    study_count     INTEGER DEFAULT 0,
    storage_gb      DECIMAL(10,2) DEFAULT 0,
    user_count      INTEGER DEFAULT 0,
    ai_inference_count INTEGER DEFAULT 0,
    amount_cents    INTEGER DEFAULT 0,
    currency        VARCHAR(3) DEFAULT 'USD',
    status          VARCHAR(20) DEFAULT 'pending',
    invoice_url     VARCHAR(500),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

Meter usage with a cron job:

```sql
INSERT INTO tenant_billing (tenant_id, period_start, period_end, study_count, user_count)
SELECT
    t.id,
    date_trunc('month', NOW()),
    date_trunc('month', NOW()) + interval '1 month',
    (SELECT COUNT(*) FROM studies WHERE tenant_id = t.id AND created_at >= date_trunc('month', NOW())),
    (SELECT COUNT(*) FROM users WHERE tenant_id = t.id AND is_approved = true)
FROM tenants t
WHERE t.is_active = true;
```

### AI Pipeline Isolation

Each tenant can have its own model configuration:

```sql
ALTER TABLE tenants ADD COLUMN ai_config JSONB DEFAULT '{
    "monai_enabled": false,
    "model_name": "default",
    "max_concurrent_inferences": 2,
    "allowed_modalities": ["CT", "MR"]
}'::jsonb;
```

Pass tenant context to AI microservices:

```typescript
const response = await axios.post(`${env.MONAI_SERVER_URL}/inference`, dicomData, {
    headers: {
        "X-Tenant-Id": tenantId,
        "X-Internal-Secret": env.INTERNAL_SERVICE_SECRET,
    },
});
```

### When to Move to Separate DB per Tenant


| Signal                 | Threshold                               |
| ---------------------- | --------------------------------------- |
| Query latency P99      | > 200ms for tenant-scoped queries       |
| Table row count        | > 50M rows in studies table             |
| Tenant count           | > 500 tenants on shared DB              |
| Compliance requirement | Tenant demands physical data isolation  |
| Data sovereignty       | Tenant requires data in specific region |


**Hybrid approach:** Start shared, promote high-value tenants to dedicated:

```typescript
function getConnectionForTenant(tenantId: string): Pool {
    const dedicatedDb = tenantDbMap.get(tenantId);
    if (dedicatedDb) return dedicatedDb;
    return sharedPool; // Default shared database
}
```

