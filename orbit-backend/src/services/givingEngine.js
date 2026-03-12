'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ORBIT GIVING ENGINE  v1.0
 *  "Giving as Its Own Entity"
 *
 *  This service powers BOTH the standalone giving platform AND the
 *  dashboard control panel. It is the single source of truth for:
 *
 *    CAMPAIGNS:     Day of Giving, Giving Months, Capital, Annual Fund
 *    FORMS:         Any ad-hoc giving form attached to any campaign or standalone
 *    LEADERBOARDS:  Class, team, fund, individual — real-time scoring
 *    CHALLENGES:    Matching challenges, unlock goals, challenge walls
 *    AMBASSADORS:   Volunteer/peer fundraiser management + coaching
 *    ANALYTICS:     Pre-event, real-time, post-event reporting
 *    SOCIAL PROOF:  Live gift stream, milestone notifications
 *
 *  Integration contracts:
 *    → Payments:    delegates to paymentGateway.js (all 6 gateways)
 *    → CRM:         writes back to Blackbaud/Salesforce/HubSpot via sync.js
 *    → AI:          calls claude-sonnet for push alerts, donor coaching
 *    → Predictive:  reads donor scores from predictiveEngine.js
 *    → Agents:      notifies VCO of campaign events
 *
 *  Public API (no auth, CORS-open, rate-limited):
 *    /api/v1/giving/campaign/:slug      → public campaign data
 *    /api/v1/giving/leaderboard/:slug   → live leaderboard
 *    /api/v1/giving/give                → process donation (tokenized)
 *    /api/v1/giving/challenges/:slug    → active challenges
 *    /api/v1/giving/stream/:slug        → SSE gift stream
 *
 *  Admin API (auth required):
 *    /api/v1/giving/campaigns           → CRUD campaigns
 *    /api/v1/giving/wizard              → setup wizard save
 *    /api/v1/giving/analytics/:id       → campaign analytics
 *    /api/v1/giving/alerts              → send push alerts
 *    /api/v1/giving/ambassadors/:id     → ambassador management
 * ═══════════════════════════════════════════════════════════════════════════
 */

const db     = require('../db');
const logger = require('../utils/logger');
const fetch  = require('node-fetch');

// ─── Campaign types and their behavior profiles ───────────────────────────────
const CAMPAIGN_TYPES = {
  giving_day: {
    label:        'Day of Giving',
    icon:          '🎯',
    duration:      '24h',
    features:      ['countdown', 'leaderboard', 'challenges', 'live_stream', 'ambassadors', 'hourly_alerts'],
    defaultGoal:   250000,
    defaultTabs:   ['overview', 'leaderboard', 'challenges', 'stream', 'give'],
    competesWith:  'GiveCampus, Bonterra, 4Good',
  },
  giving_month: {
    label:        'Giving Month',
    icon:          '📅',
    duration:      '30d',
    features:      ['leaderboard', 'challenges', 'milestones', 'ambassadors', 'weekly_digest'],
    defaultGoal:   500000,
    defaultTabs:   ['overview', 'leaderboard', 'milestones', 'give'],
  },
  annual_fund: {
    label:        'Annual Fund Campaign',
    icon:          '📊',
    duration:      '90d',
    features:      ['segmented_outreach', 'pledge_collection', 'matching', 'mid_campaign_alerts'],
    defaultGoal:   1000000,
    defaultTabs:   ['overview', 'give'],
  },
  capital_campaign: {
    label:        'Capital Campaign',
    icon:          '🏛️',
    duration:      'custom',
    features:      ['major_gift_tracking', 'naming_opportunities', 'pledge_schedule', 'leadership_gifts'],
    defaultGoal:   10000000,
    defaultTabs:   ['overview', 'leadership', 'give'],
  },
  peer_to_peer: {
    label:        'Peer-to-Peer',
    icon:          '🤝',
    duration:      '14d',
    features:      ['ambassador_pages', 'social_sharing', 'team_leaderboard', 'coaching_ai'],
    defaultGoal:   50000,
    defaultTabs:   ['overview', 'leaderboard', 'give'],
  },
  emergency: {
    label:        'Emergency/Crisis Appeal',
    icon:          '🆘',
    duration:      '7d',
    features:      ['urgency_counter', 'real_time_need_bar', 'crisis_messaging'],
    defaultGoal:   100000,
    defaultTabs:   ['overview', 'give'],
  },
};

