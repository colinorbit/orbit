-- ============================================================
-- ORBIT FUNDRAISING INTELLIGENCE — DATABASE SCHEMA
-- PostgreSQL 15+
-- Run: psql -U postgres -d orbit -f schema.sql
-- ------------------------------------------------------------
-- PRODUCTION NOTE: Foreign key CASCADE DELETE is enabled for
-- dev/staging convenience. Before production launch, consider:
--   (1) Soft-delete: add deleted_at TIMESTAMPTZ to orgs/donors
--   (2) Background archiver instead of hard cascade deletes
--   (3) Audit trail table to preserve deleted record history
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- fuzzy donor name search

-- ── ORGANIZATIONS (multi-tenant) ────────────────────────────────────────────
CREATE TABLE organizations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  settings      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── USERS ────────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'officer' CHECK (role IN ('admin','officer','viewer')),
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_org ON users(org_id);
CREATE INDEX idx_users_email ON users(email);

-- ── REFRESH TOKENS ────────────────────────────────────────────────────────────
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tokens_user ON refresh_tokens(user_id);

-- ── DONORS ───────────────────────────────────────────────────────────────────
CREATE TABLE donors (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Identity
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  mobile          TEXT,
  org_name        TEXT,          -- employer / affiliated organization
  title           TEXT,

  -- Derived: first name for email templates
  first_name      TEXT GENERATED ALWAYS AS (split_part(name, ' ', 1)) STORED,

  -- Address
  address_line1   TEXT,
  address_line2   TEXT,
  city            TEXT,
  state           TEXT,
  zip             TEXT,
  country         TEXT DEFAULT 'United States',

  -- Lifecycle
  stage           TEXT NOT NULL DEFAULT 'prospect'
                  CHECK (stage IN ('prospect','engaged','active','major_prospect',
                                   'lapsed','loyal','legacy_prospect','stewardship')),
  assigned_agent  TEXT CHECK (assigned_agent IN ('VEO','VSO','VPGO','VCO')),

  -- AI scores (updated each sync/run cycle)
  propensity_score  SMALLINT CHECK (propensity_score BETWEEN 0 AND 100),
  engagement_score  SMALLINT CHECK (engagement_score BETWEEN 0 AND 100),
  sentiment_trend   TEXT CHECK (sentiment_trend IN ('rising','stable','cooling')),

  -- Giving summary (denormalized for fast dashboard queries)
  lifetime_giving   NUMERIC(12,2) DEFAULT 0,
  last_gift_amount  NUMERIC(12,2),
  last_gift_date    DATE,
  total_gifts       INTEGER DEFAULT 0,
  consecutive_years INTEGER DEFAULT 0,
  capacity_estimate NUMERIC(12,2),

  -- Preferences & compliance
  preferred_channel TEXT CHECK (preferred_channel IN ('Email','Phone','SMS','Note')),
  sms_opt_in        BOOLEAN DEFAULT FALSE,
  email_opt_out     BOOLEAN DEFAULT FALSE,
  do_not_contact    BOOLEAN DEFAULT FALSE,

  -- Profile
  alumni_class_year SMALLINT,
  alumni_major      TEXT,
  alumni_degree     TEXT,
  interests         TEXT[],       -- array: ['Scholarships','STEM']
  birth_date        DATE,

  -- CRM external IDs (keyed by provider)
  external_ids      JSONB DEFAULT '{}',
  -- e.g. {"salesforce":"003xx","hubspot":"12345","blackbaud":"RENXT-00001"}

  -- Metadata
  last_contact_at   TIMESTAMPTZ,
  last_sync_at      TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_donors_org       ON donors(org_id);
CREATE INDEX idx_donors_stage     ON donors(org_id, stage);
CREATE INDEX idx_donors_agent     ON donors(org_id, assigned_agent);
CREATE INDEX idx_donors_email     ON donors(org_id, email);
CREATE INDEX idx_donors_scores    ON donors(org_id, propensity_score DESC, engagement_score DESC);
CREATE INDEX idx_donors_name_trgm ON donors USING gin(name gin_trgm_ops);
CREATE INDEX idx_donors_external  ON donors USING gin(external_ids);

-- ── GIFTS ────────────────────────────────────────────────────────────────────
CREATE TABLE gifts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  donor_id        UUID NOT NULL REFERENCES donors(id) ON DELETE CASCADE,

  amount          NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency        CHAR(3) DEFAULT 'USD',
  date            DATE NOT NULL,
  type            TEXT NOT NULL CHECK (type IN (
                    'Cash','Pledge','Recurring Gift','Stock',
                    'In-Kind','Matching Gift','Bequest','Wire Transfer')),
  status          TEXT NOT NULL DEFAULT 'completed'
                  CHECK (status IN ('completed','pending','failed','refunded')),

  fund            TEXT,
  campaign        TEXT,
  appeal          TEXT,

  acknowledged    BOOLEAN DEFAULT FALSE,
  receipt_sent    BOOLEAN DEFAULT FALSE,
  post_date       DATE,
  reference       TEXT,

  -- Payment details
  payment_method  TEXT,                 -- 'check','ach','wire','credit_card','stock','stripe_online'
  source          TEXT DEFAULT 'manual',-- 'manual','online','pledge_payment','stripe','crm_sync'
  is_recurring    BOOLEAN DEFAULT FALSE,
  designation     TEXT,                 -- purpose within the fund
  note            TEXT,                 -- internal note

  -- Matching gifts
  matching_gift_id   UUID,              -- FK added below (self-referential)
  matching_amount    NUMERIC(12,2),
  matching_status    TEXT DEFAULT 'ineligible'
                     CHECK (matching_status IN
                       ('ineligible','eligible','pending','submitted','confirmed','denied')),

  -- CRM provenance
  external_id     TEXT,
  external_source TEXT,  -- 'salesforce' | 'hubspot' | 'blackbaud' | 'manual'

  -- Pledge link
  pledge_id       UUID,  -- FK added below after pledges table

  -- Metadata blob (webhook payloads, analytics)
  metadata        JSONB DEFAULT '{}',

  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Self-referential matching gift link
ALTER TABLE gifts ADD CONSTRAINT fk_gift_match
  FOREIGN KEY (matching_gift_id) REFERENCES gifts(id) ON DELETE SET NULL;

CREATE INDEX idx_gifts_donor    ON gifts(donor_id);
CREATE INDEX idx_gifts_org_date ON gifts(org_id, date DESC);
CREATE INDEX idx_gifts_fund     ON gifts(org_id, fund);
CREATE INDEX idx_gifts_campaign ON gifts(org_id, campaign);
CREATE INDEX idx_gifts_external ON gifts(external_source, external_id);

-- ── PLEDGES ──────────────────────────────────────────────────────────────────
CREATE TABLE pledges (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  donor_id        UUID NOT NULL REFERENCES donors(id) ON DELETE CASCADE,

  total_amount       NUMERIC(12,2) NOT NULL,
  paid_amount        NUMERIC(12,2) DEFAULT 0,
  balance            NUMERIC(12,2) NOT NULL DEFAULT 0,  -- total_amount - paid_amount (trigger-maintained)
  installment_amount NUMERIC(12,2),
  frequency          TEXT DEFAULT 'annual'
                     CHECK (frequency IN ('monthly','quarterly','annual','one-time')),
  fund               TEXT,
  campaign           TEXT,
  start_date         DATE,
  end_date           DATE,
  next_due_date      DATE,
  status             TEXT NOT NULL DEFAULT 'current'
                     CHECK (status IN ('current','overdue','at-risk','paused','cancelled','fulfilled')),
  total_years        INTEGER,
  reminders_sent     INTEGER DEFAULT 0,

  external_id        TEXT,
  external_source    TEXT,

  notes              TEXT,
  metadata           JSONB DEFAULT '{}',

  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-maintain balance = total_amount - paid_amount
CREATE OR REPLACE FUNCTION sync_pledge_balance()
RETURNS TRIGGER AS $$
BEGIN
  NEW.balance := NEW.total_amount - COALESCE(NEW.paid_amount, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_pledge_balance
  BEFORE INSERT OR UPDATE OF total_amount, paid_amount ON pledges
  FOR EACH ROW EXECUTE FUNCTION sync_pledge_balance();

-- Back-link gifts → pledges
ALTER TABLE gifts ADD CONSTRAINT fk_gift_pledge
  FOREIGN KEY (pledge_id) REFERENCES pledges(id) ON DELETE SET NULL;

CREATE INDEX idx_pledges_donor  ON pledges(donor_id);
CREATE INDEX idx_pledges_org    ON pledges(org_id, status);
CREATE INDEX idx_pledges_due    ON pledges(org_id, next_due_date);

-- ── CAMPAIGNS ─────────────────────────────────────────────────────────────────
CREATE TABLE campaigns (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  status          TEXT DEFAULT 'draft'
                  CHECK (status IN ('draft','live','paused','completed')),
  assigned_agent  TEXT CHECK (assigned_agent IN ('VEO','VSO','VPGO','VCO')),
  channel         TEXT,
  goal            NUMERIC(12,2),
  raised          NUMERIC(12,2) DEFAULT 0,
  donor_count     INTEGER DEFAULT 0,
  start_date      DATE,
  end_date        DATE,
  settings        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_campaigns_org ON campaigns(org_id, status);

-- ── UNIQUE CONSTRAINT: idempotent external gift inserts ───────────────────────
-- Prevents duplicate gifts when Stripe/CRM webhooks retry
CREATE UNIQUE INDEX idx_gifts_external
  ON gifts(external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

-- ── AGENT CONFIGS ─────────────────────────────────────────────────────────────
CREATE TABLE agent_configs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_key       TEXT NOT NULL CHECK (agent_key IN ('VEO','VSO','VPGO','VCO')),
  config          JSONB NOT NULL DEFAULT '{}',
  -- Full config blob: persona, tone, cadence, thresholds, channels, integrations
  updated_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, agent_key)
);

-- ── AGENT ACTIVITY LOG ────────────────────────────────────────────────────────
CREATE TABLE agent_activities (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_key       TEXT NOT NULL,
  donor_id        UUID REFERENCES donors(id) ON DELETE SET NULL,
  donor_name      TEXT,          -- snapshot in case donor deleted
  type            TEXT NOT NULL, -- 'email_sent','brief_generated','gift_secured','call_scheduled'
  title           TEXT,
  detail          TEXT,
  amount          NUMERIC(12,2),
  ai_reasoning    TEXT,          -- Claude's reasoning trace
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activities_org   ON agent_activities(org_id, created_at DESC);
CREATE INDEX idx_activities_agent ON agent_activities(org_id, agent_key, created_at DESC);
CREATE INDEX idx_activities_donor ON agent_activities(donor_id);

-- ── OUTREACH / MESSAGES ───────────────────────────────────────────────────────
CREATE TABLE outreach_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  donor_id        UUID NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
  agent_key       TEXT NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('Email','SMS','Phone','Note')),
  subject         TEXT,
  body            TEXT NOT NULL,
  status          TEXT DEFAULT 'draft'
                  CHECK (status IN ('draft','scheduled','sent','delivered','opened','replied','bounced','failed')),
  scheduled_at    TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  opened_at       TIMESTAMPTZ,
  replied_at      TIMESTAMPTZ,
  ai_generated    BOOLEAN DEFAULT TRUE,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_donor  ON outreach_messages(donor_id);
CREATE INDEX idx_messages_org    ON outreach_messages(org_id, status);
CREATE INDEX idx_messages_sched  ON outreach_messages(org_id, scheduled_at) WHERE status='scheduled';

-- ── INTEGRATIONS ──────────────────────────────────────────────────────────────
CREATE TABLE integrations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL CHECK (provider IN (
                    'salesforce','hubspot','blackbaud','stripe','docusign','twilio','sendgrid')),
  status          TEXT DEFAULT 'disconnected'
                  CHECK (status IN ('connected','disconnected','error','syncing')),

  -- Encrypted credentials blob (AES-256-GCM via pgcrypto)
  credentials_enc BYTEA,

  -- Non-sensitive config
  config          JSONB DEFAULT '{}',
  -- e.g. {"syncInterval":15,"conflictRes":"last_modified_wins","syncObjects":{"gifts":true}}

  -- Sync state
  last_sync_at    TIMESTAMPTZ,
  last_sync_status TEXT,
  next_sync_at    TIMESTAMPTZ,
  records_synced  INTEGER DEFAULT 0,
  sync_errors     INTEGER DEFAULT 0,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, provider)
);

CREATE INDEX idx_integrations_org ON integrations(org_id);

-- ── SYNC EVENTS LOG ───────────────────────────────────────────────────────────
CREATE TABLE sync_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,
  type        TEXT NOT NULL,    -- 'constituent_synced','gift_created','solicit_code_added'
  status      TEXT NOT NULL CHECK (status IN ('ok','warn','error')),
  message     TEXT,
  payload     JSONB,            -- raw event payload for debugging
  duration_ms INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sync_events_org      ON sync_events(org_id, provider, created_at DESC);
CREATE INDEX idx_sync_events_status   ON sync_events(org_id, status, created_at DESC);

-- Partition by month for large orgs (optional, enable in production)
-- CREATE TABLE sync_events PARTITION BY RANGE (created_at);

-- ── GIFT AGREEMENTS ───────────────────────────────────────────────────────────
CREATE TABLE gift_agreements (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  donor_id        UUID NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
  pledge_id       UUID REFERENCES pledges(id),
  amount          NUMERIC(12,2),
  years           INTEGER,
  fund            TEXT,
  status          TEXT DEFAULT 'pending'
                  CHECK (status IN ('draft','sent','signed','declined','expired')),
  docusign_id     TEXT,         -- DocuSign envelope ID
  sent_at         TIMESTAMPTZ,
  signed_at       TIMESTAMPTZ,
  document_url    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agreements_org   ON gift_agreements(org_id, status);
CREATE INDEX idx_agreements_donor ON gift_agreements(donor_id);

-- ── METRIC SNAPSHOTS (for fast dashboard queries) ─────────────────────────────
-- Pre-computed daily by a cron job — avoids expensive real-time aggregations
CREATE TABLE metric_snapshots (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot_date   DATE NOT NULL,
  metrics         JSONB NOT NULL DEFAULT '{}',
  -- {raised_mtd, active_donors, open_pledges, retention_rate,
  --  new_donors, lapsed_donors, revenue_by_fund, revenue_by_agent, ...}
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, snapshot_date)
);

CREATE INDEX idx_snapshots_org ON metric_snapshots(org_id, snapshot_date DESC);

-- ── TRIGGERS: auto-update updated_at ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','users','donors','gifts','pledges',
    'campaigns','agent_configs','outreach_messages',
    'integrations','gift_agreements'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t, t
    );
  END LOOP;
END $$;

-- ── SEED: default organization ────────────────────────────────────────────────
INSERT INTO organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Greenfield University', 'greenfield');

INSERT INTO users (org_id, email, password_hash, name, role) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'sarah@greenfield.edu',
   crypt('orbit-demo-2026', gen_salt('bf')),
   'Sarah Chen',
   'admin');
