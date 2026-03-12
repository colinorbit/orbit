'use strict';
/**
 * Background Jobs
 * - Sync scheduler: runs each integration on its configured interval
 * - Metric snapshot: pre-computes daily KPIs for fast dashboard queries
 * - Pledge health: flags overdue / at-risk pledges
 */

const cron   = require('node-cron');
const db     = require('../db');
const syncSvc          = require('../services/sync');
const predictiveEngine  = require('../services/predictiveEngine');
const signalIngestion   = require('../services/signalIngestion');
const vsoEngine         = require('../services/vsoEngine');
const delivery = require('../services/delivery');
const logger   = require('../utils/logger');

function startJobs() {
  // ── Sync scheduler — runs every 5 minutes, kicks off overdue integrations ──
  cron.schedule('*/5 * * * *', async () => {
    try {
      const { rows } = await db.query(
        `SELECT org_id, provider FROM integrations
         WHERE status='connected' AND next_sync_at <= NOW()
         ORDER BY next_sync_at ASC LIMIT 20`
      );

      for (const { org_id, provider } of rows) {
        syncSvc.triggerSync(org_id, provider).catch(err =>
          logger.error('Scheduled sync failed', { org_id, provider, err: err.message })
        );
      }

      if (rows.length) logger.info('Sync scheduler kicked off', { count: rows.length });
    } catch(e) {
      logger.error('Sync scheduler error', { err: e.message });
    }
  });

  // ── Daily metric snapshot — runs at 2am ──────────────────────────────────
  cron.schedule(process.env.METRIC_SNAPSHOT_CRON || '0 2 * * *', async () => {
    logger.info('Daily metric snapshot starting');
    try {
      const { rows: orgs } = await db.query('SELECT id FROM organizations');
      for (const org of orgs) {
        await computeMetricSnapshot(org.id);
      }
      logger.info('Daily metric snapshot complete', { orgs: orgs.length });
    } catch(e) {
      logger.error('Metric snapshot failed', { err: e.message });
    }
  });

  // ── Pledge health check — runs daily at 3am ───────────────────────────────
  cron.schedule('0 3 * * *', async () => {
    logger.info('Pledge health check starting');
    try {
      // Mark overdue pledges
      await db.query(
        `UPDATE pledges SET status='overdue'
         WHERE status='current' AND next_due_date < CURRENT_DATE`
      );

      // Flag at-risk: engagement score < 50 on donor with current pledge
      await db.query(
        `UPDATE pledges p SET status='at-risk'
         FROM donors d
         WHERE p.donor_id=d.id
           AND p.status='current'
           AND d.engagement_score < 50
           AND p.next_due_date < CURRENT_DATE + INTERVAL '30 days'`
      );

      logger.info('Pledge health check complete');
    } catch(e) {
      logger.error('Pledge health check failed', { err: e.message });
    }
  });

  // ── Outreach delivery worker — runs every 2 minutes ─────────────────────────
  cron.schedule('*/2 * * * *', async () => {
    try {
      await delivery.runDeliveryWorker();
    } catch(e) {
      logger.error('Delivery worker error', { err: e.message });
    }
  });

  // ── Token refresh for RE NXT — runs every 50 minutes ─────────────────────
  cron.schedule('*/50 * * * *', async () => {
    const { rows } = await db.query(
      `SELECT org_id, credentials_enc FROM integrations
       WHERE provider='blackbaud' AND status='connected'`
    );

    const { decrypt, encrypt } = require('../utils/crypto');
    const blackbaud = require('../integrations/blackbaud');

    for (const row of rows) {
      try {
        const creds  = decrypt(row.credentials_enc);
        if (!creds.refreshToken) continue;
        const newToken = await blackbaud.refreshToken(creds);
        creds.accessToken = newToken;
        const enc = encrypt(creds);
        await db.query(
          'UPDATE integrations SET credentials_enc=$1, updated_at=NOW() WHERE org_id=$2 AND provider=$3',
          [enc, row.org_id, 'blackbaud']
        );
        logger.info('RE NXT token refreshed', { orgId: row.org_id });
      } catch(e) {
        logger.warn('RE NXT token refresh failed', { orgId: row.org_id, err: e.message });
      }
    }
  });

  logger.info('Background jobs started (sync, delivery, snapshots, pledge health, token refresh)');
}

