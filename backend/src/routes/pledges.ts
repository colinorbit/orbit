/**
 * /api/v1/pledges — Pledge Routes
 *
 * GET    /pledges                          List pledges (paginated + filtered)
 * GET    /pledges/:id                      Get single pledge by ID
 * POST   /pledges                          Create pledge
 * PATCH  /pledges/:id                      Update pledge status or metadata
 * GET    /pledges/:id/installments         List installments for a pledge
 * PATCH  /pledges/:id/installments/:instId Update installment status (mark paid/forgiven)
 * GET    /pledges/donor/:donorId           All pledges for a donor
 *
 * Rules (per CLAUDE.md):
 *   - Every query must include org_id from req.user.orgId
 *   - Monetary values in cents (INTEGER, never FLOAT)
 *   - All IDs are UUIDs
 *   - Soft deletes via status = 'cancelled' / no hard DELETE
 *   - Audit log required for pledge CRUD and installment updates
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

interface PledgeRow {
  id:                       string;
  org_id:                   string;
  donor_id:                 string;
  gift_agreement_id:        string | null;
  total_amount_cents:       number;
  years:                    number;
  frequency:                string;
  start_date:               string;
  end_date:                 string | null;
  fund_name:                string | null;
  status:                   string;
  stripe_subscription_id:   string | null;
  salesforce_opportunity_id: string | null;
  created_at:               Date;
  updated_at:               Date;
}

interface InstallmentRow {
  id:                     string;
  pledge_id:              string;
  org_id:                 string;
  amount_cents:           number;
  due_date:               string;
  status:                 string;
  paid_at:                Date | null;
  stripe_invoice_id:      string | null;
  stripe_subscription_id: string | null;
  created_at:             Date;
  updated_at:             Date;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const PLEDGE_STATUSES       = ['active', 'completed', 'cancelled', 'lapsed'] as const;
const PLEDGE_FREQUENCIES    = ['monthly', 'quarterly', 'annually'] as const;
const INSTALLMENT_STATUSES  = ['pending', 'paid', 'failed', 'forgiven'] as const;

const SORT_COLUMNS = new Set([
  'start_date', 'end_date', 'total_amount_cents', 'status',
  'frequency', 'created_at', 'updated_at',
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

function serializePledge(p: PledgeRow): Record<string, unknown> {
  return {
    id:                      p.id,
    orgId:                   p.org_id,
    donorId:                 p.donor_id,
    giftAgreementId:         p.gift_agreement_id,
    totalAmountCents:        p.total_amount_cents,
    years:                   p.years,
    frequency:               p.frequency,
    startDate:               p.start_date,
    endDate:                 p.end_date,
    fundName:                p.fund_name,
    status:                  p.status,
    stripeSubscriptionId:    p.stripe_subscription_id,
    salesforceOpportunityId: p.salesforce_opportunity_id,
    createdAt:               p.created_at,
    updatedAt:               p.updated_at,
  };
}

function serializeInstallment(i: InstallmentRow): Record<string, unknown> {
  return {
    id:                   i.id,
    pledgeId:             i.pledge_id,
    orgId:                i.org_id,
    amountCents:          i.amount_cents,
    dueDate:              i.due_date,
    status:               i.status,
    paidAt:               i.paid_at,
    stripeInvoiceId:      i.stripe_invoice_id,
    stripeSubscriptionId: i.stripe_subscription_id,
    createdAt:            i.created_at,
    updatedAt:            i.updated_at,
  };
}

/**
 * Generate installment schedule rows for a pledge.
 * Installment amount = total_amount_cents / years / installments_per_year
 */
