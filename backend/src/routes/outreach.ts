/**
 * /api/v1/outreach — Outreach / Touchpoint Routes
 *
 * GET    /outreach                      List touchpoints (paginated + filtered)
 * GET    /outreach/:id                  Get single touchpoint
 * POST   /outreach                      Log a manual touchpoint (note, call, etc.)
 * POST   /outreach/email                Send an outbound email via SendGrid
 * POST   /outreach/sms                  Send an outbound SMS via Twilio
 * PATCH  /outreach/:id                  Update email/sms delivery status
 * GET    /outreach/donor/:donorId       All touchpoints for a specific donor
 *
 * Rules (per CLAUDE.md):
 *   - Every query must include org_id from req.user.orgId
 *   - Never send to donor without ai_opted_in: true (for agent-driven outreach)
 *   - Manual notes/calls do NOT require ai_opted_in
 *   - All IDs are UUIDs; standard response envelope
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

interface TouchpointRow {
  id:                  string;
  org_id:              string;
  donor_id:            string;
  agent_id:            string | null;
  channel:             string;
  direction:           string;
  subject:             string | null;
  body:                string;
  email_status:        string | null;
  email_opened_at:     Date | null;
  email_clicked_at:    Date | null;
  sms_status:          string | null;
  twilio_message_sid:  string | null;
  sendgrid_message_id: string | null;
  created_at:          Date;
  updated_at:          Date;
}

interface DonorRow {
  id:          string;
  org_id:      string;
  email:       string;
  phone:       string | null;
  first_name:  string;
  last_name:   string;
  ai_opted_in: boolean;
  email_opted_in: boolean;
  sms_opted_in:   boolean;
  status:      string;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const CHANNELS   = ['email', 'sms', 'note', 'call'] as const;
const DIRECTIONS = ['outbound', 'inbound'] as const;

const SORT_COLUMNS = new Set([
  'created_at', 'channel', 'direction', 'email_status', 'sms_status',
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

function serializeTouchpoint(t: TouchpointRow): Record<string, unknown> {
  return {
    id:                t.id,
    orgId:             t.org_id,
    donorId:           t.donor_id,
    agentId:           t.agent_id,
    channel:           t.channel,
    direction:         t.direction,
    subject:           t.subject,
    body:              t.body,
    emailStatus:       t.email_status,
    emailOpenedAt:     t.email_opened_at,
    emailClickedAt:    t.email_clicked_at,
    smsStatus:         t.sms_status,
    twilioMessageSid:  t.twilio_message_sid,
    sendgridMessageId: t.sendgrid_message_id,
    createdAt:         t.created_at,
    updatedAt:         t.updated_at,
  };
}

/** Increment touchpoint_count and update last_contact_at on the donor. */
async function recordTouchOnDonor(
  db: ReturnType<typeof getDB>,
  donorId: string,
  orgId: string,
): Promise<void> {
  await db('donors')
    .where({ id: donorId, org_id: orgId })
    .update({
      touchpoint_count: db.raw('touchpoint_count + 1'),
      last_contact_at:  new Date(),
      updated_at:       new Date(),
    });
}

// ─── ALL ROUTES REQUIRE AUTHENTICATION ────────────────────────────────────────

router.use(authenticate);

// ─── GET /outreach ────────────────────────────────────────────────────────────

router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('sort').optional().isString(),
    query('order').optional().isIn(['asc', 'desc']),
    query('channel').optional().isIn([...CHANNELS]),
    query('direction').optional().isIn([...DIRECTIONS]),
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

    const channel   = req.query.channel   as string | undefined;
    const direction = req.query.direction as string | undefined;
    const donorId   = req.query.donorId   as string | undefined;

    let qb = db<TouchpointRow>('touchpoints').where({ org_id: orgId });
    if (channel)   qb = qb.where({ channel });
    if (direction) qb = qb.where({ direction });
    if (donorId)   qb = qb.where({ donor_id: donorId });

    const [{ count }] = await qb.clone().count<[{ count: string }]>('id as count');
    const total = parseInt(count, 10);

    const touchpoints = await qb
      .orderBy(sort, order as 'asc' | 'desc')
      .limit(limit)
      .offset(offset);

    okPaged(res, touchpoints.map(serializeTouchpoint), total, page, limit);
  },
);

// ─── GET /outreach/donor/:donorId ─────────────────────────────────────────────

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

    const touchpoints = await db<TouchpointRow>('touchpoints')
      .where({ donor_id: req.params.donorId, org_id: orgId })
      .orderBy('created_at', 'desc');

    ok(res, touchpoints.map(serializeTouchpoint));
  },
);

// ─── GET /outreach/:id ────────────────────────────────────────────────────────

router.get(
  '/:id',
  [param('id').isUUID().withMessage('Touchpoint ID must be a valid UUID')],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();

    const tp = await db<TouchpointRow>('touchpoints')
      .where({ id: req.params.id, org_id: authReq.user.orgId })
      .first();
    if (!tp) {
      fail(res, 404, 'Touchpoint not found', 'NOT_FOUND');
      return;
    }

    ok(res, serializeTouchpoint(tp));
  },
);

