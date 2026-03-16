'use strict';
/**
 * /api/v1/agents — AI Agent management and execution
 * VEO · VSO · VPGO · VCO
 */
const express = require('express');
const db      = require('../db');
const ai      = require('../services/ai');
const logger  = require('../utils/logger');
const { authenticate, tenantScope, requireRole } = require('../middleware/auth');
const asyncHandler = global.asyncHandler || (fn => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { next(e); } });
const router  = express.Router();

const VALID_AGENTS = new Set(['VEO', 'VSO', 'VPGO', 'VCO']);

function validateAgent(req, res, next) {
  if (!VALID_AGENTS.has(req.params.key?.toUpperCase())) {
    return res.status(400).json({ error: 'InvalidAgent', message: 'Must be VEO, VSO, VPGO, or VCO' });
  }
  req.params.key = req.params.key.toUpperCase();
  next();
}

// GET /agents/:key/queue — top donors for this agent
router.get('/:key/queue', validateAgent, async (req, res) => {
  const { key } = req.params;
  const limit   = Math.min(parseInt(req.query.limit) || 20, 100);
  const stage   = req.query.stage;

  let where   = ['org_id = $1', 'assigned_agent = $2'];
  const params = [req.user.orgId, key];

  if (stage) { where.push(`stage = $${params.length + 1}`); params.push(stage); }

  const { rows } = await db.query(
    `SELECT id, name, email, org_name, stage, assigned_agent,
            propensity_score, engagement_score, sentiment_trend,
            lifetime_giving, last_gift_amount, last_gift_date,
            preferred_channel, interests, alumni_class_year,
            do_not_contact, email_opt_out, sms_opt_in, last_contact_at
     FROM donors WHERE ${where.join(' AND ')}
     ORDER BY propensity_score DESC, engagement_score DESC
     LIMIT $${params.length + 1}`,
    [...params, limit]
  );
  res.json(rows);
});

// GET /agents/:key/activity — recent agent activity log
router.get('/:key/activity', validateAgent, async (req, res) => {
  const { key } = req.params;
  const since   = req.query.since || new Date(Date.now() - 86400000 * 7).toISOString();
  const limit   = Math.min(parseInt(req.query.limit) || 50, 200);

  const { rows } = await db.query(
    `SELECT id, agent_key, donor_id, donor_name, type, title, detail,
            amount, ai_reasoning, metadata, created_at
     FROM agent_activities
     WHERE org_id = $1 AND agent_key = $2 AND created_at >= $3
     ORDER BY created_at DESC LIMIT $4`,
    [req.user.orgId, key, since, limit]
  );
  res.json(rows);
});

// GET /agents/:key/config — agent persona + settings
router.get('/:key/config', validateAgent, async (req, res) => {
  const { key } = req.params;
  const { rows } = await db.query(
    'SELECT config, updated_at FROM agent_configs WHERE org_id = $1 AND agent_key = $2',
    [req.user.orgId, key]
  );
  res.json(rows[0] || { config: {}, updated_at: null });
});

// PUT /agents/:key/config — update agent persona + settings
router.put('/:key/config', validateAgent, async (req, res) => {
  const { key }  = req.params;
  const config   = req.body;

  // Validate config keys
  const allowed = ['persona', 'tone', 'instName', 'sigName', 'cadence',
                   'channels', 'thresholds', 'autoApprove', 'language'];
  const invalid = Object.keys(config).filter(k => !allowed.includes(k));
  if (invalid.length) {
    return res.status(400).json({ error: 'UnknownConfigKeys', keys: invalid });
  }

  await db.query(
    `INSERT INTO agent_configs (org_id, agent_key, config, updated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (org_id, agent_key)
     DO UPDATE SET config = $3, updated_by = $4, updated_at = NOW()`,
    [req.user.orgId, key, JSON.stringify(config), req.user.sub]
  );
  logger.info('Agent config updated', { orgId: req.user.orgId, agentKey: key, userId: req.user.sub });
  res.json({ saved: true });
});

