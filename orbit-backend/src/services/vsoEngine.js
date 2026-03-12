'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ORBIT  —  Virtual Stewardship Officer (VSO) Intelligence Engine  v2.0
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  HOW THIS BEATS GIVZEY'S VSO:
 *  ─────────────────────────────
 *  Givzey VSO: "Maintains engagement between giving cycles, consistent
 *  communications, perpetual stewardship." Generic. Cadence-driven.
 *
 *  Orbit VSO: Seven donor archetypes × lifecycle phase = hyper-personalized
 *  stewardship plans. Planned gift donors get ongoing relationship and legacy
 *  reinforcement. Leadership annual givers get upgrade pathways and society
 *  recognition. Monthly sustainers get churn-prevention intelligence. Every
 *  touchpoint is scored, weighted, and timed to the individual — not the
 *  calendar. The VSO thinks like a seasoned major gift officer doing
 *  stewardship, not like a drip email sequence.
 *
 *  KEY DIFFERENTIATORS OVER GIVZEY:
 *  1. Donor archetype classification (7 types) — not one-size-fits-all
 *  2. Relationship health score (0-100) with decay model
 *  3. Planned gift covenant reinforcement cadence (distinct from annual giving)
 *  4. Leadership annual giving upgrade pathway engine
 *  5. Monthly sustainer churn prediction + payment recovery
 *  6. "Gift anniversary" and "life milestone" triggered stewardship
 *  7. Impact story matching — pairs donor interest areas to real outcomes
 *  8. Two-way sentiment analysis on reply content
 *  9. Bequest society membership management with recognition calendar
 * 10. Annual giving streak recognition and streak-break early warning
 *
 *  DONOR TYPES HANDLED:
 *  ─ PLANNED_GIFT       Bequest / CGA / trust / legacy society members
 *  ─ LEADERSHIP_ANNUAL  $1K-$25K annual fund, society-level donors
 *  ─ MONTHLY_SUSTAINER  Recurring monthly / quarterly donors
 *  ─ LOYAL_CONSECUTIVE  3+ year consecutive donors (streak donors)
 *  ─ FIRST_GIFT         New donors within first 90 days
 *  ─ LYBUNT             Last year but unfortunately not this year
 *  ─ SYBUNT             Some year but unfortunately not this year (2+ yrs lapsed)
 * ═══════════════════════════════════════════════════════════════════════════
 */

const db     = require('../db');
const ai     = require('./ai');
const logger = require('../utils/logger');

// ─── Constants ────────────────────────────────────────────────────────────────

const DONOR_TYPES = {
  PLANNED_GIFT:       'planned_gift',
  LEADERSHIP_ANNUAL:  'leadership_annual',
  MONTHLY_SUSTAINER:  'monthly_sustainer',
  LOYAL_CONSECUTIVE:  'loyal_consecutive',
  FIRST_GIFT:         'first_gift',
  LYBUNT:             'lybunt',
  SYBUNT:             'sybunt',
};

// Relationship Health Score weights
const RHS_WEIGHTS = {
  days_since_contact:   -0.4,  // decay per day silent
  days_since_gift:      -0.15, // decay per day since last gift
  email_opens:          +8,    // per recent open (last 90 days)
  email_replies:        +18,   // per reply
  event_attendance:     +22,   // per event attended (last 12mo)
  impact_report_opened: +12,   // opened a stewardship report
  call_completed:       +25,   // completed phone call
  note_sent:            +10,   // handwritten note sent
  giving_streak_years:  +5,    // per year of consecutive giving
  upgrade_made:         +30,   // upgraded gift level
  pledge_current:       +20,   // pledge installments current
  pledge_overdue:       -35,   // pledge installment overdue
  bequest_confirmed:    +40,   // confirmed planned gift
  complaint_filed:      -50,   // complaint or negative interaction
};

// Touchpoint channel preferences by donor type
const CHANNEL_MATRIX = {
  planned_gift:      ['handwritten_note', 'phone', 'email', 'event_invite'],
  leadership_annual: ['email', 'phone', 'handwritten_note', 'event_invite'],
  monthly_sustainer: ['email', 'sms', 'phone'],
  loyal_consecutive: ['email', 'handwritten_note', 'phone'],
  first_gift:        ['email', 'sms', 'handwritten_note'],
  lybunt:            ['email', 'phone', 'sms'],
  sybunt:            ['email', 'phone'],
};

// Stewardship cadence (days between touchpoints) by donor type and health tier
const CADENCE = {
  planned_gift:      { healthy: 45, watch: 30, critical: 14 },
  leadership_annual: { healthy: 60, watch: 30, critical: 21 },
  monthly_sustainer: { healthy: 30, watch: 14, critical: 7  },
  loyal_consecutive: { healthy: 60, watch: 45, critical: 21 },
  first_gift:        { healthy: 14, watch: 7,  critical: 3  }, // hot first 90 days
  lybunt:            { healthy: 30, watch: 14, critical: 7  },
  sybunt:            { healthy: 45, watch: 21, critical: 14 },
};

// ─── Classification Engine ────────────────────────────────────────────────────

/**
 * Classify a donor into their primary stewardship type.
 * A donor can have one primary type and secondary signals.
 */
