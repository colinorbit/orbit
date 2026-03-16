/**
 * /api/v1/organizations — Organization (Tenant) Routes
 *
 * GET    /organizations/me         Get current org details
 * PATCH  /organizations/me         Update org name, mission, website
 * GET    /organizations/me/users   List users in the org
 * POST   /organizations/me/users   Invite a new user
 * PATCH  /organizations/me/users/:userId   Update user role or status
 * DELETE /organizations/me/users/:userId   Deactivate user (soft)
 *
 * Rules:
 *   - All routes scope to req.user.orgId — never expose cross-org data
 *   - Admin role required for user management and org updates
 *   - Monetary values in cents; all IDs are UUIDs
 */

import { Router, Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';

import { getDB } from '../config/database';
import { logger } from '../config/logger';
import { authenticate } from '../middleware/auth';

const router = Router();

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface AuthRequest extends Request {
  user: {
    id:    string;
    orgId: string;
    email: string;
    role:  string;
  };
}

interface OrgRow {
  id:                string;
  name:              string;
  slug:              string;
  website:           string | null;
  mission:           string | null;
  tax_id:            string | null;
  stripe_account_id: string | null;
  plan:              string;
  active:            boolean;
  created_at:        Date;
  updated_at:        Date;
}

interface UserRow {
  id:            string;
  org_id:        string;
  email:         string;
  first_name:    string;
  last_name:     string;
  role:          string;
  avatar_url:    string | null;
  last_login_at: Date | null;
  active:        boolean;
  created_at:    Date;
  updated_at:    Date;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const USER_ROLES = ['admin', 'manager', 'staff'] as const;

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ data });
}

function fail(
  res:     Response,
  status:  number,
  message: string,
  code:    string,
  details: unknown[] = [],
): void {
  res.status(status).json({ error: message, code, details });
}

function validate(req: Request, res: Response, next: NextFunction): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({
      error:   'Validation failed',
      code:    'VALIDATION_ERROR',
      details: errors.array(),
    });
    return;
  }
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthRequest;
  if (authReq.user.role !== 'admin') {
    fail(res, 403, 'Admin role required', 'FORBIDDEN');
    return;
  }
  next();
}

function serializeOrg(o: OrgRow): Record<string, unknown> {
  return {
    id:      o.id,
    name:    o.name,
    slug:    o.slug,
    website: o.website,
    mission: o.mission,
    plan:    o.plan,
    active:  o.active,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  };
}

function serializeUser(u: UserRow): Record<string, unknown> {
  return {
    id:          u.id,
    email:       u.email,
    firstName:   u.first_name,
    lastName:    u.last_name,
    role:        u.role,
    avatarUrl:   u.avatar_url,
    lastLoginAt: u.last_login_at,
    active:      u.active,
    createdAt:   u.created_at,
    updatedAt:   u.updated_at,
  };
}

// ─── ALL ROUTES REQUIRE AUTHENTICATION ────────────────────────────────────────

router.use(authenticate);

// ─── GET /organizations/me ────────────────────────────────────────────────────

router.get(
  '/me',
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();

    const org = await db<OrgRow>('organizations')
      .where({ id: authReq.user.orgId })
      .first();

    if (!org) {
      fail(res, 404, 'Organization not found', 'NOT_FOUND');
      return;
    }

    ok(res, serializeOrg(org));
  },
);

// ─── PATCH /organizations/me ──────────────────────────────────────────────────

router.patch(
  '/me',
  requireAdmin,
  [
    body('name')
      .optional()
      .notEmpty().withMessage('name cannot be empty')
      .isLength({ max: 255 })
      .trim(),
    body('website')
      .optional({ nullable: true })
      .isURL({ require_protocol: true }).withMessage('website must be a valid URL')
      .isLength({ max: 255 }),
    body('mission')
      .optional({ nullable: true })
      .isString()
      .isLength({ max: 1000 })
      .trim(),
    body('taxId')
      .optional({ nullable: true })
      .isString()
      .isLength({ max: 50 })
      .trim(),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    const { name, website, mission, taxId } = req.body as Record<string, unknown>;

    const updates: Partial<OrgRow> & { updated_at: Date } = { updated_at: new Date() };
    if (name    !== undefined) updates.name    = name    as string;
    if (website !== undefined) updates.website = website as string | null;
    if (mission !== undefined) updates.mission = mission as string | null;
    if (taxId   !== undefined) updates.tax_id  = taxId   as string | null;

    const [updated] = await db<OrgRow>('organizations')
      .where({ id: orgId })
      .update(updates)
      .returning('*');

    if (!updated) {
      fail(res, 404, 'Organization not found', 'NOT_FOUND');
      return;
    }

    logger.info('Organization updated', { orgId });
    ok(res, serializeOrg(updated));
  },
);