// POST /agents/:key/run — run agent reasoning on a specific donor
router.post('/:key/run', validateAgent, async (req, res) => {
  const { key }            = req.params;
  const { donorId, action } = req.body;

  if (!donorId) return res.status(400).json({ error: 'donorId is required' });

  const [donorResult, configResult] = await Promise.all([
    db.query('SELECT * FROM donors WHERE id = $1 AND org_id = $2', [donorId, req.user.orgId]),
    db.query('SELECT config FROM agent_configs WHERE org_id = $1 AND agent_key = $2', [req.user.orgId, key]),
  ]);

  if (!donorResult.rows[0]) return res.status(404).json({ error: 'Donor not found' });

  const donor  = donorResult.rows[0];
  const config = configResult.rows[0]?.config || {};

  const reasoning = await ai.generateAgentReasoning(key, donor, config);

  await db.query(
    `INSERT INTO agent_activities
       (org_id, agent_key, donor_id, donor_name, type, title, detail, ai_reasoning, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      req.user.orgId, key, donorId, donor.name,
      action || 'analysis',
      `${key} analyzed ${donor.name}`,
      reasoning.recommended_action,
      JSON.stringify(reasoning),
      JSON.stringify({ triggeredBy: req.user.sub }),
    ]
  );

  res.json(reasoning);
});

// POST /agents/vso/run — run VSO stewardship engine on a donor JSON object
router.post('/vso/run', asyncHandler(async (req, res) => {
  const stewEngine = require('../services/stewardship-engine');
  const donor = req.body;

  // Validate required donor fields
  if (!donor || typeof donor !== 'object') {
    return res.status(400).json({ error: 'Donor object is required in request body' });
  }
  if (!donor.firstName || !donor.lastName) {
    return res.status(400).json({ error: 'Donor must have firstName and lastName' });
  }

  // Extract VSO-specific parameters from request
  const opts = {
    lapse_risk: req.body.lapse_risk || null,
    recognition_events: req.body.recognition_events || [],
    life_events: req.body.life_events || [],
    days_since_last_gift: req.body.days_since_last_gift || donor.daysSinceLastGift || 0,
    days_since_last_contact: req.body.days_since_last_contact || donor.daysSinceLastContact || 0,
  };

  // Compute stewardship decision
  const decision = stewEngine.decideStewAction(donor, opts);

  // Format for AI prompt if needed
  const promptFormatted = stewEngine.formatDecisionForPrompt(decision);

  // Return structured response
  res.json({
    donor: {
      id: donor.id || 'N/A',
      name: `${donor.firstName} ${donor.lastName}`,
      archetype: donor.archetype || 'LOYAL_ALUMNI',
      stage: donor.journeyStage || 'stewardship',
      totalGiving: donor.totalGiving || 0,
      givingStreak: donor.givingStreak || 0,
    },
    decision: {
      action: decision.action,
      tier: decision.tier,
      urgency: decision.urgency,
      channel: decision.channel,
      tone: decision.tone,
      content_themes: decision.content_themes,
      cta: decision.cta,
      ask_amount_cents: decision.ask_amount_cents,
      escalate_to_human: decision.escalate_to_human,
      hold_days: decision.hold_days,
      rationale: decision.rationale,
    },
    prompt_formatted: promptFormatted,
  });
}));

// POST /agents/:key/brief — generate full donor brief
router.post('/:key/brief', validateAgent, async (req, res) => {
  const { donorId, purpose = 'meeting prep' } = req.body;
  if (!donorId) return res.status(400).json({ error: 'donorId is required' });

  const { rows } = await db.query('SELECT * FROM donors WHERE id = $1 AND org_id = $2', [donorId, req.user.orgId]);
  if (!rows[0]) return res.status(404).json({ error: 'Donor not found' });

  const brief = await ai.generateDonorBrief(rows[0], purpose);
  res.json(brief);
});

// GET /agents/dashboard — all-agents summary for the intelligence panel
router.get('/dashboard', authenticate, tenantScope, async (req, res) => {
  const orgId = req.user.orgId;

  const [queueCounts, activityCounts, recentActivity] = await Promise.all([
    db.query(
      `SELECT assigned_agent, COUNT(*) as total,
              COUNT(*) FILTER (WHERE propensity_score >= 70) as high_priority
       FROM donors WHERE org_id = $1 AND assigned_agent IS NOT NULL
       GROUP BY assigned_agent`,
      [orgId]
    ),
    db.query(
      `SELECT agent_key, COUNT(*) as actions_today
       FROM agent_activities
       WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'
       GROUP BY agent_key`,
      [orgId]
    ),
    db.query(
      `SELECT agent_key, donor_name, type, title, created_at
       FROM agent_activities
       WHERE org_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [orgId]
    ),
  ]);

  res.json({
    queues:         queueCounts.rows,
    actionsToday:   activityCounts.rows,
    recentActivity: recentActivity.rows,
  });
});

