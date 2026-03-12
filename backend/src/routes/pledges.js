'use strict';
/**
 * /api/v1/pledges — Pledge management
 * Tracks multi-year commitments, installments, and AI-generated reminders.
 */
const express = require('express');
const db      = require('../db');
const ai      = require('../services/ai');
const logger  = require('../utils/logger');
const { authenticate, tenantScope, requireRole } = require('../middleware/auth');
const asyncHandler = global.asyncHandler || (fn => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { next(e); } });
const router  = express.Router();

// GET /pledges — list org pledges with optional filters
router.get('/', authenticate, tenantScope, async (req, res) => {
  const { status, donorId, overdue, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where  = ['p.org_id = $1'];
  const params = [req.user.orgId];
  let p = 2;

  if (status)  { where.push(`p.status = $${p++}`);    params.push(status); }
  if (donorId) { where.push(`p.donor_id = $${p++}`);  params.push(donorId); }
  if (overdue === 'true') where.push(`p.status = 'overdue'`);

  const whereStr = where.join(' AND ');

  const [data, total] = await Promise.all([
    db.query(
      `SELECT p.id, p.donor_id, d.name as donor_name, d.email as donor_email,
              p.total_amount, p.paid_amount, p.balance,
              p.frequency, p.installment_amount, p.start_date, p.end_date,
              p.next_due_date, p.status, p.fund, p.notes,
              p.reminders_sent, p.created_at, p.updated_at
       FROM pledges p
       JOIN donors d ON d.id = p.donor_id
       WHERE ${whereStr}
       ORDER BY
         CASE p.status WHEN 'overdue' THEN 1 WHEN 'at-risk' THEN 2 WHEN 'current' THEN 3 ELSE 4 END,
         p.next_due_date ASC
       LIMIT $${p++} OFFSET $${p}`,
      [...params, parseInt(limit), offset]
    ),
    db.query(`SELECT COUNT(*) FROM pledges p WHERE ${whereStr}`, params),
  ]);

  res.json({
    data:  data.rows,
    total: parseInt(total.rows[0].count),
    page:  parseInt(page),
    pages: Math.ceil(parseInt(total.rows[0].count) / parseInt(limit)),
  });
});

// GET /pledges/summary — dashboard KPIs
router.get('/summary', authenticate, tenantScope, async (req, res) => {
  const { rows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('current','at-risk','overdue')) AS open_count,
       COALESCE(SUM(balance) FILTER (WHERE status IN ('current','at-risk','overdue')), 0) AS open_balance,
       COUNT(*) FILTER (WHERE status = 'overdue') AS overdue_count,
       COALESCE(SUM(installment_amount) FILTER (WHERE status = 'overdue'), 0) AS overdue_amount,
       COUNT(*) FILTER (WHERE next_due_date BETWEEN NOW() AND NOW() + INTERVAL '30 days') AS due_soon
     FROM pledges WHERE org_id = $1`,
    [req.user.orgId]
  );
  res.json(rows[0]);
});

// GET /pledges/:id — single pledge with payment history
router.get('/:id', authenticate, tenantScope, async (req, res) => {
  const [pledge, payments] = await Promise.all([
    db.query(
      `SELECT p.*, d.name as donor_name, d.email as donor_email
       FROM pledges p JOIN donors d ON d.id = p.donor_id
       WHERE p.id = $1 AND p.org_id = $2`,
      [req.params.id, req.user.orgId]
    ),
    db.query(
      `SELECT id, amount, date, payment_method, note, created_at
       FROM gifts WHERE pledge_id = $1 ORDER BY date DESC`,
      [req.params.id]
    ),
  ]);

  if (!pledge.rows[0]) return res.status(404).json({ error: 'Pledge not found' });
  res.json({ ...pledge.rows[0], payment_history: payments.rows });
});

// POST /pledges — create new pledge
router.post('/', authenticate, tenantScope, async (req, res) => {
  const {
    donorId, totalAmount, frequency, installmentAmount,
    startDate, endDate, fund, notes
  } = req.body;

  if (!donorId || !totalAmount || !frequency) {
    return res.status(400).json({ error: 'donorId, totalAmount, frequency are required' });
  }

  // Verify donor belongs to this org
  const donor = await db.query(
    'SELECT id FROM donors WHERE id = $1 AND org_id = $2', [donorId, req.user.orgId]
  );
  if (!donor.rows[0]) return res.status(404).json({ error: 'Donor not found' });

  // Calculate first due date
  const nextDue = startDate ? new Date(startDate) : new Date();

  const { rows } = await db.query(
    `INSERT INTO pledges
       (org_id, donor_id, total_amount, paid_amount, balance,
        frequency, installment_amount, start_date, end_date,
        next_due_date, status, fund, notes)
     VALUES ($1,$2,$3,0,$3,$4,$5,$6,$7,$8,'current',$9,$10)
     RETURNING *`,
    [
      req.user.orgId, donorId, totalAmount,
      frequency, installmentAmount || totalAmount,
      startDate || new Date().toISOString().split('T')[0],
      endDate || null,
      nextDue.toISOString().split('T')[0],
      fund || 'General Fund',
      notes || null,
    ]
  );

  logger.info('Pledge created', { pledgeId: rows[0].id, donorId, orgId: req.user.orgId });
  res.status(201).json(rows[0]);
});

// PATCH /pledges/:id/payment — record a payment against pledge
router.patch('/:id/payment', authenticate, tenantScope, async (req, res) => {
  const { amount, date, paymentMethod, note } = req.body;
  if (!amount) return res.status(400).json({ error: 'amount is required' });

  const pledge = await db.query(
    'SELECT * FROM pledges WHERE id = $1 AND org_id = $2',
    [req.params.id, req.user.orgId]
  );
  if (!pledge.rows[0]) return res.status(404).json({ error: 'Pledge not found' });

  const p = pledge.rows[0];
  const newPaid    = parseFloat(p.paid_amount) + parseFloat(amount);
  const newBalance = parseFloat(p.total_amount) - newPaid;
  const newStatus  = newBalance <= 0 ? 'fulfilled' : p.status === 'overdue' ? 'current' : p.status;

  // Calculate next due date
  const nextDue = calculateNextDue(p.frequency, date || new Date().toISOString().split('T')[0]);

  const [updatedPledge] = await Promise.all([
    db.query(
      `UPDATE pledges SET
         paid_amount = $1, balance = $2, status = $3,
         next_due_date = $4, updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [newPaid, Math.max(0, newBalance), newStatus, newBalance > 0 ? nextDue : null, req.params.id]
    ),
    db.query(
      `INSERT INTO gifts (org_id, donor_id, pledge_id, amount, date, fund, payment_method, note, status, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completed','pledge_payment')`,
      [req.user.orgId, p.donor_id, p.id, amount,
       date || new Date().toISOString().split('T')[0],
       p.fund, paymentMethod || 'check', note || 'Pledge installment']
    ),
  ]);

  res.json(updatedPledge.rows[0]);
});