function buildInstallmentSchedule(
  pledgeId:          string,
  orgId:             string,
  totalAmountCents:  number,
  years:             number,
  frequency:         string,
  startDate:         string,
): Array<Partial<InstallmentRow>> {
  const periodsPerYear =
    frequency === 'monthly'   ? 12 :
    frequency === 'quarterly' ? 4  : 1;
  const totalPeriods    = years * periodsPerYear;
  const amountPerPeriod = Math.floor(totalAmountCents / totalPeriods);
  // Remainder on last installment to avoid floating point drift
  const remainder = totalAmountCents - amountPerPeriod * totalPeriods;

  const schedule: Array<Partial<InstallmentRow>> = [];
  const base = new Date(startDate);

  for (let i = 0; i < totalPeriods; i++) {
    const due = new Date(base);
    if (frequency === 'monthly') {
      due.setMonth(due.getMonth() + i);
    } else if (frequency === 'quarterly') {
      due.setMonth(due.getMonth() + i * 3);
    } else {
      due.setFullYear(due.getFullYear() + i);
    }

    schedule.push({
      pledge_id:    pledgeId,
      org_id:       orgId,
      amount_cents: i === totalPeriods - 1 ? amountPerPeriod + remainder : amountPerPeriod,
      due_date:     due.toISOString().split('T')[0],
      status:       'pending',
    });
  }

  return schedule;
}

// ─── ALL ROUTES REQUIRE AUTHENTICATION ────────────────────────────────────────

router.use(authenticate);

// ─── GET /pledges ─────────────────────────────────────────────────────────────

router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('sort').optional().isString(),
    query('order').optional().isIn(['asc', 'desc']),
    query('status').optional().isIn([...PLEDGE_STATUSES]),
    query('frequency').optional().isIn([...PLEDGE_FREQUENCIES]),
    query('donorId').optional().isUUID(),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    const page    = (req.query.page  as unknown as number) || 1;
    const limit   = (req.query.limit as unknown as number) || 20;
    const order   = (req.query.order as string) || 'desc';
    const rawSort = (req.query.sort  as string) || 'created_at';
    const sort    = SORT_COLUMNS.has(rawSort) ? rawSort : 'created_at';
    const offset  = (page - 1) * limit;

    const status    = req.query.status    as string | undefined;
    const frequency = req.query.frequency as string | undefined;
    const donorId   = req.query.donorId   as string | undefined;

    let qb = db<PledgeRow>('pledges').where({ org_id: orgId });

    if (status)    qb = qb.where({ status });
    if (frequency) qb = qb.where({ frequency });
    if (donorId)   qb = qb.where({ donor_id: donorId });

    const [{ count }] = await qb.clone().count<[{ count: string }]>('id as count');
    const total = parseInt(count, 10);

    const pledges = await qb
      .orderBy(sort, order as 'asc' | 'desc')
      .limit(limit)
      .offset(offset);

    okPaged(res, pledges.map(serializePledge), total, page, limit);
  },
);

// ─── GET /pledges/donor/:donorId ──────────────────────────────────────────────

router.get(
  '/donor/:donorId',
  [param('donorId').isUUID().withMessage('donorId must be a valid UUID')],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    const donor = await db('donors')
      .where({ id: req.params.donorId, org_id: orgId })
      .first();
    if (!donor) {
      fail(res, 404, 'Donor not found', 'NOT_FOUND');
      return;
    }

    const pledges = await db<PledgeRow>('pledges')
      .where({ donor_id: req.params.donorId, org_id: orgId })
      .orderBy('created_at', 'desc');

    ok(res, pledges.map(serializePledge));
  },
);

// ─── GET /pledges/:id ─────────────────────────────────────────────────────────

router.get(
  '/:id',
  [param('id').isUUID().withMessage('Pledge ID must be a valid UUID')],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();

    const pledge = await db<PledgeRow>('pledges')
      .where({ id: req.params.id, org_id: authReq.user.orgId })
      .first();
    if (!pledge) {
      fail(res, 404, 'Pledge not found', 'NOT_FOUND');
      return;
    }

    ok(res, serializePledge(pledge));
  },
);

// ─── POST /pledges ────────────────────────────────────────────────────────────