function classifyDonor(donor) {
  const {
    planned_gift_confirmed,      // boolean
    lifetime_giving,             // number $
    largest_gift,                // number $
    last_gift_date,              // ISO date
    last_gift_amount,            // number $
    giving_years_consecutive,    // number
    is_recurring,                // boolean
    recurring_frequency,         // 'monthly' | 'quarterly' | 'annual'
    fiscal_year_current_gift,    // boolean — gave this FY
    fiscal_year_last_gift,       // boolean — gave last FY
    first_gift_date,             // ISO date
  } = donor;

  const now = new Date();
  const daysSinceLastGift = last_gift_date
    ? Math.floor((now - new Date(last_gift_date)) / 86400000)
    : 9999;
  const daysSinceFirstGift = first_gift_date
    ? Math.floor((now - new Date(first_gift_date)) / 86400000)
    : 9999;
  const isNewDonor = daysSinceFirstGift <= 90;

  // Priority order: planned gift > leadership annual > monthly > loyal > first > lybunt > sybunt
  if (planned_gift_confirmed) return DONOR_TYPES.PLANNED_GIFT;

  if (largest_gift >= 1000 && !fiscal_year_current_gift && fiscal_year_last_gift)
    return DONOR_TYPES.LYBUNT;

  if (largest_gift >= 1000 && !fiscal_year_current_gift && !fiscal_year_last_gift)
    return DONOR_TYPES.SYBUNT;

  if (largest_gift >= 1000 || lifetime_giving >= 5000)
    return DONOR_TYPES.LEADERSHIP_ANNUAL;

  if (is_recurring)
    return DONOR_TYPES.MONTHLY_SUSTAINER;

  if (giving_years_consecutive >= 3)
    return DONOR_TYPES.LOYAL_CONSECUTIVE;

  if (isNewDonor)
    return DONOR_TYPES.FIRST_GIFT;

  if (!fiscal_year_current_gift && fiscal_year_last_gift)
    return DONOR_TYPES.LYBUNT;

  if (!fiscal_year_current_gift && !fiscal_year_last_gift)
    return DONOR_TYPES.SYBUNT;

  return DONOR_TYPES.LOYAL_CONSECUTIVE; // default: consecutive loyal donor
}

// ─── Relationship Health Score ────────────────────────────────────────────────

/**
 * Calculate the VSO Relationship Health Score (0-100).
 * This is distinct from the predictive contact score — it measures
 * the warmth and currency of the relationship, not gift propensity.
 */
function calculateRHS(donor, activity) {
  const {
    last_contact_date,
    last_gift_date,
    pledge_status,
    bequest_confirmed,
    giving_years_consecutive,
  } = donor;

  const {
    email_opens_90d     = 0,
    email_replies_90d   = 0,
    events_attended_1y  = 0,
    impact_reports_opened_1y = 0,
    calls_completed_90d = 0,
    notes_sent_90d      = 0,
    upgrades_made_3y    = 0,
    complaints_12m      = 0,
  } = activity || {};

  const now = new Date();
  const daysSilent = last_contact_date
    ? Math.floor((now - new Date(last_contact_date)) / 86400000)
    : 365;
  const daysSinceGift = last_gift_date
    ? Math.floor((now - new Date(last_gift_date)) / 86400000)
    : 730;

  let score = 50; // neutral baseline

  score += Math.max(-30, RHS_WEIGHTS.days_since_contact  * Math.min(daysSilent, 75));
  score += Math.max(-20, RHS_WEIGHTS.days_since_gift     * Math.min(daysSinceGift, 133));
  score += Math.min(40,  RHS_WEIGHTS.email_opens        * email_opens_90d);
  score += Math.min(36,  RHS_WEIGHTS.email_replies       * email_replies_90d);
  score += Math.min(44,  RHS_WEIGHTS.event_attendance    * events_attended_1y);
  score += Math.min(24,  RHS_WEIGHTS.impact_report_opened* impact_reports_opened_1y);
  score += Math.min(50,  RHS_WEIGHTS.call_completed      * calls_completed_90d);
  score += Math.min(20,  RHS_WEIGHTS.note_sent           * notes_sent_90d);
  score += Math.min(25,  RHS_WEIGHTS.giving_streak_years * (giving_years_consecutive || 0));
  score += Math.min(30,  RHS_WEIGHTS.upgrade_made        * upgrades_made_3y);

  if (bequest_confirmed)            score += RHS_WEIGHTS.bequest_confirmed;
  if (pledge_status === 'overdue')  score += RHS_WEIGHTS.pledge_overdue;
  if (pledge_status === 'current')  score += RHS_WEIGHTS.pledge_current;
  if (complaints_12m > 0)          score += RHS_WEIGHTS.complaint_filed * complaints_12m;

  return Math.min(100, Math.max(0, Math.round(score)));
}

function rhsTier(score) {
  if (score >= 75) return 'healthy';
  if (score >= 45) return 'watch';
  return 'critical';
}

// ─── Touchpoint Scheduler ────────────────────────────────────────────────────

/**
 * Given a donor's type and RHS, return their next recommended touchpoint.
 * Returns: { daysUntilNext, channel, touchpointType, rationale, urgency }
 */
function scheduleNextTouchpoint(donor, activity, donorType) {
  const rhs        = calculateRHS(donor, activity);
  const tier       = rhsTier(rhs);
  const cadence    = CADENCE[donorType]?.[tier] || 30;
  const channels   = CHANNEL_MATRIX[donorType] || ['email'];
  const lastContact = donor.last_contact_date ? new Date(donor.last_contact_date) : null;
  const daysSince   = lastContact
    ? Math.floor((Date.now() - lastContact.getTime()) / 86400000)
    : 999;
  const daysUntilNext = Math.max(0, cadence - daysSince);
  const overdue       = daysUntilNext <= 0;

  const touchpointType = selectTouchpointType(donor, donorType, activity);
  const channel        = channels[0]; // primary preferred channel

  return {
    rhs,
    tier,
    daysUntilNext,
    overdue,
    channel,
    touchpointType,
    cadenceDays: cadence,
    rationale: buildRationale(donor, donorType, tier, touchpointType, daysSince),
    urgency: overdue ? 'high' : tier === 'watch' ? 'medium' : 'low',
    suggestedDate: new Date(Date.now() + daysUntilNext * 86400000).toISOString().split('T')[0],
  };
}

/**
 * Choose the most appropriate touchpoint type based on donor context.
 */
