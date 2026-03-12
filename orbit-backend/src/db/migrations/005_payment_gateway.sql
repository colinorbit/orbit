-- ═══════════════════════════════════════════════════════════════════════════
--  ORBIT MIGRATION 005: Universal Payment Gateway
--  
--  PCI DSS Compliance Notes:
--    - gateway_config_enc: AES-256-GCM encrypted blob (never decrypted in DB)
--    - orbit_transactions: stores transaction IDs only — NO card data ever
--    - gateway_config_public: safe public config (publishableKey, siteId etc)
--    - All columns explicitly exclude card numbers, CVVs, magnetic stripe data
--
--  Run: psql $DATABASE_URL -f 005_payment_gateway.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Extend orgs table with gateway configuration ─────────────────────────────
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS gateway              VARCHAR(50)  DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS gateway_config_enc   TEXT,          -- AES-256-GCM encrypted JSON (server-side only)
  ADD COLUMN IF NOT EXISTS gateway_config_public JSONB DEFAULT '{}'; -- safe public config (publishable keys only)

-- Supported gateway enum for validation
COMMENT ON COLUMN orgs.gateway IS 'One of: stripe, authorize, touchnet, cashnet, bbms, paypal';
COMMENT ON COLUMN orgs.gateway_config_enc IS 'AES-256-GCM encrypted gateway credentials. NEVER contains raw card data. Decrypted only in application memory.';
COMMENT ON COLUMN orgs.gateway_config_public IS 'Non-secret config safe for browser: publishableKey, loginId, upaySiteId, merchantAccountId etc.';

-- ─── Transaction log ──────────────────────────────────────────────────────────
-- PCI DSS Requirement 10: Maintain audit trail of all payment activity
-- This table ONLY stores transaction references — no card data
CREATE TABLE IF NOT EXISTS orbit_transactions (
  id               BIGSERIAL    PRIMARY KEY,
  org_id           UUID         NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  gateway          VARCHAR(50)  NOT NULL,
  transaction_id   VARCHAR(255) NOT NULL,          -- Gateway's transaction ref (opaque token)
  amount           NUMERIC(12,2),
  currency         VARCHAR(3)   DEFAULT 'USD',
  status           VARCHAR(50)  DEFAULT 'pending', -- pending | completed | failed | refunded | disputed
  donor_id         UUID         REFERENCES donors(id) ON DELETE SET NULL,
  gift_type        VARCHAR(50)  DEFAULT 'one_time', -- one_time | recurring | pledge_payment
  fund             VARCHAR(255),
  metadata         JSONB        DEFAULT '{}',       -- authCode, last4 (last 4 only!), pciModel, note
  refund_id        VARCHAR(255),
  refund_amount    NUMERIC(12,2),
  disputed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- PCI constraint: explicitly prohibit storing card numbers
  CONSTRAINT no_card_data CHECK (
    metadata::text NOT SIMILAR TO '%[0-9]{13,19}%'  -- Reject anything that looks like a PAN
  ),

  UNIQUE (gateway, transaction_id)
);

COMMENT ON TABLE orbit_transactions IS 'Payment transaction audit log. PCI DSS Req 10.2. No card data stored — transaction IDs only.';
COMMENT ON COLUMN orbit_transactions.metadata IS 'Safe metadata only: authCode, last4 (4 digits), pciModel. NEVER full card number, CVV, or track data.';

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_orbit_tx_org      ON orbit_transactions(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orbit_tx_donor    ON orbit_transactions(donor_id);
CREATE INDEX IF NOT EXISTS idx_orbit_tx_status   ON orbit_transactions(status);
CREATE INDEX IF NOT EXISTS idx_orbit_tx_gateway  ON orbit_transactions(gateway);

-- ─── Extend gifts table for gateway tracking ──────────────────────────────────
ALTER TABLE gifts
  ADD COLUMN IF NOT EXISTS gateway_transaction_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS refund_reason          TEXT,
  ADD COLUMN IF NOT EXISTS gateway                VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_gifts_gateway_tx ON gifts(gateway_transaction_id) WHERE gateway_transaction_id IS NOT NULL;

-- ─── Extend donors table for recurring gift tracking ─────────────────────────
ALTER TABLE donors
  ADD COLUMN IF NOT EXISTS recurring_gift_amount      NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS recurring_gift_interval    VARCHAR(20),  -- month | quarter | year
  ADD COLUMN IF NOT EXISTS recurring_subscription_id  VARCHAR(255); -- gateway subscription/plan ID (opaque)

-- ─── Gateway health log ───────────────────────────────────────────────────────
-- Track gateway availability for dashboard monitoring
CREATE TABLE IF NOT EXISTS gateway_health_log (
  id         BIGSERIAL   PRIMARY KEY,
  org_id     UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  gateway    VARCHAR(50) NOT NULL,
  status     VARCHAR(20) NOT NULL, -- ok | degraded | error
  latency_ms INTEGER,
  error_msg  TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gateway_health_org ON gateway_health_log(org_id, checked_at DESC);

-- ─── Row-Level Security: transactions visible to own org only ─────────────────
ALTER TABLE orbit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS orbit_transactions_org_isolation
  ON orbit_transactions
  FOR ALL
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- ─── PCI DSS Audit comments ───────────────────────────────────────────────────
COMMENT ON TABLE gateway_health_log IS 'Gateway availability monitoring. PCI DSS Req 10.6.';

-- ─── Verify no sensitive columns exist (compliance assertion) ────────────────
DO $$
DECLARE
  bad_columns TEXT;
BEGIN
  SELECT string_agg(column_name, ', ')
  INTO bad_columns
  FROM information_schema.columns
  WHERE table_name IN ('orbit_transactions', 'gifts', 'donors')
    AND column_name IN ('card_number','pan','cvv','cvc','cvv2','track_data','magnetic_stripe','expiry');

  IF bad_columns IS NOT NULL THEN
    RAISE EXCEPTION 'PCI VIOLATION: Sensitive card columns found: %. Remove immediately.', bad_columns;
  END IF;

  RAISE NOTICE 'PCI DSS assertion passed: no card data columns found in payment tables.';
END;
$$;

COMMIT;