async function computeMetricSnapshot(orgId) {
  const today      = new Date().toISOString().split('T')[0];
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

  const [raised, donors, pledges, gifts] = await Promise.all([
    db.query(`SELECT COALESCE(SUM(amount),0) AS total FROM gifts WHERE org_id=$1 AND date>=$2 AND status='completed'`, [orgId, monthStart]),
    db.query(`SELECT COUNT(*) FILTER (WHERE last_gift_date >= NOW()-INTERVAL '12 months') AS active, COUNT(*) AS total FROM donors WHERE org_id=$1`, [orgId]),
    db.query(`SELECT COALESCE(SUM(total_amount-paid_amount),0) AS open FROM pledges WHERE org_id=$1 AND status IN ('current','overdue','at-risk')`, [orgId]),
    db.query(`SELECT COALESCE(SUM(amount),0) AS total FROM gifts WHERE org_id=$1 AND date_part('year',date)=date_part('year',NOW()) AND status='completed'`, [orgId]),
  ]);

  const metrics = {
    raised_mtd:       parseFloat(raised.rows[0].total),
    active_donors:    parseInt(donors.rows[0].active),
    total_donors:     parseInt(donors.rows[0].total),
    open_pledges:     parseFloat(pledges.rows[0].open),
    raised_ytd:       parseFloat(gifts.rows[0].total),
    computed_at:      new Date().toISOString(),
  };

  await db.query(
    `INSERT INTO metric_snapshots (org_id, snapshot_date, metrics)
     VALUES ($1,$2,$3)
     ON CONFLICT (org_id, snapshot_date) DO UPDATE SET metrics=$3`,
    [orgId, today, JSON.stringify(metrics)]
  );

  // ── Predictive scoring — nightly 4am ──────────────────────────────────
  cron.schedule('0 4 * * *', async () => {
    logger.info('[Jobs] Starting nightly predictive scoring run');
    try {
      const { rows: orgs } = await db.query("SELECT id FROM organizations WHERE status='active'");
      for (const org of orgs) {
        await predictiveEngine.scorePortfolio(org.id);
      }
      logger.info('[Jobs] Predictive scoring complete');
    } catch (err) { logger.error('[Jobs] Predictive scoring failed', { err: err.message }); }
  });

  // ── Signal ingestion — daily 1am ──────────────────────────────────────
  cron.schedule('0 1 * * *', async () => {
    logger.info('[Jobs] Starting signal ingestion');
    try {
      await signalIngestion.runDailyIngestion();
      logger.info('[Jobs] Signal ingestion complete');
    } catch (err) { logger.error('[Jobs] Signal ingestion failed', { err: err.message }); }
  });

  // ── VSO daily queue build — 6am, cache for dashboard ──────────────────
  cron.schedule('0 6 * * *', async () => {
    logger.info('[Jobs] Building VSO stewardship queues');
    try {
      const { rows: orgs } = await db.query("SELECT id FROM organizations WHERE status='active'");
      for (const org of orgs) {
        await vsoEngine.buildDailyQueue(org.id, 100);
      }
      logger.info('[Jobs] VSO queue build complete');
    } catch (err) { logger.error('[Jobs] VSO queue build failed', { err: err.message }); }
  });

  // ── Monthly sustainer churn scan — daily 7am ──────────────────────────
  cron.schedule('0 7 * * *', async () => {
    logger.info('[Jobs] Running sustainer churn risk scan');
    try {
      const { rows: sustainers } = await db.query(`
        SELECT d.*, o.id as org_id FROM donors d
        JOIN organizations o ON o.id = d.org_id
        WHERE d.is_recurring = true AND d.do_not_contact = false
          AND (d.card_expiry_date IS NOT NULL AND d.card_expiry_date < NOW() + INTERVAL '30 days'
               OR d.last_failed_payment IS NOT NULL)
      `);
      for (const donor of sustainers) {
        const risk = vsoEngine.assessSustainerChurnRisk(donor, {
          card_expiry_days: donor.card_expiry_date
            ? Math.floor((new Date(donor.card_expiry_date) - Date.now()) / 86400000) : 999,
        });
        if (risk.churnRisk === 'critical') {
          logger.warn('[Jobs] Critical churn risk detected', { donorId: donor.id, riskScore: risk.riskScore });
        }
      }
      logger.info('[Jobs] Churn scan complete');
    } catch (err) { logger.error('[Jobs] Churn scan failed', { err: err.message }); }
  });
}

module.exports = { startJobs };