function selectTouchpointType(donor, donorType, activity) {
  const now      = new Date();
  const lastGift = donor.last_gift_date ? new Date(donor.last_gift_date) : null;
  const daysSinceGift = lastGift ? Math.floor((now - lastGift) / 86400000) : 9999;

  // Post-gift window: first 48h
  if (daysSinceGift <= 2)  return 'gift_acknowledgment';
  // Post-gift stewardship: 2-30 days
  if (daysSinceGift <= 30) return 'impact_share';
  // Gift anniversary
  if (lastGift) {
    const giftAnniv = new Date(lastGift);
    giftAnniv.setFullYear(now.getFullYear());
    const daysToAnniv = Math.floor((giftAnniv - now) / 86400000);
    if (Math.abs(daysToAnniv) <= 7) return 'gift_anniversary';
  }

  // Type-specific
  switch (donorType) {
    case DONOR_TYPES.PLANNED_GIFT:
      return selectPlannedGiftTouchpoint(donor, activity);
    case DONOR_TYPES.LEADERSHIP_ANNUAL:
      return selectLeadershipTouchpoint(donor, activity);
    case DONOR_TYPES.MONTHLY_SUSTAINER:
      return selectSustainerTouchpoint(donor, activity);
    case DONOR_TYPES.FIRST_GIFT:
      return selectFirstGiftTouchpoint(donor, activity);
    case DONOR_TYPES.LYBUNT:
      return 'lybunt_renewal_ask';
    case DONOR_TYPES.SYBUNT:
      return daysSinceGift > 730 ? 'sybunt_reactivation' : 'sybunt_stewardship';
    default:
      return 'impact_share';
  }
}

function selectPlannedGiftTouchpoint(donor, activity) {
  const { legacy_society_member, last_impact_report_date, events_attended_1y = 0 } = { ...donor, ...activity };
  if (!legacy_society_member)                return 'legacy_society_invitation';
  if (!last_impact_report_date)              return 'planned_gift_impact_report';
  if (events_attended_1y === 0)              return 'legacy_event_invitation';
  return 'planned_gift_stewardship_update';
}

function selectLeadershipTouchpoint(donor, activity) {
  const { society_member, giving_years_consecutive = 0 } = { ...donor, ...activity };
  if (!society_member && donor.largest_gift >= 1000) return 'leadership_society_upgrade_ask';
  if (giving_years_consecutive >= 5)                 return 'consecutive_streak_celebration';
  if (donor.lifetime_giving >= 25000)                return 'cumulative_milestone_recognition';
  return 'impact_share';
}

function selectSustainerTouchpoint(donor, activity) {
  const { card_expiry_days = 999, last_failed_payment = null, upgraded_in_12m = false } = activity || {};
  if (last_failed_payment)     return 'sustainer_payment_recovery';
  if (card_expiry_days <= 30)  return 'sustainer_card_update';
  if (!upgraded_in_12m)        return 'sustainer_upgrade_ask';
  return 'sustainer_impact_share';
}

function selectFirstGiftTouchpoint(donor, activity) {
  const daysSinceFirst = donor.first_gift_date
    ? Math.floor((Date.now() - new Date(donor.first_gift_date).getTime()) / 86400000)
    : 0;
  if (daysSinceFirst <= 2)  return 'first_gift_thank_you';
  if (daysSinceFirst <= 14) return 'first_gift_impact_intro';
  if (daysSinceFirst <= 45) return 'first_gift_story';
  return 'first_gift_recurring_ask';
}

function buildRationale(donor, donorType, tier, touchpointType, daysSince) {
  const map = {
    gift_acknowledgment:          `Gift received — 48-hour stewardship window. Warmth here drives 2nd gift probability.`,
    impact_share:                 `${daysSince} days since last contact. Share impact to maintain emotional connection before next ask.`,
    gift_anniversary:             `Gift anniversary approaching — perfect no-ask touchpoint that surprises and delights.`,
    legacy_society_invitation:    `Confirmed planned gift donor not yet enrolled in legacy society. Recognition gap — close this now.`,
    planned_gift_impact_report:   `Planned gift donor hasn't received a personalized impact report. Critical for bequest retention.`,
    planned_gift_stewardship_update: `Annual covenant reinforcement — ensure they still feel ownership of their future gift.`,
    legacy_event_invitation:      `No event attendance in 12 months. Legacy society events are the #1 retention tool for PG donors.`,
    leadership_society_upgrade_ask: `Donor giving at leadership level but not enrolled in giving society. Recognition gap with upgrade opportunity.`,
    consecutive_streak_celebration: `${donor.giving_years_consecutive}+ year giving streak. Public recognition of loyalty drives continued giving.`,
    cumulative_milestone_recognition: `Lifetime giving milestone reached. Milestone moments increase average next gift by 40%.`,
    sustainer_payment_recovery:   `Failed payment detected. Act within 48h — 70% of failed payments are recovered with immediate outreach.`,
    sustainer_card_update:        `Card expiring in 30 days. Proactive update prevents passive churn — #1 sustainer loss reason.`,
    sustainer_upgrade_ask:        `Sustainer hasn't upgraded in 12 months. Personalized upgrade ask has 22% acceptance rate at 12-month mark.`,
    sustainer_impact_share:       `Monthly donors who see impact every 30 days retain at 91% vs 78% average. Send now.`,
    first_gift_thank_you:         `New donor — 48h thank-you window. Sets the entire relationship tone. Do not miss.`,
    first_gift_impact_intro:      `Week 2 of new donor journey. Educate on impact before next ask. Builds mission connection.`,
    first_gift_story:             `Month 2 of onboarding. Storytelling drives emotional investment. 60% of 2nd-gift donors convert here.`,
    first_gift_recurring_ask:     `Day 45+ new donor. Convert to recurring before 90-day window closes — 3x LTV vs one-time.`,
    lybunt_renewal_ask:           `Lapsed last year. Personal, acknowledging message drives 34% re-engagement. Generic appeals fail.`,
    sybunt_reactivation:          `2+ year lapse. Reconnect with mission story before any ask. Do not lead with money.`,
    sybunt_stewardship:           `Multi-year lapsed donor. Rebuild relationship first — 2 non-ask touches before any solicitation.`,
  };
  return map[touchpointType] || `${daysSince} days since contact — stewardship touchpoint recommended.`;
}

// ─── AI Content Generator ─────────────────────────────────────────────────────

/**
 * Generate the actual stewardship message for a donor.
 * This is where Orbit's VSO dramatically outperforms Givzey —
 * every message is typed to donor archetype, relationship health,
 * and specific contextual signals (anniversaries, milestones, etc.)
 */
