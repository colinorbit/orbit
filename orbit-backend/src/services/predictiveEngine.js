'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ORBIT PREDICTIVE CONTACT ENGINE  v1.0
 *  "The Brains"
 *
 *  Designed by: Orbit Architecture + Senior Product Design + Fundraising Ops
 *
 *  PURPOSE:
 *    Determine the RIGHT donor to contact, via the RIGHT channel,
 *    at the RIGHT moment, with the RIGHT message — autonomously.
 *
 *  SCORING MODEL (top-down, executive-aligned):
 *
 *  CONTACT READINESS SCORE (0–100) = weighted composite of:
 *
 *  LAYER 1 — CAPACITY SIGNALS (who CAN give big)        [weight: 25%]
 *    • Wealth screening score (iWave / WealthEngine / DG)
 *    • SEC insider sale / liquidity event
 *    • Property transaction (purchase > $1M)
 *    • Business Wire: IPO, M&A, funding round
 *    • Career promotion (LinkedIn)
 *
 *  LAYER 2 — PROPENSITY SIGNALS (who WANTS to give)     [weight: 25%]
 *    • Historical giving frequency (RFM: Recency/Frequency/Monetary)
 *    • Cause alignment (social listening, stated interests)
 *    • Peer giving (network of alumni donors)
 *    • Event attendance streak
 *    • Email engagement trend (last 90 days)
 *
 *  LAYER 3 — TIMING SIGNALS (who is ready NOW)          [weight: 30%]
 *    • Days since last contact (vs. stage-appropriate cadence)
 *    • Email open velocity (opened 2x in 48h = hot)
 *    • Recent web activity (giving page visit)
 *    • Signal freshness (career change this week > this month)
 *    • Fiscal / academic calendar proximity (year-end, reunion season)
 *    • Personal timing (birthday -30 days, anniversary, graduation)
 *
 *  LAYER 4 — RELATIONSHIP HEALTH (who won't say no immediately) [weight: 20%]
 *    • Sentiment trend (rising/stable/declining)
 *    • Days since last gift (recency decay)
 *    • Response rate history
 *    • Stage-appropriate contact (don't over-ask stewarded donors)
 *    • Do-not-contact / opt-out status
 *
 *  LAYER 5 — INSTITUTIONAL PRIORITY (what leadership wants) [weight: 10%]
 *    • Campaign priority flag (set by director)
 *    • Named prospect assignment
 *    • Board connection flag
 *    • Legacy/VPGO pipeline flag
 *
 *  OUTPUT:
 *    contactReadinessScore   0–100
 *    contactUrgency          immediate | this_week | this_month | hold
 *    recommendedChannel      email | phone | sms | handwritten | in_person
 *    recommendedTiming       best_window (day + hour)
 *    triggerReason           primary reason for surfacing now
 *    suppressReason          why NOT to contact (if applicable)
 *    agentAssignment         VEO | VSO | VPGO | VCO
 *    askReadiness            not_ready | cultivate | soft_ask | hard_ask
 *    estimatedAskAmount      dollar amount based on capacity + history
 *    confidence              0.0–1.0
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');
const ai     = require('./ai');

// ─── SCORING WEIGHTS ──────────────────────────────────────────────────────────
const WEIGHTS = {
  capacity:     0.25,
  propensity:   0.25,
  timing:       0.30,
  relationship: 0.20,
  institutional: 0.10,   // applied as bonus multiplier
};

// ─── STAGE CADENCE (days between contacts) ───────────────────────────────────
const STAGE_CADENCE = {
  prospect:   21,   // 3 weeks — still warming
  engaged:    14,   // 2 weeks — actively cultivating
  solicited:  7,    // 1 week — in ask conversation
  committed:  30,   // monthly stewardship
  stewarded:  45,   // quarterly touch
  lapsed:     60,   // recovery campaign spacing
};

// ─── SIGNAL WEIGHTS (how much each signal type boosts score) ─────────────────
const SIGNAL_BOOST = {
  WEALTH:  { immediate: 25, week: 15, month: 8,  stale: 2  },
  CAREER:  { immediate: 18, week: 12, month: 6,  stale: 1  },
  LIFE:    { immediate: 12, week: 8,  month: 4,  stale: 1  },
  CAUSE:   { immediate: 10, week: 7,  month: 3,  stale: 1  },
  NETWORK: { immediate: 6,  week: 4,  month: 2,  stale: 0  },
  RISK:    { immediate: -20, week: -15, month: -8, stale: -3 },
  EMAIL_OPEN:   8,   // opened email in last 48h
  WEB_VISIT:    6,   // visited giving page
  EVENT_ATTEND: 10,  // attended event in last 30 days
};

// ─── CHANNEL SCORING ─────────────────────────────────────────────────────────
const CHANNEL_RULES = {
  email: {
    conditions: ['preferred_channel=email', 'email_opt_out=false'],
    bestFor: ['prospect', 'engaged', 'solicited', 'lapsed'],
    bestWindows: { Mon:[[9,11]], Tue:[[9,11],[14,16]], Wed:[[9,11]], Thu:[[9,11],[14,16]], Fri:[[9,10]] },
  },
  phone: {
    conditions: ['has_phone', 'stage in [solicited, committed]'],
    bestFor: ['solicited', 'committed', 'major_gift'],
    bestWindows: { Tue:[[9,11],[14,16]], Wed:[[14,16]], Thu:[[9,11],[14,16]] },
  },
  sms: {
    conditions: ['sms_opt_in=true', 'stage in [engaged, stewarded]'],
    bestFor: ['engaged', 'stewarded', 'giving_day'],
    bestWindows: { Mon:[[8,9]], Tue:[[8,9]], Wed:[[8,9]], Thu:[[8,9]], Fri:[[8,9]] },
  },
  handwritten: {
    conditions: ['lifetime_giving > 5000 OR stage in [committed, stewarded, solicited]'],
    bestFor: ['committed', 'stewarded', 'major_gift', 'post_gift'],
    bestWindows: null,  // physical mail — no time window
  },
  in_person: {
    conditions: ['stage=committed OR propensity>=85'],
    bestFor: ['committed', 'major_gift'],
    bestWindows: null,  // calendar coordination required
  },
};

// ─── FISCAL CALENDAR BOOSTS ───────────────────────────────────────────────────
function getFiscalBoost(now = new Date()) {
  const month = now.getMonth() + 1; // 1–12
  const day   = now.getDate();
  // Year-end giving season (Nov–Dec): +15
  if (month === 11 || month === 12) return { boost: 15, reason: 'Year-end giving season' };
  // Giving Tuesday (first Tue of Nov): +20
  if (month === 11 && day <= 7) return { boost: 20, reason: 'Giving Tuesday proximity' };
  // Spring giving push (Mar–Apr): +8
  if (month === 3 || month === 4) return { boost: 8, reason: 'Spring giving season' };
  // Reunion season (May–Jun): +10 for alumni
  if (month === 5 || month === 6) return { boost: 10, reason: 'Reunion season' };
  // Summer slump (Jul–Aug): -5
  if (month === 7 || month === 8) return { boost: -5, reason: 'Summer giving slump' };
  return { boost: 0, reason: null };
}

// ─── RECENCY DECAY FUNCTION ───────────────────────────────────────────────────
// Returns 0–1.0 where 1.0 = contacted recently (good for stewardship)
// and 0.0 = never/very long ago (urgent for lapsed recovery)
function recencyDecay(daysSinceContact, stage) {
  const cadence = STAGE_CADENCE[stage] || 30;
  const ratio   = daysSinceContact / cadence;
  // Optimal: ratio = 0.8–1.2 (right on cadence)
  // Under-contacted: ratio > 1.5 = score drops
  // Over-contacted: ratio < 0.4 = suppress
  if (ratio < 0.4) return -15; // too soon — suppress
  if (ratio < 0.8) return 5;
  if (ratio < 1.2) return 15;  // on cadence — boost
  if (ratio < 2.0) return 8;   // slightly overdue — still ok
  if (ratio < 3.0) return 0;   // quite overdue
  return -5;                   // very overdue — risk of going cold
}

// ─── SIGNAL FRESHNESS ─────────────────────────────────────────────────────────
function getSignalFreshness(signalCreatedAt) {
  const hoursAgo = (Date.now() - new Date(signalCreatedAt).getTime()) / 3600000;
  if (hoursAgo < 24)  return 'immediate';
  if (hoursAgo < 168) return 'week';     // 7 days
  if (hoursAgo < 720) return 'month';    // 30 days
  return 'stale';
}

// ─── MAIN SCORING FUNCTION ────────────────────────────────────────────────────
/**
 * scoreDonorContactReadiness
 * @param {Object} donor         — full donor record from DB
 * @param {Array}  signals       — recent signals for this donor
 * @param {Object} orgConfig     — org-level config (fiscal year, priorities)
 * @param {Date}   now           — injectable for testing
 * @returns {Object}             — full contact readiness assessment
 */
function scoreDonorContactReadiness(donor, signals = [], orgConfig = {}, now = new Date()) {

  // ── Guard: hard suppression ──────────────────────────────────────────────
  if (donor.do_not_contact) {
    return buildSuppressedResult(donor, 'do_not_contact', 'Donor has DNC flag');
  }
  if (donor.email_opt_out && !donor.phone && !donor.sms_opt_in) {
    return buildSuppressedResult(donor, 'no_channel', 'No contactable channel');
  }

  // ── Layer 1: Capacity ────────────────────────────────────────────────────
  let capacityScore = 0;
  const wealthScore   = donor.wealth_score       || 0;  // 0–100 from iWave/DG
  const capacityRating = donor.capacity_rating   || 0;  // dollar tier
  capacityScore += (wealthScore / 100) * 60;            // up to 60 pts
  capacityScore += Math.min(capacityRating / 10, 30);   // up to 30 pts from capacity tier

  // Signal-based capacity boosts
  const wealthSignals = signals.filter(s => s.type === 'WEALTH' || s.type === 'CAREER');
  for (const sig of wealthSignals) {
    const freshness = getSignalFreshness(sig.created_at || sig.time);
    capacityScore  += SIGNAL_BOOST.WEALTH[freshness] || 0;
  }
  capacityScore = Math.min(capacityScore, 100);

  // ── Layer 2: Propensity ──────────────────────────────────────────────────
  let propensityScore = donor.propensity_score || 50;

  // Giving frequency boost (RFM)
  const giftCount = donor.total_gifts || 0;
  const rfmBoost  = Math.min(giftCount * 2, 20); // up to 20 pts for repeat giving
  propensityScore += rfmBoost;

  // Cause alignment signals
  const causeSignals = signals.filter(s => s.type === 'CAUSE');
  for (const sig of causeSignals) {
    const freshness = getSignalFreshness(sig.created_at || sig.time);
    propensityScore += SIGNAL_BOOST.CAUSE[freshness] || 0;
  }

  // Event attendance boost
  const eventSignals = signals.filter(s => s.type === 'LIFE' && s.source === 'events');
  if (eventSignals.length > 0) propensityScore += SIGNAL_BOOST.EVENT_ATTEND;

  propensityScore = Math.min(propensityScore, 100);

  // ── Layer 3: Timing ──────────────────────────────────────────────────────
  let timingScore = 50; // baseline

  // Days since last contact
  const lastContact = donor.last_contact_at ? new Date(donor.last_contact_at) : null;
  const daysSinceContact = lastContact
    ? Math.floor((now - lastContact) / 86400000)
    : 999;
  const cadenceScore = recencyDecay(daysSinceContact, donor.stage);
  timingScore += cadenceScore;

  // Email engagement velocity
  if (donor.recent_email_opens >= 2) timingScore += SIGNAL_BOOST.EMAIL_OPEN;  // opened 2x in 48h
  if (donor.recent_web_visit)        timingScore += SIGNAL_BOOST.WEB_VISIT;

  // Fiscal calendar
  const fiscal = getFiscalBoost(now);
  timingScore += fiscal.boost;

  // Signal freshness premium
  const freshSignals = signals.filter(s => getSignalFreshness(s.created_at || s.time) === 'immediate');
  timingScore += freshSignals.length * 8;

  // Personal timing (birthday)
  if (donor.birthday) {
    const bday     = new Date(donor.birthday);
    const nextBday = new Date(now.getFullYear(), bday.getMonth(), bday.getDate());
    if (nextBday < now) nextBday.setFullYear(now.getFullYear() + 1);
    const daysUntilBday = Math.floor((nextBday - now) / 86400000);
    if (daysUntilBday <= 7)  timingScore += 15;
    if (daysUntilBday <= 30) timingScore += 8;
  }

  timingScore = Math.min(timingScore, 100);

  // ── Layer 4: Relationship Health ─────────────────────────────────────────
  let relationshipScore = 60; // baseline

  // Sentiment trend
  const sentimentDelta = { rising: 20, stable: 5, declining: -15, unknown: 0 };
  relationshipScore += sentimentDelta[donor.sentiment_trend] || 0;

  // Response rate (are they engaging with our outreach?)
  const responseRate = donor.response_rate || 0.5;
  relationshipScore += (responseRate - 0.5) * 30; // ±15 based on response rate

  // Risk signals
  const riskSignals = signals.filter(s => s.type === 'RISK');
  for (const sig of riskSignals) {
    const freshness = getSignalFreshness(sig.created_at || sig.time);
    relationshipScore += SIGNAL_BOOST.RISK[freshness] || 0;
  }

  // Lapsed penalty (hasn't given in > 24 months)
  if (donor.last_gift_date) {
    const monthsSinceGift = (now - new Date(donor.last_gift_date)) / (30 * 86400000);
    if (monthsSinceGift > 36) relationshipScore -= 20;
    else if (monthsSinceGift > 24) relationshipScore -= 10;
  }

  relationshipScore = Math.max(0, Math.min(relationshipScore, 100));

  // ── Layer 5: Institutional Priority ──────────────────────────────────────
  let institutionalBonus = 0;
  if (donor.campaign_priority)   institutionalBonus += 15;
  if (donor.named_prospect)      institutionalBonus += 10;
  if (donor.board_connection)    institutionalBonus += 8;
  if (donor.legacy_flag)         institutionalBonus += 12;
  if (donor.major_gift_prospect) institutionalBonus += 10;

  // ── Composite Score ───────────────────────────────────────────────────────
  const raw =
    capacityScore     * WEIGHTS.capacity     +
    propensityScore   * WEIGHTS.propensity   +
    timingScore       * WEIGHTS.timing       +
    relationshipScore * WEIGHTS.relationship;

  // Institutional priority is a bonus on top (not capped)
  const contactReadinessScore = Math.round(Math.min(raw + (institutionalBonus * WEIGHTS.institutional), 100));

  // ── Contact Urgency ───────────────────────────────────────────────────────
  let contactUrgency;
  if (contactReadinessScore >= 80)      contactUrgency = 'immediate';   // contact today
  else if (contactReadinessScore >= 65) contactUrgency = 'this_week';
  else if (contactReadinessScore >= 45) contactUrgency = 'this_month';
  else                                  contactUrgency = 'hold';

  // ── Channel Recommendation ────────────────────────────────────────────────
  const recommendedChannel = pickBestChannel(donor, contactReadinessScore);

  // ── Best Time Window ─────────────────────────────────────────────────────
  const bestWindow = getBestContactWindow(donor, recommendedChannel, now);

  // ── Ask Readiness ────────────────────────────────────────────────────────
  let askReadiness;
  if (['prospect', 'engaged'].includes(donor.stage) && propensityScore < 65)
    askReadiness = 'cultivate';
  else if (propensityScore >= 65 && contactReadinessScore >= 60)
    askReadiness = 'soft_ask';
  else if (propensityScore >= 80 && contactReadinessScore >= 75)
    askReadiness = 'hard_ask';
  else
    askReadiness = 'not_ready';

  // ── Ask Amount ────────────────────────────────────────────────────────────
  const estimatedAskAmount = computeAskAmount(donor);

  // ── Trigger Reason ────────────────────────────────────────────────────────
  const triggerReasons = buildTriggerReasons(donor, signals, fiscal, daysSinceContact, freshSignals);

  // ── Agent Assignment ─────────────────────────────────────────────────────
  const agentAssignment = pickAgent(donor, askReadiness);

  // ── Confidence ────────────────────────────────────────────────────────────
  const dataCompleteness = computeDataCompleteness(donor);
  const signalConfidence = Math.min(signals.length * 0.1, 0.4);
  const confidence       = Math.min(0.4 + dataCompleteness * 0.4 + signalConfidence, 1.0);

  return {
    donorId:               donor.id,
    donorName:             donor.name,
    contactReadinessScore,
    contactUrgency,
    recommendedChannel,
    bestWindow,
    agentAssignment,
    askReadiness,
    estimatedAskAmount,
    triggerReasons,
    suppressReason:        null,
    scoreBreakdown: {
      capacity:      Math.round(capacityScore),
      propensity:    Math.round(propensityScore),
      timing:        Math.round(timingScore),
      relationship:  Math.round(relationshipScore),
      institutional: institutionalBonus,
    },
    signalsApplied:   signals.length,
    fiscalContext:    fiscal.reason,
    confidence:       Math.round(confidence * 100) / 100,
    computedAt:       now.toISOString(),
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function buildSuppressedResult(donor, code, reason) {
  return {
    donorId:               donor.id,
    donorName:             donor.name,
    contactReadinessScore: 0,
    contactUrgency:        'hold',
    recommendedChannel:    null,
    bestWindow:            null,
    agentAssignment:       donor.assigned_agent || 'VEO',
    askReadiness:          'not_ready',
    estimatedAskAmount:    0,
    triggerReasons:        [],
    suppressReason:        { code, reason },
    scoreBreakdown:        { capacity:0, propensity:0, timing:0, relationship:0, institutional:0 },
    signalsApplied:        0,
    fiscalContext:         null,
    confidence:            0,
    computedAt:            new Date().toISOString(),
  };
}

function pickBestChannel(donor, score) {
  if (donor.email_opt_out) {
    if (donor.phone) return 'phone';
    if (donor.sms_opt_in) return 'sms';
    return 'handwritten';
  }
  if (score >= 85 && donor.phone && ['solicited','committed'].includes(donor.stage))
    return 'phone';
  if (donor.lifetime_giving >= 25000 && score >= 75)
    return 'phone';
  if (donor.preferred_channel === 'SMS' && donor.sms_opt_in)
    return 'sms';
  if (['committed','stewarded'].includes(donor.stage) && score >= 70)
    return 'handwritten';
  return 'email';
}

function getBestContactWindow(donor, channel, now) {
  // Respect donor's stated preferred time
  if (donor.preferred_contact_time) return donor.preferred_contact_time;
  if (channel === 'handwritten') return null;
  if (channel === 'in_person') return null;

  // Default best windows by channel
  const windows = {
    email:  'Tue or Thu, 9–11am (local time)',
    phone:  'Tue or Thu, 10am–12pm (local time)',
    sms:    'Weekday, 8–9am',
  };
  return windows[channel] || 'Weekday mornings';
}

function computeAskAmount(donor) {
  const lifetime = donor.lifetime_giving || 0;
  const lastGift = donor.last_gift_amount || 0;
  const capacity = donor.capacity_rating || 0;

  // Upgrade ask: 1.3–2x last gift, capped by capacity estimate
  if (lastGift > 0) {
    const upgrade = Math.round(lastGift * 1.5 / 500) * 500; // round to nearest $500
    return Math.min(upgrade, capacity || upgrade * 3);
  }
  if (lifetime > 0) {
    const annualAvg = lifetime / Math.max(donor.giving_years || 3, 1);
    return Math.round(annualAvg * 1.2 / 250) * 250;
  }
  return 1000; // default first ask
}

function buildTriggerReasons(donor, signals, fiscal, daysSinceContact, freshSignals) {
  const reasons = [];

  if (freshSignals.length > 0) {
    const sig = freshSignals[0];
    reasons.push({ type: 'signal', priority: 'high', text: sig.headline || `New ${sig.type} signal detected` });
  }

  if (fiscal.reason) {
    reasons.push({ type: 'calendar', priority: 'medium', text: fiscal.reason });
  }

  const cadence = STAGE_CADENCE[donor.stage] || 30;
  if (daysSinceContact > cadence) {
    reasons.push({ type: 'cadence', priority: 'medium', text: `${daysSinceContact} days since last contact (cadence: ${cadence} days)` });
  }

  if (donor.recent_email_opens >= 2) {
    reasons.push({ type: 'behavior', priority: 'high', text: 'Opened 2+ emails in last 48 hours — high engagement window' });
  }

  if (donor.recent_web_visit) {
    reasons.push({ type: 'behavior', priority: 'high', text: 'Visited giving page in last 7 days' });
  }

  if (['committed','solicited'].includes(donor.stage) && donor.sentiment_trend === 'rising') {
    reasons.push({ type: 'sentiment', priority: 'medium', text: 'Sentiment trending positive — good moment to advance' });
  }

  return reasons;
}

function pickAgent(donor, askReadiness) {
  if (donor.assigned_agent) return donor.assigned_agent;
  if (donor.legacy_flag || donor.stage === 'committed')   return 'VPGO';
  if (['hard_ask','soft_ask'].includes(askReadiness))     return 'VEO';
  if (donor.stage === 'stewarded')                        return 'VSO';
  return 'VEO';
}

function computeDataCompleteness(donor) {
  const fields = ['email','phone','stage','lifetime_giving','last_gift_date',
                  'propensity_score','engagement_score','sentiment_trend',
                  'interests','preferred_channel','wealth_score'];
  const filled = fields.filter(f => donor[f] != null && donor[f] !== '').length;
  return filled / fields.length;
}

// ─── BATCH SCORING ───────────────────────────────────────────────────────────
/**
 * scorePortfolio
 * Score all donors in a portfolio and return priority-ranked queue.
 * Called by the daily scheduler and on-demand from agent routes.
 */
async function scorePortfolio(donors, signalsByDonor = {}, orgConfig = {}) {
  const results = donors.map(donor =>
    scoreDonorContactReadiness(donor, signalsByDonor[donor.id] || [], orgConfig)
  );

  // Sort: immediate > this_week > this_month > hold, then by score desc
  const urgencyOrder = { immediate: 0, this_week: 1, this_month: 2, hold: 3 };
  results.sort((a, b) => {
    const urgencyDiff = (urgencyOrder[a.contactUrgency] || 3) - (urgencyOrder[b.contactUrgency] || 3);
    if (urgencyDiff !== 0) return urgencyDiff;
    return b.contactReadinessScore - a.contactReadinessScore;
  });

  // Tag top 10% as "Priority Queue" for agent console
  const topN = Math.ceil(results.length * 0.1);
  results.slice(0, topN).forEach(r => { r.priorityQueue = true; });

  return {
    scored:    results.length,
    immediate: results.filter(r => r.contactUrgency === 'immediate').length,
    thisWeek:  results.filter(r => r.contactUrgency === 'this_week').length,
    hold:      results.filter(r => r.contactUrgency === 'hold').length,
    results,
    scoredAt:  new Date().toISOString(),
  };
}

// ─── AI-ENHANCED REASONING ───────────────────────────────────────────────────
/**
 * enrichWithAIReasoning
 * For top-priority donors, run the result through Claude to get a
 * human-readable action memo the officer can act on immediately.
 */
async function enrichWithAIReasoning(scoredResult, donor) {
  const system = `You are Orbit's predictive contact engine. A donor has been surfaced as high-priority. 
Write a concise, actionable contact memo for the advancement officer. 
Be specific. Reference actual data. Tell them exactly what to say and why now.
Output JSON only: { "memo": "2-3 sentences", "opening_line": "exact first sentence to say/write", "avoid": "what NOT to mention" }`;

  const user = `CONTACT READINESS SCORE: ${scoredResult.contactReadinessScore}/100
URGENCY: ${scoredResult.contactUrgency}
AGENT: ${scoredResult.agentAssignment}
ASK READINESS: ${scoredResult.askReadiness}
ESTIMATED ASK: $${scoredResult.estimatedAskAmount?.toLocaleString()}
TRIGGERS: ${scoredResult.triggerReasons.map(t => t.text).join(' | ')}
BEST CHANNEL: ${scoredResult.recommendedChannel}
BEST WINDOW: ${scoredResult.bestWindow}

DONOR:
Name: ${donor.name} | Stage: ${donor.stage}
Lifetime: $${(donor.lifetime_giving||0).toLocaleString()} | Last Gift: $${donor.last_gift_amount||0}
Sentiment: ${donor.sentiment_trend} | Interests: ${(donor.interests||[]).join(', ')}`;

  try {
    const raw = await ai.callClaude(system, user, 400);
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return { ...scoredResult, aiMemo: parsed };
  } catch(e) {
    logger.warn('AI reasoning enrichment failed', { err: e.message });
    return scoredResult;
  }
}

module.exports = {
  scoreDonorContactReadiness,
  scorePortfolio,
  enrichWithAIReasoning,
  getFiscalBoost,
  WEIGHTS,
  SIGNAL_BOOST,
  STAGE_CADENCE,
  CHANNEL_RULES,
};
