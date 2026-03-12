const express = require('express');
const db      = require('../db');
const ai      = require('../services/ai');
const { authenticate, tenantScope, requireRole } = require('../middleware/auth');
const asyncHandler = global.asyncHandler || (fn => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { next(e); } });
const router  = express.Router();

// GET /donors
router.get('/', authenticate, tenantScope, async (req, res) => {
  const { orgId } = req.user;
  const { stage, agent, search, minScore, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = ['org_id = $1'];
  const params = [orgId];
  let p = 2;

  if (stage)    { where.push(`stage = $${p++}`);            params.push(stage); }
  if (agent)    { where.push(`assigned_agent = $${p++}`);   params.push(agent); }
  if (minScore) { where.push(`propensity_score >= $${p++}`);params.push(parseInt(minScore)); }
  if (search)   { where.push(`name ILIKE $${p++}`);         params.push(`%${search}%`); }

  const whereStr = where.join(' AND ');

  const [data, total] = await Promise.all([
    db.query(
      `SELECT id, name, email, org_name, stage, assigned_agent,
              propensity_score, engagement_score, sentiment_trend,
              lifetime_giving, last_gift_amount, last_gift_date,
              preferred_channel, interests, alumni_class_year,
              do_not_contact, email_opt_out, sms_opt_in,
              last_contact_at, updated_at
       FROM donors WHERE ${whereStr}
       ORDER BY propensity_score DESC, engagement_score DESC
       LIMIT $${p++} OFFSET $${p}`,
      [...params, parseInt(limit), offset]
    ),
    db.query(`SELECT COUNT(*) FROM donors WHERE ${whereStr}`, params),
  ]);

  res.json({
    data:  data.rows,
    total: parseInt(total.rows[0].count),
    page:  parseInt(page),
    pages: Math.ceil(parseInt(total.rows[0].count) / parseInt(limit)),
  });
});

// GET /donors/:id
router.get('/:id', authenticate, tenantScope, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM donors WHERE id=$1 AND org_id=$2',
    [req.params.id, req.user.orgId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'NotFound' });
  res.json(rows[0]);
});

// PATCH /donors/:id
router.patch('/:id', authenticate, tenantScope, async (req, res) => {
  const allowed = ['stage','assigned_agent','preferred_channel','sms_opt_in',
                   'email_opt_out','do_not_contact','notes','interests'];
  const updates = [];
  const vals    = [];
  let p = 1;

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates.push(`${key} = $${p++}`);
      vals.push(req.body[key]);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'No valid fields' });

  vals.push(req.params.id, req.user.orgId);
  const { rows } = await db.query(
    `UPDATE donors SET ${updates.join(', ')} WHERE id=$${p} AND org_id=$${p+1} RETURNING *`,
    vals
  );
  if (!rows[0]) return res.status(404).json({ error: 'NotFound' });
  res.json(rows[0]);
});

// GET /donors/:id/gifts
router.get('/:id/gifts', authenticate, tenantScope, async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM gifts WHERE donor_id=$1 AND org_id=$2 ORDER BY date DESC`,
    [req.params.id, req.user.orgId]
  );
  res.json(rows);
});

// POST /donors/:id/ai-brief
router.post('/:id/ai-brief', authenticate, tenantScope, async (req, res) => {
  const { rows } = await db.query(
    `SELECT d.*, 
       json_agg(json_build_object('amount',g.amount,'date',g.date,'fund',g.fund,'type',g.type)
         ORDER BY g.date DESC) FILTER (WHERE g.id IS NOT NULL) AS gift_history
     FROM donors d
     LEFT JOIN gifts g ON g.donor_id=d.id
     WHERE d.id=$1 AND d.org_id=$2
     GROUP BY d.id`,
    [req.params.id, req.user.orgId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'NotFound' });

  const donor  = rows[0];
  const purpose = req.body?.purpose || 'meeting prep';
  const brief  = await ai.generateDonorBrief(donor, purpose);
  res.json(brief);
});

module.exports = router;
