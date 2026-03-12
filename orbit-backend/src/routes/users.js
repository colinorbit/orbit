/**
 * /api/v1/users — Team & Access management
 * Covers: list users, invite, update role, deactivate
 * All routes require authentication + tenantScope
 */
const express = require('express');
const router  = express.Router();
const { authenticate, tenantScope, requireRole } = require('../middleware/auth');
const db = require('../db');
const crypto = require('crypto');
const logger = require('../utils/logger');

/* ── helpers ── */
const VALID_ROLES = ['superadmin','admin','manager','officer','readonly'];

function validateRole(role) {
  return VALID_ROLES.includes(role);
}

/* ── GET /api/v1/users  — list all users in org ── */
router.get('/', authenticate, tenantScope, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, email, role, department, last_login_at, created_at,
              is_active, assigned_donor_count
       FROM users
       WHERE org_id = $1
       ORDER BY name ASC`,
      [req.orgId]
    );
    res.json({ users: rows });
  } catch (err) {
    logger.error('users.list', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

/* ── GET /api/v1/users/:id ── */
router.get('/:id', authenticate, tenantScope, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, email, role, department, last_login_at, created_at, is_active
       FROM users WHERE id = $1 AND org_id = $2`,
      [req.params.id, req.orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    logger.error('users.get', err);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

/* ── POST /api/v1/users/invite — invite new user ── */
router.post('/invite', authenticate, tenantScope, requireRole('admin'), async (req, res) => {
  const { name, email, role, department } = req.body;

  if (!name || !email || !role) {
    return res.status(400).json({ error: 'name, email, and role are required' });
  }
  if (!validateRole(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
  }

  try {
    // Check for duplicate email in org
    const existing = await db.query(
      'SELECT id FROM users WHERE email = $1 AND org_id = $2',
      [email.toLowerCase().trim(), req.orgId]
    );
    if (existing.rows.length) {
      return res.status(409).json({ error: 'A user with this email already exists in your organization' });
    }

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h

    const { rows } = await db.query(
      `INSERT INTO users (org_id, name, email, role, department, invite_token, invite_expires_at, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false)
       RETURNING id, name, email, role, created_at`,
      [req.orgId, name.trim(), email.toLowerCase().trim(), role, department || null, inviteToken, inviteExpiry]
    );

    logger.info('users.invite', { orgId: req.orgId, invitedEmail: email, role, invitedBy: req.user?.id });

    res.status(201).json({
      user: rows[0],
      inviteToken, // delivery service picks this up to send invite email
      message: 'Invitation created. Email delivery depends on ENABLE_EMAIL setting.'
    });
  } catch (err) {
    logger.error('users.invite', err);
    res.status(500).json({ error: 'Failed to create invitation' });
  }
});

/* ── PATCH /api/v1/users/:id — update role or department ── */
router.patch('/:id', authenticate, tenantScope, requireRole('admin'), async (req, res) => {
  const { role, department, is_active } = req.body;

  // Prevent self-demotion
  if (req.params.id === req.user?.id && role && role !== req.user.role) {
    return res.status(403).json({ error: 'You cannot change your own role' });
  }

  try {
    const updates = [];
    const values = [];
    let i = 1;

    if (role !== undefined) {
      if (!validateRole(role)) return res.status(400).json({ error: 'Invalid role' });
      updates.push(`role = $${i++}`); values.push(role);
    }
    if (department !== undefined) { updates.push(`department = $${i++}`); values.push(department); }
    if (is_active !== undefined) { updates.push(`is_active = $${i++}`); values.push(is_active); }

    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id, req.orgId);
    const { rows } = await db.query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${i++} AND org_id = $${i} RETURNING id, name, email, role, is_active`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    logger.info('users.update', { userId: req.params.id, updates: req.body, by: req.user?.id });
    res.json(rows[0]);
  } catch (err) {
    logger.error('users.update', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/* ── DELETE /api/v1/users/:id — deactivate (soft delete) ── */
router.delete('/:id', authenticate, tenantScope, requireRole('admin'), async (req, res) => {
  if (req.params.id === req.user?.id) {
    return res.status(403).json({ error: 'You cannot deactivate your own account' });
  }
  try {
    await db.query(
      'UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 AND org_id = $2',
      [req.params.id, req.orgId]
    );
    logger.info('users.deactivate', { userId: req.params.id, by: req.user?.id });
    res.json({ message: 'User deactivated' });
  } catch (err) {
    logger.error('users.deactivate', err);
    res.status(500).json({ error: 'Failed to deactivate user' });
  }
});

/* ── GET /api/v1/users/roles/list — available roles + permissions ── */
router.get('/roles/list', authenticate, tenantScope, async (req, res) => {
  res.json({
    roles: [
      { id: 'admin',    label: 'Administrator', desc: 'Full access including billing and user management' },
      { id: 'manager',  label: 'Manager',       desc: 'Can view all portfolios, approve outreach, run reports' },
      { id: 'officer',  label: 'Gift Officer',  desc: 'Manages assigned donor portfolio, initiates outreach' },
      { id: 'readonly', label: 'Read-Only',     desc: 'View-only access to dashboard and reports' },
    ]
  });
});

module.exports = router;