router.post(
  '/',
  [
    body('donorId')
      .notEmpty().withMessage('donorId is required')
      .isUUID().withMessage('donorId must be a valid UUID'),
    body('totalAmountCents')
      .notEmpty().withMessage('totalAmountCents is required')
      .isInt({ min: 100 }).withMessage('totalAmountCents must be at least 100 (1 dollar)'),
    body('years')
      .notEmpty().withMessage('years is required')
      .isInt({ min: 1, max: 30 }).withMessage('years must be between 1 and 30'),
    body('frequency')
      .optional()
      .isIn([...PLEDGE_FREQUENCIES]).withMessage(`frequency must be one of: ${PLEDGE_FREQUENCIES.join(', ')}`),
    body('startDate')
      .notEmpty().withMessage('startDate is required')
      .isDate().withMessage('startDate must be a valid date (YYYY-MM-DD)'),
    body('fundName')
      .optional()
      .isString()
      .isLength({ max: 255 })
      .trim(),
    body('giftAgreementId')
      .optional({ nullable: true })
      .isUUID().withMessage('giftAgreementId must be a valid UUID'),
    body('stripeSubscriptionId')
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
      totalAmountCents,
      years,
      frequency,
      startDate,
      fundName,
      giftAgreementId,
      stripeSubscriptionId,
      salesforceOpportunityId,
    } = req.body as {
      donorId:                  string;
      totalAmountCents:         number;
      years:                    number;
      frequency?:               string;
      startDate:                string;
      fundName?:                string;
      giftAgreementId?:         string | null;
      stripeSubscriptionId?:    string;
      salesforceOpportunityId?: string;
    };

    // Verify donor belongs to this org
    const donor = await db('donors')
      .where({ id: donorId, org_id: orgId })
      .whereNot({ status: 'archived' })
      .first();
    if (!donor) {
      fail(res, 422, 'Donor not found in your organization', 'INVALID_DONOR');
      return;
    }

    const freq = frequency ?? 'annually';

    // Compute end date based on years
    const end = new Date(startDate);
    end.setFullYear(end.getFullYear() + years);
    const endDate = end.toISOString().split('T')[0];

    const result = await db.transaction(async (trx) => {
      const [pledge] = await trx<PledgeRow>('pledges')
        .insert({
          org_id:                    orgId,
          donor_id:                  donorId,
          gift_agreement_id:         giftAgreementId         ?? null,
          total_amount_cents:        totalAmountCents,
          years,
          frequency:                 freq,
          start_date:                startDate,
          end_date:                  endDate,
          fund_name:                 fundName                ?? null,
          status:                    'active',
          stripe_subscription_id:    stripeSubscriptionId    ?? null,
          salesforce_opportunity_id: salesforceOpportunityId ?? null,
        })
        .returning('*');

      // Generate installment schedule
      const schedule = buildInstallmentSchedule(
        pledge.id, orgId, totalAmountCents, years, freq, startDate,
      );
      await trx('pledge_installments').insert(schedule);

      // Audit log
      await trx('audit_logs').insert({
        org_id:     orgId,
        user_id:    authReq.user.id,
        event_type: 'pledge.created',
        payload:    JSON.stringify({
          pledge_id:          pledge.id,
          donor_id:           donorId,
          total_amount_cents: totalAmountCents,
          years,
          frequency:          freq,
        }),
        ip_address: req.ip,
      });

      return pledge;
    });

    logger.info('Pledge created', {
      pledgeId:         result.id,
      donorId,
      totalAmountCents,
      years,
      frequency:        freq,
      orgId,
    });

    ok(res, serializePledge(result), 201);
  },
);

// ─── PATCH /pledges/:id ───────────────────────────────────────────────────────

router.patch(
  '/:id',
  [
    param('id').isUUID().withMessage('Pledge ID must be a valid UUID'),
    body('status')
      .optional()
      .isIn([...PLEDGE_STATUSES]).withMessage(`status must be one of: ${PLEDGE_STATUSES.join(', ')}`),
    body('fundName')
      .optional({ nullable: true })
      .isString()
      .isLength({ max: 255 })
      .trim(),
    body('stripeSubscriptionId')
      .optional({ nullable: true })
      .isString()
      .isLength({ max: 255 })
      .trim(),
    body('salesforceOpportunityId')
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

    const existing = await db<PledgeRow>('pledges')
      .where({ id: req.params.id, org_id: orgId })
      .first();
    if (!existing) {
      fail(res, 404, 'Pledge not found', 'NOT_FOUND');
      return;
    }

    const { status, fundName, stripeSubscriptionId, salesforceOpportunityId } =
      req.body as Record<string, unknown>;

    const updates: Partial<PledgeRow> & { updated_at: Date } = { updated_at: new Date() };
    if (status                   !== undefined) updates.status                    = status as string;
    if (fundName                 !== undefined) updates.fund_name                 = fundName as string | null;
    if (stripeSubscriptionId     !== undefined) updates.stripe_subscription_id    = stripeSubscriptionId as string | null;
    if (salesforceOpportunityId  !== undefined) updates.salesforce_opportunity_id = salesforceOpportunityId as string | null;

    const [updated] = await db<PledgeRow>('pledges')
      .where({ id: req.params.id, org_id: orgId })
      .update(updates)
      .returning('*');

    logger.info('Pledge updated', { pledgeId: updated.id, orgId });

    ok(res, serializePledge(updated));
  },
);

