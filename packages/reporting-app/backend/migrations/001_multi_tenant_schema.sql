-- ============================================================================
-- MIGRATION 001: Multi-Tenant Schema
-- Transforms single-tenant RIS/PACS system into multi-tenant architecture
-- Target: PostgreSQL 15+
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Extension: UUID generation
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Table: tenants (core tenant registry)
-- ---------------------------------------------------------------------------
CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(100) NOT NULL UNIQUE,
    ae_title        VARCHAR(16)  NOT NULL UNIQUE,  -- DICOM AE Title (max 16 chars per standard)
    institution_name VARCHAR(255),
    domain          VARCHAR(255) UNIQUE,            -- optional domain-based routing
    storage_path    VARCHAR(500),
    s3_bucket       VARCHAR(255),
    s3_prefix       VARCHAR(255),
    config          JSONB DEFAULT '{}'::jsonb,
    is_active       BOOLEAN DEFAULT true,
    max_users       INTEGER DEFAULT 100,
    max_storage_gb  INTEGER DEFAULT 500,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Table: users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    password_hash   VARCHAR(255),
    display_name    VARCHAR(255),
    role            VARCHAR(50)  NOT NULL DEFAULT 'viewer'
                      CHECK (role IN ('super_admin','admin','developer','radiologist','radiographer',
                                      'referring','billing','receptionist','viewer')),
    is_approved     BOOLEAN DEFAULT false,
    request_status  VARCHAR(20) DEFAULT 'pending'
                      CHECK (request_status IN ('pending','approved','rejected')),
    auth_provider   VARCHAR(50) DEFAULT 'local',
    firebase_uid    VARCHAR(255),
    google_id       VARCHAR(255),
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, email)
);

-- ---------------------------------------------------------------------------
-- Table: patients
-- ---------------------------------------------------------------------------
CREATE TABLE patients (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id      VARCHAR(100) NOT NULL,          -- MRN / hospital ID
    first_name      VARCHAR(255) NOT NULL,
    last_name       VARCHAR(255) NOT NULL,
    date_of_birth   DATE,
    gender          VARCHAR(1) CHECK (gender IN ('M','F','O')),
    phone           VARCHAR(50),
    email           VARCHAR(255),
    address         TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, patient_id)
);

-- ---------------------------------------------------------------------------
-- Table: studies
-- ---------------------------------------------------------------------------
CREATE TABLE studies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    study_instance_uid  VARCHAR(128) NOT NULL,
    patient_name        VARCHAR(255),
    patient_id_ref      UUID REFERENCES patients(id),
    study_date          DATE,
    modality            VARCHAR(16),
    description         TEXT,
    body_part           VARCHAR(100),
    location            VARCHAR(255),
    status              VARCHAR(20) DEFAULT 'unassigned'
                          CHECK (status IN ('unassigned','assigned','reported')),
    assigned_to         UUID REFERENCES users(id),
    assigned_at         TIMESTAMPTZ,
    reported_at         TIMESTAMPTZ,
    tat_hours           DECIMAL(10,2),
    uploader_id         UUID REFERENCES users(id),
    ae_title            VARCHAR(16),
    institution_name    VARCHAR(255),
    metadata            JSONB DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, study_instance_uid)
);

-- ---------------------------------------------------------------------------
-- Table: reports
-- ---------------------------------------------------------------------------
CREATE TABLE reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    study_id        UUID REFERENCES studies(id),
    template_id     UUID,
    content         TEXT,
    sections        JSONB DEFAULT '[]'::jsonb,
    status          VARCHAR(20) DEFAULT 'draft'
                      CHECK (status IN ('draft','preliminary','final','amended','cancelled')),
    priority        VARCHAR(20) DEFAULT 'routine'
                      CHECK (priority IN ('routine','urgent','critical')),
    signed_by       UUID REFERENCES users(id),
    signed_at       TIMESTAMPTZ,
    owner_id        UUID NOT NULL REFERENCES users(id),
    metadata        JSONB DEFAULT '{}'::jsonb,
    versions        JSONB DEFAULT '[]'::jsonb,
    attachments     JSONB DEFAULT '[]'::jsonb,
    voice           JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Table: templates
-- ---------------------------------------------------------------------------
CREATE TABLE templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    content         TEXT,
    category        VARCHAR(100),
    modality        VARCHAR(16),
    body_part       VARCHAR(100),
    sections        JSONB DEFAULT '[]'::jsonb,
    is_system       BOOLEAN DEFAULT false,
    owner_id        UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Table: orders
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id                  UUID NOT NULL REFERENCES patients(id),
    patient_name                VARCHAR(255),
    referring_physician_id      UUID,
    referring_physician_name    VARCHAR(255),
    modality                    VARCHAR(16),
    body_part                   VARCHAR(100),
    clinical_history            TEXT,
    priority                    VARCHAR(20) DEFAULT 'routine'
                                  CHECK (priority IN ('routine','urgent','stat')),
    status                      VARCHAR(20) DEFAULT 'scheduled'
                                  CHECK (status IN ('scheduled','in-progress','completed','cancelled')),
    scheduled_date              TIMESTAMPTZ,
    completed_date              TIMESTAMPTZ,
    study_id                    UUID REFERENCES studies(id),
    report_id                   UUID REFERENCES reports(id),
    notes                       TEXT,
    created_by                  UUID NOT NULL REFERENCES users(id),
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Table: billing
-- ---------------------------------------------------------------------------
CREATE TABLE billing (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id        UUID REFERENCES orders(id),
    patient_id      UUID NOT NULL REFERENCES patients(id),
    patient_name    VARCHAR(255),
    description     TEXT,
    modality        VARCHAR(16),
    body_part       VARCHAR(100),
    amount          DECIMAL(12,2),
    status          VARCHAR(20) DEFAULT 'pending'
                      CHECK (status IN ('pending','invoiced','paid','cancelled')),
    invoice_number  VARCHAR(100),
    paid_date       DATE,
    notes           TEXT,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Table: referring_physicians
-- ---------------------------------------------------------------------------
CREATE TABLE referring_physicians (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    specialty       VARCHAR(100),
    phone           VARCHAR(50),
    email           VARCHAR(255),
    hospital        VARCHAR(255),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Table: role_permissions (per-tenant RBAC overrides)
-- ---------------------------------------------------------------------------
CREATE TABLE role_permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role            VARCHAR(50) NOT NULL,
    permissions     JSONB DEFAULT '[]'::jsonb,
    is_customized   BOOLEAN DEFAULT false,
    updated_by      UUID REFERENCES users(id),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, role)
);

