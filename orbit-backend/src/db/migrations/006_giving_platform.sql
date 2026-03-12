-- ═══════════════════════════════════════════════════════════════════════════
--  ORBIT GIVING PLATFORM — Database Schema  v1.0
--  Migration 006_giving_platform.sql
--
--  Tables:
--    giving_campaigns      — campaign config, goals, branding, settings
--    giving_gifts          — every donation across all campaigns + standalone
--    giving_challenges     — matching/unlock/power hour challenges
--    giving_ambassadors    — volunteer fundraiser accounts + pages
--    giving_milestones     — stretch goals and celebration triggers
--    giving_form_links     — many-to-many: forms ↔ campaigns
--    giving_page_views     — analytics: views, sources, conversion funnel
-- ═══════════════════════════════════════════════════════════════════════════

-- ── giving_campaigns ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS giving_campaigns (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL,                          -- URL: give.u.edu/<slug>
  type                  TEXT NOT NULL DEFAULT 'giving_day',    -- giving_day|giving_month|annual_fund|capital|peer_to_peer|emergency
  status                TEXT NOT NULL DEFAULT 'draft',         -- draft|scheduled|live|paused|ended|archived

  -- Goals
  goal                  NUMERIC(14,2) DEFAULT 250000,
  donor_count_goal      INT DEFAULT 500,
  stretch_goals         JSONB DEFAULT '[]',                    -- [{amount, label, unlocked}]

  -- Dates
  start_date            TIMESTAMPTZ,
  end_date              TIMESTAMPTZ,
  timezone              TEXT DEFAULT 'America/New_York',

  -- Branding
  headline              TEXT,
  subheadline           TEXT,
  description           TEXT,
  primary_color         TEXT DEFAULT '#2a8c7e',
  secondary_color       TEXT DEFAULT '#1a1d23',
  accent_color          TEXT DEFAULT '#4ade80',
  logo_url              TEXT,
  hero_image_url        TEXT,
  hero_video_url        TEXT,
  favicon_url           TEXT,
  custom_css            TEXT,

  -- Social
  social_hashtag        TEXT,
  social_share_title    TEXT,
  social_share_image    TEXT,
  twitter_handle        TEXT,
  facebook_page         TEXT,

  -- Configuration (JSONB blobs — flexible)
  funds                 JSONB DEFAULT '[]',                    -- [{id, name, goal, description, image_url}]
  leaderboard_config    JSONB DEFAULT '{"enabled":true,"types":["class_year","fund"]}',
  challenge_config      JSONB DEFAULT '{"challenges":[]}',
  ambassador_config     JSONB DEFAULT '{"enabled":false,"teams":[]}',
  form_config           JSONB DEFAULT '{"formIds":[],"defaultFormId":null}',
  notification_config   JSONB DEFAULT '{"email":true,"sms":true,"push":false}',
  matching_config       JSONB DEFAULT '{"enabled":false,"challenges":[]}',

  -- Stats cache (updated async, not source of truth)
  cached_raised         NUMERIC(14,2) DEFAULT 0,
  cached_gift_count     INT DEFAULT 0,
  cached_donor_count    INT DEFAULT 0,
  cached_at             TIMESTAMPTZ,

  -- Meta
  created_by            TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  published_at          TIMESTAMPTZ,
  ended_at              TIMESTAMPTZ,

  UNIQUE(org_id, slug),
  CONSTRAINT valid_type   CHECK (type IN ('giving_day','giving_month','annual_fund','capital','peer_to_peer','emergency')),
  CONSTRAINT valid_status CHECK (status IN ('draft','scheduled','live','paused','ended','archived'))
);

CREATE INDEX IF NOT EXISTS idx_giving_campaigns_org    ON giving_campaigns(org_id);
CREATE INDEX IF NOT EXISTS idx_giving_campaigns_status ON giving_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_giving_campaigns_slug   ON giving_campaigns(slug);