// ─── GET /organizations/me/users ──────────────────────────────────────────────

router.get(
  '/me/users',
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();

    const users = await db<UserRow>('users')
      .where({ org_id: authReq.user.orgId })
      .select('id', 'org_id', 'email', 'first_name', 'last_name', 'role',
              'avatar_url', 'last_login_at', 'active', 'created_at', 'updated_at')
      .orderBy('last_name', 'asc');

    ok(res, users.map(serializeUser));
  },
);

// ─── POST /organizations/me/users — Invite user ───────────────────────────────

router.post(
  '/me/users',
  requireAdmin,
  [
    body('email')
      .notEmpty().withMessage('email is required')
      .isEmail().withMessage('email must be a valid email address')
      .normalizeEmail(),
    body('firstName')
      .notEmpty().withMessage('firstName is required')
      .isLength({ max: 100 })
      .trim(),
    body('lastName')
      .notEmpty().withMessage('lastName is required')
      .isLength({ max: 100 })
      .trim(),
    body('role')
      .optional()
      .isIn([...USER_ROLES]).withMessage(`role must be one of: ${USER_ROLES.join(', ')}`),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    const { email, firstName, lastName, role } = req.body as {
      email:      string;
      firstName:  string;
      lastName:   string;
      role?:      string;
    };

    // Check for duplicate email across ALL orgs (email is globally unique)
    const existing = await db<UserRow>('users').where({ email }).first();
    if (existing) {
      fail(res, 409, 'A user with this email already exists', 'EMAIL_CONFLICT');
      return;
    }

    // Insert with a temporary unusable password hash — user must reset via forgot-password
    const INVITE_HASH = '$2b$12$INVITE_PLACEHOLDER_MUST_RESET_PASSWORD_BEFORE_LOGIN_xxxx';

    const [user] = await db<UserRow>('users')
      .insert({
        org_id:        orgId,
        email,
        password_hash: INVITE_HASH,
        first_name:    firstName,
        last_name:     lastName,
        role:          role ?? 'staff',
        active:        true,
      })
      .returning([
        'id', 'org_id', 'email', 'first_name', 'last_name', 'role',
        'avatar_url', 'last_login_at', 'active', 'created_at', 'updated_at',
      ]);

    logger.info('User invited', { userId: user.id, orgId });

    ok(res, serializeUser(user), 201);
  },
);

// ─── PATCH /organizations/me/users/:userId ────────────────────────────────────

router.patch(
  '/me/users/:userId',
  requireAdmin,
  [
    param('userId').isUUID().withMessage('userId must be a valid UUID'),
    body('role')
      .optional()
      .isIn([...USER_ROLES]).withMessage(`role must be one of: ${USER_ROLES.join(', ')}`),
    body('active')
      .optional()
      .isBoolean().withMessage('active must be a boolean'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    // Prevent admin from demoting or deactivating themselves
    if (req.params.userId === authReq.user.id) {
      fail(res, 422, 'You cannot modify your own role or status', 'SELF_MODIFY');
      return;
    }

    const target = await db<UserRow>('users')
      .where({ id: req.params.userId, org_id: orgId })
      .first();
    if (!target) {
      fail(res, 404, 'User not found', 'NOT_FOUND');
      return;
    }

    const { role, active } = req.body as { role?: string; active?: boolean };
    const updates: Partial<UserRow> & { updated_at: Date } = { updated_at: new Date() };
    if (role   !== undefined) updates.role   = role;
    if (active !== undefined) updates.active = active;

    const [updated] = await db<UserRow>('users')
      .where({ id: req.params.userId, org_id: orgId })
      .update(updates)
      .returning([
        'id', 'org_id', 'email', 'first_name', 'last_name', 'role',
        'avatar_url', 'last_login_at', 'active', 'created_at', 'updated_at',
      ]);

    logger.info('User updated', { targetUserId: req.params.userId, orgId });

    ok(res, serializeUser(updated));
  },
);

// ─── DELETE /organizations/me/users/:userId — Deactivate (soft) ──────────────

router.delete(
  '/me/users/:userId',
  requireAdmin,
  [param('userId').isUUID().withMessage('userId must be a valid UUID')],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    if (req.params.userId === authReq.user.id) {
      fail(res, 422, 'You cannot deactivate your own account', 'SELF_MODIFY');
      return;
    }

    const [deactivated] = await db<UserRow>('users')
      .where({ id: req.params.userId, org_id: orgId, active: true })
      .update({ active: false, updated_at: new Date() })
      .returning('id');

    if (!deactivated) {
      fail(res, 404, 'User not found or already deactivated', 'NOT_FOUND');
      return;
    }

    logger.info('User deactivated', { targetUserId: req.params.userId, orgId });

    res.status(204).end();
  },
);

export default router;
