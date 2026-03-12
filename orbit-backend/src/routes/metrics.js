const express = require('express');
const db      = require('../db');
const { authenticate, tenantScope, requireRole } = require('../middleware/auth');
const asyncHandler = global.asyncHandler || (fn => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { next(e); } });
const router  = express.Router();

// GET /metrics/overview
router.get('/overview', authenticate, tenantScope, async (req, res) => {
  const orgId = req.user.orgId;
  const now   = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
  const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];

  const [raised, lastRaised, donors, pledges, retention] = await Promise.all([
    // Raised this month
    db.query(
      `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS gifts
       FROM gifts WHERE org_id=$1 AND date >= $2 AND status='completed'`,
      [orgId, monthStart]
    ),
    // Raised last month
    db.query(
      `SELECT COALESCE(SUM(amount),0) AS total FROM gifts
       WHERE org_id=$1 AND date BETWEEN $2 AND $3 AND status='completed'`,
      [orgId, lastMonthStart, lastMonthEnd]
    ),
    // Active donors (gave in last 12 months OR stage not lapsed)
    db.query(
      `SELECT
         COUNT(*) FILTER (WHERE last_gift_date >= NOW() - INTERVAL '12 months') AS active,
         COUNT(*) FILTER (WHERE last_gift_date >= $2) AS new_this_month,
         COUNT(*) FILTER (WHERE stage='lapsed') AS lapsed
       FROM donors WHERE org_id=$1`,
      [orgId, monthStart]
    ),
    // Open pledges
    db.query(
      `SELECT COALESCE(SUM(total_amount - paid_amount),0) AS open,
              COUNT(*) FILTER (WHERE status='overdue') AS overdue
       FROM pledges WHERE org_id=$1 AND status IN ('current','overdue','at-risk')`,
      [orgId]
    ),
    // Retention: donors who gave last year and gave this year
    db.query(
      `WITH last_year AS (
         SELECT DISTINCT donor_id FROM gifts
         WHERE org_id=$1 AND date_part('year', date) = date_part('year', NOW()) - 1
       ),
       this_year AS (
         SELECT DISTINCT donor_id FROM gifts
         WHERE org_id=$1 AND date_part('year', date) = date_part('year', NOW())
       )
       SELECT
         COUNT(l.donor_id) AS base,
         COUNT(t.donor_id) AS retained
       FROM last_year l
       LEFT JOIN this_year t USING (donor_id)`,
      [orgId]
    ),
  ]);

  const raisedTotal    = parseFloat(raised.rows[0].total);
  const lastTotal      = parseFloat(lastRaised.rows[0].total);
  const activeDonors   = parseInt(donors.rows[0].active);
  const newDonors      = parseInt(donors.rows[0].new_this_month);
  const lapsedDonors   = parseInt(donors.rows[0].lapsed);
  const openPledges    = parseFloat(pledges.rows[0].open);
  const base           = parseInt(retention.rows[0].base) || 1;
  const retained       = parseInt(retention.rows[0].retained);
  const retentionRate  = Math.round((retained / base) * 1000) / 10;

  res.json({
    raisedThisMonth:   raisedTotal,
    raisedLastMonth:   lastTotal,
    raisedTrend:       lastTotal > 0 ? Math.round(((raisedTotal - lastTotal) / lastTotal) * 100) : 0,
    activeDonors,
    activeDonorsTrend: newDonors - lapsedDonors,
    newDonors,
    lapsedDonors,
    openPledges,
    openPledgesTrend:  12,   // TODO: compare to last month
    retentionRate,
    retentionTrend:    8,    // TODO: compute from snapshots
    overdueCount:      parseInt(pledges.rows[0].overdue),
  });
});

// GET /metrics/revenue?months=9
router.get('/revenue', authenticate, tenantScope, async (req, res) => {
  const orgId  = req.user.orgId;
  const months = Math.min(parseInt(req.query.months) || 9, 24);

  const { rows } = await db.query(
    `SELECT
       TO_CHAR(date_trunc('month', date), 'Mon') AS month,
       date_trunc('month', date) AS month_date,
       COALESCE(SUM(amount),0) AS raised
     FROM gifts
     WHERE org_id=$1
       AND date >= date_trunc('month', NOW()) - ($2 || ' months')::INTERVAL
       AND status='completed'
     GROUP BY 1,2
     ORDER BY 2`,
    [orgId, months - 1]
  );

  // Fetch goals from campaigns (or use configured goal per month)
  const goals = await db.query(
    `SELECT
       TO_CHAR(date_trunc('month', start_date), 'Mon') AS month,
       SUM(goal) AS goal
     FROM campaigns
     WHERE org_id=$1 AND start_date IS NOT NULL
     GROUP BY 1`,
    [orgId]
  );
  const goalMap = {};
  goals.rows.forEach(g => { goalMap[g.month] = parseFloat(g.goal); });

  res.json(rows.map(r => ({
    month:  r.month,
    raised: parseFloat(r.raised),
    goal:   goalMap[r.month] || parseFloat(r.raised) * 1.15,  // fallback: 15% above raised
  })));
});

// GET /metrics/retention
router.get('/retention', authenticate, tenantScope, async (req, res) => {
  const orgId = req.user.orgId;
  const { rows } = await db.query(
    `WITH monthly AS (
       SELECT
         date_trunc('month', date) AS month,
         COUNT(DISTINCT donor_id) AS donors
       FROM gifts
       WHERE org_id=$1 AND date >= NOW() - INTERVAL '12 months'
       GROUP BY 1
     )
     SELECT TO_CHAR(month, 'Mon') AS m, donors FROM monthly ORDER BY month`,
    [orgId]
  );
  res.json(rows);
});

