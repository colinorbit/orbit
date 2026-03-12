-- Migration 003: Super Admin support
-- Run with: psql $DATABASE_URL < migrations/003_superadmin.sql

-- Add superadmin role to users
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('superadmin', 'admin', 'officer', 'viewer', 'readonly'));

-- Add must_change_password flag
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- Add last_login_at column (standardized name)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Add title column
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS title TEXT;

-- Add first_name / last_name if not present
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Integration configs table (encrypted credentials per org)
CREATE TABLE IF NOT EXISTS integration_configs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_type  TEXT NOT NULL,
  config_encrypted  TEXT NOT NULL,  -- AES-256 encrypted JSON
  enabled           BOOLEAN NOT NULL DEFAULT true,
  last_sync_at      TIMESTAMPTZ,
  last_sync_status  TEXT,
  sync_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, integration_type)
);

CREATE INDEX IF NOT EXISTS idx_integration_configs_org ON integration_configs(org_id);

-- Audit log table (persist superadmin actions)
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID,
  actor_email TEXT,
  action      TEXT NOT NULL,
  target_id   TEXT,
  target_type TEXT,
  detail      JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

-- Provision a demo superadmin user (password: ChangeMe123!)
-- Replace with bcrypt hash of real password before deploying
-- INSERT INTO users (id, email, password_hash, name, first_name, last_name, role, org_id, created_at, updated_at)
-- VALUES (gen_random_uuid(), 'admin@orbit.ai',
--         '$2b$12$placeholder_replace_with_real_hash',
--         'Orbit Admin', 'Orbit', 'Admin', 'superadmin', NULL, NOW(), NOW());

