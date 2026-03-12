'use strict';
/**
 * ORBIT GIVING PLATFORM — API Routes  v1.0
 *
 * PUBLIC (no auth, CORS-open, rate-limited):
 *   GET  /giving/campaign/:slug          → full campaign data for public page
 *   GET  /giving/leaderboard/:slug       → live leaderboard (class/fund/team)
 *   GET  /giving/challenges/:slug        → active challenges + progress
 *   GET  /giving/milestones/:slug        → milestone progress
 *   GET  /giving/stream/:slug            → SSE real-time gift stream
 *   GET  /giving/ambassador/:slug/:page  → ambassador personal page data
 *   POST /giving/give                    → process a donation (tokenized)
 *   POST /giving/pageview                → track funnel analytics
 *
 * ADMIN (auth + tenant required):
 *   GET  /giving/campaigns               → list all campaigns for org
 *   POST /giving/campaigns               → create campaign
 *   GET  /giving/campaigns/:id           → get single campaign
 *   PUT  /giving/campaigns/:id           → update campaign
 *   POST /giving/campaigns/:id/launch    → go live
 *   POST /giving/campaigns/:id/pause     → pause
 *   POST /giving/campaigns/:id/end       → end campaign
 *   GET  /giving/campaigns/:id/analytics → full analytics report
 *   POST /giving/campaigns/:id/alerts    → fire push alert
 *   GET  /giving/campaigns/:id/gifts     → paginated gift list
 *   GET  /giving/campaigns/:id/ambassadors → ambassador list
 *   POST /giving/campaigns/:id/ambassadors → add ambassador
 *   POST /giving/wizard                  → save wizard (create/update)
 *   POST /giving/ai-copy                 → AI copy for campaign setup
 */

const express    = require('express');
const router     = express.Router();
const rateLimit  = require('express-rate-limit');
const db         = require('../db');
const logger     = require('../utils/logger');
const { authenticate, tenantScope } = require('../middleware/auth');

const {
  createCampaign, getCampaignBySlug, updateCampaign,
  getLeaderboard, evaluateChallenges, processPublicGift,
  getCampaignAnalytics, generatePushAlert, saveWizardCampaign,
  getAmbassadors, addSSEClient, removeSSEClient, broadcastToStream,
} = require('../services/givingEngine');

const { callClaude } = require('../services/ai');

