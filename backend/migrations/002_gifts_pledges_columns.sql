-- ============================================================
-- ORBIT MIGRATION 002
-- Adds columns required by gifts.js, pledges.js, webhooks
-- Safe to run on existing databases (uses IF NOT EXISTS)
-- Run: psql $DATABASE_URL -f 002_gifts_pledges_columns.sql
-- ============================================================

BEGIN;

-- ── GIFTS TABLE ──────────────────────────────────────────────────────────────

-- Payment method (stripe_online, check, wire, ach, stock, etc.)
ALTER TABLE gifts
  ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- Source of the gift (online, manual, crm_sync, pledge_payment, stripe)
ALTER TABLE gifts
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

-- Recurring gift flag
ALTER TABLE gifts
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE;

-- Designation (specific purpose within a fund)
ALTER TABLE gifts
  ADD COLUMN IF NOT EXISTS designation TEXT;

-- Internal note (previously "notes" — adding "note" as alias for routes)
ALTER TABLE gifts
  ADD COLUMN IF NOT EXISTS note TEXT;

-- Matching gift columns
ALTER TABLE gifts
  ADD COLUMN IF NOT EXISTS matching_gift_id   UUID    REFERENCES gifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS matching_amount    NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS matching_status    TEXT DEFAULT 'ineligible'
    CHECK (matching_status IN ('ineligible','eligible','pending','submitted','confirmed','denied'));

-- Metadata blob for webhook payloads, custom args
ALTER TABLE gifts
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Ensure idempotent external inserts work
-- (unique constraint may already exist from previous schema run — ignore if so)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'gifts'
      AND indexname  = 'idx_gifts_external_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_gifts_external_unique
      ON gifts(external_source, external_id)
      WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
  END IF;
END $$;

-- ── PLEDGES TABLE ─────────────────────────────────────────────────────────────

-- Running balance (total_amount - paid_amount, kept in sync by trigger)
ALTER TABLE pledges
  ADD COLUMN IF NOT EXISTS balance NUMERIC(12,2);

-- Normalize: rename installment → installment_amount (new code uses this name)
-- If installment_amount already exists, skip
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pledges' AND column_name = 'installment_amount'
  ) THEN
    ALTER TABLE pledges RENAME COLUMN installment TO installment_amount;
  END IF;
END $$;

-- Notes on the pledge
ALTER TABLE pledges
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Count of reminder messages sent (for throttling)
ALTER TABLE pledges
  ADD COLUMN IF NOT EXISTS reminders_sent INTEGER DEFAULT 0;

-- Metadata blob
ALTER TABLE pledges
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- ── BACKFILL: set balance = total_amount - paid_amount ────────────────────────
UPDATE pledges
  SET balance = total_amount - COALESCE(paid_amount, 0)
  WHERE balance IS NULL;

-- Make balance NOT NULL after backfill
ALTER TABLE pledges ALTER COLUMN balance SET NOT NULL;
ALTER TABLE pledges ALTER COLUMN balance SET DEFAULT 0;

-- ── TRIGGER: keep balance in sync automatically ────────────────────────────────
CREATE OR REPLACE FUNCTION sync_pledge_balance()
RETURNS TRIGGER AS $$
BEGIN
  NEW.balance := NEW.total_amount - COALESCE(NEW.paid_amount, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pledge_balance ON pledges;
CREATE TRIGGER trg_pledge_balance
  BEFORE INSERT OR UPDATE OF total_amount, paid_amount ON pledges
  FOR EACH ROW EXECUTE FUNCTION sync_pledge_balance();

-- ── ORGANIZATIONS: billing settings column (for Stripe webhook) ───────────────
-- settings is already JSONB — no migration needed, JSONB handles ad-hoc keys
-- But add a billing_status index for fast suspension checks on every API request:

CREATE INDEX IF NOT EXISTS idx_orgs_billing_status
  ON organizations((settings->>'billing_status'));

-- ── ADD first_name to donors (derived from name, used by email templates) ─────
ALTER TABLE donors
  ADD COLUMN IF NOT EXISTS first_name TEXT
    GENERATED ALWAYS AS (split_part(name, ' ', 1)) STORED;

COMMIT;

-- ── VERIFY (prints column list for manual confirmation) ───────────────────────
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name IN ('gifts', 'pledges')
  AND column_name IN (
    'payment_method','source','is_recurring','designation','note',
    'matching_status','metadata',
    'balance','installment_amount','notes','reminders_sent'
  )
ORDER BY table_name, column_name;