// POST /pledges/:id/reminder — AI-generated reminder message
router.post('/:id/reminder', authenticate, tenantScope, async (req, res) => {
  const pledge = await db.query(
    `SELECT p.*, d.name as donor_name, d.email as donor_email,
            d.preferred_channel, d.last_gift_amount
     FROM pledges p JOIN donors d ON d.id = p.donor_id
     WHERE p.id = $1 AND p.org_id = $2`,
    [req.params.id, req.user.orgId]
  );
  if (!pledge.rows[0]) return res.status(404).json({ error: 'Pledge not found' });

  const p = pledge.rows[0];
  const daysOverdue = p.status === 'overdue'
    ? Math.floor((Date.now() - new Date(p.next_due_date)) / 86400000)
    : 0;

  const systemPrompt = `You are a compassionate university advancement officer writing a pledge reminder.
Tone: warm, appreciative, never aggressive or guilt-inducing.
Output JSON only: { "subject": "...", "body": "..." }`;

  const userMsg = `Write a pledge reminder for:
Donor: ${p.donor_name}
Pledge total: $${parseFloat(p.total_amount).toLocaleString()}
Balance remaining: $${parseFloat(p.balance).toLocaleString()}
Installment amount: $${parseFloat(p.installment_amount).toLocaleString()}
Status: ${p.status}
${daysOverdue > 0 ? `Days overdue: ${daysOverdue}` : `Next due: ${p.next_due_date}`}
Channel: ${p.preferred_channel || 'Email'}`;

  const raw = await ai.callClaude(systemPrompt, userMsg, 400);
  let reminder;
  try { reminder = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
  catch(e) { reminder = { subject: 'Your pledge reminder', body: raw }; }

  // Increment reminder counter
  await db.query(
    'UPDATE pledges SET reminders_sent = reminders_sent + 1 WHERE id = $1',
    [req.params.id]
  );

  res.json(reminder);
});

// PATCH /pledges/:id/status — manually update status
router.patch('/:id/status', authenticate, tenantScope, async (req, res) => {
  const { status } = req.body;
  const valid = ['current', 'at-risk', 'overdue', 'paused', 'cancelled', 'fulfilled'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status', valid });

  const { rows } = await db.query(
    'UPDATE pledges SET status = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3 RETURNING *',
    [status, req.params.id, req.user.orgId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Pledge not found' });
  res.json(rows[0]);
});

function calculateNextDue(frequency, lastDate) {
  const d = new Date(lastDate);
  switch (frequency) {
    case 'monthly':   d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'annual':    d.setFullYear(d.getFullYear() + 1); break;
    default:          d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString().split('T')[0];
}

module.exports = router;
