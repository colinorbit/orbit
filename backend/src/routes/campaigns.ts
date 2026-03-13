/**
 * /api/v1/campaigns — Campaign Routes
 *
 * GET    /campaigns                  List campaigns (paginated + filtered)
 * GET    /campaigns/:id              Get single campaign by ID
 * POST   /campaigns                  Create campaign
 * PATCH  /campaigns/:id              Update campaign
 * DELETE /campaigns/:id              Soft-delete campaign (status: archived)
 * POST   /campaigns/:id/donors       Assign donors to campaign
 * DELETE /campaigns/:id/donors       Remove donors from campaign
 * GET    /campaigns/:id/stats        Campaign performance statistics
 *
 * Rules (per CLAUDE.md):
 *   - Every query must include org_id from req.user.orgId
 *   - Monetary values in cents (INTEGER, never FLOAT)
 *   - All IDs are UUIDs
 *   - Soft deletes only — status: 'archived', never hard DELETE
 *   - Standard response envelope: { data } / { data, pagination } / { error, code, details }
 */

import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';

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

interface CampaignRow {
  id:                    string;
  org_id:                string;
  name:                  string;
  description:           string | null;
  type:                  string;
  goal_cents:            number | null;
  raised_cents:          number;
  start_date:            string;
  end_date:              string;
  status:                string;
  vco_agent_id:          string | null;
  salesforce_campaign_id: string | null;
  created_at:            Date;
  updated_at:            Date;
}

interface CampaignDonorRow {
  id:          string;
  campaign_id: string;
  donor_id:    string;
  org_id:      string;
  assigned_at: Date;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const CAMPAIGN_TYPES   = ['general', 'giving_tuesday', 'year_end', 'capital'] as const;
const CAMPAIGN_STATUSES = ['draft', 'active', 'completed', 'cancelled'] as const;

/** Whitelisted columns for ORDER BY — prevents SQL injection via sort param. */
const SORT_COLUMNS = new Set([
  'name', 'status', 'type', 'start_date', 'end_date',
  'goal_cents', 'raised_cents', 'created_at', 'updated_at',
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

/** Inline express-validator result checker → 422 on failure. */
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

/** Map a DB CampaignRow to the camelCase API shape. */
function serializeCampaign(c: CampaignRow): Record<string, unknown> {
  return {
    id:                   c.id,
    orgId:                c.org_id,
    name:                 c.name,
    description:          c.description,
    type:                 c.type,
    goalCents:            c.goal_cents,
    raisedCents:          c.raised_cents,
    startDate:            c.start_date,
    endDate:              c.end_date,
    status:               c.status,
    vcoAgentId:           c.vco_agent_id,
    salesforceCampaignId: c.salesforce_campaign_id,
    createdAt:            c.created_at,
    updatedAt:            c.updated_at,
  };
}

// ─── ALL ROUTES REQUIRE AUTHENTICATION ────────────────────────────────────────

router.use(authenticate);

// ─── GET /campaigns ───────────────────────────────────────────────────────────

router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('sort').optional().isString(),
    query('order').optional().isIn(['asc', 'desc']),
    query('search').optional().isString().trim().escape(),
    query('status').optional().isIn([...CAMPAIGN_STATUSES, 'archived']),
    query('type').optional().isIn([...CAMPAIGN_TYPES]),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();

    const page  = (req.query.page  as unknown as number) || 1;
    const limit = (req.query.limit as unknown as number) || 20;
    const order = (req.query.order as string) || 'asc';
    const rawSort = (req.query.sort as string) || 'name';
    const sort  = SORT_COLUMNS.has(rawSort) ? rawSort : 'name';
    const search  = req.query.search  as string | undefined;
    const status  = req.query.status  as string | undefined;
    const type    = req.query.type    as string | undefined;
    const offset  = (page - 1) * limit;

    let qb = db<CampaignRow>('campaigns')
      .where({ org_id: authReq.user.orgId })
      .whereNot({ status: 'archived' });

    if (status)  qb = qb.where({ status });
    if (type)    qb = qb.where({ type });
    if (search) {
      const like = `%${search}%`;
      qb = qb.where((b) => b.whereILike('name', like).orWhereILike('description', like));
    }

    const [{ count }] = await qb.clone().count<[{ count: string }]>('id as count');
    const total = parseInt(count, 10);

    const campaigns = await qb
      .orderBy(sort, order as 'asc' | 'desc')
      .limit(limit)
      .offset(offset);

    okPaged(res, campaigns.map(serializeCampaign), total, page, limit);
  },
);

// ─── GET /campaigns/:id ───────────────────────────────────────────────────────

router.get(
  '/:id',
  [param('id').isUUID().withMessage('Campaign ID must be a valid UUID')],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();

    const campaign = await db<CampaignRow>('campaigns')
      .where({ id: req.params.id, org_id: authReq.user.orgId })
      .whereNot({ status: 'archived' })
      .first();

    if (!campaign) {
      fail(res, 404, 'Campaign not found', 'NOT_FOUND');
      return;
    }

    ok(res, serializeCampaign(campaign));
  },
);