// ─── Rate limiting for public endpoints ──────────────────────────────────────
const publicLimiter = rateLimit({
  windowMs:    60 * 1000,
  max:         120,
  message:     { error: 'RateLimited', message: 'Too many requests — try again shortly' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const giftLimiter = rateLimit({
  windowMs:    15 * 60 * 1000,
  max:         10,
  message:     { error: 'RateLimited', message: 'Too many gift attempts' },
  keyGenerator: req => req.body?.email || req.ip,
});

// ══════════════════════════════════════════════════════════════════════════════
//  PUBLIC ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

// ── Campaign public data ───────────────────────────────────────────────────────
router.get('/campaign/:slug', publicLimiter, async (req, res) => {
  try {
    const campaign = await getCampaignBySlug(req.params.slug);
    if (!campaign) return res.status(404).json({ error: 'CampaignNotFound' });

    // Strip sensitive fields for public consumption
    const {
      id, name, slug, type, status, goal, donor_count_goal,
      start_date, end_date, headline, subheadline, description,
      primary_color, secondary_color, accent_color,
      logo_url, hero_image_url, hero_video_url,
      social_hashtag, social_share_title, social_share_image,
      twitter_handle, funds, leaderboard_config, challenge_config,
      ambassador_config, stretch_goals,
      cached_raised, cached_gift_count, cached_donor_count,
      org_name, gateway, gateway_config_public,
    } = campaign;

    res.json({
      campaign: {
        id, name, slug, type, status, goal, donor_count_goal,
        startDate: start_date, endDate: end_date,
        headline, subheadline, description,
        primaryColor: primary_color, secondaryColor: secondary_color, accentColor: accent_color,
        logoUrl: logo_url, heroImageUrl: hero_image_url, heroVideoUrl: hero_video_url,
        socialHashtag: social_hashtag, socialShareTitle: social_share_title,
        twitterHandle: twitter_handle, funds,
        leaderboardConfig: leaderboard_config,
        ambassadorConfig: ambassador_config,
        stretchGoals: stretch_goals,
        orgName: org_name,
        gateway, gatewayPublicConfig: gateway_config_public,
      },
      live: {
        raised:      parseFloat(cached_raised || 0),
        giftCount:   parseInt(cached_gift_count || 0),
        donorCount:  parseInt(cached_donor_count || 0),
        pct:         goal > 0 ? Math.round((cached_raised / goal) * 100) : 0,
      },
      fetchedAt: new Date().toISOString(),
    });
  } catch(e) {
    logger.error('Campaign fetch failed', { slug: req.params.slug, err: e.message });
    res.status(500).json({ error: 'FetchFailed' });
  }
});

// ── Live leaderboard ───────────────────────────────────────────────────────────
router.get('/leaderboard/:slug', publicLimiter, async (req, res) => {
  try {
    const campaign = await getCampaignBySlug(req.params.slug);
    if (!campaign) return res.status(404).json({ error: 'CampaignNotFound' });

    const type    = req.query.type || 'class_year';
    const limit   = Math.min(parseInt(req.query.limit || 25), 100);
    const board   = await getLeaderboard(campaign.id, type, limit);

    res.json(board);
  } catch(e) {
    res.status(500).json({ error: 'LeaderboardFailed', message: e.message });
  }
});

// ── Challenge status ───────────────────────────────────────────────────────────
router.get('/challenges/:slug', publicLimiter, async (req, res) => {
  try {
    const campaign = await getCampaignBySlug(req.params.slug);
    if (!campaign) return res.status(404).json({ error: 'CampaignNotFound' });

    const challenges = await evaluateChallenges(campaign.id);
    res.json({ challenges, updatedAt: new Date().toISOString() });
  } catch(e) {
    res.status(500).json({ error: 'ChallengesFailed' });
  }
});

// ── Milestone progress ─────────────────────────────────────────────────────────
router.get('/milestones/:slug', publicLimiter, async (req, res) => {
  try {
    const campaign = await getCampaignBySlug(req.params.slug);
    if (!campaign) return res.status(404).json({ error: 'CampaignNotFound' });

    const { rows } = await db.query(
      'SELECT * FROM giving_milestones WHERE campaign_id=$1 ORDER BY display_order',
      [campaign.id]
    );
    res.json({ milestones: rows, updatedAt: new Date().toISOString() });
  } catch(e) {
    res.status(500).json({ error: 'MilestonesFailed' });
  }
});

// ── SSE gift stream ────────────────────────────────────────────────────────────
router.get('/stream/:slug', async (req, res) => {
  try {
    const campaign = await getCampaignBySlug(req.params.slug);
    if (!campaign) return res.status(404).end();

    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    // Send initial state
    res.write(`event: init\ndata: ${JSON.stringify({
      raised:    parseFloat(campaign.cached_raised || 0),
      giftCount: parseInt(campaign.cached_gift_count || 0),
      pct:       Math.round((campaign.cached_raised / campaign.goal) * 100),
    })}\n\n`);

    // Heartbeat every 25s to keep connection alive
    const heartbeat = setInterval(() => res.write(':heartbeat\n\n'), 25000);

    addSSEClient(campaign.id, res);

    req.on('close', () => {
      clearInterval(heartbeat);
      removeSSEClient(campaign.id, res);
    });
  } catch(e) {
    res.status(500).end();
  }
});

// ── Ambassador page ────────────────────────────────────────────────────────────
router.get('/ambassador/:slug/:pageSlug', publicLimiter, async (req, res) => {
  try {
    const campaign = await getCampaignBySlug(req.params.slug);
    if (!campaign) return res.status(404).json({ error: 'CampaignNotFound' });

    const { rows } = await db.query(
      `SELECT a.*, 
              COUNT(gg.id) as gifts_driven, 
              COALESCE(SUM(gg.amount),0) as raised
       FROM giving_ambassadors a
       LEFT JOIN giving_gifts gg ON gg.ambassador_id=a.id AND gg.status='completed'
       WHERE a.campaign_id=$1 AND a.page_slug=$2
       GROUP BY a.id`,
      [campaign.id, req.params.pageSlug]
    );

    if (!rows.length) return res.status(404).json({ error: 'AmbassadorNotFound' });
    res.json({ ambassador: rows[0], campaign: { name: campaign.name, primaryColor: campaign.primary_color } });
  } catch(e) {
    res.status(500).json({ error: 'AmbassadorFailed' });
  }
});

// ── Process gift ───────────────────────────────────────────────────────────────
router.post('/give', giftLimiter, async (req, res) => {
  const { campaignSlug, ...giftData } = req.body;

  if (!campaignSlug)    return res.status(400).json({ error: 'MissingCampaignSlug' });
  if (!giftData.token)  return res.status(400).json({ error: 'MissingPaymentToken' });
  if (!giftData.amount || giftData.amount <= 0) return res.status(400).json({ error: 'InvalidAmount' });
  if (!giftData.email)  return res.status(400).json({ error: 'MissingEmail' });

  try {
    const result = await processPublicGift(campaignSlug, giftData);

    if (!result.success) {
      return res.status(402).json({ error: 'PaymentFailed', message: result.errorMessage });
    }

    // Broadcast to SSE stream clients (non-blocking)
    const campaign = await getCampaignBySlug(campaignSlug);
    if (campaign) {
      broadcastToStream(campaign.id, 'gift', {
        name:   giftData.isAnonymous ? 'Anonymous' : `${giftData.firstName} ${giftData.lastName}`,
        amount: giftData.amount,
        fund:   giftData.fund || 'General Fund',
        time:   'just now',
        match:  result.matchApplied || false,
      });
    }

    res.json({
      success:       true,
      transactionId: result.transactionId,
      giftId:        result.giftId,
      amount:        giftData.amount,
      matchApplied:  result.matchApplied || false,
      matchAmount:   result.matchAmount || 0,
      message:       'Thank you for your generous gift!',
    });
  } catch(e) {
    logger.error('Gift processing failed', { campaignSlug, err: e.message });
    res.status(500).json({ error: 'ProcessingFailed', message: e.message });
  }
});

// ── Page view tracking ─────────────────────────────────────────────────────────
router.post('/pageview', publicLimiter, async (req, res) => {
  const { campaignSlug, page, sessionId, referrer, utmSource, utmMedium, utmCampaign, device } = req.body;
  try {
    const campaign = await getCampaignBySlug(campaignSlug);
    if (!campaign) return res.status(404).json({ error: 'CampaignNotFound' });

    await db.query(
      `INSERT INTO giving_page_views (campaign_id, org_id, session_id, page, referrer, utm_source, device_type, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [campaign.id, campaign.org_id, sessionId, page, referrer, utmSource, device]
    );
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: false }); // Don't fail the user experience for analytics
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  ADMIN ENDPOINTS (auth required)
// ══════════════════════════════════════════════════════════════════════════════
const protect = [authenticate, tenantScope];

// ── List campaigns ─────────────────────────────────────────────────────────────
router.get('/campaigns', ...protect, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.*,
              (SELECT COALESCE(SUM(amount),0) FROM giving_gifts WHERE campaign_id=c.id AND status='completed') as total_raised,
              (SELECT COUNT(*) FROM giving_gifts WHERE campaign_id=c.id AND status='completed') as gift_count
       FROM giving_campaigns c
       WHERE c.org_id=$1
       ORDER BY c.created_at DESC`,
      [req.user.orgId]
    );
    res.json({ campaigns: rows });
  } catch(e) {
    res.status(500).json({ error: 'ListFailed', message: e.message });
  }
});

// ── Create campaign ────────────────────────────────────────────────────────────
router.post('/campaigns', ...protect, async (req, res) => {
  try {
    const campaign = await createCampaign(req.user.orgId, {
      ...req.body, createdBy: req.user.email,
    });
    res.status(201).json({ campaign });
  } catch(e) {
    res.status(500).json({ error: 'CreateFailed', message: e.message });
  }
});

// ── Get single campaign ────────────────────────────────────────────────────────
router.get('/campaigns/:id', ...protect, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM giving_campaigns WHERE id=$1 AND org_id=$2',
      [req.params.id, req.user.orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'NotFound' });
    res.json({ campaign: rows[0] });
  } catch(e) {
    res.status(500).json({ error: 'FetchFailed' });
  }
});

