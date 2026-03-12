/**
 * /api/v1/donors — Donor CRUD + AI Briefing Routes
 *
 * GET    /donors                List donors (paginated, filtered, searched)
 * GET    /donors/:id            Get single donor by ID
 * POST   /donors                Create donor
 * PATCH  /donors/:id            Update donor (whitelisted fields only)
 * DELETE /donors/:id            Soft-delete — sets status = 'archived', never hard deletes
 * POST   /donors/:id/brief      AI-prepared donor briefing (Claude)
 *
 * Invariants (CLAUDE.md):
 *   - Every query includes org_id = req.user.orgId — no exceptions
 *   - Monetary values stored and returned in cents (integer)
 *   - All IDs are UUIDs
 *   - Soft deletes only — status = 'archived'
 *   - Standard response envelope: { data, pagination } / { error, code, details }
 *   - express-validator on every mutating route
 */

import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { getDB } from '../config/database';
import { logger } from '../config/logger';
import { authenticate, requireRole } from '../middleware/auth';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const aiService = require('../services/ai') as {
  generateDonorBrief: (donor: DonorRow & { gift_history?: GiftSummary[] }, purpose: string) => Promise<DonorBrief>;
};

const router = Router();

// All donor routes require authentication + tenant scope
router.use(authenticate);

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface AuthRequest extends Request {
  user: { id: string; orgId: string; email: string; role: string };
}

interface DonorRow {
  id:                      string;
  org_id:                  string;
  first_name:              string;
  last_name:               string;
  email:                   string;
  phone:                   string | null;
  address_line1:           string | null;
  address_line2:           string | null;
  city:                    string | null;
  state:                   string | null;
  zip:                     string | null;
  country:                 string;
  total_giving_cents:      number;
  last_gift_cents:         number;
  last_gift_date:          string | null;
  first_gift_date:         string | null;
  consecutive_giving_years: number;
  lapsed_years:            number;
  number_of_gifts:         number;
  wealth_capacity_cents:   number;
  propensity_score:        number;
  bequeath_score:          number;
  interests:               string[] | null;
  communication_pref:      string;
  email_opted_in:          boolean;
  sms_opted_in:            boolean;
  ai_opted_in:             boolean;
  ai_opted_in_at:          string | null;
  journey_stage:           string;
  sentiment:               string;
  touchpoint_count:        number;
  last_contact_at:         string | null;
  status:                  string;    // 'active' | 'archived'  (requires migration 002)
  salesforce_contact_id:   string | null;
  external_ids:            Record<string, string> | null;
  created_at:              string;
  updated_at:              string;
}

interface GiftSummary {
  id:          string;
  amount_cents: number;
  gift_date:   string;
  fund:        string | null;
  type:        string | null;
}

interface DonorBrief {
  brief:                  string;
  talking_points:         string[];
  ask_strategy:           string;
  channel_recommendation: string;
  risk_flags:             string[];
  next_action:            string;
}

// Allowed sort columns — whitelist prevents SQL injection via ORDER BY
const SORT_COLUMNS = new Set([
  'first_name', 'last_name', 'email',
  'total_giving_cents', 'last_gift_date', 'last_gift_cents',
  'propensity_score', 'bequeath_score',
  'journey_stage', 'consecutive_giving_years',
  'created_at', 'updated_at', 'last_contact_at',
]);

// Fields callers may update via PATCH (system fields excluded)
const PATCHABLE_FIELDS: Array<keyof DonorRow> = [
  'first_name', 'last_name', 'email', 'phone',
  'address_line1', 'address_line2', 'city', 'state', 'zip', 'country',
  'communication_pref', 'email_opted_in', 'sms_opted_in',
  'ai_opted_in', 'ai_opted_in_at',
  'journey_stage', 'sentiment', 'interests',
  'salesforce_contact_id', 'external_ids',
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ data });
}

function okPaged(
  res:        Response,
  data:       unknown[],
  total:      number,
  page:       number,
  limit:      number,
): void {
  res.json({
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}

function fail(res: Response, status: number, message: string, code: string, details: unknown[] = []): void {
  res.status(status).json({ error: message, code, details });
}

function validate(req: Request, res: Response, next: NextFunction): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: errors.array() });
    return;
  }
  next();
}

// ─── GET /donors ──────────────────────────────────────────────────────────────