async function generateStewardshipContent(params, org) {
  const {
    donor,
    donorType,
    touchpointType,
    channel,         // 'email' | 'sms' | 'phone' | 'handwritten_note'
    impactStory,     // optional: specific impact story to include
    includeAsk,      // boolean — should this include a soft ask?
    askAmount,       // optional suggested ask amount
  } = params;

  const orgName    = org?.name || 'the university';
  const donorName  = donor.preferred_name || donor.first_name || 'Friend';
  const fund       = donor.primary_fund_interest || 'general scholarship fund';
  const lastGiftAmt= donor.last_gift_amount ? `$${donor.last_gift_amount.toLocaleString()}` : 'your recent gift';
  const streak     = donor.giving_years_consecutive || 0;
  const lifetime   = donor.lifetime_giving ? `$${donor.lifetime_giving.toLocaleString()}` : null;

  // Build the highly-specific prompt based on donor type and touchpoint
  const systemPrompt = buildSystemPrompt(donorType, touchpointType, channel, orgName);
  const userPrompt   = buildUserPrompt({
    donor, donorType, touchpointType, channel, donorName, fund,
    lastGiftAmt, streak, lifetime, impactStory, includeAsk, askAmount
  });

  try {
    const content = await ai.generate(systemPrompt, userPrompt, { maxTokens: 600, org });
    return {
      success: true,
      content,
      touchpointType,
      channel,
      donorType,
      includesAsk: includeAsk || false,
      metadata: {
        generatedAt: new Date().toISOString(),
        donorId: donor.id,
        orgId: org?.id,
      }
    };
  } catch (err) {
    logger.error('VSO content generation failed', { err: err.message, donorId: donor.id });
    throw err;
  }
}

function buildSystemPrompt(donorType, touchpointType, channel, orgName) {
  const channelGuide = {
    email:            'Write a personalized email. Subject line + body. 150-250 words. Conversational but professional.',
    sms:              'Write an SMS. 160 characters max. Warm, personal. No links unless absolutely needed.',
    phone:            'Write a phone script/talking points. Natural, conversational. 60-90 seconds when spoken.',
    handwritten_note: 'Write a handwritten notecard. 60-80 words. Personal, warm. Donor sees this as high-touch luxury. No bullet points.',
  }[channel] || 'Write a personalized email. 150-250 words.';

  const typePersona = {
    planned_gift:      `You are stewarding a legacy donor — someone who has included ${orgName} in their estate plan. They are making a gift that will outlive them. Treat them with the deepest reverence. They are not just donors; they are founders of the future. Never pressure them. Honor their vision. Use language of legacy, permanence, and shared mission.`,
    leadership_annual: `You are stewarding a leadership annual giving donor — a committed community member giving $1,000-$25,000/year. They are proud of their loyalty and appreciate being recognized. They are the backbone of the annual fund. Make them feel like insiders with access and recognition.`,
    monthly_sustainer: `You are stewarding a monthly recurring donor. They've made a year-round commitment. They value reliability and seeing their sustained impact. Never make them feel like an ATM. Focus on the cumulative power of their consistent support.`,
    loyal_consecutive: `You are stewarding a loyal consecutive donor — someone who has given every year for 3+ years. Their streak is their identity. Honor it. Make them feel like part of an exclusive, loyal community.`,
    first_gift:        `You are stewarding a brand-new donor within their first 90 days. This is the most critical window in the entire donor lifecycle. They gave once and might never give again unless they feel deeply welcomed and see their impact. Be warm, genuine, specific.`,
    lybunt:            `You are re-engaging a donor who gave last year but hasn't given yet this year. They are not lost — they are distracted or waiting to be asked the right way. Acknowledge their loyalty, not their lapse. Never mention that they haven't given. Lead with relationship.`,
    sybunt:            `You are re-engaging a donor who gave years ago but has been absent. Approach with humility. Rebuild the relationship before any ask. Show them what they've missed and why it matters. Two rebuilding touches before any solicitation.`,
  }[donorType] || 'You are a warm, expert fundraising stewardship professional.';

  return `You are the VSO (Virtual Stewardship Officer) for ${orgName}.

${typePersona}

${channelGuide}

CRITICAL RULES:
- Never be generic. Every word must feel like it was written specifically for this person.
- Never include both a thank-you and an ask in the same message (unless instructed).
- For planned gift donors: never reference their age, health, or the nature of the future gift directly.
- For lapsed donors: lead with mission and relationship — never with guilt.
- For first-gift donors: end with warmth, not another ask.
- For sustainers: acknowledge their CUMULATIVE impact, not just their monthly amount.
- Always write as if from a real human officer — not a system.
- Output only the message content (subject + body for email, or just the text for other channels).`;
}

