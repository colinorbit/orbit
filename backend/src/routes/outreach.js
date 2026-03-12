'use strict';
/**
 * /api/v1/outreach — Outreach message queue and delivery
 * Handles AI-drafted emails/SMS, approval workflow, and send tracking.
 */
const express = require('express');
const db      = require('../db');
const ai      = require('../services/ai');
const logger  = require('../utils/logger');
const router    = express.Router();
const delivery  = require('../services/delivery');
const { authenticate, tenantScope, requireRole } = require('../middleware/auth');
const asyncHandler = global.asyncHandler || (fn => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { next(e); } });

// GET /outreach — pending approval queue (default) or all messages
router.get('/', authenticate, tenantScope, async (req, res) => {
  const { status = 'draft', agentKey, channel, donorId, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where    = ['m.org_id = $1'];
  const params = [req.user.orgId];
  let p = 2;

  if (status)   { where.push(`m.status = $${p++}`);      params.push(status); }
  if (agentKey) { where.push(`m.agent_key = $${p++}`);   params.push(agentKey); }
  if (channel)  { where.push(`m.channel = $${p++}`);     params.push(channel); }
  if (donorId)  { where.push(`m.donor_id = $${p++}`);    params.push(donorId); }

  const [data, total] = await Promise.all([
    db.query(
      `SELECT m.id, m.donor_id, d.name as donor_name, d.email as donor_email,
              d.mobile as donor_mobile,
              m.agent_key, m.channel, m.subject, m.body, m.status,
              m.scheduled_at, m.sent_at, m.opened_at, m.replied_at,
              m.ai_generated, m.metadata, m.created_at
       FROM outreach_messages m
       JOIN donors d ON d.id = m.donor_id
       WHERE ${where.join(' AND ')}
       ORDER BY m.created_at DESC
       LIMIT $${p++} OFFSET $${p}`,
      [...params, parseInt(limit), offset]
    ),
    db.query(
      `SELECT COUNT(*) FROM outreach_messages m WHERE ${where.join(' AND ')}`,
      params
    ),
  ]);

  res.json({
    data:  data.rows,
    total: parseInt(total.rows[0].count),
    page:  parseInt(page),
    pages: Math.ceil(parseInt(total.rows[0].count) / parseInt(limit)),
  });
});

// GET /outreach/stats — delivery stats for KPI dashboard
router.get('/stats', authenticate, tenantScope, async (req, res) => {
  const { since = new Date(Date.now() - 30 * 86400000).toISOString() } = req.query;
  const { rows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'draft')      AS pending_approval,
       COUNT(*) FILTER (WHERE status = 'sent')       AS sent,
       COUNT(*) FILTER (WHERE status = 'delivered')  AS delivered,
       COUNT(*) FILTER (WHERE status = 'opened')     AS opened,
       COUNT(*) FILTER (WHERE status = 'replied')    AS replied,
       COUNT(*) FILTER (WHERE status = 'bounced')    AS bounced,
       COUNT(*) FILTER (WHERE channel = 'Email')     AS email_count,
       COUNT(*) FILTER (WHERE channel = 'SMS')       AS sms_count,
       ROUND(
         COUNT(*) FILTER (WHERE status IN ('opened','replied'))::numeric /
         NULLIF(COUNT(*) FILTER (WHERE status IN ('sent','delivered','opened','replied')), 0) * 100,
         1
       ) AS open_rate
     FROM outreach_messages
     WHERE org_id = $1 AND created_at >= $2`,
    [req.user.orgId, since]
  );
  res.json(rows[0]);
});

// POST /outreach/generate — AI-generate message for a donor (saves as draft)
router.post('/generate', authenticate, tenantScope, async (req, res) => {
  const { donorId, agentKey, channel = 'Email', purpose } = req.body;
  if (!donorId || !agentKey) return res.status(400).json({ error: 'donorId and agentKey are required' });

  const [donorResult, configResult] = await Promise.all([
    db.query('SELECT * FROM donors WHERE id = $1 AND org_id = $2', [donorId, req.user.orgId]),
    db.query('SELECT config FROM agent_configs WHERE org_id = $1 AND agent_key = $2', [req.user.orgId, agentKey]),
  ]);

  if (!donorResult.rows[0]) return res.status(404).json({ error: 'Donor not found' });

  const donor  = donorResult.rows[0];
  const config = { ...configResult.rows[0]?.config, purpose };

  if (donor.do_not_contact) return res.status(422).json({ error: 'Donor has do_not_contact flag set' });
  if (channel === 'Email' && donor.email_opt_out) return res.status(422).json({ error: 'Donor has opted out of email' });
  if (channel === 'SMS'   && !donor.sms_opt_in)   return res.status(422).json({ error: 'Donor has not opted into SMS' });

  const message = await ai.generateOutreachMessage(donor, config, channel);

  const { rows } = await db.query(
    `INSERT INTO outreach_messages
       (org_id, donor_id, agent_key, channel, subject, body, status, ai_generated, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',true,$7)
     RETURNING id, channel, subject, body, status, created_at`,
    [
      req.user.orgId, donorId, agentKey, channel,
      message.subject || null, message.body,
      JSON.stringify({ rationale: message.rationale, generatedBy: req.user.sub }),
    ]
  );

  res.status(201).json(rows[0]);
});

// POST /outreach/:id/approve — approve and queue for sending
router.post('/:id/approve', authenticate, tenantScope, async (req, res) => {
  const { scheduledAt } = req.body;

  const sendNow = !scheduledAt || new Date(scheduledAt) <= new Date(Date.now() + 60000);

  const { rows } = await db.query(
    `UPDATE outreach_messages
     SET status = 'scheduled',
         scheduled_at = $1,
         updated_at = NOW(),
         metadata = metadata || $2
     WHERE id = $3 AND org_id = $4 AND status = 'draft'
     RETURNING *`,
    [
      scheduledAt || new Date().toISOString(),
      JSON.stringify({ approvedBy: req.user.sub, approvedAt: new Date().toISOString() }),
      req.params.id, req.user.orgId,
    ]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Message not found or not in draft status' });

  logger.info('Message approved', { messageId: rows[0].id, sendNow, orgId: req.user.orgId });

  // Fire-and-forget for immediate sends — client gets fast response
  if (sendNow) {
    delivery.deliverMessage(rows[0].id).catch(err =>
      logger.error('Immediate delivery failed', { messageId: rows[0].id, err: err.message })
    );
  }

  res.json({ ...rows[0], queued_for_send: sendNow });
});

// POST /outreach/:id/reject — reject back to draft with note
router.post('/:id/reject', authenticate, tenantScope, async (req, res) => {
  const { reason } = req.body;

  const { rows } = await db.query(
    `UPDATE outreach_messages
     SET status = 'draft', updated_at = NOW(),
         metadata = metadata || $1
     WHERE id = $2 AND org_id = $3
     RETURNING id, status`,
    [
      JSON.stringify({ rejectedBy: req.user.sub, rejectedAt: new Date().toISOString(), reason }),
      req.params.id, req.user.orgId,
    ]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Message not found' });
  res.json(rows[0]);
});

// PATCH /outreach/:id — edit draft before approval
router.patch('/:id', authenticate, tenantScope, async (req, res) => {
  const { subject, body, scheduledAt } = req.body;

  const { rows } = await db.query(
    `UPDATE outreach_messages
     SET subject = COALESCE($1, subject),
         body = COALESCE($2, body),
         scheduled_at = COALESCE($3, scheduled_at),
         updated_at = NOW()
     WHERE id = $4 AND org_id = $5 AND status IN ('draft','scheduled')
     RETURNING *`,
    [subject, body, scheduledAt, req.params.id, req.user.orgId]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Message not found or already sent' });
  res.json(rows[0]);
});

// DELETE /outreach/:id — delete draft
router.delete('/:id', authenticate, tenantScope, async (req, res) => {
  const { rowCount } = await db.query(
    `DELETE FROM outreach_messages
     WHERE id = $1 AND org_id = $2 AND status = 'draft'`,
    [req.params.id, req.user.orgId]
  );
  if (!rowCount) return res.status(404).json({ error: 'Draft not found' });
  res.status(204).end();
});

// POST /outreach/bulk-generate — bulk AI draft for segment
router.post('/bulk-generate', authenticate, tenantScope, async (req, res) => {
  const { donorIds, agentKey, channel = 'Email', templateHint } = req.body;

  if (!Array.isArray(donorIds) || donorIds.length === 0) {
    return res.status(400).json({ error: 'donorIds[] required' });
  }
  if (donorIds.length > 100) {
    return res.status(400).json({ error: 'Max 100 donors per bulk generate' });
  }

  const [donors, config] = await Promise.all([
    db.query(
      `SELECT * FROM donors WHERE id = ANY($1::uuid[]) AND org_id = $2
       AND do_not_contact = false
       AND ($3 != 'Email' OR email_opt_out = false)
       AND ($3 != 'SMS'   OR sms_opt_in = true)`,
      [donorIds, req.user.orgId, channel]
    ),
    db.query(
      'SELECT config FROM agent_configs WHERE org_id = $1 AND agent_key = $2',
      [req.user.orgId, agentKey]
    ),
  ]);

  const agentConfig = { ...config.rows[0]?.config, templateHint };
  const results     = { created: 0, skipped: 0, errors: 0 };

  for (const donor of donors.rows) {
    try {
      const msg = await ai.generateOutreachMessage(donor, agentConfig, channel);
      await db.query(
        `INSERT INTO outreach_messages
           (org_id, donor_id, agent_key, channel, subject, body, status, ai_generated)
         VALUES ($1,$2,$3,$4,$5,$6,'draft',true)`,
        [req.user.orgId, donor.id, agentKey, channel, msg.subject || null, msg.body]
      );
      results.created++;
    } catch(e) {
      logger.warn('Bulk generate error', { donorId: donor.id, err: e.message });
      results.errors++;
    }
  }

  results.skipped = donorIds.length - donors.rows.length;
  res.json(results);
});

module.exports = router;
