/**
 * /api/v1/analytics — Analytics Routes
 *
 * GET /analytics/overview          Dashboard summary (giving, donors, agents, campaigns)
 * GET /analytics/giving            Giving trends over time (monthly/quarterly/yearly)
 * GET /analytics/donors            Donor cohort metrics (retention, lapse, new, reactivated)
 * GET /analytics/campaigns         Campaign performance summary across all campaigns
 * GET /analytics/agents            Agent activity metrics per agent type
 *
 * Rules (per CLAUDE.md):
 *   - Every query must include org_id from req.user.orgId
 *   - Monetary values in response are cents (integers)
 *   - manager or admin role required for all analytics
 */

import { Router, Request, Response, NextFunction } from 'express';
import { query, validationResult } from 'express-validator';

import { getDB } from '../config/database';
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

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function ok(res: Response, data: unknown): void {
  res.json({ data });
}

function fail(
  res:     Response,
  status:  number,
  message: string,
  code:    string,
): void {
  res.status(status).json({ error: message, code, details: [] });
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

/** Require manager or admin role for all analytics endpoints. */
function requireManager(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthRequest;
  if (!['admin', 'manager'].includes(authReq.user.role)) {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', details: [] });
    return;
  }
  next();
}

/** Parse ISO date string query param or return a default. */
function parseDate(val: string | undefined, defaultDaysAgo: number): string {
  if (val) return val;
  const d = new Date();
  d.setDate(d.getDate() - defaultDaysAgo);
  return d.toISOString().split('T')[0];
}

// ─── ALL ROUTES REQUIRE AUTHENTICATION ────────────────────────────────────────

router.use(authenticate, requireManager);

// ─── GET /analytics/overview ──────────────────────────────────────────────────

router.get(
  '/overview',
  [
    query('dateFrom').optional().isDate().withMessage('dateFrom must be YYYY-MM-DD'),
    query('dateTo').optional().isDate().withMessage('dateTo must be YYYY-MM-DD'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq  = req as AuthRequest;
    const db       = getDB();
    const orgId    = authReq.user.orgId;
    const dateFrom = parseDate(req.query.dateFrom as string | undefined, 365);
    const dateTo   = (req.query.dateTo as string) || new Date().toISOString().split('T')[0];

    const [
      givingStats,
      donorStats,
      campaignStats,
      agentStats,
      pledgeStats,
      recentGifts,
    ] = await Promise.all([

      // Total giving in period
      db('gifts')
        .where({ org_id: orgId })
        .whereNot({ status: 'failed' })
        .whereBetween('gift_date', [dateFrom, dateTo])
        .select(
          db.raw('COALESCE(SUM(amount_cents), 0)::bigint  AS total_raised_cents'),
          db.raw('COUNT(*)::int                            AS gift_count'),
          db.raw('COALESCE(AVG(amount_cents), 0)::bigint  AS avg_gift_cents'),
          db.raw('COUNT(DISTINCT donor_id)::int            AS unique_donors'),
        )
        .first<{
          total_raised_cents: string;
          gift_count:         number;
          avg_gift_cents:     string;
          unique_donors:      number;
        }>(),

      // Donor pipeline counts
      db('donors')
        .where({ org_id: orgId })
        .whereNot({ status: 'archived' })
        .select(
          db.raw('COUNT(*)::int                                           AS total_donors'),
          db.raw("COUNT(*) FILTER (WHERE journey_stage = 'uncontacted')::int  AS uncontacted"),
          db.raw("COUNT(*) FILTER (WHERE journey_stage = 'cultivation')::int   AS in_cultivation"),
          db.raw("COUNT(*) FILTER (WHERE journey_stage = 'stewardship')::int   AS in_stewardship"),
          db.raw("COUNT(*) FILTER (WHERE journey_stage = 'lapsed_outreach')::int AS lapsed"),
          db.raw('COUNT(*) FILTER (WHERE ai_opted_in = true)::int         AS ai_opted_in'),
        )
        .first<{
          total_donors:    number;
          uncontacted:     number;
          in_cultivation:  number;
          in_stewardship:  number;
          lapsed:          number;
          ai_opted_in:     number;
        }>(),

      // Active campaign count + total raised
      db('campaigns')
        .where({ org_id: orgId })
        .whereNot({ status: 'archived' })
        .select(
          db.raw('COUNT(*)::int                              AS total_campaigns'),
          db.raw("COUNT(*) FILTER (WHERE status = 'active')::int AS active_campaigns"),
          db.raw('COALESCE(SUM(raised_cents), 0)::bigint    AS total_raised_cents'),
          db.raw('COALESCE(SUM(goal_cents), 0)::bigint      AS total_goal_cents'),
        )
        .first<{
          total_campaigns:     number;
          active_campaigns:    number;
          total_raised_cents:  string;
          total_goal_cents:    string;
        }>(),

      // Agent decision volume in period
      db('agent_decisions')
        .where({ org_id: orgId })
        .whereBetween('created_at', [dateFrom + 'T00:00:00Z', dateTo + 'T23:59:59Z'])
        .select(
          db.raw('COUNT(*)::int                               AS total_decisions'),
          db.raw('COUNT(DISTINCT donor_id)::int               AS donors_engaged'),
          db.raw('COUNT(*) FILTER (WHERE escalated = true)::int AS escalations'),
        )
        .first<{
          total_decisions: number;
          donors_engaged:  number;
          escalations:     number;
        }>(),

      // Active pledge totals
      db('pledges')
        .where({ org_id: orgId, status: 'active' })
        .select(
          db.raw('COUNT(*)::int                                AS active_pledges'),
          db.raw('COALESCE(SUM(total_amount_cents), 0)::bigint AS total_pledged_cents'),
        )
        .first<{
          active_pledges:      number;
          total_pledged_cents: string;
        }>(),

      // Last 5 confirmed gifts (for activity feed)
      db('gifts')
        .join('donors', 'donors.id', 'gifts.donor_id')
        .where({ 'gifts.org_id': orgId })
        .whereNot({ 'gifts.status': 'failed' })
        .select(
          'gifts.id',
          'gifts.amount_cents',
          'gifts.gift_date',
          'gifts.fund_name',
          db.raw("CONCAT(donors.first_name, ' ', donors.last_name) AS donor_name"),
        )
        .orderBy('gifts.gift_date', 'desc')
        .limit(5) as Promise<Array<{
          id:           string;
          amount_cents: number;
          gift_date:    string;
          fund_name:    string | null;
          donor_name:   string;
        }>>,
    ]);

    ok(res, {
      period:    { dateFrom, dateTo },
      giving: {
        totalRaisedCents: parseInt(givingStats?.total_raised_cents ?? '0', 10),
        giftCount:        givingStats?.gift_count    ?? 0,
        avgGiftCents:     parseInt(givingStats?.avg_gift_cents  ?? '0', 10),
        uniqueDonors:     givingStats?.unique_donors ?? 0,
      },
      donors: {
        total:         donorStats?.total_donors   ?? 0,
        uncontacted:   donorStats?.uncontacted    ?? 0,
        inCultivation: donorStats?.in_cultivation ?? 0,
        inStewardship: donorStats?.in_stewardship ?? 0,
        lapsed:        donorStats?.lapsed         ?? 0,
        aiOptedIn:     donorStats?.ai_opted_in    ?? 0,
      },
      campaigns: {
        total:           campaignStats?.total_campaigns    ?? 0,
        active:          campaignStats?.active_campaigns   ?? 0,
        totalRaisedCents: parseInt(campaignStats?.total_raised_cents ?? '0', 10),
        totalGoalCents:   parseInt(campaignStats?.total_goal_cents   ?? '0', 10),
      },
      agents: {
        totalDecisions: agentStats?.total_decisions ?? 0,
        donorsEngaged:  agentStats?.donors_engaged  ?? 0,
        escalations:    agentStats?.escalations     ?? 0,
      },
      pledges: {
        active:             pledgeStats?.active_pledges                           ?? 0,
        totalPledgedCents:  parseInt(pledgeStats?.total_pledged_cents ?? '0', 10),
      },
      recentGifts: recentGifts.map((g) => ({
        id:          g.id,
        amountCents: g.amount_cents,
        giftDate:    g.gift_date,
        fundName:    g.fund_name,
        donorName:   g.donor_name,
      })),
    });
  },
);

// ─── GET /analytics/giving ────────────────────────────────────────────────────

router.get(
  '/giving',
  [
    query('granularity')
      .optional()
      .isIn(['monthly', 'quarterly', 'yearly'])
      .withMessage('granularity must be monthly, quarterly, or yearly'),
    query('dateFrom').optional().isDate().withMessage('dateFrom must be YYYY-MM-DD'),
    query('dateTo').optional().isDate().withMessage('dateTo must be YYYY-MM-DD'),
    query('campaignId').optional().isUUID(),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq     = req as AuthRequest;
    const db          = getDB();
    const orgId       = authReq.user.orgId;
    const granularity = (req.query.granularity as string) || 'monthly';
    const dateFrom    = parseDate(req.query.dateFrom as string | undefined, 365);
    const dateTo      = (req.query.dateTo   as string) || new Date().toISOString().split('T')[0];
    const campaignId  = req.query.campaignId as string | undefined;

    // Validate campaignId ownership
    if (campaignId) {
      const campaign = await db('campaigns')
        .where({ id: campaignId, org_id: orgId })
        .first();
      if (!campaign) {
        fail(res, 404, 'Campaign not found', 'NOT_FOUND');
        return;
      }
    }

    const truncExpr =
      granularity === 'yearly'    ? "DATE_TRUNC('year',  gift_date::date)" :
      granularity === 'quarterly' ? "DATE_TRUNC('quarter', gift_date::date)" :
                                    "DATE_TRUNC('month', gift_date::date)";

    let qb = db('gifts')
      .where({ org_id: orgId })
      .whereNot({ status: 'failed' })
      .whereBetween('gift_date', [dateFrom, dateTo])
      .select(
        db.raw(`${truncExpr}                             AS period`),
        db.raw('COALESCE(SUM(amount_cents), 0)::bigint  AS raised_cents'),
        db.raw('COUNT(*)::int                            AS gift_count'),
        db.raw('COUNT(DISTINCT donor_id)::int            AS unique_donors'),
      )
      .groupByRaw(truncExpr)
      .orderByRaw(truncExpr);

    if (campaignId) qb = qb.where({ campaign_id: campaignId });

    const rows = await qb as Array<{
      period:        Date;
      raised_cents:  string;
      gift_count:    number;
      unique_donors: number;
    }>;

    ok(res, {
      granularity,
      dateFrom,
      dateTo,
      series: rows.map((r) => ({
        period:       r.period,
        raisedCents:  parseInt(r.raised_cents, 10),
        giftCount:    r.gift_count,
        uniqueDonors: r.unique_donors,
      })),
    });
  },
);

// ─── GET /analytics/donors ────────────────────────────────────────────────────

router.get(
  '/donors',
  [
    query('dateFrom').optional().isDate().withMessage('dateFrom must be YYYY-MM-DD'),
    query('dateTo').optional().isDate().withMessage('dateTo must be YYYY-MM-DD'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq  = req as AuthRequest;
    const db       = getDB();
    const orgId    = authReq.user.orgId;
    const dateFrom = parseDate(req.query.dateFrom as string | undefined, 365);
    const dateTo   = (req.query.dateTo as string) || new Date().toISOString().split('T')[0];

    const [journeyBreakdown, retentionStats, topDonors] = await Promise.all([

      // Journey stage breakdown
      db('donors')
        .where({ org_id: orgId })
        .whereNot({ status: 'archived' })
        .select('journey_stage', db.raw('COUNT(*)::int AS count'))
        .groupBy('journey_stage')
        .orderBy('count', 'desc') as Promise<Array<{ journey_stage: string; count: number }>>,

      // Retention: gave in dateFrom..dateTo vs gave in prior period
      db.raw(
        `SELECT
          COUNT(DISTINCT CASE WHEN g_curr.donor_id IS NOT NULL THEN d.id END)::int AS retained,
          COUNT(DISTINCT CASE WHEN g_curr.donor_id IS NULL     THEN d.id END)::int AS lapsed_in_period,
          COUNT(DISTINCT CASE WHEN g_prior.donor_id IS NULL AND g_curr.donor_id IS NOT NULL THEN d.id END)::int AS reactivated,
          COUNT(DISTINCT CASE WHEN g_prior.donor_id IS NULL AND first_gift.donor_id IS NOT NULL AND g_curr.donor_id IS NOT NULL THEN d.id END)::int AS new_donors
        FROM donors d
        LEFT JOIN (
          SELECT DISTINCT donor_id FROM gifts
          WHERE org_id = ? AND status != 'failed' AND gift_date BETWEEN ? AND ?
        ) g_curr  ON g_curr.donor_id  = d.id
        LEFT JOIN (
          SELECT DISTINCT donor_id FROM gifts
          WHERE org_id = ? AND status != 'failed'
            AND gift_date BETWEEN (CAST(? AS date) - interval '1 year') AND (CAST(? AS date) - interval '1 day')
        ) g_prior ON g_prior.donor_id = d.id
        LEFT JOIN (
          SELECT donor_id, MIN(gift_date) AS first_gift_date FROM gifts
          WHERE org_id = ? AND status != 'failed'
          GROUP BY donor_id
        ) first_gift ON first_gift.donor_id = d.id AND first_gift.first_gift_date BETWEEN ? AND ?
        WHERE d.org_id = ? AND d.status != 'archived'`,
        [
          orgId, dateFrom, dateTo,
          orgId, dateFrom, dateTo,
          orgId, dateFrom, dateTo,
          orgId,
        ],
      ),

      // Top 10 donors by lifetime giving
      db('donors')
        .where({ org_id: orgId })
        .whereNot({ status: 'archived' })
        .select(
          'id',
          db.raw("CONCAT(first_name, ' ', last_name) AS name"),
          'total_giving_cents',
          'journey_stage',
          'propensity_score',
        )
        .orderBy('total_giving_cents', 'desc')
        .limit(10) as Promise<Array<{
          id:                 string;
          name:               string;
          total_giving_cents: number;
          journey_stage:      string;
          propensity_score:   number;
        }>>,
    ]);

    const ret = (retentionStats as { rows: Array<Record<string, number>> }).rows[0] ?? {};

    ok(res, {
      period: { dateFrom, dateTo },
      journeyBreakdown: journeyBreakdown.map((r) => ({
        stage: r.journey_stage,
        count: r.count,
      })),
      retention: {
        retained:        ret.retained         ?? 0,
        lapsedInPeriod:  ret.lapsed_in_period ?? 0,
        reactivated:     ret.reactivated      ?? 0,
        newDonors:       ret.new_donors       ?? 0,
      },
      topDonors: topDonors.map((d) => ({
        id:               d.id,
        name:             d.name,
        totalGivingCents: d.total_giving_cents,
        journeyStage:     d.journey_stage,
        propensityScore:  d.propensity_score,
      })),
    });
  },
);

// ─── GET /analytics/campaigns ─────────────────────────────────────────────────

router.get(
  '/campaigns',
  [],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();
    const orgId   = authReq.user.orgId;

    const rows = await db('campaigns')
      .where({ 'campaigns.org_id': orgId })
      .whereNot({ 'campaigns.status': 'archived' })
      .leftJoin('gifts', function () {
        this.on('gifts.campaign_id', '=', 'campaigns.id')
            .andOnVal('gifts.status', '!=', 'failed');
      })
      .select(
        'campaigns.id',
        'campaigns.name',
        'campaigns.status',
        'campaigns.type',
        'campaigns.goal_cents',
        'campaigns.start_date',
        'campaigns.end_date',
        db.raw('COALESCE(SUM(gifts.amount_cents), 0)::bigint AS raised_cents'),
        db.raw('COUNT(DISTINCT gifts.donor_id)::int           AS unique_donors'),
        db.raw('COUNT(gifts.id)::int                          AS gift_count'),
      )
      .groupBy(
        'campaigns.id',
        'campaigns.name',
        'campaigns.status',
        'campaigns.type',
        'campaigns.goal_cents',
        'campaigns.start_date',
        'campaigns.end_date',
      )
      .orderBy('campaigns.start_date', 'desc') as Array<{
        id:            string;
        name:          string;
        status:        string;
        type:          string;
        goal_cents:    number | null;
        start_date:    string;
        end_date:      string;
        raised_cents:  string;
        unique_donors: number;
        gift_count:    number;
      }>;

    ok(res, rows.map((r) => {
      const raised  = parseInt(r.raised_cents, 10);
      const goal    = r.goal_cents ?? 0;
      const progress = goal > 0 ? Math.min(Math.round((raised / goal) * 100), 100) : null;
      const today    = new Date();
      const end      = new Date(r.end_date);
      const daysRemaining = Math.ceil((end.getTime() - today.getTime()) / 86400000);

      return {
        id:             r.id,
        name:           r.name,
        status:         r.status,
        type:           r.type,
        goalCents:      goal,
        raisedCents:    raised,
        progressPercent: progress,
        startDate:      r.start_date,
        endDate:        r.end_date,
        daysRemaining,
        uniqueDonors:   r.unique_donors,
        giftCount:      r.gift_count,
      };
    }));
  },
);

// ─── GET /analytics/agents ────────────────────────────────────────────────────

router.get(
  '/agents',
  [
    query('dateFrom').optional().isDate().withMessage('dateFrom must be YYYY-MM-DD'),
    query('dateTo').optional().isDate().withMessage('dateTo must be YYYY-MM-DD'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq  = req as AuthRequest;
    const db       = getDB();
    const orgId    = authReq.user.orgId;
    const dateFrom = parseDate(req.query.dateFrom as string | undefined, 30);
    const dateTo   = (req.query.dateTo as string) || new Date().toISOString().split('T')[0];

    const [agentActivity, touchpointStats] = await Promise.all([

      // Decisions per agent type in period
      db('agent_decisions')
        .join('agents', 'agents.id', 'agent_decisions.agent_id')
        .where({ 'agent_decisions.org_id': orgId })
        .whereBetween('agent_decisions.created_at', [
          dateFrom + 'T00:00:00Z',
          dateTo   + 'T23:59:59Z',
        ])
        .select(
          'agents.type',
          db.raw('COUNT(agent_decisions.id)::int       AS decision_count'),
          db.raw('COUNT(DISTINCT agent_decisions.donor_id)::int AS donors_engaged'),
          db.raw('COUNT(*) FILTER (WHERE agent_decisions.escalated = true)::int AS escalations'),
        )
        .groupBy('agents.type')
        .orderBy('decision_count', 'desc') as Promise<Array<{
          type:            string;
          decision_count:  number;
          donors_engaged:  number;
          escalations:     number;
        }>>,

      // Touchpoints by channel in period
      db('touchpoints')
        .where({ org_id: orgId })
        .whereBetween('created_at', [
          dateFrom + 'T00:00:00Z',
          dateTo   + 'T23:59:59Z',
        ])
        .select(
          'channel',
          db.raw('COUNT(*)::int AS count'),
        )
        .groupBy('channel')
        .orderBy('count', 'desc') as Promise<Array<{
          channel: string;
          count:   number;
        }>>,
    ]);

    ok(res, {
      period: { dateFrom, dateTo },
      agentActivity: agentActivity.map((r) => ({
        agentType:      r.type,
        decisionCount:  r.decision_count,
        donorsEngaged:  r.donors_engaged,
        escalations:    r.escalations,
      })),
      touchpointsByChannel: touchpointStats.map((r) => ({
        channel: r.channel,
        count:   r.count,
      })),
    });
  },
);

export default router;
