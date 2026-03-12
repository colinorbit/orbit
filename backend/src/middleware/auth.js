const jwt    = require('jsonwebtoken');
const db     = require('../db');
const logger = require('../utils/logger');

/**
 * Verifies Bearer JWT. Attaches req.user = { id, orgId, email, role }.
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing token' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id:    payload.sub,
      orgId: payload.orgId,
      email: payload.email,
      role:  payload.role,
    };
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'TokenExpired', message: 'Access token expired' });
    }
    logger.warn('Invalid JWT', { err: e.message });
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
  }
}

/**
 * Scopes all queries to the authenticated user's org.
 * Sets req.orgId. Must run after authenticate().
 */
function tenantScope(req, res, next) {
  if (!req.user?.orgId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'No org context' });
  }
  req.orgId = req.user.orgId;
  next();
}

/**
 * Role guard — use after authenticate().
 * requireRole('admin') or requireRole('admin', 'manager')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Requires role: ${roles.join(' or ')}. Your role: ${req.user.role}`
      });
    }
    next();
  };
}

/** Legacy alias */
const authorize = requireRole;

module.exports = { authenticate, tenantScope, requireRole, authorize };