// ─── POST /campaigns ──────────────────────────────────────────────────────────

router.post(
  '/',
  [
    body('name')
      .notEmpty().withMessage('name is required')
      .isLength({ max: 255 }).withMessage('name must be 255 characters or fewer')
      .trim(),
    body('description')
      .optional()
      .isString().withMessage('description must be a string')
      .isLength({ max: 5000 }).withMessage('description must be 5000 characters or fewer')
      .trim(),
    body('type')
      .optional()
      .isIn([...CAMPAIGN_TYPES]).withMessage(`type must be one of: ${CAMPAIGN_TYPES.join(', ')}`),
    body('goalCents')
      .optional()
      .isInt({ min: 1 }).withMessage('goalCents must be a positive integer (cents)'),
    body('startDate')
      .notEmpty().withMessage('startDate is required')
      .isDate().withMessage('startDate must be a valid date (YYYY-MM-DD)'),
    body('endDate')
      .notEmpty().withMessage('endDate is required')
      .isDate().withMessage('endDate must be a valid date (YYYY-MM-DD)')
      .custom((endDate: string, { req: r }) => {
        if (r.body.startDate && endDate <= r.body.startDate) {
          throw new Error('endDate must be after startDate');
        }
        return true;
      }),
    body('status')
      .optional()
      .isIn([...CAMPAIGN_STATUSES]).withMessage(`status must be one of: ${CAMPAIGN_STATUSES.join(', ')}`),
    body('vcoAgentId')
      .optional()
      .isUUID().withMessage('vcoAgentId must be a valid UUID'),
    body('salesforceCampaignId')
      .optional()
      .isString().withMessage('salesforceCampaignId must be a string')
      .isLength({ max: 255 }).withMessage('salesforceCampaignId must be 255 characters or fewer')
      .trim(),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();

    const {
      name,
      description,
      type,
      goalCents,
      startDate,
      endDate,
      status,
      vcoAgentId,
      salesforceCampaignId,
    } = req.body as {
      name:                 string;
      description?:         string;
      type?:                string;
      goalCents?:           number;
      startDate:            string;
      endDate:              string;
      status?:              string;
      vcoAgentId?:          string;
      salesforceCampaignId?: string;
    };

    // If a vcoAgentId is provided, verify it belongs to this org
    if (vcoAgentId) {
      const agent = await db('agents')
        .where({ id: vcoAgentId, org_id: authReq.user.orgId, type: 'VCO' })
        .first();
      if (!agent) {
        fail(res, 422, 'vcoAgentId must reference a VCO agent in your organization', 'INVALID_AGENT');
        return;
      }
    }

    const [campaign] = await db<CampaignRow>('campaigns')
      .insert({
        org_id:                authReq.user.orgId,
        name,
        description:           description ?? null,
        type:                  type         ?? 'general',
        goal_cents:            goalCents    ?? null,
        raised_cents:          0,
        start_date:            startDate,
        end_date:              endDate,
        status:                status       ?? 'draft',
        vco_agent_id:          vcoAgentId   ?? null,
        salesforce_campaign_id: salesforceCampaignId ?? null,
      })
      .returning('*');

    logger.info('Campaign created', { campaignId: campaign.id, orgId: authReq.user.orgId });

    ok(res, serializeCampaign(campaign), 201);
  },
);

// ─── PATCH /campaigns/:id ─────────────────────────────────────────────────────