// GET /metrics/drill/:tile
router.get('/drill/:tile', authenticate, tenantScope, async (req, res) => {
  const orgId = req.user.orgId;
  const { tile } = req.params;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                       .toISOString().split('T')[0];

  if (tile === 'raised') {
    const [byFund, byAgent, topGifts, stats] = await Promise.all([
      db.query(
        `SELECT fund, SUM(amount) AS total, COUNT(*) AS gifts
         FROM gifts WHERE org_id=$1 AND date>=$2 AND status='completed'
         GROUP BY fund ORDER BY total DESC LIMIT 6`,
        [orgId, monthStart]
      ),
      db.query(
        `SELECT d.assigned_agent AS agent, SUM(g.amount) AS total, COUNT(*) AS gifts
         FROM gifts g JOIN donors d ON d.id=g.donor_id
         WHERE g.org_id=$1 AND g.date>=$2 AND g.status='completed'
         GROUP BY 1 ORDER BY total DESC`,
        [orgId, monthStart]
      ),
      db.query(
        `SELECT d.name AS donor, g.amount, g.fund, g.date, g.type
         FROM gifts g JOIN donors d ON d.id=g.donor_id
         WHERE g.org_id=$1 AND g.date>=$2 AND g.status='completed'
         ORDER BY g.amount DESC LIMIT 10`,
        [orgId, monthStart]
      ),
      db.query(
        `SELECT AVG(amount) AS avg, percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS median,
                MAX(amount) AS max
         FROM gifts WHERE org_id=$1 AND date>=$2 AND status='completed'`,
        [orgId, monthStart]
      ),
    ]);
    return res.json({ byFund: byFund.rows, byAgent: byAgent.rows, topGifts: topGifts.rows, stats: stats.rows[0] });
  }

  if (tile === 'donors') {
    const [byStage, byAgent, byChannel, newDonors] = await Promise.all([
      db.query(
        `SELECT stage, COUNT(*) AS n FROM donors WHERE org_id=$1 GROUP BY stage ORDER BY n DESC`,
        [orgId]
      ),
      db.query(
        `SELECT assigned_agent AS agent, COUNT(*) AS n FROM donors WHERE org_id=$1 AND assigned_agent IS NOT NULL GROUP BY 1`,
        [orgId]
      ),
      db.query(
        `SELECT preferred_channel AS channel, COUNT(*) AS n FROM donors WHERE org_id=$1 GROUP BY 1`,
        [orgId]
      ),
      db.query(
        `SELECT d.name, g.amount, g.date FROM donors d
         JOIN gifts g ON g.donor_id=d.id
         WHERE d.org_id=$1 AND d.total_gifts=1 AND g.date>=$2
         ORDER BY g.date DESC LIMIT 10`,
        [orgId, monthStart]
      ),
    ]);
    return res.json({ byStage: byStage.rows, byAgent: byAgent.rows, byChannel: byChannel.rows, newDonors: newDonors.rows });
  }

  if (tile === 'pledges') {
    const [byFund, health, register] = await Promise.all([
      db.query(
        `SELECT fund, SUM(total_amount-paid_amount) AS remaining FROM pledges
         WHERE org_id=$1 AND status IN ('current','overdue','at-risk')
         GROUP BY fund ORDER BY remaining DESC`,
        [orgId]
      ),
      db.query(
        `SELECT status, COUNT(*) AS n, SUM(total_amount-paid_amount) AS value
         FROM pledges WHERE org_id=$1 GROUP BY status`,
        [orgId]
      ),
      db.query(
        `SELECT d.name AS donor, p.total_amount, p.paid_amount,
                p.total_amount-p.paid_amount AS remaining,
                p.installment, p.fund, p.next_due_date, p.status
         FROM pledges p JOIN donors d ON d.id=p.donor_id
         WHERE p.org_id=$1 AND p.status IN ('current','overdue','at-risk')
         ORDER BY remaining DESC LIMIT 15`,
        [orgId]
      ),
    ]);
    return res.json({ byFund: byFund.rows, health: health.rows, register: register.rows });
  }

  if (tile === 'retention') {
    const [monthly, bySegment, atRisk] = await Promise.all([
      db.query(
        `SELECT TO_CHAR(date_trunc('month',date),'Mon') AS m,
                COUNT(DISTINCT donor_id) AS donors
         FROM gifts WHERE org_id=$1 AND date >= NOW()-INTERVAL '9 months'
         GROUP BY 1,date_trunc('month',date) ORDER BY date_trunc('month',date)`,
        [orgId]
      ),
      db.query(
        `SELECT stage, COUNT(*) AS n FROM donors WHERE org_id=$1 GROUP BY stage`,
        [orgId]
      ),
      db.query(
        `SELECT name, last_gift_date, engagement_score, sentiment_trend
         FROM donors WHERE org_id=$1 AND engagement_score < 50
         ORDER BY engagement_score ASC LIMIT 10`,
        [orgId]
      ),
    ]);
    return res.json({ monthly: monthly.rows, bySegment: bySegment.rows, atRisk: atRisk.rows });
  }

  res.status(400).json({ error: 'Unknown tile', message: `Valid tiles: raised, donors, pledges, retention` });
});

module.exports = router;