-- ---------------------------------------------------------------------------
-- Table: tenant_dicom_config (per-tenant DICOM routing)
-- ---------------------------------------------------------------------------
CREATE TABLE tenant_dicom_config (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
    ae_title            VARCHAR(16) NOT NULL UNIQUE,
    calling_ae_titles   JSONB DEFAULT '[]'::jsonb,
    institution_name    VARCHAR(255),
    storage_path        VARCHAR(500),
    orthanc_peer_name   VARCHAR(100),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Table: audit_logs (immutable, append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    user_id         UUID REFERENCES users(id),
    action          VARCHAR(100) NOT NULL,
    resource_type   VARCHAR(100),
    resource_id     VARCHAR(255),
    details         JSONB DEFAULT '{}'::jsonb,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Table: refresh_tokens (JWT refresh token store)
-- ---------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked         BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES: Tenant-first composite indexes for query performance
-- ============================================================================

CREATE INDEX idx_users_tenant              ON users(tenant_id);
CREATE INDEX idx_users_tenant_email        ON users(tenant_id, email);
CREATE INDEX idx_users_tenant_role         ON users(tenant_id, role);
CREATE INDEX idx_users_firebase_uid        ON users(firebase_uid) WHERE firebase_uid IS NOT NULL;

CREATE INDEX idx_patients_tenant           ON patients(tenant_id);
CREATE INDEX idx_patients_tenant_mrn       ON patients(tenant_id, patient_id);
CREATE INDEX idx_patients_tenant_name      ON patients(tenant_id, last_name, first_name);

CREATE INDEX idx_studies_tenant            ON studies(tenant_id);
CREATE INDEX idx_studies_tenant_uid        ON studies(tenant_id, study_instance_uid);
CREATE INDEX idx_studies_tenant_status     ON studies(tenant_id, status);
CREATE INDEX idx_studies_tenant_assigned   ON studies(tenant_id, assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_studies_tenant_date       ON studies(tenant_id, study_date DESC);
CREATE INDEX idx_studies_ae_title          ON studies(ae_title) WHERE ae_title IS NOT NULL;

CREATE INDEX idx_reports_tenant            ON reports(tenant_id);
CREATE INDEX idx_reports_tenant_study      ON reports(tenant_id, study_id);
CREATE INDEX idx_reports_tenant_owner      ON reports(tenant_id, owner_id);
CREATE INDEX idx_reports_tenant_status     ON reports(tenant_id, status);

CREATE INDEX idx_templates_tenant          ON templates(tenant_id);
CREATE INDEX idx_templates_tenant_owner    ON templates(tenant_id, owner_id);

CREATE INDEX idx_orders_tenant             ON orders(tenant_id);
CREATE INDEX idx_orders_tenant_status      ON orders(tenant_id, status);
CREATE INDEX idx_orders_tenant_patient     ON orders(tenant_id, patient_id);
CREATE INDEX idx_orders_tenant_date        ON orders(tenant_id, scheduled_date DESC);

CREATE INDEX idx_billing_tenant            ON billing(tenant_id);
CREATE INDEX idx_billing_tenant_status     ON billing(tenant_id, status);
CREATE INDEX idx_billing_tenant_patient    ON billing(tenant_id, patient_id);

CREATE INDEX idx_ref_physicians_tenant     ON referring_physicians(tenant_id);

CREATE INDEX idx_audit_tenant_time         ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX idx_audit_tenant_user         ON audit_logs(tenant_id, user_id);
CREATE INDEX idx_audit_tenant_action       ON audit_logs(tenant_id, action);
CREATE INDEX idx_audit_tenant_resource     ON audit_logs(tenant_id, resource_type, resource_id);

CREATE INDEX idx_refresh_tokens_user       ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expiry     ON refresh_tokens(expires_at) WHERE revoked = false;

-- ============================================================================
-- ROW-LEVEL SECURITY (defense-in-depth — enforced even if app layer fails)
-- ============================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE referring_physicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

-- RLS policies use a session variable `app.current_tenant_id` set per connection.
-- The application sets this via: SET LOCAL app.current_tenant_id = '<uuid>';

CREATE POLICY tenant_isolation_users ON users
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_patients ON patients
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_studies ON studies
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_reports ON reports
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_templates ON templates
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_orders ON orders
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_billing ON billing
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_ref_physicians ON referring_physicians
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_audit ON audit_logs
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_role_perms ON role_permissions
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_refresh_tokens ON refresh_tokens
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- FUNCTIONS: Updated-at trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_patients_updated_at BEFORE UPDATE ON patients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_studies_updated_at BEFORE UPDATE ON studies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_reports_updated_at BEFORE UPDATE ON reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_templates_updated_at BEFORE UPDATE ON templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_billing_updated_at BEFORE UPDATE ON billing
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_ref_physicians_updated_at BEFORE UPDATE ON referring_physicians
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
