const express = require('express');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db      = require('../db');
const { authenticate } = require('../middleware/auth');
const logger  = require('../utils/logger');

const router = express.Router();

function signAccess(user) {
  return jwt.sign(
    { sub: user.id, orgId: user.org_id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
}

function signRefresh(userId) {
  return jwt.sign({ sub: userId, type: 'refresh' }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// POST /auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'BadRequest', message: 'email and password required' });
  }

  const { rows } = await db.query(
    'SELECT id, email, name, role, org_id, password_hash, created_at FROM users WHERE email = $1 LIMIT 1', [email.toLowerCase()]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'InvalidCredentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'InvalidCredentials' });

  await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

  const accessToken  = signAccess(user);
  const refreshToken = signRefresh(user.id);
  const tokenHash    = require('crypto').createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt    = new Date(Date.now() + 30 * 24 * 3600 * 1000);

  await db.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
    [user.id, tokenHash, expiresAt]
  );

  logger.info('User logged in', { userId: user.id, email: user.email });
  res.json({
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, orgId: user.org_id },
  });
});

// POST /auth/refresh
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Missing refreshToken' });

  let payload;
  try {
    payload = jwt.verify(refreshToken, process.env.JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'InvalidRefreshToken' });
  }

  const tokenHash = require('crypto').createHash('sha256').update(refreshToken).digest('hex');
  const { rows }  = await db.query(
    'SELECT * FROM refresh_tokens WHERE token_hash=$1 AND expires_at > NOW() LIMIT 1',
    [tokenHash]
  );
  if (!rows[0]) return res.status(401).json({ error: 'RefreshTokenRevoked' });

  const { rows: users } = await db.query('SELECT * FROM users WHERE id=$1', [payload.sub]);
  if (!users[0]) return res.status(401).json({ error: 'UserNotFound' });

  const accessToken = signAccess(users[0]);
  res.json({ accessToken });
});

// POST /auth/logout
router.post('/logout', authenticate, async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    const tokenHash = require('crypto').createHash('sha256').update(refreshToken).digest('hex');
const rateLimit = (() => {
  try { return require('express-rate-limit'); } catch(e) {
    // If package not installed, return a no-op middleware
    console.warn('express-rate-limit not installed — auth rate limiting disabled');
    return () => (req, res, next) => next();
  }
})();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TooManyRequests', message: 'Too many login attempts. Try again in 15 minutes.' }
});


const asyncHandler = global.asyncHandler || (fn => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { next(e); } });
    await db.query('DELETE FROM refresh_tokens WHERE token_hash=$1', [tokenHash]);
  }
  res.status(204).end();
});

// GET /auth/me
router.get('/me', authenticate, async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, email, name, role, org_id, last_login FROM users WHERE id=$1',
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'NotFound' });
  res.json(rows[0]);
});


// POST /auth/superadmin-login
// Separate endpoint for Orbit staff — checks SUPERADMIN_EMAILS env var
router.post('/superadmin-login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }

  // Check against staff list (comma-separated in env)
  const allowedEmails = (process.env.SUPERADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
  if (!allowedEmails.includes(email.toLowerCase()) && !email.endsWith('@orbit.ai')) {
    return res.status(403).json({ error: 'Not authorized for super admin access' });
  }

  const { rows } = await db.query(
    "SELECT id, email, name, role, password_hash FROM users WHERE email = $1 AND role = 'superadmin' LIMIT 1",
    [email.toLowerCase()]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'InvalidCredentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'InvalidCredentials' });

  await db.query("UPDATE users SET last_login = NOW() WHERE id = $1", [user.id]);

  const token = jwt.sign(
    { sub: user.id, id: user.id, email: user.email, role: 'superadmin', orgId: null },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  logger.info({ action: 'superadmin_login', email: user.email });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: 'superadmin' } });
});

module.exports = router;