// ── Update campaign ────────────────────────────────────────────────────────────
router.put('/campaigns/:id', ...protect, async (req, res) => {
  try {
    const updated = await updateCampaign(req.params.id, req.user.orgId, req.body);
    if (!updated) return res.status(404).json({ error: 'NotFound' });
    res.json({ campaign: updated });
  } catch(e) {
    res.status(500).json({ error: 'UpdateFailed', message: e.message });
  }
});

// ── Launch / Pause / End campaign ─────────────────────────────────────────────
router.post('/campaigns/:id/launch', ...protect, async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE giving_campaigns SET status='live', published_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND org_id=$2 AND status IN ('draft','scheduled','paused') RETURNING *`,
      [req.params.id, req.user.orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'NotFound or invalid status transition' });
    logger.info('Campaign launched', { campaignId: req.params.id, orgId: req.user.orgId });
    res.json({ campaign: rows[0] });
  } catch(e) {
    res.status(500).json({ error: 'LaunchFailed', message: e.message });
  }
});

router.post('/campaigns/:id/pause', ...protect, async (req, res) => {
  const { rows } = await db.query(
    `UPDATE giving_campaigns SET status='paused', updated_at=NOW()
     WHERE id=$1 AND org_id=$2 AND status='live' RETURNING id,status`,
    [req.params.id, req.user.orgId]
  ).catch(() => ({ rows: [] }));
  rows.length ? res.json({ campaign: rows[0] }) : res.status(404).json({ error: 'NotFound' });
});

router.post('/campaigns/:id/end', ...protect, async (req, res) => {
  const { rows } = await db.query(
    `UPDATE giving_campaigns SET status='ended', ended_at=NOW(), updated_at=NOW()
     WHERE id=$1 AND org_id=$2 AND status IN ('live','paused') RETURNING id,status,ended_at`,
    [req.params.id, req.user.orgId]
  ).catch(() => ({ rows: [] }));
  rows.length ? res.json({ campaign: rows[0] }) : res.status(404).json({ error: 'NotFound' });
});

// ── Analytics ─────────────────────────────────────────────────────────────────
router.get('/campaigns/:id/analytics', ...protect, async (req, res) => {
  try {
    const analytics = await getCampaignAnalytics(req.params.id, req.user.orgId);
    res.json(analytics);
  } catch(e) {
    res.status(500).json({ error: 'AnalyticsFailed', message: e.message });
  }
});

// ── Fire push alert ────────────────────────────────────────────────────────────
router.post('/campaigns/:id/alerts', ...protect, async (req, res) => {
  const { alertType, customContext } = req.body;
  if (!alertType) return res.status(400).json({ error: 'Missing alertType' });
  try {
    const alerts = await generatePushAlert(req.params.id, req.user.orgId, alertType, customContext || {});
    res.json(alerts);
  } catch(e) {
    res.status(500).json({ error: 'AlertFailed', message: e.message });
  }
});

// ── Gift list ─────────────────────────────────────────────────────────────────
router.get('/campaigns/:id/gifts', ...protect, async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page || 1));
  const limit = Math.min(100, parseInt(req.query.limit || 50));
  const offset = (page - 1) * limit;
  try {
    const { rows } = await db.query(
      `SELECT * FROM giving_gifts WHERE campaign_id=$1 AND org_id=$2
       ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [req.params.id, req.user.orgId, limit, offset]
    );
    const { rows: count } = await db.query(
      'SELECT COUNT(*) FROM giving_gifts WHERE campaign_id=$1 AND org_id=$2',
      [req.params.id, req.user.orgId]
    );
    res.json({ gifts: rows, total: parseInt(count[0].count), page, limit });
  } catch(e) {
    res.status(500).json({ error: 'GiftsFailed' });
  }
});

