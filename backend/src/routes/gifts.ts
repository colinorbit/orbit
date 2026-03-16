/**
 * /api/v1/gifts — Gift Routes
 *
 * GET    /gifts                      List gifts (paginated + filtered)
 * GET    /gifts/:id                  Get single gift by ID
 * POST   /gifts                      Record a new gift
 * PATCH  /gifts/:id                  Update gift status or metadata
 * GET    /gifts/donor/:donorId       All gifts for a specific donor
 * GET    /gifts/campaign/:campaignId All gifts for a specific campaign
 *
 * Rules (per CLAUDE.md):
 *   - Every query must include org_id from req.user.orgId
 *   - Monetary values in cents (INTEGER, never FLOAT)
 *   - All IDs are UUIDs
 *   - Soft deletes via status = 'failed' / 'archived' — never hard DELETE
 *   - Audit log required for gift CRUD
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

interface GiftRow {
  id:                       string;
  org_id:                   string;
  donor_id:                 string;
  agent_id:                 string | null;
  campaign_id:              string | null;
  amount_cents:             number;
  fund_name:                string | null;
  gift_type:                string;
  gift_date:                string;
  status:                   string;
  stripe_payment_intent_id: string | null;
  salesforce_opportunity_id: string | null;
  created_at:               Date;
  updated_at:               Date;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const GIFT_TYPES    = ['one_time', 'pledge', 'planned'] as const;
const GIFT_STATUSES = ['pending', 'confirmed', 'failed'] as const;

const SORT_COLUMNS = new Set([
  'gift_date', 'amount_cents', 'fund_name', 'gift_type',
  'status', 'created_at', 'updated_at',
]);

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ data });
}

function okPaged(
  res:   Response,
  data:  unknown,
  total: number,
  page:  number,
  limit: number,
): void {
  res.json({
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
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

function serializeGift(g: GiftRow): Record<string, unknown> {
  return {
    id:                      g.id,
    orgId:                   g.org_id,
    donorId:                 g.donor_id,
    agentId:                 g.agent_id,
    campaignId:              g.campaign_id,
    amountCents:             g.amount_cents,
    fundName:                g.fund_name,
    giftType:                g.gift_type,
    giftDate:                g.gift_date,
    status:                  g.status,
    stripePaymentIntentId:   g.stripe_payment_intent_id,
    salesforceOpportunityId: g.salesforce_opportunity_id,
    createdAt:               g.created_at,
    updatedAt:               g.updated_at,
  };
}

// ─── ALL ROUTES REQUIRE AUTHENTICATION ────────────────────────────────────────

router.use(authenticate);

// ─── GET /gifts ───────────────────────────────────────────────────────────────

router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('sort').optional().isString(),
    query('order').optional().isIn(['asc', 'desc']),
    query('donorId').optional().isUUID(),
    query('campaignId').optional().isUUID(),
    query('status').optional().isIn([...GIFT_STATUSES]),
    query('giftType').optional().isIn([...GIFT_TYPES]),
    query('dateFrom').optional().isDate(),
    query('dateTo').optional().isDate(),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    const page     = (req.query.page  as unknown as number) || 1;
    const limit    = (req.query.limit as unknown as number) || 20;
    const order    = (req.query.order as string) || 'desc';
    const rawSort  = (req.query.sort  as string) || 'gift_date';
    const sort     = SORT_COLUMNS.has(rawSort) ? rawSort : 'gift_date';
    const offset   = (page - 1) * limit;

    const donorId    = req.query.donorId    as string | undefined;
    const campaignId = req.query.campaignId as string | undefined;
    const status     = req.query.status     as string | undefined;
    const giftType   = req.query.giftType   as string | undefined;
    const dateFrom   = req.query.dateFrom   as string | undefined;
    const dateTo     = req.query.dateTo     as string | undefined;

    let qb = db<GiftRow>('gifts').where({ org_id: orgId });

    if (donorId)    qb = qb.where({ donor_id:    donorId    });
    if (campaignId) qb = qb.where({ campaign_id: campaignId });
    if (status)     qb = qb.where({ status });
    if (giftType)   qb = qb.where({ gift_type:   giftType   });
    if (dateFrom)   qb = qb.where('gift_date', '>=', dateFrom);
    if (dateTo)     qb = qb.where('gift_date', '<=', dateTo);

    const [{ count }] = await qb.clone().count<[{ count: string }]>('id as count');
    const total = parseInt(count, 10);

    const gifts = await qb
      .orderBy(sort, order as 'asc' | 'desc')
      .limit(limit)
      .offset(offset);

    okPaged(res, gifts.map(serializeGift), total, page, limit);
  },
);

// ─── GET /gifts/donor/:donorId ────────────────────────────────────────────────

router.get(
  '/donor/:donorId',
  [param('donorId').isUUID().withMessage('donorId must be a valid UUID')],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    // Verify donor belongs to this org
    const donor = await db('donors')
      .where({ id: req.params.donorId, org_id: orgId })
      .first();
    if (!donor) {
      fail(res, 404, 'Donor not found', 'NOT_FOUND');
      return;
    }

    const gifts = await db<GiftRow>('gifts')
      .where({ donor_id: req.params.donorId, org_id: orgId })
      .orderBy('gift_date', 'desc');

    ok(res, gifts.map(serializeGift));
  },
);

// ─── GET /gifts/campaign/:campaignId ─────────────────────────────────────────

router.get(
  '/campaign/:campaignId',
  [param('campaignId').isUUID().withMessage('campaignId must be a valid UUID')],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    // Verify campaign belongs to this org
    const campaign = await db('campaigns')
      .where({ id: req.params.campaignId, org_id: orgId })
      .whereNot({ status: 'archived' })
      .first();
    if (!campaign) {
      fail(res, 404, 'Campaign not found', 'NOT_FOUND');
      return;
    }

    const gifts = await db<GiftRow>('gifts')
      .where({ campaign_id: req.params.campaignId, org_id: orgId })
      .orderBy('gift_date', 'desc');

    ok(res, gifts.map(serializeGift));
  },
);

// ─── GET /gifts/:id ───────────────────────────────────────────────────────────

router.get(
  '/:id',
  [param('id').isUUID().withMessage('Gift ID must be a valid UUID')],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();

    const gift = await db<GiftRow>('gifts')
      .where({ id: req.params.id, org_id: authReq.user.orgId })
      .first();
    if (!gift) {
      fail(res, 404, 'Gift not found', 'NOT_FOUND');
      return;
    }

    ok(res, serializeGift(gift));
  },
);

// ─── POST /gifts ──────────────────────────────────────────────────────────────

router.post(
  '/',
  [
    body('donorId')
      .notEmpty().withMessage('donorId is required')
      .isUUID().withMessage('donorId must be a valid UUID'),
    body('amountCents')
      .notEmpty().withMessage('amountCents is required')
      .isInt({ min: 1 }).withMessage('amountCents must be a positive integer (cents)'),
    body('giftDate')
      .notEmpty().withMessage('giftDate is required')
      .isDate().withMessage('giftDate must be a valid date (YYYY-MM-DD)'),
    body('giftType')
      .optional()
      .isIn([...GIFT_TYPES]).withMessage(`giftType must be one of: ${GIFT_TYPES.join(', ')}`),
    body('status')
      .optional()
      .isIn([...GIFT_STATUSES]).withMessage(`status must be one of: ${GIFT_STATUSES.join(', ')}`),
    body('fundName')
      .optional()
      .isString().withMessage('fundName must be a string')
      .isLength({ max: 255 })
      .trim(),
    body('campaignId')
      .optional({ nullable: true })
      .isUUID().withMessage('campaignId must be a valid UUID'),
    body('agentId')
      .optional({ nullable: true })
      .isUUID().withMessage('agentId must be a valid UUID'),
    body('stripePaymentIntentId')
      .optional()
      .isString()
      .isLength({ max: 255 })
      .trim(),
    body('salesforceOpportunityId')
      .optional()
      .isString()
      .isLength({ max: 255 })
      .trim(),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    const {
      donorId,
      amountCents,
      giftDate,
      giftType,
      status,
      fundName,
      campaignId,
      agentId,
      stripePaymentIntentId,
      salesforceOpportunityId,
    } = req.body as {
      donorId:                 string;
      amountCents:             number;
      giftDate:                string;
      giftType?:               string;
      status?:                 string;
      fundName?:               string;
      campaignId?:             string | null;
      agentId?:                string | null;
      stripePaymentIntentId?:  string;
      salesforceOpportunityId?: string;
    };

    // Verify donor exists and belongs to this org
    const donor = await db('donors')
      .where({ id: donorId, org_id: orgId })
      .whereNot({ status: 'archived' })
      .first();
    if (!donor) {
      fail(res, 422, 'Donor not found in your organization', 'INVALID_DONOR');
      return;
    }

    // Verify campaign if provided
    if (campaignId) {
      const campaign = await db('campaigns')
        .where({ id: campaignId, org_id: orgId })
        .whereNot({ status: 'archived' })
        .first();
      if (!campaign) {
        fail(res, 422, 'Campaign not found in your organization', 'INVALID_CAMPAIGN');
        return;
      }
    }

    const gift = await db.transaction(async (trx) => {
      const [newGift] = await trx<GiftRow>('gifts')
        .insert({
          org_id:                    orgId,
          donor_id:                  donorId,
          agent_id:                  agentId           ?? null,
          campaign_id:               campaignId        ?? null,
          amount_cents:              amountCents,
          fund_name:                 fundName          ?? null,
          gift_type:                 giftType          ?? 'one_time',
          gift_date:                 giftDate,
          status:                    status            ?? 'confirmed',
          stripe_payment_intent_id:  stripePaymentIntentId  ?? null,
          salesforce_opportunity_id: salesforceOpportunityId ?? null,
        })
        .returning('*');

      // Update donor giving summary
      await trx('donors')
        .where({ id: donorId, org_id: orgId })
        .update({
          total_giving_cents: trx.raw('total_giving_cents + ?', [amountCents]),
          last_gift_cents:    amountCents,
          last_gift_date:     giftDate,
          number_of_gifts:    trx.raw('number_of_gifts + 1'),
          updated_at:         new Date(),
        });

      // Update campaign raised amount if attached
      if (campaignId) {
        await trx('campaigns')
          .where({ id: campaignId, org_id: orgId })
          .update({
            raised_cents: trx.raw('raised_cents + ?', [amountCents]),
            updated_at:   new Date(),
          });
      }

      // Audit log
      await trx('audit_logs').insert({
        org_id:     orgId,
        user_id:    authReq.user.id,
        event_type: 'gift.created',
        payload:    JSON.stringify({ gift_id: newGift.id, donor_id: donorId, amount_cents: amountCents }),
        ip_address: req.ip,
      });

      return newGift;
    });

    logger.info('Gift recorded', {
      giftId:      gift.id,
      donorId,
      amountCents,
      orgId,
    });

    ok(res, serializeGift(gift), 201);
  },
);

// ─── PATCH /gifts/:id ─────────────────────────────────────────────────────────

router.patch(
  '/:id',
  [
    param('id').isUUID().withMessage('Gift ID must be a valid UUID'),
    body('status')
      .optional()
      .isIn([...GIFT_STATUSES]).withMessage(`status must be one of: ${GIFT_STATUSES.join(', ')}`),
    body('fundName')
      .optional()
      .isString()
      .isLength({ max: 255 })
      .trim(),
    body('salesforceOpportunityId')
      .optional({ nullable: true })
      .isString()
      .isLength({ max: 255 })
      .trim(),
    body('stripePaymentIntentId')
      .optional({ nullable: true })
      .isString()
      .isLength({ max: 255 })
      .trim(),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    const existing = await db<GiftRow>('gifts')
      .where({ id: req.params.id, org_id: orgId })
      .first();
    if (!existing) {
      fail(res, 404, 'Gift not found', 'NOT_FOUND');
      return;
    }

    const { status, fundName, salesforceOpportunityId, stripePaymentIntentId } =
      req.body as Record<string, unknown>;

    const updates: Partial<GiftRow> & { updated_at: Date } = { updated_at: new Date() };
    if (status                   !== undefined) updates.status                    = status as string;
    if (fundName                 !== undefined) updates.fund_name                 = fundName as string | null;
    if (salesforceOpportunityId  !== undefined) updates.salesforce_opportunity_id = salesforceOpportunityId as string | null;
    if (stripePaymentIntentId    !== undefined) updates.stripe_payment_intent_id  = stripePaymentIntentId as string | null;

    const [updated] = await db<GiftRow>('gifts')
      .where({ id: req.params.id, org_id: orgId })
      .update(updates)
      .returning('*');

    logger.info('Gift updated', { giftId: updated.id, orgId });

    ok(res, serializeGift(updated));
  },
);

export default router;