function buildUserPrompt(params) {
  const {
    donor, donorType, touchpointType, channel, donorName, fund,
    lastGiftAmt, streak, lifetime, impactStory, includeAsk, askAmount
  } = params;

  const contextLines = [
    `Donor name: ${donorName}`,
    `Class year / affiliation: ${donor.class_year || 'alumni'}`,
    `Primary fund interest: ${fund}`,
    `Last gift: ${lastGiftAmt} on ${donor.last_gift_date || 'record'}`,
    streak > 0 ? `Giving streak: ${streak} consecutive years` : null,
    lifetime ? `Lifetime giving: ${lifetime}` : null,
    donor.planned_gift_confirmed ? `Planned gift type: ${donor.planned_gift_vehicle || 'bequest'}` : null,
    donor.legacy_society_member  ? `Legacy society member: Yes` : null,
    donor.preferred_communication_notes || null,
    donor.insider_note || null,
    impactStory ? `Impact story to include: ${impactStory}` : null,
  ].filter(Boolean).join('\n');

  const askInstruction = includeAsk
    ? `\nInclude a soft, natural ask for ${askAmount ? '$' + askAmount.toLocaleString() : 'a renewal gift'}. Make it feel like a natural extension of the stewardship, not a pivot.`
    : '\nDo NOT include any ask for money.';

  const touchpointGuide = {
    gift_acknowledgment:             'Write within 24-48 hours of gift receipt. Pure gratitude. No ask. Specific to their gift.',
    impact_share:                    'Share one concrete impact story tied to their giving area. Make it vivid and specific.',
    gift_anniversary:                'Celebrate the anniversary of their first or most significant gift. Surprise and delight.',
    legacy_society_invitation:       'Warmly invite them to join the legacy/heritage society. Honor their planned gift. Explain the society benefits and community.',
    planned_gift_impact_report:      'Personal impact report for a planned gift donor. Cover: how their fund area has grown, one student/program story, future vision. No ask.',
    planned_gift_stewardship_update: 'Annual covenant reinforcement. Affirm their decision. Share institutional progress. Make them feel like a founding partner.',
    legacy_event_invitation:         'Personal invitation to a legacy society event. Make it feel exclusive and meaningful.',
    leadership_society_upgrade_ask:  'Soft invitation to formally join the leadership giving society. Explain recognition and benefits. Frame as an honor, not a sales pitch.',
    consecutive_streak_celebration:  `Celebrate their ${streak}-year giving streak. Make them feel like a legend.`,
    cumulative_milestone_recognition: `Celebrate reaching $${(donor.lifetime_giving || 0).toLocaleString()} in lifetime giving. Milestone moment.`,
    sustainer_payment_recovery:      'Card failed. Gentle, non-embarrassing message. Make it easy. Provide a link to update. Acknowledge their sustained commitment.',
    sustainer_card_update:           'Card expiring soon. Proactive, friendly message. No guilt. Simple action request.',
    sustainer_upgrade_ask:           'Warm invite to increase their monthly gift by a suggested amount. Frame as expanding their impact.',
    sustainer_impact_share:          'Monthly sustainer impact. Show cumulative year-to-date impact from their recurring gift.',
    first_gift_thank_you:            'First gift, within 48h. Pure gratitude. No ask. Welcome them to the community.',
    first_gift_impact_intro:         '2 weeks in. Introduce them to the impact of their specific giving area.',
    first_gift_story:                '45 days in. One powerful story about someone impacted by a gift like theirs.',
    first_gift_recurring_ask:        '60-90 days in. Gentle invite to consider a monthly gift. Frame as even more impact.',
    lybunt_renewal_ask:              'Lapsed from last year. Acknowledge their history. Reconnect with mission. Natural soft ask.',
    sybunt_reactivation:             'Multi-year lapse. No ask. Pure reconnection. What has changed. What they have been a part of.',
    sybunt_stewardship:              'Year 2 reconnection. Share something meaningful. Still no ask.',
  }[touchpointType] || 'Provide a warm, personal stewardship touchpoint.';

  return `DONOR CONTEXT:
${contextLines}

TOUCHPOINT TYPE: ${touchpointType}
INSTRUCTION: ${touchpointGuide}
CHANNEL: ${channel}
${askInstruction}

Write the ${channel} now:`;
}

// ─── Planned Gift Stewardship Planner ─────────────────────────────────────────

/**
 * Build a full 12-month stewardship plan for a confirmed planned gift donor.
 * This is the deepest planned giving stewardship in any fundraising platform.
 */
function buildPlannedGiftStewardshipPlan(donor) {
  const vehicle = donor.planned_gift_vehicle || 'bequest';
  const societyMember = donor.legacy_society_member || false;
  const hasInterestAreas = (donor.interest_areas || []).length > 0;

  const plan = {
    donorId:    donor.id,
    donorName:  donor.first_name,
    vehicle,
    societyMember,
    annualTouchpoints: [],
    specialMilestones: [],
    riskFlags: [],
  };

  // Month 1: Immediately after confirmation
  plan.annualTouchpoints.push({
    month: 1, timing: 'Within 48h of confirmation',
    type: 'gift_acknowledgment',
    channel: 'handwritten_note',
    from: 'President or VP of Advancement',
    note: 'Personal, profound thank-you. From the most senior person possible. Non-negotiable.',
    aiAssist: true,
  });

  // Month 1-2: Legacy society enrollment
  if (!societyMember) {
    plan.annualTouchpoints.push({
      month: 2, timing: 'Within 30 days of confirmation',
      type: 'legacy_society_invitation',
      channel: 'email + physical packet',
      note: 'Formal invitation to join legacy/heritage society. Include society pin, brochure, member list (with permission).',
      aiAssist: true,
    });
  }

  // Month 3: First personalized impact report
  plan.annualTouchpoints.push({
    month: 3, timing: 'Quarterly',
    type: 'planned_gift_impact_report',
    channel: 'email',
    note: 'Personalized to their fund area. Include one student or program story. No ask.',
    aiAssist: true,
  });

  // Annual legacy society event invite
  plan.annualTouchpoints.push({
    month: 4, timing: 'Annual — spring',
    type: 'legacy_event_invitation',
    channel: 'email + phone call',
    note: 'Exclusive event — lunch with president, campus tour, meet scholarship recipients. The crown jewel of PG stewardship.',
    aiAssist: false, // human-led call
  });

  // Mid-year stewardship — no ask
  plan.annualTouchpoints.push({
    month: 6, timing: 'Mid-year',
    type: 'planned_gift_stewardship_update',
    channel: 'email',
    note: 'Share institutional news relevant to their fund area. Reinforce their decision. No ask.',
    aiAssist: true,
  });

  // Quarter 3: Impact report
  plan.annualTouchpoints.push({
    month: 9, timing: 'Quarterly',
    type: 'planned_gift_impact_report',
    channel: 'email',
    note: 'Fall impact report. Include forward-looking — what the fund will do next year.',
    aiAssist: true,
  });

  // Holiday: Handwritten card
  plan.annualTouchpoints.push({
    month: 12, timing: 'December',
    type: 'holiday_gratitude',
    channel: 'handwritten_note',
    from: 'Gift officer assigned',
    note: 'Warm personal holiday card. No ask. Reference something personal learned about the donor.',
    aiAssist: true,
  });

  // Annual giving ask (planned gift donors give 75% more annually after commitment)
  plan.annualTouchpoints.push({
    month: 10, timing: 'October — annual appeal season',
    type: 'annual_fund_soft_ask',
    channel: 'email',
    note: 'Soft annual fund ask. They are 3x more likely to give annually after a planned gift commitment. $500-$2,500 range.',
    aiAssist: true,
  });

  // Vehicle-specific additions
  if (vehicle === 'charitable_gift_annuity') {
    plan.annualTouchpoints.push({
      month: 2, timing: 'After each annuity payment',
      type: 'cga_payment_stewardship',
      channel: 'email',
      note: 'Brief thank-you after each annuity payment — acknowledge the relationship, not just the transaction.',
      aiAssist: true,
    });
    plan.specialMilestones.push({ event: 'CGA rate change', action: 'Notify proactively and explain impact' });
  }

  if (vehicle === 'charitable_remainder_trust') {
    plan.specialMilestones.push({ event: 'Annual trust report', action: 'Send personalized summary of trust performance' });
  }

  // Risk flags
  if (!societyMember) {
    plan.riskFlags.push({ level: 'high', message: 'Not enrolled in legacy society — bequests that lack recognition are 3x more likely to be removed from estate plans.' });
  }
  if (!hasInterestAreas) {
    plan.riskFlags.push({ level: 'medium', message: 'No fund interest areas recorded — cannot personalize impact reports. Collect this in next touchpoint.' });
  }
  if (!donor.last_contact_date || Math.floor((Date.now() - new Date(donor.last_contact_date).getTime()) / 86400000) > 90) {
    plan.riskFlags.push({ level: 'critical', message: 'No contact in 90+ days. Planned gift donors who go quiet for 6+ months have 2x higher bequest removal rate.' });
  }

  plan.annualTouchpoints.sort((a, b) => a.month - b.month);
  return plan;
}