router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer').toInt(),
    query('limit').optional().isInt({ min: 1, max: 250 }).withMessage('limit must be 1–250').toInt(),
    query('sort').optional().isString(),
    query('order').optional().isIn(['asc', 'desc']).withMessage('order must be asc or desc'),
    query('search').optional().isString().trim(),
    query('stage').optional().isString().trim(),
    query('minScore').optional().isInt({ min: 0, max: 100 }).toInt(),
    query('communicationPref').optional().isIn(['email', 'sms', 'both']),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const orgId   = authReq.user.orgId;
    const db      = getDB();

    const page   = (req.query.page as unknown as number)  || 1;
    const limit  = (req.query.limit as unknown as number) || 20;
    const offset = (page - 1) * limit;

    // Whitelist sort column to prevent injection
    const rawSort = (req.query.sort as string) || 'created_at';
    const sortCol = SORT_COLUMNS.has(rawSort) ? rawSort : 'created_at';
    const order   = (req.query.order as string) === 'asc' ? 'asc' : 'desc';

    const search          = req.query.search as string | undefined;
    const stage           = req.query.stage  as string | undefined;
    const minScore        = req.query.minScore as unknown as number | undefined;
    const communicationPref = req.query.communicationPref as string | undefined;

    // Base query — always filter by org_id and exclude archived
    const baseQuery = db<DonorRow>('donors')
      .where({ org_id: orgId })
      .whereNot({ status: 'archived' });

    if (stage)           baseQuery.where({ journey_stage: stage });
    if (communicationPref) baseQuery.where({ communication_pref: communicationPref });
    if (minScore !== undefined) baseQuery.where('propensity_score', '>=', minScore);
    if (search) {
      baseQuery.where(function () {
        this.whereILike('first_name', `%${search}%`)
          .orWhereILike('last_name',  `%${search}%`)
          .orWhereILike('email',      `%${search}%`);
      });
    }

    const [rows, [{ count }]] = await Promise.all([
      baseQuery.clone()
        .select(
          'id', 'org_id', 'first_name', 'last_name', 'email', 'phone',
          'journey_stage', 'sentiment', 'communication_pref',
          'total_giving_cents', 'last_gift_cents', 'last_gift_date', 'number_of_gifts',
          'propensity_score', 'bequeath_score', 'consecutive_giving_years',
          'email_opted_in', 'sms_opted_in', 'ai_opted_in',
          'touchpoint_count', 'last_contact_at',
          'interests', 'status', 'created_at', 'updated_at',
        )
        .orderBy(sortCol, order)
        .limit(limit)
        .offset(offset),
      baseQuery.clone().count('id as count'),
    ]);

    okPaged(res, rows, Number(count), page, limit);
  },
);

// ─── GET /donors/:id ──────────────────────────────────────────────────────────

