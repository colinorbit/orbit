/**
 * /api/v1/integrations — Integration Configuration Routes
 *
 * GET    /integrations           List all integrations for the org (no credentials)
 * GET    /integrations/:id       Get single integration by ID (no credentials)
 * POST   /integrations           Connect/upsert an integration. Admin required.
 * PATCH  /integrations/:id       Update active status or credentials. Admin required.
 * DELETE /integrations/:id       Hard delete (configuration, not donor data). Admin required.
 * POST   /integrations/:id/sync  Trigger manual sync — updates last_sync_at. Manager+ required.
 *
 * Rules (per CLAUDE.md):
 *   - Every query must include org_id from req.user.orgId
 *   - All IDs are UUIDs
 *   - credentials_encrypted MUST NEVER appear in any API response
 *   - Standard response envelope: { data } / { data, pagination } / { error, code, details }
 *   - Placeholder encryption: JSON.stringify(credentials) + ':orbit-encrypted'
 *     Real AES-256-GCM via ENCRYPTION_KEY (ENV.md) to be wired in Phase 3
 */

import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';

import { getDB }    from '../config/database';
import { logger }   from '../config/logger';
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

interface IntegrationRow {
  id:                     string;
  org_id:                 string;
  provider:               string;
  credentials_encrypted:  string;
  active:                 boolean;
  last_sync_at:           Date | null;
  created_at:             Date;
  updated_at:             Date;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const PROVIDERS = [
  'salesforce',
  'blackbaud',
  'bloomerang',
  'mailchimp',
  'stripe',
  'docusign',
  'sendgrid',
  'twilio',
] as const;

type Provider = typeof PROVIDERS[number];

/** Whitelisted columns for ORDER BY — prevents SQL injection via sort param. */
const SORT_COLUMNS = new Set([
  'provider', 'active', 'last_sync_at', 'created_at', 'updated_at',
]);

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Standard success envelope. */
function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ data });
}

