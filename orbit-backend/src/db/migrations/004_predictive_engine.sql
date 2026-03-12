-- ═══════════════════════════════════════════════════════════════════════════
--  ORBIT MIGRATION: Predictive Contact Engine
--  Adds signal ingestion table, wealth screening columns,
--  and contact readiness score columns to donors.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Donor signals table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS donor_signals (
  id              BIGSERIAL PRIMARY KEY,
  donor_id        INTEGER     NOT NULL,
  org_id          INTEGER     NOT NULL,
  source          VARCHAR(50) NOT NULL,  -- sec | linkedin | news | iwave | email | web
  type            VARCHAR(30) NOT NULL,  -- WEALTH | CAREER | LIFE | CAUSE | NETWORK | RISK
  headline        TEXT        NOT NULL,
  detail          TEXT,
  impact          TEXT,
  score           SMALLINT    DEFAULT 0, -- +/- impact on contact readiness
  raw_data        JSONB       DEFAULT '{}',
  applied         BOOLEAN     DEFAULT FALSE,
  applied_at      TIMESTAMPTZ,
  applied_by      TEXT,                  -- user sub who applied it
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(donor_id, org_id, source, headline)   -- prevent duplicates
);

CREATE INDEX IF NOT EXISTS idx_donor_signals_donor  ON donor_signals(donor_id, org_id);
CREATE INDEX IF NOT EXISTS idx_donor_signals_type   ON donor_signals(type);
CREATE INDEX IF NOT EXISTS idx_donor_signals_source ON donor_signals(source);
CREATE INDEX IF NOT EXISTS idx_donor_signals_date   ON donor_signals(created_at DESC);

-- ── 2. Donor wealth screening columns ────────────────────────────────────────
ALTER TABLE donors
  ADD COLUMN IF NOT EXISTS wealth_score             SMALLINT,     -- 0–100 (iWave/DG)
  ADD COLUMN IF NOT EXISTS capacity_rating          INTEGER,      -- dollar tier (e.g. 50000 = $50K capacity)
  ADD COLUMN IF NOT EXISTS iwave_score              SMALLINT,
  ADD COLUMN IF NOT EXISTS donorsearch_rating       VARCHAR(5),
  ADD COLUMN IF NOT EXISTS cik_number               VARCHAR(20),  -- SEC CIK for insider trade lookup
  ADD COLUMN IF NOT EXISTS screened_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS birthday                 DATE,
  ADD COLUMN IF NOT EXISTS city                     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state                    VARCHAR(10),
  ADD COLUMN IF NOT EXISTS recent_email_opens       SMALLINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recent_web_visit         BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS response_rate            NUMERIC(4,3), -- 0.000–1.000
  ADD COLUMN IF NOT EXISTS giving_years             SMALLINT,
  ADD COLUMN IF NOT EXISTS campaign_priority        BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS named_prospect           BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS board_connection         BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS legacy_flag              BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS major_gift_prospect      BOOLEAN  DEFAULT FALSE;

-- ── 3. Contact readiness output columns ──────────────────────────────────────
ALTER TABLE donors
  ADD COLUMN IF NOT EXISTS contact_readiness_score  SMALLINT,     -- 0–100 composite
  ADD COLUMN IF NOT EXISTS contact_urgency          VARCHAR(20),  -- immediate|this_week|this_month|hold
  ADD COLUMN IF NOT EXISTS recommended_channel      VARCHAR(20),  -- email|phone|sms|handwritten|in_person
  ADD COLUMN IF NOT EXISTS ask_readiness            VARCHAR(20),  -- not_ready|cultivate|soft_ask|hard_ask
  ADD COLUMN IF NOT EXISTS estimated_ask_amount     INTEGER,      -- dollars
  ADD COLUMN IF NOT EXISTS score_computed_at        TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_donors_readiness
  ON donors(org_id, contact_readiness_score DESC NULLS LAST, contact_urgency);

-- ── 4. Email events table (for engagement tracking) ──────────────────────────
CREATE TABLE IF NOT EXISTS email_events (
  id          BIGSERIAL PRIMARY KEY,
  org_id      INTEGER     NOT NULL,
  donor_id    INTEGER,
  email       VARCHAR(255),
  event_type  VARCHAR(30) NOT NULL,   -- open | click | reply | bounce | unsubscribe
  message_id  VARCHAR(255),
  opened_at   TIMESTAMPTZ DEFAULT NOW(),
  metadata    JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_email_events_donor ON email_events(donor_id, org_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_events_type  ON email_events(event_type, opened_at DESC);

-- ── 5. Agent score audit log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_score_log (
  id              BIGSERIAL PRIMARY KEY,
  org_id          INTEGER     NOT NULL,
  donor_id        INTEGER     NOT NULL,
  score           SMALLINT,
  urgency         VARCHAR(20),
  channel         VARCHAR(20),
  ask_readiness   VARCHAR(20),
  triggers        JSONB,
  breakdown       JSONB,
  computed_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_score_log_donor ON agent_score_log(donor_id, org_id, computed_at DESC);