// ─── Leaderboard category types ───────────────────────────────────────────────
const LEADERBOARD_TYPES = {
  class_year:   { label:'Class Year',    icon:'🎓', groupBy:'class_year',    metric:'gifts' },
  school:       { label:'School/College',icon:'🏫', groupBy:'school',        metric:'amount' },
  team:         { label:'Team',          icon:'👥', groupBy:'team_id',       metric:'gifts' },
  fund:         { label:'Fund',          icon:'💰', groupBy:'fund',          metric:'amount' },
  ambassador:   { label:'Ambassador',    icon:'⭐', groupBy:'ambassador_id', metric:'gifts' },
  geographic:   { label:'Geography',     icon:'🗺️', groupBy:'state',        metric:'donors' },
  reunion_class:{ label:'Reunion Class', icon:'🎉', groupBy:'reunion_year',  metric:'participation_rate' },
};

// ─── Challenge mechanics ──────────────────────────────────────────────────────
const CHALLENGE_TYPES = {
  matching:     { label:'Matching Gift',    desc:'Every gift matched dollar-for-dollar up to a cap',         icon:'💎' },
  unlock:       { label:'Unlock Challenge', desc:'Unlock a bonus gift when X donors give',                   icon:'🔓' },
  class_battle: { label:'Class Battle',     desc:'Classes compete — top class earns a bonus gift',           icon:'⚔️' },
  time_match:   { label:'Power Hour',       desc:'All gifts in a window get matched',                        icon:'⚡' },
  stretch:      { label:'Stretch Goal',     desc:'Bonus unlocked when total giving exceeds threshold',       icon:'🎯' },
  faculty:      { label:'Faculty Challenge',desc:'Faculty/staff challenge alumni to match their giving',     icon:'👩‍🏫' },
  board:        { label:'Board Challenge',  desc:'Board member funds matching for a specific period',        icon:'🏛️' },
  first_time:   { label:'First-Time Donor', desc:'Special match or bonus for first-time donors only',        icon:'🌟' },
  loyalty:      { label:'Loyalty Bonus',    desc:'Consecutive year donors get their gift matched at higher rate',icon:'🔥' },
};

// ─── Campaign CRUD ────────────────────────────────────────────────────────────
async function createCampaign(orgId, data) {
  const slug = generateSlug(data.name);
  
  const { rows } = await db.query(
    `INSERT INTO giving_campaigns (
       org_id, name, slug, type, status, goal, start_date, end_date,
       headline, subheadline, description, primary_color, secondary_color,
       logo_url, hero_image_url, video_url, funds, leaderboard_config,
       challenge_config, ambassador_config, social_config, form_config,
       created_by, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW(),NOW())
     RETURNING *`,
    [
      orgId, data.name, slug, data.type || 'giving_day',
      data.goal || 250000,
      data.startDate, data.endDate,
      data.headline || `${data.name} — Give Today`,
      data.subheadline || 'Every dollar makes a difference.',
      data.description || '',
      data.primaryColor || '#2a8c7e',
      data.secondaryColor || '#1a1d23',
      data.logoUrl || null,
      data.heroImageUrl || null,
      data.videoUrl || null,
      JSON.stringify(data.funds || [{ id: 'general', name: 'General Fund', goal: 0 }]),
      JSON.stringify(data.leaderboardConfig || { enabled: true, types: ['class_year', 'fund'] }),
      JSON.stringify(data.challengeConfig || { challenges: [] }),
      JSON.stringify(data.ambassadorConfig || { enabled: false, teams: [] }),
      JSON.stringify(data.socialConfig || { hashtag: '', twitterHandle: '', facebookPage: '' }),
      JSON.stringify(data.formConfig || { formIds: [], defaultFormId: null }),
      data.createdBy || orgId,
    ]
  );

  logger.info('Campaign created', { orgId, campaignId: rows[0].id, slug });
  return rows[0];
}