/** Paginated success envelope. */
function okPaged(
  res:   Response,
  data:  unknown,
  total: number,
  page:  number,
  limit: number,
): void {
  res.json({
    data,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
}

/** Standard error envelope. */
function fail(
  res:     Response,
  status:  number,
  message: string,
  code:    string,
  details: unknown[] = [],
): void {
  res.status(status).json({ error: message, code, details });
}

/** Inline express-validator result checker -> 422 on failure. */
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

/**
 * Serialize an IntegrationRow to the camelCase API shape.
 * credentials_encrypted is intentionally NEVER included in the output.
 */
function serializeIntegration(row: IntegrationRow): Record<string, unknown> {
  return {
    id:          row.id,
    orgId:       row.org_id,
    provider:    row.provider,
    active:      row.active,
    lastSyncAt:  row.last_sync_at,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

/**
 * Placeholder encryption.
 * TODO (Phase 3): replace with AES-256-GCM using process.env.ENCRYPTION_KEY
 */
function encryptCredentials(credentials: Record<string, unknown>): string {
  return JSON.stringify(credentials) + ':orbit-encrypted';
}

// ─── ALL ROUTES REQUIRE AUTHENTICATION ────────────────────────────────────────

router.use(authenticate);

// ─── GET /integrations ────────────────────────────────────────────────────────

router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('sort').optional().isString(),
    query('order').optional().isIn(['asc', 'desc']),
    query('provider').optional().isIn([...PROVIDERS]).withMessage(`provider must be one of: ${PROVIDERS.join(', ')}`),
    query('active').optional().isBoolean().toBoolean(),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();

    const page  = (req.query.page  as unknown as number) || 1;
    const limit = (req.query.limit as unknown as number) || 20;
    const order = (req.query.order as string) || 'asc';
    const rawSort = (req.query.sort as string) || 'provider';
    const sort    = SORT_COLUMNS.has(rawSort) ? rawSort : 'provider';
    const offset  = (page - 1) * limit;

    const provider = req.query.provider as Provider | undefined;
    const active   = req.query.active   as unknown as boolean | undefined;

    let qb = db<IntegrationRow>('integrations')
      .where({ org_id: authReq.user.orgId });

    if (provider !== undefined) qb = qb.where({ provider });
    if (active   !== undefined) qb = qb.where({ active });

    const [{ count }] = await qb.clone().count<[{ count: string }]>('id as count');
    const total = parseInt(count, 10);

    const rows = await qb
      .select('id', 'org_id', 'provider', 'active', 'last_sync_at', 'created_at', 'updated_at')
      .orderBy(sort, order as 'asc' | 'desc')
      .limit(limit)
      .offset(offset);

    okPaged(res, rows.map(serializeIntegration), total, page, limit);
  },
);

// ─── GET /integrations/:id ────────────────────────────────────────────────────

router.get(
  '/:id',
  [param('id').isUUID().withMessage('Integration ID must be a valid UUID')],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();

    const row = await db<IntegrationRow>('integrations')
      .where({ id: req.params.id, org_id: authReq.user.orgId })
      .select('id', 'org_id', 'provider', 'active', 'last_sync_at', 'created_at', 'updated_at')
      .first();

    if (!row) {
      fail(res, 404, 'Integration not found', 'NOT_FOUND');
      return;
    }

    ok(res, serializeIntegration(row));
  },
);

// ─── POST /integrations — connect / upsert (admin only) ──────────────────────

router.post(
  '/',
  [
    body('provider')
      .notEmpty().withMessage('provider is required')
      .isIn([...PROVIDERS]).withMessage(`provider must be one of: ${PROVIDERS.join(', ')}`),
    body('credentials')
      .notEmpty().withMessage('credentials is required')
      .isObject().withMessage('credentials must be a JSON object'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;

    // Admin-only: inline role check (no requireRole middleware so the validator
    // errors above still run and return 422 before hitting auth concerns)
    if (authReq.user.role !== 'admin') {
      fail(res, 403, 'Only admins may connect integrations', 'FORBIDDEN');
      return;
    }

    const db    = getDB();
    const orgId = authReq.user.orgId;

    const { provider, credentials } = req.body as {
      provider:    Provider;
      credentials: Record<string, unknown>;
    };

    const credentialsEncrypted = encryptCredentials(credentials);

    // Upsert on (org_id, provider) conflict — one record per provider per org
    const [row] = await db<IntegrationRow>('integrations')
      .insert({
        org_id:                orgId,
        provider,
        credentials_encrypted: credentialsEncrypted,
        active:                true,
        last_sync_at:          null,
      })
      .onConflict(['org_id', 'provider'])
      .merge({
        credentials_encrypted: credentialsEncrypted,
        active:                true,
        updated_at:            new Date(),
      })
      .returning(['id', 'org_id', 'provider', 'active', 'last_sync_at', 'created_at', 'updated_at']);

    logger.info('Integration connected', { orgId, provider, integrationId: row.id });

    ok(res, serializeIntegration(row), 201);
  },
);

// ─── PATCH /integrations/:id (admin only) ────────────────────────────────────

router.patch(
  '/:id',
  [
    param('id').isUUID().withMessage('Integration ID must be a valid UUID'),
    body('active')
      .optional()
      .isBoolean().withMessage('active must be a boolean')
      .toBoolean(),
    body('credentials')
      .optional()
      .isObject().withMessage('credentials must be a JSON object'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;

    if (authReq.user.role !== 'admin') {
      fail(res, 403, 'Only admins may update integrations', 'FORBIDDEN');
      return;
    }

    const db    = getDB();
    const orgId = authReq.user.orgId;

    const { active, credentials } = req.body as {
      active?:      boolean;
      credentials?: Record<string, unknown>;
    };

    const updates: Partial<IntegrationRow> & { updated_at: Date } = {
      updated_at: new Date(),
    };

    if (active      !== undefined) updates.active                 = active;
    if (credentials !== undefined) updates.credentials_encrypted  = encryptCredentials(credentials);

    if (Object.keys(updates).length === 1) {
      // Only updated_at was set — nothing meaningful was provided
      fail(res, 422, 'No valid fields provided', 'NO_FIELDS');
      return;
    }

    const [row] = await db<IntegrationRow>('integrations')
      .where({ id: req.params.id, org_id: orgId })
      .update(updates)
      .returning(['id', 'org_id', 'provider', 'active', 'last_sync_at', 'created_at', 'updated_at']);

    if (!row) {
      fail(res, 404, 'Integration not found', 'NOT_FOUND');
      return;
    }

    logger.info('Integration updated', { orgId, integrationId: row.id });

    ok(res, serializeIntegration(row));
  },
);

// ─── DELETE /integrations/:id (admin only, hard delete) ──────────────────────

router.delete(
  '/:id',
  [param('id').isUUID().withMessage('Integration ID must be a valid UUID')],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;

    if (authReq.user.role !== 'admin') {
      fail(res, 403, 'Only admins may remove integrations', 'FORBIDDEN');
      return;
    }

    const db    = getDB();
    const orgId = authReq.user.orgId;

    // Hard delete: integrations are configuration, not donor data (per spec)
    const [deleted] = await db<IntegrationRow>('integrations')
      .where({ id: req.params.id, org_id: orgId })
      .delete()
      .returning('id');

    if (!deleted) {
      fail(res, 404, 'Integration not found', 'NOT_FOUND');
      return;
    }

    logger.info('Integration deleted', { orgId, integrationId: req.params.id });

    res.status(204).end();
  },
);

// ─── POST /integrations/:id/sync (manager+ required) ─────────────────────────

router.post(
  '/:id/sync',
  [param('id').isUUID().withMessage('Integration ID must be a valid UUID')],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;

    // Manager or admin may trigger a manual sync
    if (!['admin', 'manager'].includes(authReq.user.role)) {
      fail(res, 403, 'Manager or admin role required to trigger a sync', 'FORBIDDEN');
      return;
    }

    const db    = getDB();
    const orgId = authReq.user.orgId;

    const [row] = await db<IntegrationRow>('integrations')
      .where({ id: req.params.id, org_id: orgId })
      .update({
        last_sync_at: new Date(),
        updated_at:   new Date(),
      })
      .returning(['id', 'org_id', 'provider', 'active', 'last_sync_at', 'created_at', 'updated_at']);

    if (!row) {
      fail(res, 404, 'Integration not found', 'NOT_FOUND');
      return;
    }

    logger.info('Integration sync triggered', { orgId, integrationId: row.id, provider: row.provider });

    ok(res, serializeIntegration(row));
  },
);

export default router;