-- ── giving_gifts ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS giving_gifts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           UUID REFERENCES giving_campaigns(id) ON DELETE SET NULL,
  org_id                UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  -- Donor info (captured at time of gift, may not match donor record)
  donor_id              UUID REFERENCES donors(id) ON DELETE SET NULL,  -- matched post-gift
  donor_name            TEXT,
  donor_email           TEXT,
  donor_phone           TEXT,
  donor_class_year      INT,
  donor_school          TEXT,
  donor_state           TEXT,
  is_anonymous          BOOLEAN DEFAULT FALSE,

  -- Gift details
  amount                NUMERIC(12,2) NOT NULL,
  currency              TEXT DEFAULT 'USD',
  fund                  TEXT,
  designation           TEXT,
  is_recurring          BOOLEAN DEFAULT FALSE,
  frequency             TEXT,                                  -- monthly|quarterly|annually
  recurring_token       TEXT,                                  -- gateway recurring ID

  -- Tribute
  tribute_type          TEXT,                                  -- honor|memory
  tribute_name          TEXT,
  tribute_notify_email  TEXT,

  -- Campaign context
  ambassador_id         UUID,                                  -- FK to giving_ambassadors
  team_id               UUID,
  challenge_id          UUID,
  matching_eligible     BOOLEAN DEFAULT TRUE,
  match_amount          NUMERIC(12,2) DEFAULT 0,
  match_applied         BOOLEAN DEFAULT FALSE,

  -- Payment
  gateway               TEXT,
  gateway_transaction_id TEXT,
  gateway_fee           NUMERIC(8,2) DEFAULT 0,
  net_amount            NUMERIC(12,2),
  payment_method        TEXT,                                  -- card|ach|paypal|apple_pay|google_pay|daf
  status                TEXT DEFAULT 'pending',               -- pending|completed|failed|refunded|disputed

  -- Attribution
  referrer_url          TEXT,
  utm_source            TEXT,
  utm_medium            TEXT,
  utm_campaign          TEXT,
  device_type           TEXT,                                  -- mobile|desktop|tablet

  -- Acknowledgement
  ack_email_sent        BOOLEAN DEFAULT FALSE,
  ack_sent_at           TIMESTAMPTZ,
  crm_synced            BOOLEAN DEFAULT FALSE,
  crm_synced_at         TIMESTAMPTZ,

  -- Timestamps
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT valid_status CHECK (status IN ('pending','completed','failed','refunded','disputed')),
  CONSTRAINT positive_amount CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_giving_gifts_campaign  ON giving_gifts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_giving_gifts_org       ON giving_gifts(org_id);
CREATE INDEX IF NOT EXISTS idx_giving_gifts_email     ON giving_gifts(donor_email);
CREATE INDEX IF NOT EXISTS idx_giving_gifts_status    ON giving_gifts(status);
CREATE INDEX IF NOT EXISTS idx_giving_gifts_created   ON giving_gifts(created_at);
CREATE INDEX IF NOT EXISTS idx_giving_gifts_donor     ON giving_gifts(donor_id);

