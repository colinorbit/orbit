-- ============================================================
-- Orbit Migration 003: Subscription Plans & Feature Flags
-- Run: psql $DATABASE_URL -f 003_subscription_plans.sql
-- ============================================================

-- ── Extend orgs table with billing/plan fields ────────────────────────────────
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS
  plan               VARCHAR(20)  NOT NULL DEFAULT 'trial'
  CONSTRAINT plan_check CHECK (plan IN ('trial','starter','growth','enterprise'));

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS
  billing_status     VARCHAR(20)  NOT NULL DEFAULT 'trialing'
  CONSTRAINT billing_status_check CHECK (billing_status IN
    ('trialing','active','past_due','suspended','cancelled'));

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS
  stripe_customer_id    VARCHAR(64)  UNIQUE;

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS
  stripe_subscription_id VARCHAR(64) UNIQUE;

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS
  trial_ends_at      TIMESTAMPTZ;

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS
  plan_seats         INTEGER      NOT NULL DEFAULT 2;

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS
  plan_donor_limit   INTEGER      NOT NULL DEFAULT 2500;

-- ── Feature flags per plan ─────────────────────────────────────────────────────
-- Stored as a JSONB column so we can add flags without migrations
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS
  feature_flags      JSONB        NOT NULL DEFAULT '{}'::jsonb;

-- ── Plan defaults function ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_plan_defaults()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  CASE NEW.plan
    WHEN 'starter' THEN
      NEW.plan_seats       := 2;
      NEW.plan_donor_limit := 2500;
      NEW.feature_flags    := '{"veo":true,"vso":true,"vpgo":false,"vco":false,
        "matching_gifts":false,"phone_dialer":false,"giving_day":false,
        "prospect_discovery":false,"social_comms":false,"bulk_ai":false}'::jsonb;
    WHEN 'growth' THEN
      NEW.plan_seats       := 10;
      NEW.plan_donor_limit := 15000;
      NEW.feature_flags    := '{"veo":true,"vso":true,"vpgo":true,"vco":true,
        "matching_gifts":true,"phone_dialer":true,"giving_day":true,
        "prospect_discovery":true,"social_comms":true,"bulk_ai":true}'::jsonb;
    WHEN 'enterprise' THEN
      NEW.plan_seats       := 9999;
      NEW.plan_donor_limit := 9999999;
      NEW.feature_flags    := '{"veo":true,"vso":true,"vpgo":true,"vco":true,
        "matching_gifts":true,"phone_dialer":true,"giving_day":true,
        "prospect_discovery":true,"social_comms":true,"bulk_ai":true,
        "sso":true,"custom_integrations":true,"sla":true}'::jsonb;
    WHEN 'trial' THEN
      NEW.plan_seats       := 5;
      NEW.plan_donor_limit := 500;
      NEW.feature_flags    := '{"veo":true,"vso":true,"vpgo":false,"vco":false,
        "matching_gifts":false,"phone_dialer":false,"giving_day":false,
        "prospect_discovery":false,"social_comms":false,"bulk_ai":false}'::jsonb;
    ELSE NULL;
  END CASE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_plan_defaults ON orgs;
CREATE TRIGGER trg_plan_defaults
  BEFORE INSERT OR UPDATE OF plan ON orgs
  FOR EACH ROW EXECUTE FUNCTION set_plan_defaults();

-- ── Subscription events log ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_events (
  id            BIGSERIAL     PRIMARY KEY,
  org_id        UUID          NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  event_type    VARCHAR(64)   NOT NULL,  -- 'created','upgraded','downgraded','cancelled','payment_failed'
  from_plan     VARCHAR(20),
  to_plan       VARCHAR(20),
  stripe_event_id VARCHAR(128) UNIQUE,
  amount_cents  INTEGER,
  currency      CHAR(3)       DEFAULT 'usd',
  metadata      JSONB         DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_events_org ON subscription_events (org_id, created_at DESC);

-- ── AI usage tracking (for cost monitoring per tenant) ────────────────────────
CREATE TABLE IF NOT EXISTS ai_usage (
  id             BIGSERIAL   PRIMARY KEY,
  org_id         UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id        UUID        REFERENCES users(id) ON DELETE SET NULL,
  model          VARCHAR(64) NOT NULL,
  input_tokens   INTEGER     NOT NULL DEFAULT 0,
  output_tokens  INTEGER     NOT NULL DEFAULT 0,
  feature        VARCHAR(64),  -- 'donor_briefing', 'outreach_draft', 'ask_engine', etc.
  cost_cents     NUMERIC(10,4) DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_org_day
  ON ai_usage (org_id, date_trunc('day', created_at) DESC);

-- ── View: daily AI cost per org (for superadmin cost monitoring) ─────────────
CREATE OR REPLACE VIEW v_ai_daily_cost AS
SELECT
  org_id,
  date_trunc('day', created_at)  AS day,
  SUM(input_tokens)              AS total_input_tokens,
  SUM(output_tokens)             AS total_output_tokens,
  SUM(cost_cents)                AS total_cost_cents,
  COUNT(*)                       AS request_count
FROM ai_usage
GROUP BY org_id, date_trunc('day', created_at)
ORDER BY day DESC;

-- ── View: MRR by plan (for superadmin revenue dashboard) ─────────────────────
CREATE OR REPLACE VIEW v_mrr_by_plan AS
SELECT
  plan,
  billing_status,
  COUNT(*)                                AS org_count,
  COUNT(*) * CASE plan
    WHEN 'starter'    THEN 49900
    WHEN 'growth'     THEN 129900
    WHEN 'enterprise' THEN 399900
    ELSE 0
  END / 100.0                            AS mrr_dollars
FROM orgs
WHERE billing_status IN ('active', 'past_due')
GROUP BY plan, billing_status
ORDER BY plan;

COMMENT ON TABLE subscription_events IS 'Immutable log of all subscription state changes. Used for revenue reporting and audit.';
COMMENT ON TABLE ai_usage IS 'Per-request AI token usage. Used for cost monitoring and per-tenant limits.';