// ─── POST /outreach — Log manual touchpoint (note / call) ─────────────────────

router.post(
  '/',
  [
    body('donorId')
      .notEmpty().withMessage('donorId is required')
      .isUUID().withMessage('donorId must be a valid UUID'),
    body('channel')
      .notEmpty().withMessage('channel is required')
      .isIn([...CHANNELS]).withMessage(`channel must be one of: ${CHANNELS.join(', ')}`),
    body('direction')
      .optional()
      .isIn([...DIRECTIONS]).withMessage(`direction must be one of: ${DIRECTIONS.join(', ')}`),
    body('subject')
      .optional()
      .isString()
      .isLength({ max: 500 })
      .trim(),
    body('body')
      .notEmpty().withMessage('body is required')
      .isString()
      .isLength({ max: 10000 })
      .trim(),
    body('agentId')
      .optional({ nullable: true })
      .isUUID().withMessage('agentId must be a valid UUID'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    const { donorId, channel, direction, subject, body: bodyText, agentId } = req.body as {
      donorId:    string;
      channel:    string;
      direction?: string;
      subject?:   string;
      body:       string;
      agentId?:   string | null;
    };

    const donor = await db<DonorRow>('donors')
      .where({ id: donorId, org_id: orgId })
      .whereNot({ status: 'archived' })
      .first();
    if (!donor) {
      fail(res, 422, 'Donor not found in your organization', 'INVALID_DONOR');
      return;
    }

    const [tp] = await db<TouchpointRow>('touchpoints')
      .insert({
        org_id:    orgId,
        donor_id:  donorId,
        agent_id:  agentId ?? null,
        channel,
        direction: direction ?? 'outbound',
        subject:   subject ?? null,
        body:      bodyText,
      })
      .returning('*');

    await recordTouchOnDonor(db, donorId, orgId);

    logger.info('Touchpoint logged', { touchpointId: tp.id, channel, orgId });

    ok(res, serializeTouchpoint(tp), 201);
  },
);

// ─── POST /outreach/email — Send email via SendGrid ───────────────────────────

router.post(
  '/email',
  [
    body('donorId')
      .notEmpty().withMessage('donorId is required')
      .isUUID().withMessage('donorId must be a valid UUID'),
    body('subject')
      .notEmpty().withMessage('subject is required')
      .isLength({ max: 500 })
      .trim(),
    body('body')
      .notEmpty().withMessage('body is required')
      .isString()
      .isLength({ max: 50000 })
      .trim(),
    body('agentId')
      .optional({ nullable: true })
      .isUUID().withMessage('agentId must be a valid UUID'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    const { donorId, subject, body: bodyText, agentId } = req.body as {
      donorId:  string;
      subject:  string;
      body:     string;
      agentId?: string | null;
    };

    const donor = await db<DonorRow>('donors')
      .where({ id: donorId, org_id: orgId })
      .whereNot({ status: 'archived' })
      .first();
    if (!donor) {
      fail(res, 422, 'Donor not found in your organization', 'INVALID_DONOR');
      return;
    }

    // CLAUDE.md rule: never contact donor without ai_opted_in when agent-driven
    if (agentId && !donor.ai_opted_in) {
      fail(res, 422, 'Donor has not opted in to AI-driven outreach', 'AI_OPT_IN_REQUIRED');
      return;
    }

    if (!donor.email_opted_in) {
      fail(res, 422, 'Donor has opted out of email', 'EMAIL_OPT_OUT');
      return;
    }

    // Send via SendGrid (lazy-require to allow mocking in tests)
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

    let sendgridMessageId: string | null = null;

    try {
      const [sgRes] = await sgMail.send({
        to:      donor.email,
        from:    process.env.SENDGRID_FROM_EMAIL || 'noreply@donororbit.com',
        subject,
        html:    bodyText,
        text:    bodyText.replace(/<[^>]+>/g, ''),
      });
      sendgridMessageId = (sgRes?.headers?.['x-message-id'] as string) ?? null;
    } catch (err) {
      logger.error('SendGrid error', { donorId, orgId, error: (err as Error).message });
      fail(res, 502, 'Email delivery service error', 'EMAIL_SEND_ERROR');
      return;
    }

    // Record touchpoint
    const [tp] = await db<TouchpointRow>('touchpoints')
      .insert({
        org_id:              orgId,
        donor_id:            donorId,
        agent_id:            agentId ?? null,
        channel:             'email',
        direction:           'outbound',
        subject,
        body:                bodyText,
        email_status:        'delivered',
        sendgrid_message_id: sendgridMessageId,
      })
      .returning('*');

    await recordTouchOnDonor(db, donorId, orgId);

    logger.info('Email sent', {
      touchpointId: tp.id,
      donorId,
      orgId,
      sendgridMessageId,
    });

    ok(res, serializeTouchpoint(tp), 201);
  },
);

// ─── POST /outreach/sms — Send SMS via Twilio ─────────────────────────────────

router.post(
  '/sms',
  [
    body('donorId')
      .notEmpty().withMessage('donorId is required')
      .isUUID().withMessage('donorId must be a valid UUID'),
    body('body')
      .notEmpty().withMessage('body is required')
      .isString()
      .isLength({ min: 1, max: 1600 }).withMessage('SMS body must be 1-1600 characters')
      .trim(),
    body('agentId')
      .optional({ nullable: true })
      .isUUID().withMessage('agentId must be a valid UUID'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    const { donorId, body: bodyText, agentId } = req.body as {
      donorId:  string;
      body:     string;
      agentId?: string | null;
    };

    const donor = await db<DonorRow>('donors')
      .where({ id: donorId, org_id: orgId })
      .whereNot({ status: 'archived' })
      .first();
    if (!donor) {
      fail(res, 422, 'Donor not found in your organization', 'INVALID_DONOR');
      return;
    }

    // CLAUDE.md: never contact without ai_opted_in for agent-driven outreach
    if (agentId && !donor.ai_opted_in) {
      fail(res, 422, 'Donor has not opted in to AI-driven outreach', 'AI_OPT_IN_REQUIRED');
      return;
    }

    if (!donor.sms_opted_in) {
      fail(res, 422, 'Donor has opted out of SMS', 'SMS_OPT_OUT');
      return;
    }

    if (!donor.phone) {
      fail(res, 422, 'Donor does not have a phone number on record', 'NO_PHONE');
      return;
    }

    // Send via Twilio
    const twilio = require('twilio');
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN,
    );

    let twilioMessageSid: string | null = null;

    try {
      const message = await client.messages.create({
        body: bodyText,
        from: process.env.TWILIO_FROM_NUMBER,
        to:   donor.phone,
      });
      twilioMessageSid = message.sid;
    } catch (err) {
      logger.error('Twilio error', { donorId, orgId, error: (err as Error).message });
      fail(res, 502, 'SMS delivery service error', 'SMS_SEND_ERROR');
      return;
    }

    // Record touchpoint
    const [tp] = await db<TouchpointRow>('touchpoints')
      .insert({
        org_id:             orgId,
        donor_id:           donorId,
        agent_id:           agentId ?? null,
        channel:            'sms',
        direction:          'outbound',
        subject:            null,
        body:               bodyText,
        sms_status:         'sent',
        twilio_message_sid: twilioMessageSid,
      })
      .returning('*');

    await recordTouchOnDonor(db, donorId, orgId);

    logger.info('SMS sent', {
      touchpointId:    tp.id,
      donorId,
      orgId,
      twilioMessageSid,
    });

    ok(res, serializeTouchpoint(tp), 201);
  },
);

// ─── PATCH /outreach/:id — Update delivery status ─────────────────────────────

router.patch(
  '/:id',
  [
    param('id').isUUID().withMessage('Touchpoint ID must be a valid UUID'),
    body('emailStatus')
      .optional()
      .isIn(['delivered', 'opened', 'clicked', 'bounced'])
      .withMessage('emailStatus must be: delivered, opened, clicked, or bounced'),
    body('smsStatus')
      .optional()
      .isIn(['sent', 'delivered', 'failed'])
      .withMessage('smsStatus must be: sent, delivered, or failed'),
    body('emailOpenedAt')
      .optional({ nullable: true })
      .isISO8601().withMessage('emailOpenedAt must be ISO 8601'),
    body('emailClickedAt')
      .optional({ nullable: true })
      .isISO8601().withMessage('emailClickedAt must be ISO 8601'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    const existing = await db<TouchpointRow>('touchpoints')
      .where({ id: req.params.id, org_id: orgId })
      .first();
    if (!existing) {
      fail(res, 404, 'Touchpoint not found', 'NOT_FOUND');
      return;
    }

    const { emailStatus, smsStatus, emailOpenedAt, emailClickedAt } =
      req.body as Record<string, unknown>;

    const updates: Partial<TouchpointRow> & { updated_at: Date } = { updated_at: new Date() };
    if (emailStatus   !== undefined) updates.email_status      = emailStatus  as string | null;
    if (smsStatus     !== undefined) updates.sms_status        = smsStatus    as string | null;
    if (emailOpenedAt !== undefined) updates.email_opened_at   = emailOpenedAt  ? new Date(emailOpenedAt as string) : null;
    if (emailClickedAt !== undefined) updates.email_clicked_at = emailClickedAt ? new Date(emailClickedAt as string) : null;

    const [updated] = await db<TouchpointRow>('touchpoints')
      .where({ id: req.params.id, org_id: orgId })
      .update(updates)
      .returning('*');

    ok(res, serializeTouchpoint(updated));
  },
);

export default router;
