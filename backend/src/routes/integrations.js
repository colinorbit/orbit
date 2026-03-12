const express  = require('express');
const db       = require('../db');
const { encrypt, decrypt } = require('../utils/crypto');
const syncSvc  = require('../services/sync');
const logger   = require('../utils/logger');
const { authenticate, tenantScope, requireRole } = require('../middleware/auth');
const asyncHandler = global.asyncHandler || (fn => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { next(e); } });
const router   = express.Router();

// GET /integrations  — list all with live status
router.get('/', authenticate, tenantScope, async (req, res) => {
  const { rows } = await db.query(
    `SELECT provider, status, last_sync_at, next_sync_at,
            records_synced, sync_errors, config
     FROM integrations WHERE org_id=$1`,
    [req.user.orgId]
  );
  res.json(rows);
});

// POST /integrations/:provider/connect
router.post('/:provider/connect', authenticate, tenantScope, async (req, res) => {
  const { provider } = req.params;
  const { orgId }    = req.user;
  const creds        = req.body;

  // Validate we have the minimum required fields per provider
  const required = {
    salesforce: ['instanceUrl','consumerKey','consumerSecret','username','password'],
    hubspot:    ['token'],
    blackbaud:  ['subscriptionKey','clientId','accessToken'],
    stripe:     ['secretKey'],
    twilio:     ['accountSid','authToken','fromNumber'],
    sendgrid:   ['apiKey'],
    docusign:   ['integrationKey','accountId'],
  };

  const missing = (required[provider] || []).filter(k => !creds[k]);
  if (missing.length) {
    return res.status(400).json({
      error: 'MissingCredentials',
      message: `Required: ${missing.join(', ')}`,
    });
  }

  // Test the connection before saving
  const testResult = await syncSvc.testConnection(provider, creds);
  if (!testResult.ok) {
    return res.status(422).json({
      error: 'ConnectionFailed',
      message: testResult.error,
    });
  }

  // Encrypt credentials and upsert
  const encryptedCreds = encrypt(creds);
  const config         = req.body.config || {};

  await db.query(
    `INSERT INTO integrations (org_id, provider, status, credentials_enc, config, next_sync_at)
     VALUES ($1,$2,'connected',$3,$4, NOW() + INTERVAL '15 minutes')
     ON CONFLICT (org_id, provider)
     DO UPDATE SET status='connected', credentials_enc=$3, config=$4,
                   next_sync_at=NOW()+INTERVAL '15 minutes', updated_at=NOW()`,
    [orgId, provider, encryptedCreds, JSON.stringify(config)]
  );

  // Kick off initial sync in background
  syncSvc.triggerSync(orgId, provider).catch(err =>
    logger.error('Initial sync failed', { provider, err: err.message })
  );

  logger.info('Integration connected', { orgId, provider });
  res.json({ status: 'connected', message: `${provider} connected. Initial sync started.` });
});

// POST /integrations/:provider/test
router.post('/:provider/test', authenticate, tenantScope, async (req, res) => {
  const { provider } = req.params;
  const creds        = req.body;

  // Allow testing with stored creds if no body provided
  if (!Object.keys(creds).length) {
    const { rows } = await db.query(
      'SELECT credentials_enc FROM integrations WHERE org_id=$1 AND provider=$2',
      [req.user.orgId, provider]
    );
    if (!rows[0]) return res.status(404).json({ error: 'NotConfigured' });
    Object.assign(creds, decrypt(rows[0].credentials_enc));
  }

  const result = await syncSvc.testConnection(provider, creds);
  res.json(result);
});

// POST /integrations/:provider/sync  — force immediate sync
router.post('/:provider/sync', authenticate, tenantScope, async (req, res) => {
  const { provider }  = req.params;
  const { orgId }     = req.user;

  const { rows } = await db.query(
    'SELECT status FROM integrations WHERE org_id=$1 AND provider=$2',
    [orgId, provider]
  );
  if (!rows[0]) return res.status(404).json({ error: 'NotConfigured' });
  if (rows[0].status === 'syncing') return res.status(409).json({ error: 'AlreadySyncing' });

  // Queue without awaiting
  syncSvc.triggerSync(orgId, provider).catch(err =>
    logger.error('Force sync failed', { provider, err: err.message })
  );

  res.status(202).json({ status: 'queued', message: 'Sync started' });
});

// GET /integrations/:provider/status
router.get('/:provider/status', authenticate, tenantScope, async (req, res) => {
  const { orgId }    = req.user;
  const { provider } = req.params;

  const [integration, events] = await Promise.all([
    db.query(
      `SELECT status, last_sync_at, next_sync_at, records_synced, sync_errors, config
       FROM integrations WHERE org_id=$1 AND provider=$2`,
      [orgId, provider]
    ),
    db.query(
      `SELECT type, status, message, created_at, duration_ms
       FROM sync_events WHERE org_id=$1 AND provider=$2
       ORDER BY created_at DESC LIMIT 20`,
      [orgId, provider]
    ),
  ]);

  if (!integration.rows[0]) return res.status(404).json({ error: 'NotConfigured' });

  res.json({
    ...integration.rows[0],
    recentEvents: events.rows,
  });
});

// DELETE /integrations/:provider/disconnect
router.delete('/:provider/disconnect', authenticate, tenantScope, async (req, res) => {
  const { orgId }    = req.user;
  const { provider } = req.params;

  await db.query(
    `UPDATE integrations
     SET status='disconnected', credentials_enc=NULL, updated_at=NOW()
     WHERE org_id=$1 AND provider=$2`,
    [orgId, provider]
  );

  logger.info('Integration disconnected', { orgId, provider });
  res.status(204).end();
});

module.exports = router;
