'use strict';
/**
 * Orbit — Multi-Tenant Isolation Middleware
 *
 * This is the most critical security layer in the application.
 * It MUST be applied to every route that returns org-specific data.
 *
 * Usage in routes:
 *   const { tenantScope, requireOrgAccess } = require('../middleware/tenant');
 *
 *   // Inject org_id into all queries via res.locals
 *   router.use(tenantScope);
 *
 *   // Verify a specific resource belongs to the caller's org
 *   router.get('/:id', requireOrgAccess('donors', 'id'), handler);
 */

const { pool }  = require('../db');
const logger    = require('../utils/logger');

// ─── tenantScope ──────────────────────────────────────────────────────────────
// Adds req.orgId from the authenticated JWT. All DB queries MUST use this.
// Logs a security event if org_id is missing (should never happen post-auth).
const tenantScope = (req, res, next) => {
  if (!req.user?.org_id) {
    logger.error({ path: req.path, user: req.user }, 'SECURITY: tenantScope called without org_id in JWT');
    return res.status(403).json({ error: 'TenantScopeViolation', message: 'Missing organization context.' });
  }

  // Attach to res.locals for convenience in route handlers
  res.locals.orgId = req.user.org_id;

  // Freeze it — prevent accidental mutation
  Object.defineProperty(req, 'orgId', {
    get: () => req.user.org_id,
    set: () => { throw new Error('SECURITY: orgId is immutable — cannot be overridden'); },
    configurable: false,
  });

  next();
};

// ─── requireOrgAccess ─────────────────────────────────────────────────────────
// Verifies a resource (row) belongs to the caller's org before the handler runs.
// Prevents IDOR (Insecure Direct Object Reference) attacks.
//
// Usage: router.get('/:id', requireOrgAccess('donors', 'id'), handler)
// table:  the DB table to check against
// param:  the route param name containing the resource ID
const requireOrgAccess = (table, param = 'id') => async (req, res, next) => {
  const resourceId = req.params[param];
  const orgId      = req.user?.org_id;

  if (!orgId || !resourceId) {
    return res.status(403).json({ error: 'AccessDenied', message: 'Missing org or resource context.' });
  }

  // Allowlist of tables to prevent SQL injection via table parameter
  const ALLOWED_TABLES = [
    'donors', 'gifts', 'campaigns', 'outreach_messages', 'pledges',
    'agents', 'integrations', 'forms', 'email_templates', 'users',
    'audit_log', 'giving_days',
  ];

  if (!ALLOWED_TABLES.includes(table)) {
    logger.error({ table, param }, 'SECURITY: requireOrgAccess called with unlisted table');
    return res.status(500).json({ error: 'InvalidTableScope' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id FROM ${table} WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [resourceId, orgId]
    );

    if (!rows.length) {
      // Log potential IDOR attempt (don't reveal whether resource exists)
      logger.warn({
        org_id:      orgId,
        user_id:     req.user.id,
        table,
        resource_id: resourceId,
        path:        req.path,
        ip:          req.ip,
      }, 'SECURITY: Cross-org access attempt or resource not found');

      // Return 404 (not 403) — never confirm whether the resource exists in another org
      return res.status(404).json({ error: 'NotFound', message: `${table} not found.` });
    }

    next();
  } catch (err) {
    logger.error({ err, table, resourceId, orgId }, 'requireOrgAccess DB check failed');
    res.status(500).json({ error: 'AccessCheckFailed' });
  }
};

// ─── auditLog ─────────────────────────────────────────────────────────────────
// Persists an audit event to the audit_log table.
// Call from any route handler for sensitive operations.
//
// Usage:
//   await auditLog(req, 'donor.viewed', 'donors', donorId, { field: 'contact_info' });
const auditLog = async (req, action, resource, resourceId = null, detail = {}) => {
  const orgId   = req.user?.org_id;
  const actorId = req.user?.id;

  if (!orgId || !actorId) {
    logger.warn({ action }, 'auditLog called without org/actor context — skipping');
    return;
  }

  try {
    await pool.query(
      `INSERT INTO audit_log
         (org_id, actor_id, action, resource, resource_id, detail, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        orgId,
        actorId,
        action,
        resource,
        resourceId || null,
        JSON.stringify(detail),
        req.ip || null,
        req.get('user-agent')?.substring(0, 255) || null,
      ]
    );
  } catch (err) {
    // Never throw from audit log — a failed audit write should NOT break the request
    logger.error({ err, action, resource, resourceId, orgId }, 'Audit log write failed');
  }
};

// ─── requireRole ──────────────────────────────────────────────────────────────
// Enforces RBAC within the org. Roles: 'superadmin' > 'admin' > 'officer' > 'viewer'
const ROLE_LEVELS = { superadmin: 4, admin: 3, officer: 2, viewer: 1 };

const requireRole = (...allowedRoles) => (req, res, next) => {
  const userRole  = req.user?.role || 'viewer';
  const userLevel = ROLE_LEVELS[userRole] || 0;
  const maxAllowed = Math.max(...allowedRoles.map(r => ROLE_LEVELS[r] || 0));

  if (userLevel < maxAllowed) {
    logger.warn({
      user_id: req.user?.id,
      user_role: userRole,
      required: allowedRoles,
      path: req.path,
    }, 'RBAC: insufficient role');
    return res.status(403).json({
      error: 'InsufficientRole',
      message: `This action requires one of: ${allowedRoles.join(', ')}`,
    });
  }

  next();
};

// ─── superAdminOnly ───────────────────────────────────────────────────────────
// Hard-gates super admin routes — must have role:'superadmin' AND valid SA JWT secret
const superAdminOnly = (req, res, next) => {
  if (req.user?.role !== 'superadmin') {
    logger.warn({ user_id: req.user?.id, path: req.path, ip: req.ip }, 'SECURITY: Unauthorized super admin access attempt');
    return res.status(403).json({ error: 'SuperAdminRequired' });
  }
  next();
};

module.exports = { tenantScope, requireOrgAccess, auditLog, requireRole, superAdminOnly };