// POST /agents/score — score a portfolio (or single donor) for contact readiness
router.post('/score', authenticate, tenantScope, asyncHandler(async (req, res) => {
  const { donorIds, limit = 50, enrichTop = 5 } = req.body;
  const engine = require('../services/predictiveEngine');
  const orgId  = req.user.orgId;

  // Fetch donors
  let donorQuery, donorParams;
  if (donorIds && donorIds.length) {
    donorQuery  = `SELECT * FROM donors WHERE org_id=$1 AND id = ANY($2::int[]) AND do_not_contact=false`;
    donorParams = [orgId, donorIds];
  } else {
    donorQuery  = `SELECT * FROM donors WHERE org_id=$1 AND do_not_contact=false ORDER BY propensity_score DESC NULLS LAST LIMIT $2`;
    donorParams = [orgId, Math.min(limit, 200)];
  }
  const { rows: donors } = await db.query(donorQuery, donorParams);

  // Fetch recent signals for each donor
  const { rows: signals } = await db.query(
    `SELECT * FROM donor_signals WHERE org_id=$1 AND donor_id = ANY($2::int[]) AND created_at > NOW() - INTERVAL '30 days' ORDER BY created_at DESC`,
    [orgId, donors.map(d => d.id)]
  );
  const signalsByDonor = {};
  signals.forEach(s => { (signalsByDonor[s.donor_id] = signalsByDonor[s.donor_id] || []).push(s); });

  // Fetch org config for fiscal calendar
  const { rows: configRows } = await db.query('SELECT config FROM tenant_configs WHERE org_id=$1', [orgId]).catch(() => ({ rows: [] }));
  const orgConfig = configRows[0]?.config || {};

  // Score all donors
  const portfolio = await engine.scorePortfolio(donors, signalsByDonor, orgConfig);

  // AI-enrich the top N priority donors
  const topDonors = portfolio.results.filter(r => r.contactUrgency === 'immediate').slice(0, enrichTop);
  const donorMap  = Object.fromEntries(donors.map(d => [d.id, d]));
  const enriched  = await Promise.all(
    topDonors.map(r => engine.enrichWithAIReasoning(r, donorMap[r.donorId]).catch(() => r))
  );
  enriched.forEach(r => {
    const idx = portfolio.results.findIndex(p => p.donorId === r.donorId);
    if (idx >= 0) portfolio.results[idx] = r;
  });

  // Persist scores back to donor records
  for (const result of portfolio.results) {
    await db.query(
      `UPDATE donors SET
         contact_readiness_score = $1,
         contact_urgency         = $2,
         recommended_channel     = $3,
         ask_readiness           = $4,
         estimated_ask_amount    = $5,
         score_computed_at       = NOW()
       WHERE id = $6 AND org_id = $7`,
      [result.contactReadinessScore, result.contactUrgency, result.recommendedChannel,
       result.askReadiness, result.estimatedAskAmount, result.donorId, orgId]
    ).catch(() => {}); // non-blocking
  }

  res.json(portfolio);
}));

