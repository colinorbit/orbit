'use strict';
/**
 * /api/v1/gifts — Gift recording, history, and matching gift management
 */
const express = require('express');
const db      = require('../db');
const logger  = require('../utils/logger');
const { authenticate, tenantScope, requireRole } = require('../middleware/auth');
const asyncHandler = global.asyncHandler || (fn => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { next(e); } });
const router  = express.Router();

// GET /gifts — list gifts with filters
router.get('/', authenticate, tenantScope, async (req, res) => {
  const { donorId, fund, minAmount, startDate, endDate, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where    = ['g.org_id = $1'];
  const params = [req.user.orgId];
  let p = 2;

  if (donorId)   { where.push(`g.donor_id = $${p++}`);             params.push(donorId); }
  if (fund)      { where.push(`g.fund ILIKE $${p++}`);             params.push(`%${fund}%`); }
  if (minAmount) { where.push(`g.amount >= $${p++}`);              params.push(parseFloat(minAmount)); }
  if (startDate) { where.push(`g.date >= $${p++}`);                params.push(startDate); }
  if (endDate)   { where.push(`g.date <= $${p++}`);                params.push(endDate); }

  const [data, total] = await Promise.all([
    db.query(
      `SELECT g.id, g.donor_id, d.name as donor_name, g.amount, g.date,
              g.fund, g.designation, g.payment_method, g.source,
              g.status, g.is_recurring, g.matching_gift_id,
              g.matching_amount, g.matching_status, g.note,
              g.pledge_id, g.created_at
       FROM gifts g
       JOIN donors d ON d.id = g.donor_id
       WHERE ${where.join(' AND ')} AND g.status = 'completed'
       ORDER BY g.date DESC
       LIMIT $${p++} OFFSET $${p}`,
      [...params, parseInt(limit), offset]
    ),
    db.query(`SELECT COUNT(*) FROM gifts g WHERE ${where.join(' AND ')} AND g.status = 'completed'`, params),
  ]);

  res.json({
    data:  data.rows,
    total: parseInt(total.rows[0].count),
    page:  parseInt(page),
    pages: Math.ceil(parseInt(total.rows[0].count) / parseInt(limit)),
  });
});

// GET /gifts/summary — giving summary stats for dashboard
router.get('/summary', authenticate, tenantScope, async (req, res) => {
  const { period = '30' } = req.query;
  const days = Math.min(parseInt(period), 365);

  const { rows } = await db.query(
    `SELECT
       COALESCE(SUM(amount), 0)                              AS total_raised,
       COUNT(*)                                              AS gift_count,
       COALESCE(AVG(amount), 0)                             AS avg_gift,
       COUNT(DISTINCT donor_id)                              AS unique_donors,
       COALESCE(SUM(matching_amount)
         FILTER (WHERE matching_status = 'confirmed'), 0)   AS matching_confirmed,
       COALESCE(SUM(amount) FILTER (WHERE source = 'online'), 0) AS online_total,
       COALESCE(SUM(amount) FILTER (WHERE is_recurring = true), 0) AS recurring_total
     FROM gifts
     WHERE org_id = $1
       AND status = 'completed'
       AND date >= NOW() - ($2 || ' days')::INTERVAL`,
    [req.user.orgId, days]
  );
  res.json(rows[0]);
});

// GET /gifts/:id
router.get('/:id', authenticate, tenantScope, async (req, res) => {
  const { rows } = await db.query(
    `SELECT g.*, d.name as donor_name, d.email as donor_email
     FROM gifts g JOIN donors d ON d.id = g.donor_id
     WHERE g.id = $1 AND g.org_id = $2`,
    [req.params.id, req.user.orgId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Gift not found' });
  res.json(rows[0]);
});

// POST /gifts — record a gift
router.post('/', authenticate, tenantScope, async (req, res) => {
  const {
    donorId, amount, date, fund, designation,
    paymentMethod, source, isRecurring, pledgeId, note
  } = req.body;

  if (!donorId || !amount) return res.status(400).json({ error: 'donorId and amount are required' });
  if (parseFloat(amount) <= 0) return res.status(400).json({ error: 'amount must be positive' });

  // Verify donor
  const donor = await db.query(
    'SELECT id, name, lifetime_giving, total_gifts FROM donors WHERE id = $1 AND org_id = $2',
    [donorId, req.user.orgId]
  );
  if (!donor.rows[0]) return res.status(404).json({ error: 'Donor not found' });

  const giftDate = date || new Date().toISOString().split('T')[0];

  const { rows } = await db.query(
    `INSERT INTO gifts
       (org_id, donor_id, amount, date, fund, designation,
        payment_method, source, is_recurring, pledge_id, note, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'completed')
     RETURNING *`,
    [
      req.user.orgId, donorId, parseFloat(amount), giftDate,
      fund || 'General Fund', designation || null,
      paymentMethod || 'check', source || 'manual',
      isRecurring || false, pledgeId || null, note || null,
    ]
  );

  // Update donor totals and last gift
  await db.query(
    `UPDATE donors SET
       lifetime_giving = lifetime_giving + $1,
       last_gift_amount = $1,
       last_gift_date = $2,
       total_gifts = total_gifts + 1,
       stage = CASE
         WHEN stage = 'lapsed' THEN 'engaged'
         WHEN stage = 'prospect' THEN 'engaged'
         ELSE stage
       END,
       updated_at = NOW()
     WHERE id = $3`,
    [parseFloat(amount), giftDate, donorId]
  );

  logger.info('Gift recorded', { giftId: rows[0].id, donorId, amount, orgId: req.user.orgId });
  res.status(201).json(rows[0]);
});

// GET /gifts/matching/opportunities — donors whose employers match gifts
router.get('/matching/opportunities', authenticate, tenantScope, async (req, res) => {
  // Returns donors with employer match programs who have unclaimed matching
  const { rows } = await db.query(
    `SELECT g.id as gift_id, g.donor_id, d.name as donor_name,
            d.org_name as employer, g.amount, g.date, g.fund,
            g.matching_status, g.matching_amount
     FROM gifts g
     JOIN donors d ON d.id = g.donor_id
     WHERE g.org_id = $1
       AND g.status = 'completed'
       AND g.matching_status IN ('eligible', 'pending')
       AND d.org_name IS NOT NULL
       AND g.date >= NOW() - INTERVAL '365 days'
     ORDER BY g.amount DESC
     LIMIT 100`,
    [req.user.orgId]
  );
  res.json(rows);
});

// PATCH /gifts/:id/matching — update matching gift status
router.patch('/:id/matching', authenticate, tenantScope, async (req, res) => {
  const { status, matchingAmount, matchingCompany } = req.body;
  const validStatuses = ['eligible', 'pending', 'submitted', 'confirmed', 'denied', 'ineligible'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status', valid: validStatuses });
  }

  const { rows } = await db.query(
    `UPDATE gifts SET
       matching_status = $1,
       matching_amount = COALESCE($2, matching_amount),
       metadata = metadata || $3,
       updated_at = NOW()
     WHERE id = $4 AND org_id = $5
     RETURNING *`,
    [
      status, matchingAmount || null,
      JSON.stringify({ matchingCompany, updatedBy: req.user.sub }),
      req.params.id, req.user.orgId,
    ]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Gift not found' });
  res.json(rows[0]);
});

module.exports = router;