async function getCampaignBySlug(slug, orgId = null) {
  const whereClause = orgId ? 'slug = $1 AND org_id = $2' : 'slug = $1';
  const params      = orgId ? [slug, orgId] : [slug];
  
  const { rows } = await db.query(
    `SELECT c.*,
            o.name  as org_name,
            o.slug  as org_slug,
            o.gateway,
            o.gateway_config_public,
            (SELECT COUNT(*) FROM giving_gifts gg WHERE gg.campaign_id = c.id AND gg.status = 'completed') as gift_count,
            (SELECT COALESCE(SUM(gg.amount),0) FROM giving_gifts gg WHERE gg.campaign_id = c.id AND gg.status = 'completed') as total_raised,
            (SELECT COUNT(DISTINCT gg.donor_email) FROM giving_gifts gg WHERE gg.campaign_id = c.id AND gg.status = 'completed') as unique_donors
     FROM giving_campaigns c
     JOIN orgs o ON o.id = c.org_id
     WHERE ${whereClause}`,
    params
  );
  return rows[0] || null;
}

async function updateCampaign(campaignId, orgId, updates) {
  const allowed = ['name','headline','subheadline','description','goal','start_date','end_date',
                   'primary_color','secondary_color','logo_url','hero_image_url','video_url',
                   'funds','leaderboard_config','challenge_config','ambassador_config',
                   'social_config','form_config','status'];
  
  const sets  = [];
  const vals  = [campaignId, orgId];
  let   p     = 3;

  for (const [k, v] of Object.entries(updates)) {
    const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (!allowed.includes(col)) continue;
    const val = typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
    sets.push(`${col} = $${p++}`);
    vals.push(val);
  }

  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);

  const { rows } = await db.query(
    `UPDATE giving_campaigns SET ${sets.join(',')} WHERE id = $1 AND org_id = $2 RETURNING *`,
    vals
  );
  return rows[0];
}

// ─── Leaderboard engine ───────────────────────────────────────────────────────
async function getLeaderboard(campaignId, type = 'class_year', limit = 20) {
  const config = LEADERBOARD_TYPES[type];
  if (!config) throw new Error(`Unknown leaderboard type: ${type}`);

  const groupCol = config.groupBy === 'team_id' ? 'gg.team_id' 
    : config.groupBy === 'ambassador_id' ? 'gg.ambassador_id'
    : `gg.donor_${config.groupBy}`;

  try {
    const { rows } = await db.query(
      `SELECT
         ${groupCol}               AS group_key,
         COUNT(*)                  AS gift_count,
         COUNT(DISTINCT donor_email) AS donor_count,
         COALESCE(SUM(amount), 0)  AS total_raised,
         ROUND(COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER(), 0) * 100, 1) AS participation_pct
       FROM giving_gifts gg
       WHERE gg.campaign_id = $1 AND gg.status = 'completed'
         AND ${groupCol} IS NOT NULL
       GROUP BY ${groupCol}
       ORDER BY ${config.metric === 'gifts' ? 'gift_count' : config.metric === 'amount' ? 'total_raised' : 'participation_pct'} DESC
       LIMIT $2`,
      [campaignId, limit]
    );
    return { type, config, entries: rows, updatedAt: new Date().toISOString() };
  } catch(e) {
    // Fallback: return demo data structure if DB columns don't exist yet
    logger.warn('Leaderboard query failed, using estimated data', { err: e.message });
    return { type, config, entries: [], updatedAt: new Date().toISOString() };
  }
}