// GET /agents/score/:donorId — score a single donor in detail
router.get('/score/:donorId', authenticate, tenantScope, asyncHandler(async (req, res) => {
  const engine   = require('../services/predictiveEngine');
  const { donorId } = req.params;
  const orgId    = req.user.orgId;

  const { rows: [donor] } = await db.query('SELECT * FROM donors WHERE id=$1 AND org_id=$2', [donorId, orgId]);
  if (!donor) return res.status(404).json({ error: 'Donor not found' });

  const { rows: signals } = await db.query(
    'SELECT * FROM donor_signals WHERE donor_id=$1 AND org_id=$2 ORDER BY created_at DESC LIMIT 20',
    [donorId, orgId]
  );

  let result = engine.scoreDonorContactReadiness(donor, signals);
  result     = await engine.enrichWithAIReasoning(result, donor);

  res.json(result);
}));

// POST /agents/signals/ingest — trigger signal ingestion for this org
router.post('/signals/ingest', authenticate, tenantScope, requireRole(['admin','director']), asyncHandler(async (req, res) => {
  const ingestion = require('../services/signalIngestion');
  const summary   = await ingestion.runSignalIngestion(req.user.orgId);
  res.json({ success: true, ...summary });
}));

// GET /agents/signals — get recent signals for this org
router.get('/signals', authenticate, tenantScope, asyncHandler(async (req, res) => {
  const { donorId, type, limit = 50, applied } = req.query;
  const where  = ['org_id = $1'];
  const params = [req.user.orgId];
  if (donorId) { where.push(`donor_id = $${params.length+1}`); params.push(donorId); }
  if (type)    { where.push(`type = $${params.length+1}`);     params.push(type.toUpperCase()); }
  if (applied !== undefined) { where.push(`applied = $${params.length+1}`); params.push(applied === 'true'); }

  const { rows } = await db.query(
    `SELECT s.*, d.name as donor_name, d.stage, d.assigned_agent
     FROM donor_signals s JOIN donors d ON d.id = s.donor_id AND d.org_id = s.org_id
     WHERE ${where.join(' AND ')}
     ORDER BY s.created_at DESC LIMIT $${params.length+1}`,
    [...params, Math.min(parseInt(limit), 200)]
  );
  res.json(rows);
}));

// PATCH /agents/signals/:signalId/apply — mark signal as applied to donor profile
router.patch('/signals/:signalId/apply', authenticate, tenantScope, asyncHandler(async (req, res) => {
  const { rows: [sig] } = await db.query(
    'UPDATE donor_signals SET applied=true, applied_at=NOW(), applied_by=$1 WHERE id=$2 AND org_id=$3 RETURNING *',
    [req.user.sub, req.params.signalId, req.user.orgId]
  );
  if (!sig) return res.status(404).json({ error: 'Signal not found' });
  res.json(sig);
}));

// POST /agents/chat — backend proxy for agent chat (keeps API key server-side)
// Body: { system: string, messages: [{role, content}] }
// Used by orbit-v4.html to route all agent chat through the backend.
router.post('/chat', authenticate, asyncHandler(async (req, res) => {
  const { system, messages } = req.body;

  if (!system || typeof system !== 'string') {
    return res.status(422).json({ error: 'system prompt is required', code: 'VALIDATION_ERROR', details: [] });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(422).json({ error: 'messages array is required', code: 'VALIDATION_ERROR', details: [] });
  }

  // Trim to last 10 turns; validate roles (CLAUDE.md agent rule)
  const trimmed = messages
    .filter(m => m && typeof m.content === 'string' && ["user","assistant"].includes(m.role))
    .slice(-10);

  const fetch = require("node-fetch");
  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system,
      messages:   trimmed,
    }),
  });

  if (\!claudeRes.ok) {
    logger.error("Claude API error in /agents/chat", { status: claudeRes.status });
    return res.status(502).json({ error: "AI service error", code: "UPSTREAM_ERROR", details: [] });
  }

  const data  = await claudeRes.json();
  const reply = data.content?.[0]?.text || "No response from AI.";

  res.json({ data: { reply } });
}));

module.exports = router;