-- ── giving_challenges ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS giving_challenges (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           UUID NOT NULL REFERENCES giving_campaigns(id) ON DELETE CASCADE,
  org_id                UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  type                  TEXT NOT NULL,          -- matching|unlock|class_battle|time_match|stretch|faculty|board|first_time|loyalty
  label                 TEXT NOT NULL,
  description           TEXT,
  sponsor_name          TEXT,
  sponsor_logo_url      TEXT,

  -- Matching config
  match_ratio           TEXT DEFAULT '1:1',     -- 1:1|2:1|3:1
  match_cap             NUMERIC(12,2),
  match_used            NUMERIC(12,2) DEFAULT 0,

  -- Unlock/trigger config
  trigger_type          TEXT,                   -- donor_count|amount|class|time_window
  trigger_threshold     NUMERIC(12,2),
  bonus_amount          NUMERIC(12,2),

  -- Time window
  window_start          TIMESTAMPTZ,
  window_end            TIMESTAMPTZ,

  -- Status
  status                TEXT DEFAULT 'pending', -- pending|active|triggered|expired|paused
  triggered_at          TIMESTAMPTZ,
  progress              NUMERIC(5,2) DEFAULT 0, -- 0–100 percent

  display_order         INT DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_giving_challenges_campaign ON giving_challenges(campaign_id);

-- ── giving_ambassadors ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS giving_ambassadors (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           UUID NOT NULL REFERENCES giving_campaigns(id) ON DELETE CASCADE,
  org_id                UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  -- Identity
  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL,
  phone                 TEXT,
  class_year            INT,
  profile_image_url     TEXT,

  -- Team
  team_name             TEXT,
  team_id               UUID,
  is_team_captain       BOOLEAN DEFAULT FALSE,

  -- Personal page
  page_slug             TEXT,                   -- give.u.edu/<campaign>/ambassador/<slug>
  personal_message      TEXT,
  personal_goal         NUMERIC(12,2),
  header_image_url      TEXT,

  -- Stats
  gifts_driven          INT DEFAULT 0,
  amount_raised         NUMERIC(12,2) DEFAULT 0,
  page_views            INT DEFAULT 0,
  share_count           INT DEFAULT 0,

  -- Status
  status                TEXT DEFAULT 'active',  -- active|inactive|pending

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(campaign_id, email)
);

CREATE INDEX IF NOT EXISTS idx_giving_ambassadors_campaign ON giving_ambassadors(campaign_id);

-- ── giving_milestones ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS giving_milestones (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           UUID NOT NULL REFERENCES giving_campaigns(id) ON DELETE CASCADE,
  org_id                UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  type                  TEXT NOT NULL,          -- amount|donor_count|class_participation|time_based
  label                 TEXT NOT NULL,
  description           TEXT,
  threshold             NUMERIC(14,2),
  celebration_message   TEXT,
  icon                  TEXT DEFAULT '🎉',
  color                 TEXT DEFAULT '#4ade80',
  unlocked              BOOLEAN DEFAULT FALSE,
  unlocked_at           TIMESTAMPTZ,
  display_order         INT DEFAULT 0,

  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ── giving_form_links (many-to-many: forms ↔ campaigns) ──────────────────────
CREATE TABLE IF NOT EXISTS giving_form_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES giving_campaigns(id) ON DELETE CASCADE,
  form_id       TEXT NOT NULL,                  -- references GF_SEED_LIBRARY.id (string IDs)
  org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  is_default    BOOLEAN DEFAULT FALSE,
  fund_scope    TEXT,                            -- restrict this form to a specific fund
  display_order INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(campaign_id, form_id)
);

-- ── giving_page_views (funnel analytics) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS giving_page_views (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID REFERENCES giving_campaigns(id) ON DELETE CASCADE,
  org_id        UUID NOT NULL,
  session_id    TEXT,
  page          TEXT,                            -- /give|/give/leaderboard|/give/challenges
  referrer      TEXT,
  utm_source    TEXT,
  device_type   TEXT,
  converted     BOOLEAN DEFAULT FALSE,           -- did this session result in a gift?
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_giving_page_views_campaign ON giving_page_views(campaign_id);
CREATE INDEX IF NOT EXISTS idx_giving_page_views_created  ON giving_page_views(created_at);

-- ── Row Level Security ─────────────────────────────────────────────────────────
ALTER TABLE giving_campaigns    ENABLE ROW LEVEL SECURITY;
ALTER TABLE giving_gifts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE giving_challenges   ENABLE ROW LEVEL SECURITY;
ALTER TABLE giving_ambassadors  ENABLE ROW LEVEL SECURITY;
ALTER TABLE giving_milestones   ENABLE ROW LEVEL SECURITY;

CREATE POLICY giving_campaigns_org    ON giving_campaigns    USING (org_id = current_setting('app.org_id')::UUID);
CREATE POLICY giving_gifts_org        ON giving_gifts        USING (org_id = current_setting('app.org_id')::UUID);
CREATE POLICY giving_challenges_org   ON giving_challenges   USING (org_id = current_setting('app.org_id')::UUID);
CREATE POLICY giving_ambassadors_org  ON giving_ambassadors  USING (org_id = current_setting('app.org_id')::UUID);
CREATE POLICY giving_milestones_org   ON giving_milestones   USING (org_id = current_setting('app.org_id')::UUID);

-- ── Cache refresh function (called after each gift) ────────────────────────────
CREATE OR REPLACE FUNCTION refresh_campaign_cache(p_campaign_id UUID)
RETURNS VOID AS $$
  UPDATE giving_campaigns
  SET
    cached_raised      = (SELECT COALESCE(SUM(amount),0) FROM giving_gifts WHERE campaign_id=p_campaign_id AND status='completed'),
    cached_gift_count  = (SELECT COUNT(*) FROM giving_gifts WHERE campaign_id=p_campaign_id AND status='completed'),
    cached_donor_count = (SELECT COUNT(DISTINCT donor_email) FROM giving_gifts WHERE campaign_id=p_campaign_id AND status='completed'),
    cached_at          = NOW()
  WHERE id = p_campaign_id;
$$ LANGUAGE SQL;

-- ── Trigger: auto-refresh cache on gift insert/update ─────────────────────────
CREATE OR REPLACE FUNCTION trg_refresh_campaign_cache()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.campaign_id IS NOT NULL AND NEW.status = 'completed' THEN
    PERFORM refresh_campaign_cache(NEW.campaign_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_giving_gifts_cache ON giving_gifts;
CREATE TRIGGER trg_giving_gifts_cache
  AFTER INSERT OR UPDATE ON giving_gifts
  FOR EACH ROW EXECUTE FUNCTION trg_refresh_campaign_cache();