// ─── Challenge engine ─────────────────────────────────────────────────────────
async function evaluateChallenges(campaignId) {
  const { rows: campaign } = await db.query(
    `SELECT challenge_config, total_raised FROM giving_campaigns WHERE id = $1`,
    [campaignId]
  );
  if (!campaign.length) return [];

  const config     = campaign[0].challenge_config;
  const challenges = Array.isArray(config?.challenges) ? config.challenges : [];
  const results    = [];

  for (const challenge of challenges) {
    const { rows: stats } = await db.query(
      `SELECT COUNT(*) as gift_count, COALESCE(SUM(amount),0) as raised
       FROM giving_gifts
       WHERE campaign_id = $1
         AND status = 'completed'
         AND ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)
         AND ($3::timestamptz IS NULL OR created_at <= $3::timestamptz)`,
      [campaignId, challenge.startTime || null, challenge.endTime || null]
    );

    const giftCount = parseInt(stats[0]?.gift_count || 0);
    const raised    = parseFloat(stats[0]?.raised || 0);

    let triggered = false;
    let progress  = 0;

    if (challenge.type === 'unlock') {
      progress  = Math.min(100, (giftCount / challenge.threshold) * 100);
      triggered = giftCount >= challenge.threshold;
    } else if (challenge.type === 'matching' || challenge.type === 'time_match') {
      const matchedSoFar = Math.min(challenge.cap, raised);
      progress           = Math.min(100, (matchedSoFar / challenge.cap) * 100);
      triggered          = matchedSoFar >= challenge.cap;
    } else if (challenge.type === 'stretch') {
      progress  = Math.min(100, (raised / challenge.threshold) * 100);
      triggered = raised >= challenge.threshold;
    }

    results.push({
      ...challenge,
      progress:       Math.round(progress),
      triggered,
      currentStats:   { giftCount, raised },
    });

    // Auto-fire webhook/notification if newly triggered
    if (triggered && !challenge.notifiedAt) {
      await db.query(
        `UPDATE giving_campaigns
         SET challenge_config = jsonb_set(
           challenge_config,
           '{challenges}',
           (SELECT jsonb_agg(
             CASE WHEN elem->>'id' = $2 THEN elem || '{"notifiedAt":"${new Date().toISOString()}"}'
             ELSE elem END
           ) FROM jsonb_array_elements(challenge_config->'challenges') elem)
         )
         WHERE id = $1`,
        [campaignId, challenge.id]
      );
      logger.info('Challenge triggered', { campaignId, challengeId: challenge.id, type: challenge.type });
    }
  }

  return results;
}

// ─── Gift processing (delegates to paymentGateway) ───────────────────────────
async function processPublicGift(campaignSlug, giftData) {
  const campaign = await getCampaignBySlug(campaignSlug);
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.status !== 'live') throw new Error('Campaign is not active');

  const { GatewayRouter } = require('./paymentGateway');
  const adapter = GatewayRouter.getAdapter({
    gateway:       campaign.gateway,
    gatewayConfig: campaign.gateway_config_public || {},
  });

  // Charge the tokenized payment
  const result = await adapter.chargeToken(
    giftData.token,
    giftData.amount,
    giftData.currency || 'USD',
    {
      orgId:       campaign.org_id,
      fund:        giftData.fund,
      giftType:    giftData.isRecurring ? 'recurring' : 'one_time',
      description: `${campaign.name} — ${giftData.fund || 'General Fund'}`,
    }
  );

  if (!result.success) return result;

  // Record in giving_gifts
  const { rows } = await db.query(
    `INSERT INTO giving_gifts (
       campaign_id, org_id, donor_name, donor_email, donor_class_year,
       donor_phone, amount, fund, designation, is_anonymous,
       is_recurring, frequency, tribute_type, tribute_name,
       tribute_notify_email, gateway, transaction_id, status,
       ambassador_id, team_id, matching_eligible, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'completed',$18,$19,$20,NOW())
     RETURNING id`,
    [
      campaign.id, campaign.org_id,
      giftData.isAnonymous ? 'Anonymous' : `${giftData.firstName} ${giftData.lastName}`,
      giftData.email,
      giftData.classYear || null,
      giftData.phone || null,
      parseFloat(giftData.amount),
      giftData.fund || 'General Fund',
      giftData.designation || null,
      giftData.isAnonymous || false,
      giftData.isRecurring || false,
      giftData.frequency || null,
      giftData.tributeType || null,
      giftData.tributeName || null,
      giftData.tributeNotifyEmail || null,
      campaign.gateway,
      result.transactionId,
      giftData.ambassadorId || null,
      giftData.teamId || null,
      giftData.matchingEligible || true,
    ]
  );

  const giftId = rows[0].id;

  // Trigger challenge evaluation (async, don't block response)
  evaluateChallenges(campaign.id).catch(e =>
    logger.error('Challenge eval failed post-gift', { err: e.message })
  );

  // Notify agents (async)
  notifyAgents(campaign, giftData, result).catch(() => {});

  return { ...result, giftId, campaignId: campaign.id };
}