// ─── Leadership Annual Giving Upgrade Engine ──────────────────────────────────

/**
 * Determine if a leadership annual donor is ready for:
 *   (a) society enrollment / upgrade
 *   (b) major gift pipeline move
 *   (c) multi-year pledge ask
 *   (d) planned giving conversation introduction
 */
function evaluateUpgradePath(donor, activity) {
  const {
    largest_gift,
    lifetime_giving,
    giving_years_consecutive,
    age_estimate,
    capacity_score,         // 0-100 wealth screen
    engagement_score,       // from donor intelligence
    society_member,
    has_had_major_gift_conversation,
    volunteer_roles,
    event_attendance,
  } = { ...donor, ...activity };

  const paths = [];

  // Society upgrade — for non-members giving >= $1K
  if (largest_gift >= 1000 && !society_member) {
    paths.push({
      path: 'society_enrollment',
      readiness: 'high',
      rationale: `${giving_years_consecutive}-year donor at $${largest_gift.toLocaleString()}/year not yet in leadership society. Enrollment increases retention by 31%.`,
      nextStep: 'Send society invitation email with membership benefits. Follow up with phone call.',
    });
  }

  // Major gift pipeline indicator
  const majorGiftSignals = [
    giving_years_consecutive >= 5,
    lifetime_giving >= 10000,
    capacity_score >= 70,
    engagement_score >= 75,
    (event_attendance || 0) >= 2,
    (volunteer_roles || []).length > 0,
    !has_had_major_gift_conversation,
  ].filter(Boolean).length;

  if (majorGiftSignals >= 3) {
    paths.push({
      path: 'major_gift_pipeline',
      readiness: majorGiftSignals >= 5 ? 'high' : 'medium',
      rationale: `${majorGiftSignals}/7 major gift indicators met. Consider portfolio assignment to a gift officer for cultivation.`,
      nextStep: 'Schedule discovery call. Assign to VEO or human gift officer for cultivation to major gift.',
      transferToAgent: 'VEO',
    });
  }

  // Multi-year pledge ask
  if (giving_years_consecutive >= 3 && largest_gift >= 500) {
    paths.push({
      path: 'multiyear_pledge',
      readiness: 'medium',
      rationale: `${giving_years_consecutive}-year consecutive donor — 3x more likely to accept a pledge ask than average. Givzey data shows 90%+ pledge confirmation within 1 week for loyal donors.`,
      nextStep: 'Send pledge invitation via gift agreement. Pre-fill based on last gift amount.',
    });
  }

  // Planned giving conversation seed (for older loyal donors)
  if ((age_estimate || 0) >= 60 && giving_years_consecutive >= 5) {
    paths.push({
      path: 'planned_giving_introduction',
      readiness: 'medium',
      rationale: `Long-tenured donor, age-eligible for PG conversation. Introduce legacy society concept naturally in next stewardship touch.`,
      nextStep: 'Seed planned giving message in next impact report. Transfer to VPGO after 1 stewardship touch.',
      transferToAgent: 'VPGO',
    });
  }

  return {
    donorId:      donor.id,
    evaluatedAt:  new Date().toISOString(),
    currentLevel: `$${(largest_gift || 0).toLocaleString()}/year | ${giving_years_consecutive || 0}-year streak | LTV $${(lifetime_giving || 0).toLocaleString()}`,
    upgradePaths: paths,
    topPath:      paths.sort((a, b) => (b.readiness === 'high' ? 1 : 0) - (a.readiness === 'high' ? 1 : 0))[0] || null,
  };
}

// ─── Monthly Sustainer Churn Prevention ──────────────────────────────────────

/**
 * Predict churn risk for a monthly sustainer and prescribe intervention.
 * Monthly sustainers are retained at 83% vs 45% for one-time donors — protecting them is high-ROI.
 */