// ── Ambassadors ────────────────────────────────────────────────────────────────
router.get('/campaigns/:id/ambassadors', ...protect, async (req, res) => {
  try {
    const ambassadors = await getAmbassadors(req.params.id, req.user.orgId);
    res.json({ ambassadors });
  } catch(e) {
    res.status(500).json({ error: 'AmbassadorsFailed' });
  }
});

router.post('/campaigns/:id/ambassadors', ...protect, async (req, res) => {
  const { name, email, phone, classYear, teamName, personalGoal, personalMessage } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Missing name or email' });
  try {
    const slug = email.split('@')[0].replace(/[^a-z0-9]/gi, '-').toLowerCase() + '-' + Date.now().toString(36);
    const { rows } = await db.query(
      `INSERT INTO giving_ambassadors (campaign_id, org_id, name, email, phone, class_year, team_name, personal_goal, personal_message, page_slug)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (campaign_id, email) DO UPDATE SET name=EXCLUDED.name, updated_at=NOW()
       RETURNING *`,
      [req.params.id, req.user.orgId, name, email, phone, classYear, teamName, personalGoal, personalMessage, slug]
    );
    res.status(201).json({ ambassador: rows[0] });
  } catch(e) {
    res.status(500).json({ error: 'AddAmbassadorFailed', message: e.message });
  }
});