router.get(
  '/:id',
  [
    param('id').isUUID().withMessage('id must be a valid UUID'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();

    const donor = await db<DonorRow>('donors')
      .where({ id: req.params.id, org_id: authReq.user.orgId })
      .whereNot({ status: 'archived' })
      .first();

    if (!donor) {
      fail(res, 404, 'Donor not found', 'NOT_FOUND');
      return;
    }

    ok(res, donor);
  },
);

// ─── POST /donors ─────────────────────────────────────────────────────────────

router.post(
  '/',
  requireRole('admin', 'manager', 'staff'),
  [
    body('firstName').notEmpty().withMessage('firstName is required').trim(),
    body('lastName').notEmpty().withMessage('lastName is required').trim(),
    body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
    body('phone').optional().isMobilePhone('any').withMessage('Invalid phone number'),
    body('addressLine1').optional().isString().trim(),
    body('addressLine2').optional().isString().trim(),
    body('city').optional().isString().trim(),
    body('state').optional().isString().isLength({ max: 50 }).trim(),
    body('zip').optional().isString().isLength({ max: 20 }).trim(),
    body('country').optional().isString().isLength({ min: 2, max: 2 }).toUpperCase(),
    body('communicationPref').optional().isIn(['email', 'sms', 'both']),
    body('emailOptedIn').optional().isBoolean().toBoolean(),
    body('smsOptedIn').optional().isBoolean().toBoolean(),
    body('aiOptedIn').optional().isBoolean().toBoolean(),
    body('journeyStage').optional().isString(),
    body('interests').optional().isArray(),
    body('totalGivingCents')
      .optional()
      .isInt({ min: 0 }).withMessage('totalGivingCents must be a non-negative integer (cents)'),
    body('lastGiftCents')
      .optional()
      .isInt({ min: 0 }).withMessage('lastGiftCents must be a non-negative integer (cents)'),
    body('wealthCapacityCents')
      .optional()
      .isInt({ min: 0 }).withMessage('wealthCapacityCents must be a non-negative integer (cents)'),
    body('propensityScore').optional().isInt({ min: 0, max: 100 }),
    body('bequeathScore').optional().isInt({ min: 0, max: 100 }),
    body('salesforceContactId').optional().isString().trim(),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const orgId   = authReq.user.orgId;
    const db      = getDB();

    const {
      firstName, lastName, email, phone,
      addressLine1, addressLine2, city, state, zip, country,
      communicationPref, emailOptedIn, smsOptedIn, aiOptedIn,
      journeyStage, interests,
      totalGivingCents, lastGiftCents, wealthCapacityCents,
      propensityScore, bequeathScore,
      salesforceContactId,
    } = req.body as Record<string, unknown>;

    // ai_opted_in_at must be set when ai_opted_in is true
    const aiOptedInAt = aiOptedIn ? new Date().toISOString() : null;

    const [donor] = await db<DonorRow>('donors')
      .insert({
        org_id:                orgId,
        first_name:            firstName as string,
        last_name:             lastName  as string,
        email:                 (email as string).toLowerCase(),
        phone:                 phone                ?? null,
        address_line1:         addressLine1         ?? null,
        address_line2:         addressLine2         ?? null,
        city:                  city                 ?? null,
        state:                 state                ?? null,
        zip:                   zip                  ?? null,
        country:               (country as string)  ?? 'US',
        communication_pref:    communicationPref    ?? 'email',
        email_opted_in:        emailOptedIn         ?? false,
        sms_opted_in:          smsOptedIn           ?? false,
        ai_opted_in:           aiOptedIn            ?? false,
        ai_opted_in_at:        aiOptedInAt,
        journey_stage:         journeyStage         ?? 'uncontacted',
        interests:             interests            ?? null,
        total_giving_cents:    totalGivingCents     ?? 0,
        last_gift_cents:       lastGiftCents        ?? 0,
        wealth_capacity_cents: wealthCapacityCents  ?? 0,
        propensity_score:      propensityScore      ?? 50,
        bequeath_score:        bequeathScore        ?? 0,
        salesforce_contact_id: salesforceContactId  ?? null,
        status:                'active',
      })
      .returning('*');

    logger.info('Donor created', { orgId, donorId: donor.id });
    ok(res, donor, 201);
  },
);

// ─── PATCH /donors/:id ────────────────────────────────────────────────────────

router.patch(
  '/:id',
  requireRole('admin', 'manager', 'staff'),
  [
    param('id').isUUID().withMessage('id must be a valid UUID'),
    body('firstName').optional().notEmpty().trim(),
    body('lastName').optional().notEmpty().trim(),
    body('email').optional().isEmail().normalizeEmail(),
    body('phone').optional().isMobilePhone('any'),
    body('addressLine1').optional().isString().trim(),
    body('addressLine2').optional().isString().trim(),
    body('city').optional().isString().trim(),
    body('state').optional().isString().isLength({ max: 50 }).trim(),
    body('zip').optional().isString().isLength({ max: 20 }).trim(),
    body('country').optional().isString().isLength({ min: 2, max: 2 }).toUpperCase(),
    body('communicationPref').optional().isIn(['email', 'sms', 'both']),
    body('emailOptedIn').optional().isBoolean().toBoolean(),
    body('smsOptedIn').optional().isBoolean().toBoolean(),
    body('aiOptedIn').optional().isBoolean().toBoolean(),
    body('journeyStage').optional().isString(),
    body('interests').optional().isArray(),
    body('propensityScore').optional().isInt({ min: 0, max: 100 }),
    body('bequeathScore').optional().isInt({ min: 0, max: 100 }),
    body('salesforceContactId').optional().isString().trim(),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const orgId   = authReq.user.orgId;
    const db      = getDB();

    // Build update payload from camelCase body → snake_case columns
    const camelToSnake: Record<string, keyof DonorRow> = {
      firstName:           'first_name',
      lastName:            'last_name',
      email:               'email',
      phone:               'phone',
      addressLine1:        'address_line1',
      addressLine2:        'address_line2',
      city:                'city',
      state:               'state',
      zip:                 'zip',
      country:             'country',
      communicationPref:   'communication_pref',
      emailOptedIn:        'email_opted_in',
      smsOptedIn:          'sms_opted_in',
      aiOptedIn:           'ai_opted_in',
      journeyStage:        'journey_stage',
      interests:           'interests',
      propensityScore:     'propensity_score',
      bequeathScore:       'bequeath_score',
      salesforceContactId: 'salesforce_contact_id',
    };

    const updates: Partial<DonorRow> = {};
    for (const [camel, snake] of Object.entries(camelToSnake)) {
      if (req.body[camel] !== undefined) {
        (updates as Record<string, unknown>)[snake] =
          camel === 'email'
            ? (req.body[camel] as string).toLowerCase()
            : req.body[camel];
      }
    }

    // Enforce ai_opted_in_at rule from CLAUDE.md §5
    if (updates.ai_opted_in === true && !updates.ai_opted_in_at) {
      updates.ai_opted_in_at = new Date().toISOString();
    }

    if (Object.keys(updates).length === 0) {
      fail(res, 422, 'No valid fields provided', 'NO_FIELDS');
      return;
    }

    const [donor] = await db<DonorRow>('donors')
      .where({ id: req.params.id, org_id: orgId })
      .whereNot({ status: 'archived' })
      .update({ ...updates, updated_at: new Date().toISOString() } as Partial<DonorRow>)
      .returning('*');

    if (!donor) {
      fail(res, 404, 'Donor not found', 'NOT_FOUND');
      return;
    }

    logger.info('Donor updated', { orgId, donorId: donor.id });
    ok(res, donor);
  },
);

// ─── DELETE /donors/:id — soft-delete only ────────────────────────────────────

router.delete(
  '/:id',
  requireRole('admin', 'manager'),
  [
    param('id').isUUID().withMessage('id must be a valid UUID'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const orgId   = authReq.user.orgId;
    const db      = getDB();

    // CLAUDE.md §5: never hard-delete donors — set status = 'archived'
    const [donor] = await db<DonorRow>('donors')
      .where({ id: req.params.id, org_id: orgId })
      .whereNot({ status: 'archived' })
      .update({
        status:       'archived',
        updated_at:   new Date().toISOString(),
      } as Partial<DonorRow>)
      .returning('id');

    if (!donor) {
      fail(res, 404, 'Donor not found', 'NOT_FOUND');
      return;
    }

    logger.info('Donor archived (soft delete)', { orgId, donorId: donor.id });
    res.status(204).end();
  },
);

// ─── POST /donors/:id/brief — AI-prepared donor briefing ─────────────────────

router.post(
  '/:id/brief',
  [
    param('id').isUUID().withMessage('id must be a valid UUID'),
    body('purpose')
      .optional()
      .isString()
      .isIn(['meeting prep', 'solicitation', 'stewardship', 'general'])
      .withMessage('purpose must be: meeting prep, solicitation, stewardship, or general'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const orgId   = authReq.user.orgId;
    const db      = getDB();

    // Load donor — org_id scoped, never archived
    const donor = await db<DonorRow>('donors')
      .where({ id: req.params.id, org_id: orgId })
      .whereNot({ status: 'archived' })
      .first();

    if (!donor) {
      fail(res, 404, 'Donor not found', 'NOT_FOUND');
      return;
    }

    // Guard: AI briefing only if donor has consented to AI contact
    if (!donor.ai_opted_in) {
      fail(
        res,
        403,
        'AI briefing not available — donor has not opted into AI interactions',
        'AI_OPT_IN_REQUIRED',
      );
      return;
    }

    // Fetch recent gift history (last 10)
    const gifts = await db<GiftSummary>('gifts')
      .where({ donor_id: donor.id, org_id: orgId })
      .select('id', 'amount_cents', 'gift_date', 'fund', 'type')
      .orderBy('gift_date', 'desc')
      .limit(10);

    // Fetch recent touchpoints for context
    const touchpoints = await db('touchpoints')
      .where({ donor_id: donor.id, org_id: orgId })
      .select('channel', 'direction', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(5);

    const donorContext = { ...donor, gift_history: gifts, recent_touchpoints: touchpoints };
    const purpose      = (req.body.purpose as string | undefined) ?? 'meeting prep';

    const brief = await aiService.generateDonorBrief(donorContext, purpose);

    ok(res, {
      donorId:   donor.id,
      purpose,
      generatedAt: new Date().toISOString(),
      brief,
    });
  },
);

export default router;