// ─── GET /pledges/:id/installments ────────────────────────────────────────────

router.get(
  '/:id/installments',
  [param('id').isUUID().withMessage('Pledge ID must be a valid UUID')],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    // Verify pledge belongs to this org
    const pledge = await db<PledgeRow>('pledges')
      .where({ id: req.params.id, org_id: orgId })
      .first();
    if (!pledge) {
      fail(res, 404, 'Pledge not found', 'NOT_FOUND');
      return;
    }

    const installments = await db<InstallmentRow>('pledge_installments')
      .where({ pledge_id: req.params.id, org_id: orgId })
      .orderBy('due_date', 'asc');

    ok(res, installments.map(serializeInstallment));
  },
);

// ─── PATCH /pledges/:id/installments/:instId ──────────────────────────────────

router.patch(
  '/:id/installments/:instId',
  [
    param('id').isUUID().withMessage('Pledge ID must be a valid UUID'),
    param('instId').isUUID().withMessage('Installment ID must be a valid UUID'),
    body('status')
      .notEmpty().withMessage('status is required')
      .isIn([...INSTALLMENT_STATUSES]).withMessage(`status must be one of: ${INSTALLMENT_STATUSES.join(', ')}`),
    body('paidAt')
      .optional()
      .isISO8601().withMessage('paidAt must be a valid ISO 8601 datetime'),
    body('stripeInvoiceId')
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

    // Verify pledge belongs to this org first
    const pledge = await db<PledgeRow>('pledges')
      .where({ id: req.params.id, org_id: orgId })
      .first();
    if (!pledge) {
      fail(res, 404, 'Pledge not found', 'NOT_FOUND');
      return;
    }

    const installment = await db<InstallmentRow>('pledge_installments')
      .where({ id: req.params.instId, pledge_id: req.params.id, org_id: orgId })
      .first();
    if (!installment) {
      fail(res, 404, 'Installment not found', 'NOT_FOUND');
      return;
    }

    const { status, paidAt, stripeInvoiceId } = req.body as {
      status:           string;
      paidAt?:          string;
      stripeInvoiceId?: string | null;
    };

    const updates: Partial<InstallmentRow> & { updated_at: Date } = {
      status,
      updated_at: new Date(),
    };

    if (status === 'paid') {
      updates.paid_at = paidAt ? new Date(paidAt) : new Date();
    }
    if (stripeInvoiceId !== undefined) {
      updates.stripe_invoice_id = stripeInvoiceId;
    }

    const [updated] = await db<InstallmentRow>('pledge_installments')
      .where({ id: req.params.instId, pledge_id: req.params.id, org_id: orgId })
      .update(updates)
      .returning('*');

    // If all installments are paid, auto-complete the pledge
    if (status === 'paid') {
      const remaining = await db('pledge_installments')
        .where({ pledge_id: req.params.id, org_id: orgId })
        .whereIn('status', ['pending', 'failed'])
        .count<[{ count: string }]>('id as count');
      if (parseInt(remaining[0].count, 10) === 0) {
        await db<PledgeRow>('pledges')
          .where({ id: req.params.id, org_id: orgId })
          .update({ status: 'completed', updated_at: new Date() });
      }
    }

    logger.info('Installment updated', {
      installmentId: updated.id,
      pledgeId:      req.params.id,
      status,
      orgId,
    });

    ok(res, serializeInstallment(updated));
  },
);

export default router;
