'use strict';
/**
 * Sync Service
 * Orchestrates bi-directional data sync between Orbit and CRM providers.
 * Each provider has a dedicated adapter that maps provider records → Orbit schema.
 */

const db      = require('../db');
const { decrypt } = require('../utils/crypto');
const logger  = require('../utils/logger');
const hubspot     = require('../integrations/hubspot');
const salesforce  = require('../integrations/salesforce');
const blackbaud   = require('../integrations/blackbaud');

const ADAPTERS = { hubspot, salesforce, blackbaud };

/**
 * Test a connection without saving credentials.
 * Returns { ok: true } or { ok: false, error: string }
 */
async function testConnection(provider, creds) {
  const adapter = ADAPTERS[provider];
  if (!adapter) return { ok: false, error: `Unsupported provider: ${provider}` };
  try {
    return await adapter.testConnection(creds);
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Full bi-directional sync for an org + provider.
 * Pulls from CRM, upserts to Orbit DB, then pushes Orbit scores back.
 */
async function triggerSync(orgId, provider) {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`Unsupported provider: ${provider}`);

  // Acquire DB advisory lock keyed on org+provider hash (prevents concurrent syncs)
  const lockKey = require('crypto')
    .createHash('md5').update(orgId + provider).digest('hex').slice(0, 8);
  const lockId  = parseInt(lockKey, 16);
  const lockResult = await db.query('SELECT pg_try_advisory_lock($1) AS acquired', [lockId]);
  if (!lockResult.rows[0].acquired) {
    logger.info('Sync skipped — already locked', { orgId, provider });
    return { synced: 0, errors: 0, skipped: true };
  }

  // Mark as syncing
  await db.query(
    `UPDATE integrations SET status='syncing', updated_at=NOW()
     WHERE org_id=$1 AND provider=$2`,
    [orgId, provider]
  );

  const started = Date.now();
  let synced = 0, errors = 0;

  try {
    // Load encrypted credentials
    const { rows } = await db.query(
      'SELECT credentials_enc, config FROM integrations WHERE org_id=$1 AND provider=$2',
      [orgId, provider]
    );
    if (!rows[0] || !rows[0].credentials_enc) throw new Error('No credentials stored');

    const creds  = decrypt(rows[0].credentials_enc);
    const config = rows[0].config || {};

    // ── PULL: CRM → Orbit ────────────────────────────────────────────────────
    logger.info(`Sync pull started`, { orgId, provider });
    const pullResult = await adapter.pull(creds, config, orgId);

    // If the adapter refreshed the OAuth access_token (e.g. RE NXT), write it back.
    // Without this, the next sync starts with the original stale token and refresh
    // fails silently, breaking all CRM data flow.
    if (creds._tokenRefreshed && creds.accessToken) {
      const updatedCreds = { ...decrypt(rows[0].credentials_enc), accessToken: creds.accessToken };
      await db.query(
        `UPDATE integrations SET credentials_enc=$1, updated_at=NOW()
         WHERE org_id=$2 AND provider=$3`,
        [encrypt(updatedCreds), orgId, provider]
      );
      logger.info('CRM OAuth token written back to DB', { orgId, provider });
    }

    for (const record of pullResult.donors || []) {
      try {
        await upsertDonor(orgId, provider, record);
        synced++;
      } catch (e) {
        errors++;
        await logSyncEvent(orgId, provider, 'donor_upsert', 'error', e.message);
        logger.warn('Donor upsert failed', { provider, record: record.externalId, err: e.message });
      }
    }

    for (const gift of pullResult.gifts || []) {
      try {
        await upsertGift(orgId, provider, gift);
      } catch (e) {
        errors++;
        await logSyncEvent(orgId, provider, 'gift_upsert', 'error', e.message);
      }
    }

    await logSyncEvent(orgId, provider, 'pull_complete', 'ok',
      `${synced} donors, ${pullResult.gifts?.length || 0} gifts`);

    // ── PUSH: Orbit scores → CRM ─────────────────────────────────────────────
    if (config.pushScores !== false) {
      logger.info('Sync push started', { orgId, provider });
      const donors = await db.query(
        `SELECT * FROM donors WHERE org_id=$1 AND last_sync_at < NOW() - INTERVAL '10 minutes'
         ORDER BY updated_at DESC LIMIT 500`,
        [orgId]
      );
      await adapter.push(creds, config, donors.rows);
      await logSyncEvent(orgId, provider, 'push_complete', 'ok',
        `Pushed scores for ${donors.rows.length} donors`);
    }

    // ── Update integration status ─────────────────────────────────────────────
    const duration = Date.now() - started;
    await db.query(
      `UPDATE integrations
       SET status='connected', last_sync_at=NOW(),
           next_sync_at=NOW()+($1 || ' minutes')::INTERVAL,
           records_synced=records_synced+$2,
           sync_errors=sync_errors+$3,
           updated_at=NOW()
       WHERE org_id=$4 AND provider=$5`,
      [config.syncInterval || 15, synced, errors, orgId, provider]
    );

    logger.info('Sync complete', { orgId, provider, synced, errors, durationMs: duration });
    return { synced, errors };

  } catch (e) {
    /* Detect credential revocation during sync */
    const isAuthError = e.status === 401 || String(e.message).includes('401') ||
      String(e.message).includes('Unauthorized') || String(e.message).includes('invalid_grant');
    const newStatus = isAuthError ? 'auth_expired' : 'error';
    await db.query(
      `UPDATE integrations SET status=$3, updated_at=NOW() WHERE org_id=$1 AND provider=$2`,
      [orgId, provider, newStatus]
    );
    await logSyncEvent(orgId, provider, 'sync_failed', 'error', e.message);
    if (isAuthError) logger.warn('Sync halted: CRM credentials expired/revoked', { orgId, provider });
    else logger.error('Sync failed', { orgId, provider, err: e.message });
    throw e;
  } finally {
    // Always release advisory lock
    if (typeof lockId !== 'undefined') {
      await db.query('SELECT pg_advisory_unlock($1)', [lockId]).catch(() => {});
    }
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function upsertDonor(orgId, provider, record) {
  // record shape from adapter.pull() — normalized to Orbit schema
  const {
    externalId, name, email, phone, orgName, title,
    city, state, zip, country,
    stage, interests, alumniClassYear,
    lifetimeGiving, lastGiftAmount, lastGiftDate,
    propensityScore, engagementScore,
    preferredChannel, smsOptIn, emailOptOut, doNotContact,
  } = record;

  // Dedup by email (primary) or external ID
  const existing = await db.query(
    `SELECT id, external_ids FROM donors WHERE org_id=$1 AND (
       email = $2 OR external_ids->$3 = $4::jsonb
     ) LIMIT 1`,
    [orgId, email, provider, JSON.stringify(externalId)]
  );

  const externalIds = existing.rows[0]?.external_ids || {};
  externalIds[provider] = externalId;

  if (existing.rows[0]) {
    // UPDATE existing
    await db.query(
      `UPDATE donors SET
         name=$1, email=COALESCE($2,email), phone=COALESCE($3,phone),
         org_name=COALESCE($4,org_name), title=COALESCE($5,title),
         city=COALESCE($6,city), state=COALESCE($7,state), zip=COALESCE($8,zip),
         lifetime_giving=COALESCE($9,lifetime_giving),
         last_gift_amount=COALESCE($10,last_gift_amount),
         last_gift_date=COALESCE($11::date,last_gift_date),
         preferred_channel=COALESCE($12,preferred_channel),
         sms_opt_in=COALESCE($13,sms_opt_in),
         email_opt_out=COALESCE($14,email_opt_out),
         do_not_contact=COALESCE($15,do_not_contact),
         external_ids=$16, last_sync_at=NOW()
       WHERE id=$17`,
      [name, email, phone, orgName, title, city, state, zip,
       lifetimeGiving, lastGiftAmount, lastGiftDate,
       preferredChannel, smsOptIn, emailOptOut, doNotContact,
       JSON.stringify(externalIds), existing.rows[0].id]
    );
  } else {
    // INSERT new
    await db.query(
      `INSERT INTO donors
         (org_id, name, email, phone, org_name, title,
          city, state, zip, country,
          stage, interests, alumni_class_year,
          lifetime_giving, last_gift_amount, last_gift_date,
          preferred_channel, sms_opt_in, email_opt_out, do_not_contact,
          external_ids, last_sync_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())`,
      [orgId, name, email, phone, orgName, title,
       city, state, zip, country || 'United States',
       stage || 'prospect', interests || [], alumniClassYear,
       lifetimeGiving || 0, lastGiftAmount, lastGiftDate,
       preferredChannel, smsOptIn || false, emailOptOut || false, doNotContact || false,
       JSON.stringify(externalIds)]
    );
  }
}

async function upsertGift(orgId, provider, gift) {
  // Find donor by external ID
  const donor = await db.query(
    `SELECT id FROM donors WHERE org_id=$1 AND external_ids->$2 = $3::jsonb LIMIT 1`,
    [orgId, provider, JSON.stringify(gift.donorExternalId)]
  );
  if (!donor.rows[0]) return; // donor not synced yet — skip

  const donorId = donor.rows[0].id;

  // Dedup by external_id + source
  const existing = await db.query(
    'SELECT id FROM gifts WHERE external_source=$1 AND external_id=$2 LIMIT 1',
    [provider, gift.externalId]
  );
  if (existing.rows[0]) return; // already synced

  await db.query(
    `INSERT INTO gifts
       (org_id, donor_id, amount, date, type, status, fund, campaign, appeal,
        acknowledged, receipt_sent, external_id, external_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT DO NOTHING`,
    [orgId, donorId, gift.amount, gift.date, gift.type || 'Cash',
     gift.status || 'completed', gift.fund, gift.campaign, gift.appeal,
     gift.acknowledged || false, gift.receiptSent || false,
     gift.externalId, provider]
  );

  // Update donor giving summary
  await db.query(
    `UPDATE donors SET
       lifetime_giving = lifetime_giving + $1,
       total_gifts     = total_gifts + 1,
       last_gift_amount = CASE WHEN $2::date >= COALESCE(last_gift_date,'1900-01-01'::date) THEN $1 ELSE last_gift_amount END,
       last_gift_date   = GREATEST(COALESCE(last_gift_date,'1900-01-01'::date), $2::date)
     WHERE id=$3`,
    [gift.amount, gift.date, donorId]
  );
}

async function logSyncEvent(orgId, provider, type, status, message, payload = null) {
  await db.query(
    `INSERT INTO sync_events (org_id, provider, type, status, message, payload)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [orgId, provider, type, status, message, payload ? JSON.stringify(payload) : null]
  );
}

module.exports = { testConnection, triggerSync };