async function notifyAgents(campaign, giftData, paymentResult) {
  // Write to agent activity stream
  await db.query(
    `INSERT INTO agent_activities (org_id, agent, action, resource_type, resource_id, detail, created_at)
     VALUES ($1,'VCO','gift_received','campaign',$2,$3,NOW())`,
    [
      campaign.org_id,
      campaign.id,
      JSON.stringify({
        amount: giftData.amount,
        fund: giftData.fund,
        transactionId: paymentResult.transactionId,
        campaignName: campaign.name,
      }),
    ]
  ).catch(() => {});
}

// ─── Real-time SSE gift stream ────────────────────────────────────────────────
const sseClients = new Map(); // campaignId → Set of response objects

function addSSEClient(campaignId, res) {
  if (!sseClients.has(campaignId)) sseClients.set(campaignId, new Set());
  sseClients.get(campaignId).add(res);
  logger.info('SSE client connected', { campaignId, total: sseClients.get(campaignId).size });
}

function removeSSEClient(campaignId, res) {
  sseClients.get(campaignId)?.delete(res);
}

function broadcastToStream(campaignId, eventType, data) {
  const clients = sseClients.get(campaignId);
  if (!clients?.size) return;

  const msg = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch(e) { clients.delete(res); }
  }
}

// ─── Post-event analytics ─────────────────────────────────────────────────────
async function getCampaignAnalytics(campaignId, orgId) {
  const queries = await Promise.all([
    // Hourly breakdown
    db.query(
      `SELECT
         DATE_TRUNC('hour', created_at)   AS hour,
         COUNT(*)                          AS gifts,
         COALESCE(SUM(amount), 0)          AS raised
       FROM giving_gifts
       WHERE campaign_id=$1 AND org_id=$2 AND status='completed'
       GROUP BY 1 ORDER BY 1`,
      [campaignId, orgId]
    ),
    // By fund
    db.query(
      `SELECT fund, COUNT(*) as gifts, COALESCE(SUM(amount),0) as raised,
              ROUND(AVG(amount),2) as avg_gift
       FROM giving_gifts
       WHERE campaign_id=$1 AND org_id=$2 AND status='completed'
       GROUP BY fund ORDER BY raised DESC`,
      [campaignId, orgId]
    ),
    // By class year
    db.query(
      `SELECT donor_class_year as class_year, COUNT(*) as gifts, COALESCE(SUM(amount),0) as raised
       FROM giving_gifts
       WHERE campaign_id=$1 AND org_id=$2 AND status='completed' AND donor_class_year IS NOT NULL
       GROUP BY 1 ORDER BY raised DESC LIMIT 20`,
      [campaignId, orgId]
    ),
    // Gift size distribution
    db.query(
      `SELECT
         CASE WHEN amount < 25 THEN 'Under $25'
              WHEN amount < 100 THEN '$25–$99'
              WHEN amount < 250 THEN '$100–$249'
              WHEN amount < 1000 THEN '$250–$999'
              WHEN amount < 5000 THEN '$1K–$4.9K'
              ELSE '$5K+' END AS tier,
         COUNT(*) as gifts, COALESCE(SUM(amount),0) as raised
       FROM giving_gifts
       WHERE campaign_id=$1 AND org_id=$2 AND status='completed'
       GROUP BY 1 ORDER BY MIN(amount)`,
      [campaignId, orgId]
    ),
    // Top metrics
    db.query(
      `SELECT
         COUNT(*)                                 AS total_gifts,
         COALESCE(SUM(amount),0)                  AS total_raised,
         COUNT(DISTINCT donor_email)              AS unique_donors,
         ROUND(AVG(amount),2)                     AS avg_gift,
         MAX(amount)                              AS largest_gift,
         COUNT(*) FILTER(WHERE is_recurring)      AS recurring_setups,
         COUNT(*) FILTER(WHERE is_anonymous)      AS anonymous_gifts,
         COUNT(*) FILTER(WHERE matching_eligible) AS matching_eligible
       FROM giving_gifts
       WHERE campaign_id=$1 AND org_id=$2 AND status='completed'`,
      [campaignId, orgId]
    ),
  ]);

  return {
    campaignId,
    hourly:     queries[0].rows,
    byFund:     queries[1].rows,
    byClass:    queries[2].rows,
    giftTiers:  queries[3].rows,
    summary:    queries[4].rows[0],
    generatedAt:new Date().toISOString(),
  };
}

