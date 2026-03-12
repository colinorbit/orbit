'use strict';
/**
 * /api/v1/campaigns — Campaign management and real-time stats
 */
const express = require('express');
const db      = require('../db');
const ai      = require('../services/ai');
const logger  = require('../utils/logger');
const { authenticate, tenantScope, requireRole } = require('../middleware/auth');
const asyncHandler = global.asyncHandler || (fn => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { next(e); } });
const router  = express.Router();

// GET /campaigns
router.get('/', authenticate, tenantScope, async (req, res) => {
  const { status, agent } = req.query;
  let where    = ['c.org_id = $1'];
  const params = [req.user.orgId];
  let p = 2;

  if (status) { where.push(`c.status = $${p++}`); params.push(status); }
  if (agent)  { where.push(`c.assigned_agent = $${p++}`); params.push(agent); }

  const { rows } = await db.query(
    `SELECT c.*,
       COALESCE(SUM(g.amount), 0) AS raised,
       COUNT(DISTINCT g.donor_id) AS donors_gave
     FROM campaigns c
     LEFT JOIN gifts g ON g.org_id = c.org_id
       AND g.date BETWEEN c.start_date AND COALESCE(c.end_date, NOW())
       AND g.status = 'completed'
       AND g.source ILIKE '%campaign%'
     WHERE ${where.join(' AND ')}
     GROUP BY c.id
     ORDER BY c.start_date DESC`,
    params
  );
  res.json(rows);
});

// POST /campaigns — create campaign
router.post('/', authenticate, tenantScope, async (req, res) => {
  const { name, assignedAgent, channel, goal, startDate, endDate, description, targetSegment } = req.body;
  if (!name || !assignedAgent) return res.status(400).json({ error: 'name and assignedAgent are required' });

  const { rows } = await db.query(
    `INSERT INTO campaigns
       (org_id, name, assigned_agent, channel, goal, start_date, end_date, description, target_segment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.user.orgId, name, assignedAgent, channel || 'Email',
     goal || null, startDate || null, endDate || null,
     description || null, targetSegment ? JSON.stringify(targetSegment) : null]
  );
  res.status(201).json(rows[0]);
});

// GET /campaigns/:id/stats
router.get('/:id/stats', authenticate, tenantScope, async (req, res) => {
  const campaign = await db.query(
    'SELECT * FROM campaigns WHERE id = $1 AND org_id = $2',
    [req.params.id, req.user.orgId]
  );
  if (!campaign.rows[0]) return res.status(404).json({ error: 'Campaign not found' });
  const c = campaign.rows[0];

  const [gifts, messages] = await Promise.all([
    db.query(
      `SELECT COALESCE(SUM(amount),0) AS raised, COUNT(*) AS gifts,
              COUNT(DISTINCT donor_id) AS donors,
              COALESCE(AVG(amount),0) AS avg_gift
       FROM gifts
       WHERE org_id=$1 AND date BETWEEN $2 AND COALESCE($3::date, NOW())
         AND status='completed'`,
      [req.user.orgId, c.start_date, c.end_date]
    ),
    db.query(
      `SELECT COUNT(*) AS sent,
              COUNT(*) FILTER (WHERE status='opened')   AS opened,
              COUNT(*) FILTER (WHERE status='replied')  AS replied,
              COUNT(*) FILTER (WHERE channel='SMS')     AS sms_sent,
              COUNT(*) FILTER (WHERE channel='Email')   AS email_sent
       FROM outreach_messages
       WHERE org_id=$1 AND agent_key=$2
         AND created_at >= $3`,
      [req.user.orgId, c.assigned_agent, c.start_date]
    ),
  ]);

  const g = gifts.rows[0];
  const m = messages.rows[0];
  const progressPct = c.goal ? Math.round((parseFloat(g.raised) / parseFloat(c.goal)) * 100) : null;

  res.json({
    ...c,
    raised:         parseFloat(g.raised),
    gifts:          parseInt(g.gifts),
    donors:         parseInt(g.donors),
    avg_gift:       parseFloat(g.avg_gift),
    goal_progress:  progressPct,
    messages_sent:  parseInt(m.sent),
    open_rate:      m.sent > 0 ? Math.round((m.opened / m.sent) * 100) : 0,
    reply_rate:     m.sent > 0 ? Math.round((m.replied / m.sent) * 100) : 0,
    email_sent:     parseInt(m.email_sent),
    sms_sent:       parseInt(m.sms_sent),
  });
});

// PATCH /campaigns/:id — update campaign
router.patch('/:id', authenticate, tenantScope, async (req, res) => {
  const { name, goal, endDate, status, description } = req.body;
  const { rows } = await db.query(
    `UPDATE campaigns SET
       name        = COALESCE($1, name),
       goal        = COALESCE($2, goal),
       end_date    = COALESCE($3, end_date),
       status      = COALESCE($4, status),
       description = COALESCE($5, description),
       updated_at  = NOW()
     WHERE id = $6 AND org_id = $7 RETURNING *`,
    [name, goal, endDate, status, description, req.params.id, req.user.orgId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Campaign not found' });
  res.json(rows[0]);
});

// POST /campaigns/:id/push-message — AI-generate campaign push message
router.post('/:id/push-message', authenticate, tenantScope, async (req, res) => {
  const { urgency = 'medium', goalProgress, timeRemaining } = req.body;

  const campaign = await db.query(
    'SELECT * FROM campaigns WHERE id = $1 AND org_id = $2',
    [req.params.id, req.user.orgId]
  );
  if (!campaign.rows[0]) return res.status(404).json({ error: 'Campaign not found' });
  const c = campaign.rows[0];

  const system = `You are VCO — Virtual Campaign Officer. Generate urgent, compelling campaign push messages.
Output JSON only: { "email_subject": "...", "email_body": "...", "sms_body": "..." }
SMS must be under 160 characters.`;

  const user = `Campaign: "${c.name}"
Goal: $${parseFloat(c.goal || 0).toLocaleString()}
Progress: ${goalProgress || 'Unknown'}%
Time remaining: ${timeRemaining || 'Today only'}
Urgency level: ${urgency}
Write matching messages for Email and SMS.`;

  const raw = await ai.callClaude(system, user, 500);
  let msg;
  try { msg = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
  catch(e) { msg = { email_subject: c.name, email_body: raw, sms_body: raw.slice(0, 160) }; }

  res.json(msg);
});

module.exports = router;
