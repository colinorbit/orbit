-- ============================================================
-- Orbit Migration 004: Persistent Audit Log
-- Run: psql $DATABASE_URL -f 004_audit_log.sql
-- ============================================================

-- Audit log table for FERPA compliance, SOC 2, and security forensics.
-- Every sensitive operation (donor views, data exports, config changes,
-- agent actions, billing events) is recorded here.
--
-- CRITICAL: This table must NEVER be deleted, even in development.
-- Retention policy: 7 years minimum (FERPA requirement for education records).

CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL       PRIMARY KEY,
  org_id        UUID            NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  actor_id      UUID            REFERENCES users(id) ON DELETE SET NULL,

  -- Action string: resource.verb pattern, e.g. 'donor.viewed', 'gift.created'
  action        VARCHAR(128)    NOT NULL,

  -- Resource being acted upon
  resource      VARCHAR(64)     NOT NULL,
  resource_id   VARCHAR(128),  -- UUID or external ID of the specific record

  -- Structured detail blob (JSON) — what changed, old/new values, etc.
  detail        JSONB           DEFAULT '{}'::jsonb,

  -- Request context
  ip_address    INET,
  user_agent    VARCHAR(255),

  -- Immutable timestamp — never allow UPDATE on this column
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ── Indexes for common query patterns ─────────────────────────────────────────
-- Org-level audit trail (most common — compliance report per org)
CREATE INDEX IF NOT EXISTS idx_audit_log_org_created
  ON audit_log (org_id, created_at DESC);

-- Actor audit trail (what did this user do?)
CREATE INDEX IF NOT EXISTS idx_audit_log_actor
  ON audit_log (actor_id, created_at DESC);

-- Resource audit trail (full history of a specific record)
CREATE INDEX IF NOT EXISTS idx_audit_log_resource
  ON audit_log (resource, resource_id, created_at DESC);

-- Action filtering (find all exports, all logins, etc.)
CREATE INDEX IF NOT EXISTS idx_audit_log_action
  ON audit_log (org_id, action, created_at DESC);

-- ── Prevent modifications (data integrity) ────────────────────────────────────
-- Audit records are append-only. Block UPDATE and DELETE at DB level.
-- Only superadmin can archive (never delete) via the purge procedure below.

CREATE OR REPLACE RULE audit_log_no_update AS
  ON UPDATE TO audit_log
  DO INSTEAD NOTHING;

CREATE OR REPLACE RULE audit_log_no_delete AS
  ON DELETE TO audit_log
  DO INSTEAD NOTHING;

-- ── Useful views for compliance reporting ─────────────────────────────────────
CREATE OR REPLACE VIEW v_audit_summary AS
SELECT
  al.org_id,
  o.name                              AS org_name,
  al.action,
  COUNT(*)                            AS event_count,
  MAX(al.created_at)                  AS last_seen,
  COUNT(DISTINCT al.actor_id)         AS unique_actors
FROM audit_log al
JOIN orgs o ON o.id = al.org_id
WHERE al.created_at >= NOW() - INTERVAL '90 days'
GROUP BY al.org_id, o.name, al.action
ORDER BY event_count DESC;

CREATE OR REPLACE VIEW v_recent_sensitive_actions AS
SELECT
  al.id,
  al.org_id,
  o.name                              AS org_name,
  u.email                             AS actor_email,
  al.action,
  al.resource,
  al.resource_id,
  al.detail,
  al.ip_address,
  al.created_at
FROM audit_log al
JOIN orgs o ON o.id = al.org_id
LEFT JOIN users u ON u.id = al.actor_id
WHERE al.action IN (
  'donor.export', 'donor.bulk_delete', 'config.api_key_viewed',
  'user.impersonated', 'billing.cancel_requested', 'org.suspended',
  'auth.failed_login', 'auth.password_reset', 'data.export'
)
ORDER BY al.created_at DESC
LIMIT 500;

-- ── Archival procedure (never delete — archive after 7 years) ────────────────
-- Call annually: SELECT archive_old_audit_logs();
CREATE OR REPLACE FUNCTION archive_old_audit_logs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  archived_count INTEGER;
BEGIN
  -- Move records older than 7 years to audit_log_archive
  -- (create archive table first if it doesn't exist)
  CREATE TABLE IF NOT EXISTS audit_log_archive (LIKE audit_log INCLUDING ALL);

  WITH moved AS (
    INSERT INTO audit_log_archive
    SELECT * FROM audit_log
    WHERE created_at < NOW() - INTERVAL '7 years'
    RETURNING id
  )
  SELECT COUNT(*) INTO archived_count FROM moved;

  -- Note: DELETE rule above prevents deletion — must disable rule temporarily
  -- In practice, archival should be done via pg_dump + external storage

  RAISE NOTICE 'Archived % audit log records older than 7 years', archived_count;
  RETURN archived_count;
END;
$$;

-- ── Grant permissions ──────────────────────────────────────────────────────────
-- Only the app user can INSERT. No UPDATE or DELETE (enforced by rules above).
GRANT INSERT ON audit_log TO orbit_app;
GRANT SELECT ON audit_log TO orbit_app;
GRANT SELECT ON v_audit_summary TO orbit_app;
GRANT SELECT ON v_recent_sensitive_actions TO orbit_app;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO orbit_app;

-- ── Seed: system audit event on migration run ─────────────────────────────────
-- Note: This requires a valid org to exist. Run AFTER org creation.
-- INSERT INTO audit_log (org_id, actor_id, action, resource, detail)
-- VALUES ('<your-org-uuid>', NULL, 'system.migration_run', 'schema', '{"migration":"004_audit_log.sql"}');

COMMENT ON TABLE audit_log IS
  'Append-only audit trail for FERPA compliance, SOC 2, and security forensics. '
  'Retention: 7 years minimum. No UPDATE or DELETE permitted by rule.';
