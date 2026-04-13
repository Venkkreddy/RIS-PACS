-- ============================================================================
-- MIGRATION 002: Backfill existing data into multi-tenant schema
-- Run AFTER 001_multi_tenant_schema.sql
--
-- Strategy:
--   1. Create a "default" tenant for all existing single-tenant data
--   2. Export Firestore collections → staging tables → tenant tables
--   3. Map existing user IDs to new UUIDs via a lookup table
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: Create the default tenant for migration
-- ---------------------------------------------------------------------------
INSERT INTO tenants (id, name, slug, ae_title, institution_name, storage_path, config)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Default Hospital (Migration)',
    'default-hospital',
    'DEFAULT_AE',
    'Default Hospital',
    '/storage/00000000-0000-0000-0000-000000000001',
    '{"migrated_from_single_tenant": true}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Step 2: Staging table for Firestore → PostgreSQL ID mapping
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _migration_id_map (
    old_id      VARCHAR(255) NOT NULL,
    new_id      UUID NOT NULL DEFAULT gen_random_uuid(),
    entity_type VARCHAR(50) NOT NULL,
    PRIMARY KEY (entity_type, old_id)
);

-- ---------------------------------------------------------------------------
-- Step 3: Import users from Firestore export (CSV/JSON → staging)
--
-- Firestore export expected format (CSV):
--   id, email, role, approved, requestStatus, authProvider, displayName, createdAt, updatedAt
--
-- Load via: \copy _staging_users FROM 'firestore_users.csv' CSV HEADER;
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _staging_users (
    old_id          VARCHAR(255),
    email           VARCHAR(255),
    role            VARCHAR(50),
    approved        BOOLEAN,
    request_status  VARCHAR(20),
    auth_provider   VARCHAR(50),
    display_name    VARCHAR(255),
    firebase_uid    VARCHAR(255),
    created_at      VARCHAR(100),
    updated_at      VARCHAR(100)
);

-- After loading staging data:
-- INSERT INTO _migration_id_map (old_id, entity_type)
-- SELECT old_id, 'user' FROM _staging_users ON CONFLICT DO NOTHING;
--
-- INSERT INTO users (id, tenant_id, email, display_name, role, is_approved, request_status,
--                    auth_provider, firebase_uid, created_at, updated_at)
-- SELECT
--     m.new_id,
--     '00000000-0000-0000-0000-000000000001',
--     s.email,
--     s.display_name,
--     s.role,
--     COALESCE(s.approved, false),
--     COALESCE(s.request_status, 'pending'),
--     s.auth_provider,
--     s.firebase_uid,
--     COALESCE(s.created_at::timestamptz, NOW()),
--     COALESCE(s.updated_at::timestamptz, NOW())
-- FROM _staging_users s
-- JOIN _migration_id_map m ON m.old_id = s.old_id AND m.entity_type = 'user';

-- ---------------------------------------------------------------------------
-- Step 4: Import patients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _staging_patients (
    old_id          VARCHAR(255),
    patient_id      VARCHAR(100),
    first_name      VARCHAR(255),
    last_name       VARCHAR(255),
    date_of_birth   VARCHAR(100),
    gender          VARCHAR(1),
    phone           VARCHAR(50),
    email           VARCHAR(255),
    address         TEXT,
    created_at      VARCHAR(100),
    updated_at      VARCHAR(100)
);

-- ---------------------------------------------------------------------------
-- Step 5: Import studies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _staging_studies (
    old_id              VARCHAR(255),
    study_instance_uid  VARCHAR(128),
    patient_name        VARCHAR(255),
    study_date          VARCHAR(100),
    modality            VARCHAR(16),
    description         TEXT,
    body_part           VARCHAR(100),
    location            VARCHAR(255),
    status              VARCHAR(20),
    assigned_to_old_id  VARCHAR(255),
    uploader_old_id     VARCHAR(255),
    metadata            TEXT,
    created_at          VARCHAR(100),
    updated_at          VARCHAR(100)
);

-- ---------------------------------------------------------------------------
-- Step 6: Import reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _staging_reports (
    old_id          VARCHAR(255),
    study_old_id    VARCHAR(255),
    template_old_id VARCHAR(255),
    content         TEXT,
    sections        TEXT,
    status          VARCHAR(20),
    priority        VARCHAR(20),
    owner_old_id    VARCHAR(255),
    metadata        TEXT,
    versions        TEXT,
    attachments     TEXT,
    created_at      VARCHAR(100),
    updated_at      VARCHAR(100)
);

-- ---------------------------------------------------------------------------
-- Step 7: Create the default tenant's DICOM config
-- ---------------------------------------------------------------------------
INSERT INTO tenant_dicom_config (tenant_id, ae_title, institution_name, storage_path)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'DEFAULT_AE',
    'Default Hospital',
    '/storage/00000000-0000-0000-0000-000000000001'
);

-- ---------------------------------------------------------------------------
-- Step 8: Verification queries (run manually after import)
-- ---------------------------------------------------------------------------

-- Check all tables have tenant_id populated:
-- SELECT 'users' AS tbl, COUNT(*) AS total, COUNT(tenant_id) AS with_tenant FROM users
-- UNION ALL SELECT 'patients', COUNT(*), COUNT(tenant_id) FROM patients
-- UNION ALL SELECT 'studies', COUNT(*), COUNT(tenant_id) FROM studies
-- UNION ALL SELECT 'reports', COUNT(*), COUNT(tenant_id) FROM reports;

-- Check no orphaned records:
-- SELECT 'studies' AS tbl, COUNT(*) FROM studies WHERE tenant_id NOT IN (SELECT id FROM tenants)
-- UNION ALL SELECT 'reports', COUNT(*) FROM reports WHERE tenant_id NOT IN (SELECT id FROM tenants);

-- ---------------------------------------------------------------------------
-- Step 9: Cleanup staging tables (run after verification)
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS _staging_users;
-- DROP TABLE IF EXISTS _staging_patients;
-- DROP TABLE IF EXISTS _staging_studies;
-- DROP TABLE IF EXISTS _staging_reports;
-- DROP TABLE IF EXISTS _migration_id_map;

COMMIT;