router.patch(
  '/:id',
  [
    param('id').isUUID().withMessage('Campaign ID must be a valid UUID'),
    body('name')
      .optional()
      .notEmpty().withMessage('name cannot be empty')
      .isLength({ max: 255 }).withMessage('name must be 255 characters or fewer')
      .trim(),
    body('description')
      .optional()
      .isString().withMessage('description must be a string')
      .isLength({ max: 5000 }).withMessage('description must be 5000 characters or fewer')
      .trim(),
    body('type')
      .optional()
      .isIn([...CAMPAIGN_TYPES]).withMessage(`type must be one of: ${CAMPAIGN_TYPES.join(', ')}`),
    body('goalCents')
      .optional()
      .isInt({ min: 1 }).withMessage('goalCents must be a positive integer (cents)'),
    body('startDate')
      .optional()
      .isDate().withMessage('startDate must be a valid date (YYYY-MM-DD)'),
    body('endDate')
      .optional()
      .isDate().withMessage('endDate must be a valid date (YYYY-MM-DD)'),
    body('status')
      .optional()
      .isIn([...CAMPAIGN_STATUSES]).withMessage(`status must be one of: ${CAMPAIGN_STATUSES.join(', ')}`),
    body('vcoAgentId')
      .optional({ nullable: true })
      .custom((val: unknown) => val === null || (typeof val === 'string'))
      .withMessage('vcoAgentId must be a UUID or null'),
    body('salesforceCampaignId')
      .optional()
      .isString().withMessage('salesforceCampaignId must be a string')
      .isLength({ max: 255 })
      .trim(),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    const existing = await db<CampaignRow>('campaigns')
      .where({ id: req.params.id, org_id: orgId })
      .whereNot({ status: 'archived' })
      .first();

    if (!existing) {
      fail(res, 404, 'Campaign not found', 'NOT_FOUND');
      return;
    }

    // Build update map — only include fields that were explicitly sent
    const {
      name,
      description,
      type,
      goalCents,
      startDate,
      endDate,
      status,
      vcoAgentId,
      salesforceCampaignId,
    } = req.body as Record<string, unknown>;

    const updates: Partial<CampaignRow> = { updated_at: new Date() };

    if (name               !== undefined) updates.name                  = name as string;
    if (description        !== undefined) updates.description           = description as string | null;
    if (type               !== undefined) updates.type                  = type as string;
    if (goalCents          !== undefined) updates.goal_cents            = goalCents as number;
    if (startDate          !== undefined) updates.start_date            = startDate as string;
    if (endDate            !== undefined) updates.end_date              = endDate as string;
    if (status             !== undefined) updates.status                = status as string;
    if (vcoAgentId         !== undefined) updates.vco_agent_id          = vcoAgentId as string | null;
    if (salesforceCampaignId !== undefined) updates.salesforce_campaign_id = salesforceCampaignId as string | null;

    // Validate date ordering after merging existing + updates
    const effectiveStart = (updates.start_date ?? existing.start_date) as string;
    const effectiveEnd   = (updates.end_date   ?? existing.end_date)   as string;
    if (effectiveEnd <= effectiveStart) {
      fail(res, 422, 'endDate must be after startDate', 'VALIDATION_ERROR');
      return;
    }

    // If setting a vcoAgentId, confirm it belongs to this org
    if (updates.vco_agent_id) {
      const agent = await db('agents')
        .where({ id: updates.vco_agent_id, org_id: orgId, type: 'VCO' })
        .first();
      if (!agent) {
        fail(res, 422, 'vcoAgentId must reference a VCO agent in your organization', 'INVALID_AGENT');
        return;
      }
    }

    const [updated] = await db<CampaignRow>('campaigns')
      .where({ id: req.params.id, org_id: orgId })
      .update(updates)
      .returning('*');

    logger.info('Campaign updated', { campaignId: updated.id, orgId });

    ok(res, serializeCampaign(updated));
  },
);

// ─── DELETE /campaigns/:id (soft-delete) ──────────────────────────────────────

router.delete(
  '/:id',
  [param('id').isUUID().withMessage('Campaign ID must be a valid UUID')],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    const [archived] = await db<CampaignRow>('campaigns')
      .where({ id: req.params.id, org_id: orgId })
      .whereNot({ status: 'archived' })
      .update({ status: 'archived', updated_at: new Date() })
      .returning('id');

    if (!archived) {
      fail(res, 404, 'Campaign not found', 'NOT_FOUND');
      return;
    }

    logger.info('Campaign archived', { campaignId: req.params.id, orgId });

    res.status(204).end();
  },
);