// ─── AI-powered push alert generator ─────────────────────────────────────────
async function generatePushAlert(campaignId, orgId, alertType, customContext = {}) {
  const campaign = await db.query(
    `SELECT c.*, 
            (SELECT COALESCE(SUM(amount),0) FROM giving_gifts WHERE campaign_id=c.id AND status='completed') AS raised,
            (SELECT COUNT(*) FROM giving_gifts WHERE campaign_id=c.id AND status='completed') AS gift_count
     FROM giving_campaigns c WHERE c.id=$1 AND c.org_id=$2`,
    [campaignId, orgId]
  );
  if (!campaign.rows.length) throw new Error('Campaign not found');
  const c = campaign.rows[0];

  const raised    = parseFloat(c.raised || 0);
  const giftCount = parseInt(c.gift_count || 0);
  const pct       = Math.min(100, Math.round((raised / c.goal) * 100));

  const { callClaude } = require('./ai');
  const sys = `You are the VCO (Virtual Campaign Officer) for ${c.org_id} running ${c.name}. Write short, urgent, authentic fundraising push messages. Never corporate. Real numbers. Creates urgency without panic.`;

  const contexts = {
    email:     `Write a 2-sentence email subject + preview for a ${alertType} campaign alert. Current: $${raised.toLocaleString()} / $${c.goal.toLocaleString()} goal, ${giftCount} gifts, ${pct}% complete.`,
    sms:       `Write a 160-char SMS alert for ${alertType}. Current: $${raised.toLocaleString()} raised, ${giftCount} gifts, ${pct}% to goal. No hashtags.`,
    social:    `Write a tweet (280 chars) for ${alertType}. $${raised.toLocaleString()} raised. ${giftCount} donors. Campaign: ${c.name}.`,
    push_notif:`Write a push notification (title: 10 words max, body: 20 words max) for ${alertType}.`,
  };

  const results = {};
  const channels = Object.keys(contexts);

  await Promise.allSettled(
    channels.map(async ch => {
      try {
        results[ch] = await callClaude(sys, contexts[ch] + (customContext.extra || ''), 200);
      } catch(e) {
        results[ch] = null;
      }
    })
  );

  return { alertType, campaign: c.name, raised, giftCount, pct, alerts: results };
}

// ─── Wizard: save complete campaign setup ────────────────────────────────────
async function saveWizardCampaign(orgId, wizardData) {
  const existing = await db.query(
    'SELECT id FROM giving_campaigns WHERE org_id=$1 AND slug=$2',
    [orgId, generateSlug(wizardData.name)]
  );

  if (existing.rows.length) {
    return updateCampaign(existing.rows[0].id, orgId, wizardData);
  }
  return createCampaign(orgId, wizardData);
}

// ─── Ambassador management ────────────────────────────────────────────────────
async function getAmbassadors(campaignId, orgId) {
  const { rows } = await db.query(
    `SELECT a.*,
            COUNT(gg.id)            AS gifts_driven,
            COALESCE(SUM(gg.amount),0) AS raised
     FROM campaign_ambassadors a
     LEFT JOIN giving_gifts gg ON gg.campaign_id=a.campaign_id AND gg.ambassador_id=a.id AND gg.status='completed'
     WHERE a.campaign_id=$1 AND a.org_id=$2
     GROUP BY a.id
     ORDER BY raised DESC`,
    [campaignId, orgId]
  );
  return rows;
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

module.exports = {
  CAMPAIGN_TYPES,
  LEADERBOARD_TYPES,
  CHALLENGE_TYPES,
  createCampaign,
  getCampaignBySlug,
  updateCampaign,
  getLeaderboard,
  evaluateChallenges,
  processPublicGift,
  getCampaignAnalytics,
  generatePushAlert,
  saveWizardCampaign,
  getAmbassadors,
  addSSEClient,
  removeSSEClient,
  broadcastToStream,
  generateSlug,
};