// ── Wizard save ────────────────────────────────────────────────────────────────
router.post('/wizard', ...protect, async (req, res) => {
  try {
    const campaign = await saveWizardCampaign(req.user.orgId, {
      ...req.body, createdBy: req.user.email,
    });
    res.json({ campaign, publicUrl: `https://give.${req.user.orgSlug || 'university'}.edu/${campaign.slug}` });
  } catch(e) {
    res.status(500).json({ error: 'WizardFailed', message: e.message });
  }
});

// ── AI copy generation (wizard step 2 helper) ─────────────────────────────────
router.post('/ai-copy', ...protect, async (req, res) => {
  const { campaignName, campaignType, orgName, goal } = req.body;
  if (!campaignName || !orgName) return res.status(400).json({ error: 'Missing required fields' });
  try {
    const [headline, subheadline, description, socialHashtag] = await Promise.all([
      callClaude('You write brilliant, short giving campaign headlines. No clichés.', `Write a campaign headline (10 words max) for "${campaignName}" at ${orgName}. Type: ${campaignType}. Goal: $${Number(goal||250000).toLocaleString()}.`, 60),
      callClaude('You write compelling giving campaign subheadlines.', `Write a one-sentence campaign subheadline for "${campaignName}" at ${orgName}. Warm, specific, urgent.`, 80),
      callClaude('You write giving campaign landing page descriptions.', `Write a 2-paragraph campaign description for "${campaignName}" at ${orgName}. Goal: $${Number(goal||250000).toLocaleString()}. Type: ${campaignType}. Be specific, warm, compelling.`, 300),
      callClaude('You create campaign hashtags.', `Suggest 3 hashtag options for "${campaignName}" at ${orgName}. Short, memorable, university-appropriate. Return as JSON array of strings.`, 60),
    ]);
    res.json({ headline, subheadline, description, socialHashtag });
  } catch(e) {
    res.status(500).json({ error: 'AICopyFailed', message: e.message });
  }
});

module.exports = router;