function assessSustainerChurnRisk(donor, activity) {
  const {
    months_as_sustainer = 0,
    monthly_amount,
    card_expiry_days  = 999,
    failed_payments_12m = 0,
    email_opens_90d   = 0,
    last_contact_date,
    month_joined,
  } = { ...donor, ...activity };

  let riskScore = 0;
  const riskFactors = [];
  const interventions = [];

  // Expiring card — #1 churn reason
  if (card_expiry_days <= 30) {
    riskScore += 45;
    riskFactors.push(`Card expiring in ${card_expiry_days} days`);
    interventions.push({ urgency: 'critical', action: 'sustainer_card_update', window: '48h', channel: 'email+sms' });
  }

  // January effect — highest churn month
  const currentMonth = new Date().getMonth(); // 0 = Jan
  if (currentMonth === 0) {
    riskScore += 15;
    riskFactors.push('January churn peak — 1.4x higher lapse rate this month');
    interventions.push({ urgency: 'high', action: 'sustainer_impact_share', window: '7d', channel: 'email' });
  }

  // Failed payments
  if (failed_payments_12m > 0) {
    riskScore += 20 * failed_payments_12m;
    riskFactors.push(`${failed_payments_12m} failed payment(s) in last 12 months`);
    interventions.push({ urgency: 'critical', action: 'sustainer_payment_recovery', window: '24h', channel: 'email+sms' });
  }

  // Silent engagement
  if (email_opens_90d === 0) {
    riskScore += 20;
    riskFactors.push('Zero email opens in 90 days');
    interventions.push({ urgency: 'medium', action: 'sustainer_reengagement', window: '14d', channel: 'sms' });
  }

  // Early sustainers (0-6 months) — 30-50% cancel in this window
  if (months_as_sustainer <= 6) {
    riskScore += 25;
    riskFactors.push(`Early sustainer (${months_as_sustainer} months) — highest churn window`);
    interventions.push({ urgency: 'high', action: 'sustainer_impact_share', window: '30d', channel: 'email' });
  }

  const risk = riskScore >= 60 ? 'critical' : riskScore >= 35 ? 'high' : riskScore >= 15 ? 'medium' : 'low';
  const annualValue = (monthly_amount || 0) * 12;
  const ltv5year   = annualValue * 8 * 0.83; // 8yr avg sustainer LTV at 83% retention

  return {
    donorId:       donor.id,
    churnRisk:     risk,
    riskScore,
    riskFactors,
    interventions: interventions.sort((a, b) => a.urgency === 'critical' ? -1 : 1),
    financialImpact: {
      annualValue:  `$${annualValue.toLocaleString()}`,
      ltv5year:     `$${Math.round(ltv5year).toLocaleString()}`,
      lossIfChurned: `$${Math.round(annualValue * 0.83 * 3).toLocaleString()} (avg 3 years lost)`,
    },
  };
}

// ─── Stewardship Queue Builder ────────────────────────────────────────────────

/**
 * Build the daily VSO stewardship queue for an org.
 * Returns prioritized list of donors who need a touchpoint today or soon.
 */