// ─── POST /campaigns/:id/donors — Assign donors ───────────────────────────────

router.post(
  '/:id/donors',
  [
    param('id').isUUID().withMessage('Campaign ID must be a valid UUID'),
    body('donorIds')
      .isArray({ min: 1, max: 500 }).withMessage('donorIds must be a non-empty array of up to 500 UUIDs'),
    body('donorIds.*')
      .isUUID().withMessage('Each donorId must be a valid UUID'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    // Verify campaign exists and belongs to this org
    const campaign = await db<CampaignRow>('campaigns')
      .where({ id: req.params.id, org_id: orgId })
      .whereNot({ status: 'archived' })
      .first();

    if (!campaign) {
      fail(res, 404, 'Campaign not found', 'NOT_FOUND');
      return;
    }

    const { donorIds } = req.body as { donorIds: string[] };

    // Verify all requested donors exist within this org (deduplicate first)
    const uniqueIds  = [...new Set(donorIds)];
    const validDonors = await db('donors')
      .whereIn('id', uniqueIds)
      .where({ org_id: orgId })
      .whereNot({ status: 'archived' })
      .select('id');

    const validIdSet = new Set(validDonors.map((d: { id: string }) => d.id));
    const invalidIds = uniqueIds.filter((id) => !validIdSet.has(id));

    if (invalidIds.length > 0) {
      fail(res, 422, 'Some donor IDs are invalid or not in your organization', 'INVALID_DONOR_IDS', invalidIds);
      return;
    }

    // Fetch already-assigned donor IDs to avoid duplicate insert
    const existing = await db<CampaignDonorRow>('campaign_donors')
      .where({ campaign_id: req.params.id, org_id: orgId })
      .whereIn('donor_id', uniqueIds)
      .select('donor_id');

    const existingSet  = new Set(existing.map((r: { donor_id: string }) => r.donor_id));
    const toInsert     = uniqueIds.filter((id) => !existingSet.has(id));

    let assignedCount = 0;
    if (toInsert.length > 0) {
      const rows = toInsert.map((donorId) => ({
        campaign_id:  req.params.id,
        donor_id:     donorId,
        org_id:       orgId,
        assigned_at:  new Date(),
      }));
      await db('campaign_donors').insert(rows);
      assignedCount = toInsert.length;
    }

    const skippedCount = uniqueIds.length - toInsert.length;

    logger.info('Donors assigned to campaign', {
      campaignId:    req.params.id,
      assignedCount,
      skippedCount,
      orgId,
    });

    ok(res, {
      campaignId:    req.params.id,
      assignedCount,
      skippedCount,
      message:       `${assignedCount} donor(s) assigned; ${skippedCount} already assigned (skipped).`,
    });
  },
);

// ─── DELETE /campaigns/:id/donors — Remove donors ─────────────────────────────

router.delete(
  '/:id/donors',
  [
    param('id').isUUID().withMessage('Campaign ID must be a valid UUID'),
    body('donorIds')
      .isArray({ min: 1, max: 500 }).withMessage('donorIds must be a non-empty array of up to 500 UUIDs'),
    body('donorIds.*')
      .isUUID().withMessage('Each donorId must be a valid UUID'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    // Verify campaign exists and belongs to this org
    const campaign = await db<CampaignRow>('campaigns')
      .where({ id: req.params.id, org_id: orgId })
      .whereNot({ status: 'archived' })
      .first();

    if (!campaign) {
      fail(res, 404, 'Campaign not found', 'NOT_FOUND');
      return;
    }

    const { donorIds } = req.body as { donorIds: string[] };
    const uniqueIds    = [...new Set(donorIds)];

    const removedCount = await db('campaign_donors')
      .where({ campaign_id: req.params.id, org_id: orgId })
      .whereIn('donor_id', uniqueIds)
      .delete();

    logger.info('Donors removed from campaign', {
      campaignId:   req.params.id,
      removedCount,
      orgId,
    });

    ok(res, {
      campaignId:   req.params.id,
      removedCount,
      message:      `${removedCount} donor(s) removed from campaign.`,
    });
  },
);

// ─── GET /campaigns/:id/stats ─────────────────────────────────────────────────

router.get(
  '/:id/stats',
  [param('id').isUUID().withMessage('Campaign ID must be a valid UUID')],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    const campaign = await db<CampaignRow>('campaigns')
      .where({ id: req.params.id, org_id: orgId })
      .whereNot({ status: 'archived' })
      .first();

    if (!campaign) {
      fail(res, 404, 'Campaign not found', 'NOT_FOUND');
      return;
    }

    const campaignId = req.params.id;

    // Run stat queries concurrently for performance
    const [
      donorCountResult,
      giftStatsResult,
      topDonorsResult,
      assignedDonorCountResult,
    ] = await Promise.all([

      // Distinct donors who have given to this campaign
      db('gifts')
        .where({ campaign_id: campaignId, org_id: orgId })
        .whereNot({ status: 'failed' })
        .countDistinct<[{ count: string }]>('donor_id as count'),

      // Aggregate gift metrics
      db('gifts')
        .where({ campaign_id: campaignId, org_id: orgId })
        .whereNot({ status: 'failed' })
        .select(
          db.raw('COALESCE(SUM(amount_cents), 0)::bigint        AS raised_cents'),
          db.raw('COUNT(*)::int                                  AS gift_count'),
          db.raw('COALESCE(AVG(amount_cents), 0)::bigint        AS avg_gift_cents'),
          db.raw('COALESCE(MAX(amount_cents), 0)::bigint        AS largest_gift_cents'),
        )
        .first<{
          raised_cents:       string;
          gift_count:         number;
          avg_gift_cents:     string;
          largest_gift_cents: string;
        }>(),

      // Top 5 donors by total giving to this campaign
      db('gifts')
        .join('donors', 'donors.id', 'gifts.donor_id')
        .where({ 'gifts.campaign_id': campaignId, 'gifts.org_id': orgId })
        .whereNot({ 'gifts.status': 'failed' })
        .select(
          'donors.id',
          db.raw("CONCAT(donors.first_name, ' ', donors.last_name) AS name"),
          db.raw('SUM(gifts.amount_cents)::bigint AS total_cents'),
        )
        .groupBy('donors.id', 'donors.first_name', 'donors.last_name')
        .orderBy('total_cents', 'desc')
        .limit(5),

      // Total donors assigned to this campaign (from campaign_donors join table)
      db('campaign_donors')
        .where({ campaign_id: campaignId, org_id: orgId })
        .count<[{ count: string }]>('donor_id as count'),
    ]);

    const raisedCents       = parseInt(giftStatsResult?.raised_cents       ?? '0', 10);
    const avgGiftCents      = parseInt(giftStatsResult?.avg_gift_cents      ?? '0', 10);
    const largestGiftCents  = parseInt(giftStatsResult?.largest_gift_cents  ?? '0', 10);
    const giftCount         = giftStatsResult?.gift_count  ?? 0;
    const uniqueDonorCount  = parseInt(donorCountResult[0]?.count            ?? '0', 10);
    const assignedDonors    = parseInt(assignedDonorCountResult[0]?.count    ?? '0', 10);
    const goalCents         = campaign.goal_cents ?? 0;
    const progressPercent   = goalCents > 0 ? Math.min(Math.round((raisedCents / goalCents) * 100), 100) : null;

    // Days remaining (negative = overdue)
    const today      = new Date();
    const endDate    = new Date(campaign.end_date);
    const msPerDay   = 1000 * 60 * 60 * 24;
    const daysRemaining = Math.ceil((endDate.getTime() - today.getTime()) / msPerDay);

    ok(res, {
      campaignId,
      name:              campaign.name,
      status:            campaign.status,
      type:              campaign.type,
      startDate:         campaign.start_date,
      endDate:           campaign.end_date,
      daysRemaining,
      goalCents,
      raisedCents,
      progressPercent,
      giftCount,
      uniqueDonorCount,
      avgGiftCents,
      largestGiftCents,
      assignedDonors,
      topDonors: (topDonorsResult as Array<{ id: string; name: string; total_cents: string }>).map((d) => ({
        donorId:     d.id,
        name:        d.name,
        totalCents:  parseInt(d.total_cents, 10),
      })),
    });
  },
);

export default router;