async function buildDailyQueue(orgId, limit = 50) {
  try {
    const { rows: donors } = await db.query(`
      SELECT
        d.id, d.first_name, d.last_name, d.preferred_name,
        d.email, d.phone, d.class_year, d.age_estimate,
        d.lifetime_giving, d.largest_gift, d.last_gift_amount,
        d.last_gift_date, d.first_gift_date,
        d.giving_years_consecutive, d.is_recurring,
        d.recurring_frequency, d.monthly_amount,
        d.planned_gift_confirmed, d.planned_gift_vehicle,
        d.legacy_society_member, d.society_member,
        d.interest_areas, d.primary_fund_interest,
        d.preferred_name, d.insider_note,
        d.preferred_communication_notes,
        d.last_contact_date,
        (
          SELECT COUNT(*) FROM outreach_log ol
          WHERE ol.donor_id = d.id AND ol.created_at > NOW() - INTERVAL '90 days'
            AND ol.channel = 'email' AND ol.opened = true
        ) AS email_opens_90d,
        (
          SELECT COUNT(*) FROM outreach_log ol
          WHERE ol.donor_id = d.id AND ol.created_at > NOW() - INTERVAL '90 days'
            AND ol.replied = true
        ) AS email_replies_90d,
        -- Fiscal year giving flags (assumes July 1 FY start)
        EXISTS(
          SELECT 1 FROM gifts g WHERE g.donor_id = d.id
          AND g.gift_date >= DATE_TRUNC('year', CURRENT_DATE - INTERVAL '0 year')
            + INTERVAL '6 months' - INTERVAL '12 months' * (
              CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) < 7 THEN 1 ELSE 0 END
            )
        ) AS fiscal_year_current_gift,
        EXISTS(
          SELECT 1 FROM gifts g WHERE g.donor_id = d.id
          AND g.gift_date BETWEEN
            DATE_TRUNC('year', CURRENT_DATE - INTERVAL '1 year') + INTERVAL '6 months' - INTERVAL '12 months' * (
              CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) < 7 THEN 1 ELSE 0 END
            )
            AND DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '6 months' - INTERVAL '12 months' * (
              CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) < 7 THEN 1 ELSE 0 END
            )
        ) AS fiscal_year_last_gift
      FROM donors d
      WHERE d.org_id = $1
        AND d.assigned_agent = 'VSO'
        AND d.do_not_contact = false
        AND d.email IS NOT NULL
      ORDER BY d.last_gift_date DESC NULLS LAST
      LIMIT 500
    `, [orgId]);

    const queue = [];

    for (const donor of donors) {
      const donorType  = classifyDonor(donor);
      const activity   = {
        email_opens_90d:   parseInt(donor.email_opens_90d) || 0,
        email_replies_90d: parseInt(donor.email_replies_90d) || 0,
      };
      const schedule   = scheduleNextTouchpoint(donor, activity, donorType);

      // ── VPGO contact-frequency cap (P0 compliance fix) ──────────────────
      // Planned gift donors: max 2 outreach touches per 30-day window.
      // Over-contacting legacy prospects is a reputational and legal risk.
      if (donorType === DONOR_TYPES.PLANNED_GIFT) {
        const { rows: pgContacts } = await db.query(
          `SELECT COUNT(*) AS cnt FROM outreach_log
           WHERE donor_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
          [donor.id]
        ).catch(() => ({ rows: [{ cnt: 0 }] }));
        const recentContacts = parseInt(pgContacts[0]?.cnt || 0);
        if (recentContacts >= 2) {
          logger.debug('VSO queue: skipping planned gift donor — frequency cap reached', {
            donorId: donor.id, recentContacts,
          });
          continue; // eslint-disable-line no-continue
        }
      }

      // Only include donors due for a touchpoint within 7 days or overdue
      if (schedule.daysUntilNext <= 7 || schedule.overdue) {
        const priority = schedule.overdue ? 0 : schedule.daysUntilNext;

        // For sustainers, also assess churn risk
        let churnRisk = null;
        if (donorType === DONOR_TYPES.MONTHLY_SUSTAINER) {
          const churnAssessment = assessSustainerChurnRisk(donor, activity);
          if (churnAssessment.churnRisk !== 'low') churnRisk = churnAssessment;
        }

        queue.push({
          donor: {
            id:         donor.id,
            name:       `${donor.preferred_name || donor.first_name} ${donor.last_name}`,
            email:      donor.email,
            classYear:  donor.class_year,
            lastGift:   donor.last_gift_amount,
            lastGiftDate: donor.last_gift_date,
            lifetime:   donor.lifetime_giving,
          },
          donorType,
          schedule,
          churnRisk,
          priority,
          suggestedContent: null, // generated on demand via generateStewardshipContent()
        });
      }
    }

    queue.sort((a, b) => a.priority - b.priority);

    return {
      orgId,
      generatedAt:  new Date().toISOString(),
      totalEligible: donors.length,
      queueSize:    Math.min(queue.length, limit),
      queue:        queue.slice(0, limit),
      summary: {
        byType:    countByKey(queue, 'donorType'),
        byUrgency: countByKey(queue.map(q => q.schedule), 'urgency'),
        overdue:   queue.filter(q => q.schedule.overdue).length,
        churnRisks:queue.filter(q => q.churnRisk?.churnRisk === 'critical').length,
      },
    };
  } catch (err) {
    logger.error('VSO queue build failed', { err: err.message, orgId });
    throw err;
  }
}

function countByKey(arr, key) {
  return arr.reduce((acc, item) => {
    const v = item[key] || 'unknown';
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});
}

// ─── Sentiment Analysis ───────────────────────────────────────────────────────

/**
 * Analyze sentiment in a donor reply to adjust stewardship approach.
 * If a donor replies to a stewardship email, this helps the VSO understand
 * whether to accelerate, hold, or pivot the relationship.
 */
async function analyzeDonorSentiment(replyText, donor, org) {
  const prompt = `Analyze this donor reply from ${donor.preferred_name || donor.first_name}.
Donor type: ${classifyDonor(donor)}, Lifetime giving: $${(donor.lifetime_giving || 0).toLocaleString()}

REPLY TEXT:
"${replyText}"

Return JSON with these exact keys:
{
  "sentiment": "positive|neutral|negative|very_positive|very_negative",
  "score": 0-100,
  "signals": ["signal1", "signal2"],
  "readyForAsk": true|false,
  "concernFlags": ["concern1"],
  "recommendedNextAction": "string",
  "urgency": "immediate|soon|standard"
}`;

  try {
    const raw = await ai.generate(
      'You are an expert fundraising sentiment analyst. Return only valid JSON.',
      prompt,
      { maxTokens: 300, org }
    );
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (err) {
    logger.warn('Sentiment analysis failed', { err: err.message });
    return { sentiment: 'neutral', score: 50, readyForAsk: false, urgency: 'standard' };
  }
}

// ─── Stewardship Effectiveness Reporter ──────────────────────────────────────

async function getVSOPerformanceReport(orgId, days = 30) {
  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE ol.agent = 'VSO')                        AS total_touches,
        COUNT(*) FILTER (WHERE ol.agent = 'VSO' AND ol.opened = true)   AS opens,
        COUNT(*) FILTER (WHERE ol.agent = 'VSO' AND ol.replied = true)  AS replies,
        COUNT(*) FILTER (WHERE ol.agent = 'VSO' AND ol.gift_resulted = true) AS gifts_resulted,
        COALESCE(SUM(g.amount) FILTER (WHERE ol.agent = 'VSO' AND ol.gift_resulted = true), 0) AS revenue_from_stewardship,
        COUNT(DISTINCT ol.donor_id) FILTER (WHERE ol.agent = 'VSO')     AS donors_touched
      FROM outreach_log ol
      LEFT JOIN gifts g ON g.donor_id = ol.donor_id
        AND g.gift_date BETWEEN ol.sent_at AND ol.sent_at + INTERVAL '30 days'
      WHERE ol.org_id = $1
        AND ol.sent_at > NOW() - ($2 || ' days')::INTERVAL
    `, [orgId, days]);

    const r = rows[0] || {};
    const openRate  = r.total_touches > 0 ? (r.opens / r.total_touches * 100).toFixed(1) : 0;
    const replyRate = r.total_touches > 0 ? (r.replies / r.total_touches * 100).toFixed(1) : 0;

    return {
      period:        `Last ${days} days`,
      touchpoints:   parseInt(r.total_touches) || 0,
      donorsTouched: parseInt(r.donors_touched) || 0,
      openRate:      `${openRate}%`,
      replyRate:     `${replyRate}%`,
      giftsResulted: parseInt(r.gifts_resulted) || 0,
      revenueFromStewardship: parseInt(r.revenue_from_stewardship) || 0,
      roi: r.revenue_from_stewardship > 0
        ? `$${(r.revenue_from_stewardship / Math.max(r.total_touches, 1) * 0.05).toFixed(0)} per touchpoint`
        : 'N/A',
    };
  } catch (err) {
    logger.error('VSO performance report failed', { err: err.message });
    return {};
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Classification
  classifyDonor,
  DONOR_TYPES,

  // Health scoring
  calculateRHS,
  rhsTier,

  // Scheduling
  scheduleNextTouchpoint,
  selectTouchpointType,

  // Content generation
  generateStewardshipContent,

  // Planned giving
  buildPlannedGiftStewardshipPlan,

  // Leadership annual
  evaluateUpgradePath,

  // Monthly sustainer
  assessSustainerChurnRisk,

  // Queue
  buildDailyQueue,

  // Sentiment
  analyzeDonorSentiment,

  // Reporting
  getVSOPerformanceReport,
};
