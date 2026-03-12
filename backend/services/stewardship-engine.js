'use strict';
/**
 * VSO Stewardship Engine — Core Decision Logic
 * ============================================
 * Ported from vso_intelligence/stewardship_engine.py
 *
 * Determines the RIGHT action, RIGHT channel, RIGHT timing, and RIGHT content
 * for every stewardship touchpoint based on:
 *   - Gift tier (micro → principal)
 *   - Donor archetype
 *   - Engagement health & lapse risk
 *   - Life events
 *   - Donation history & giving streak
 */

// ─── ACTION TYPES ────────────────────────────────────────────────────────────

const StewAction = {
  GIFT_ACKNOWLEDGMENT:      'gift_acknowledgment',
  IMPACT_REPORT:            'impact_report',
  RENEWAL_NUDGE:            'renewal_nudge',
  UPGRADE_ASK:              'upgrade_ask',
  MILESTONE_RECOGNITION:    'milestone_recognition',
  SOFT_SOLICITATION:        'soft_solicitation',
  ESTATE_SEED:              'estate_seed',
  LAPSE_WARM_OUTREACH:      'lapse_warm_outreach',
  LAPSE_SOFT_ASK:           'lapse_soft_ask',
  RELATIONSHIP_CHECKUP:     'relationship_checkup',
  GIVING_DAY_PREP:          'giving_day_prep',
  SOCIETY_WELCOME:          'society_welcome',
  MATCHING_GIFT_ALERT:      'matching_gift_alert',
  PLEDGE_REMINDER:          'pledge_reminder',
  EVENT_INVITATION:         'event_invitation',
  NAMED_FUND_UPDATE:        'named_fund_update',
  ESCALATE_TO_MGO:          'escalate_to_mgo',
};

// ─── GIFT TIERS ──────────────────────────────────────────────────────────────

const GiftTier = {
  MICRO:      'micro',        // <$100
  ANNUAL:     'annual',       // $100–$999
  MID_LEVEL:  'mid_level',    // $1,000–$9,999
  LEADERSHIP: 'leadership',   // $10,000–$24,999
  MAJOR:      'major',        // $25,000–$99,999
  PRINCIPAL:  'principal',    // $100,000+
};

// ─── LAPSE TIERS ─────────────────────────────────────────────────────────────

const LapseTier = {
  CRITICAL: 'critical',
  HIGH:     'high',
  MEDIUM:   'medium',
  LOW:      'low',
};

/**
 * Classify donor tier based on most recent gift and cumulative giving.
 * Gift amounts are expected in cents (e.g., 50000 = $500)
 */
function classifyTier(lastGiftCents, totalGivingCents) {
  let lg = lastGiftCents;
  if (lg === 0 || lg === undefined) {
    lg = totalGivingCents || 0;
  }

  if (lg >= 10_000_00) return GiftTier.PRINCIPAL;   // $10,000+
  if (lg >= 2_500_00)  return GiftTier.MAJOR;       // $2,500+
  if (lg >= 1_000_00)  return GiftTier.LEADERSHIP;  // $1,000+
  if (lg >= 100_00)    return GiftTier.MID_LEVEL;   // $100+
  if (lg >= 50_00)     return GiftTier.ANNUAL;      // $50+
  return GiftTier.MICRO;                             // <$50
}

// ─── TIER CADENCES ───────────────────────────────────────────────────────────

const TIER_ANNUAL_TOUCHPOINTS = {
  [GiftTier.MICRO]:      2,
  [GiftTier.ANNUAL]:     4,
  [GiftTier.MID_LEVEL]:  6,
  [GiftTier.LEADERSHIP]: 10,
  [GiftTier.MAJOR]:      14,
  [GiftTier.PRINCIPAL]:  0,   // Human-managed only
};

const TIER_CHANNELS = {
  [GiftTier.MICRO]:      'email',
  [GiftTier.ANNUAL]:     'email',
  [GiftTier.MID_LEVEL]:  'email',
  [GiftTier.LEADERSHIP]: 'email+phone',
  [GiftTier.MAJOR]:      'phone',
  [GiftTier.PRINCIPAL]:  'handwritten',
};

const ARCHETYPE_TONES = {
  'LEGACY_BUILDER':     'reverent, legacy-focused, institutional pride',
  'COMMUNITY_CHAMPION': 'warm, communal, shared-mission, inclusive',
  'IMPACT_INVESTOR':    'data-driven, outcomes-focused, ROI-framed',
  'LOYAL_ALUMNI':       'nostalgic, identity-affirming, belonging',
  'MISSION_ZEALOT':     'passionate, mission-first, urgency without pressure',
  'SOCIAL_CONNECTOR':   'energetic, peer-referencing, social proof-heavy',
  'PRAGMATIC_PARTNER':  'direct, value-exchange, efficient, no fluff',
  'FAITH_DRIVEN':       'values-anchored, purposeful, service-oriented',
};

// ─── STEWARDSHIP DECISION CLASS ───────────────────────────────────────────

class StewDecision {
  constructor(opts = {}) {
    this.action = opts.action || StewAction.RELATIONSHIP_CHECKUP;
    this.tier = opts.tier || GiftTier.ANNUAL;
    this.urgency = opts.urgency || 'medium';
    this.channel = opts.channel || 'email';
    this.content_themes = opts.content_themes || [];
    this.tone = opts.tone || 'warm, personalized, authentic';
    this.cta = opts.cta || 'No CTA';
    this.ask_amount_cents = opts.ask_amount_cents || 0;
    this.escalate_to_human = opts.escalate_to_human || false;
    this.hold_days = opts.hold_days || 0;
    this.rationale = opts.rationale || '';
  }
}

/**
 * CORE DECISION FUNCTION
 * Determine the optimal stewardship action for a donor right now.
 *
 * Priority order:
 *   1. Life event override (bereavement/distress → hold; estate → escalate)
 *   2. Immediate post-gift acknowledgment
 *   3. Pledge installment reminder
 *   4. Recognition milestone
 *   5. Lapse risk intervention
 *   6. Upgrade pathway
 *   7. Estate / planned giving seed
 *   8. Impact reporting (scheduled)
 *   9. Relationship warmth (scheduled)
 */
function decideStewAction(
  donor,
  opts = {}
) {
  const {
    lapse_risk = null,
    recognition_events = [],
    life_events = [],
    days_since_last_gift = 0,
    days_since_last_contact = 0,
  } = opts;

  // Extract donor profile
  const lastGiftCents = donor.lastGiftCents || (donor.lastGiftAmount * 100) || 0;
  const totalCents = (donor.totalGiving < 1_000_000)
    ? (donor.totalGiving * 100)
    : donor.totalGiving;
  const streak = donor.givingStreak || 0;
  const archetype = donor.archetype || 'LOYAL_ALUMNI';
  const stage = donor.journeyStage || 'stewardship';
  const bequeathScore = donor.bequeathScore || 0;

  const tier = classifyTier(lastGiftCents, totalCents);
  const tone = ARCHETYPE_TONES[archetype] || 'warm, personalized, authentic';

  // ── 1. LIFE EVENT OVERRIDES ───────────────────────────────────────────
  if (life_events && life_events.length > 0) {
    const eventTypes = life_events.map(e => e.event_type || e.type);
    const eventUrgencies = life_events.map(e => e.urgency);

    // Opt-out request
    if (eventTypes.includes('OPT_OUT_REQUEST')) {
      return new StewDecision({
        action: StewAction.ESCALATE_TO_MGO,
        tier,
        urgency: 'immediate',
        channel: 'none',
        content_themes: ['Opt-out acknowledged — suppress all AI outreach'],
        tone: 'none',
        cta: 'none',
        escalate_to_human: true,
        hold_days: 365,
        rationale: 'Donor requested opt-out. All outreach suspended.',
      });
    }

    // Bereavement or distress
    if (eventTypes.includes('BEREAVEMENT') || eventTypes.includes('DISTRESS')) {
      return new StewDecision({
        action: StewAction.RELATIONSHIP_CHECKUP,
        tier,
        urgency: 'high',
        channel: [GiftTier.MAJOR, GiftTier.PRINCIPAL].includes(tier) ? 'handwritten' : 'email',
        content_themes: [
          'Genuine care message — NO solicitation of any kind',
          'Acknowledge their difficulty without being intrusive',
          'Offer connection to human relationship manager',
        ],
        tone: 'compassionate, human, unhurried',
        cta: 'No CTA — purely supportive',
        escalate_to_human: [GiftTier.LEADERSHIP, GiftTier.MAJOR, GiftTier.PRINCIPAL].includes(tier),
        hold_days: 0,
        rationale: 'Life event detected. Stewardship pivots to pure care with zero ask.',
      });
    }

    // Estate/wealth event
    if (eventTypes.includes('COMPANY_IPO') || eventTypes.some(t => (t || '').toLowerCase().includes('estate'))) {
      return new StewDecision({
        action: StewAction.ESCALATE_TO_MGO,
        tier,
        urgency: 'immediate',
        channel: 'phone',
        content_themes: [
          'Major capacity event detected',
          'Hand off to Major Gifts Officer for personal conversation',
          'Do NOT make ask via AI under any circumstance',
        ],
        tone: 'none — human takeover',
        cta: 'none',
        escalate_to_human: true,
        hold_days: 0,
        rationale: 'Wealth event or estate planning signal — must escalate to MGO.',
      });
    }
  }

  // ── 2. POST-GIFT ACKNOWLEDGMENT (within 24 hrs) ────────────────────────
  if (days_since_last_gift <= 1 && lastGiftCents > 0) {
    const channel = TIER_CHANNELS[tier] || 'email';
    const giftAmountDollars = Math.round(lastGiftCents / 100);
    return new StewDecision({
      action: StewAction.GIFT_ACKNOWLEDGMENT,
      tier,
      urgency: 'immediate',
      channel,
      content_themes: [
        `Thank donor for their $${giftAmountDollars.toLocaleString()} gift — specific, not generic`,
        'Reference exact fund or program this gift supports',
        'Share ONE concrete impact story (student, research, or program) tied to this fund',
        'Reinforce donor identity: they are a changemaker, not just a donor',
        streak >= 3 ? `Giving streak recognition: ${streak}-year streak` : '',
        'Soft forward: "Your continued support makes next year\'s plans possible"',
      ].filter(x => x),
      tone,
      cta: 'No ask — this is pure gratitude',
      rationale: `Post-gift acknowledgment within 24 hours for $${giftAmountDollars.toLocaleString()} gift.`,
    });
  }

  // ── 3. PLEDGE REMINDER ─────────────────────────────────────────────────
  if (stage === 'committed' && donor.pledgeInstallmentDueSoon) {
    return new StewDecision({
      action: StewAction.PLEDGE_REMINDER,
      tier,
      urgency: 'high',
      channel: 'email',
      content_themes: [
        'Warm reminder of upcoming pledge installment',
        'Reference the impact their pledge is making so far',
        'Easy payment link/instructions',
        'Offer to adjust schedule if needed — show flexibility',
      ],
      tone: 'appreciative, easy-going, no pressure',
      cta: 'Pay installment (link)',
      rationale: 'Pledge installment coming due.',
    });
  }

  // ── 4. RECOGNITION MILESTONES ──────────────────────────────────────────
  if (recognition_events && recognition_events.length > 0) {
    const mostUrgent = recognition_events[0];
    let channel = TIER_CHANNELS[tier] || 'email';
    if ([GiftTier.MAJOR, GiftTier.PRINCIPAL].includes(tier)) {
      channel = 'handwritten';
    }
    return new StewDecision({
      action: StewAction.MILESTONE_RECOGNITION,
      tier,
      urgency: 'high',
      channel,
      content_themes: [
        `Recognize: ${mostUrgent.description || mostUrgent.event_type}`,
        'Make donor feel genuinely seen and special — not a mail-merge',
        'Reference their cumulative impact over the years',
        mostUrgent.society_upgrade ? 'Invite to higher recognition tier or exclusive experience' : '',
        'Frame milestone as community achievement, not just personal',
      ].filter(x => x),
      tone,
      cta: mostUrgent.cta || 'No ask — recognition only',
      rationale: `Milestone detected: ${mostUrgent.description || mostUrgent.event_type}`,
    });
  }

  // ── 5. LAPSE RISK INTERVENTION ─────────────────────────────────────────
  if (lapse_risk) {
    if (lapse_risk.tier === LapseTier.CRITICAL) {
      return new StewDecision({
        action: StewAction.LAPSE_WARM_OUTREACH,
        tier,
        urgency: 'high',
        channel: TIER_CHANNELS[tier] || 'email',
        content_themes: [
          'Reconnect — NOT a guilt-trip, NOT an ask',
          'Reference their history of impact warmly',
          'Share what has changed/improved since last contact',
          'Ask a question to re-engage: "What matters most to you this year?"',
          'Only if re-engagement succeeds → soft renewal in follow-up',
        ],
        tone: 'warm, genuine, no pressure',
        cta: 'Reply or click — conversational engagement',
        rationale: `Critical lapse risk: ${lapse_risk.days_since_last_gift || 365} days since last gift.`,
      });
    }
    if (lapse_risk.tier === LapseTier.HIGH) {
      const giftAmountDollars = Math.round(lastGiftCents / 100);
      return new StewDecision({
        action: StewAction.RENEWAL_NUDGE,
        tier,
        urgency: 'medium',
        channel: 'email',
        content_themes: [
          'Proactive renewal before lapse occurs',
          'Reference their giving streak / loyalty',
          'Show concrete impact from their previous gift',
          'Make renewal feel like the natural continuation of their story',
        ],
        tone,
        cta: lastGiftCents > 0
          ? `Renew your $${giftAmountDollars.toLocaleString()} gift`
          : 'Make your annual gift',
        ask_amount_cents: lastGiftCents,
        rationale: `High lapse risk: ${lapse_risk.days_since_last_gift || 365} days since last gift.`,
      });
    }
  }

  // ── 6. UPGRADE PATHWAY ───────────────────────────────────────────────────
  const upgradeEligible = (
    streak >= 3
    && days_since_last_gift < 365
    && days_since_last_contact < 90
    && !lapse_risk
    && tier !== GiftTier.PRINCIPAL
  );
  if (upgradeEligible && donor.upgradeReady) {
    const nextAsk = calculateUpgradeAsk(lastGiftCents, tier);
    const nextAskDollars = Math.round(nextAsk / 100);
    return new StewDecision({
      action: StewAction.UPGRADE_ASK,
      tier,
      urgency: 'medium',
      channel: tier === GiftTier.ANNUAL ? 'email' : 'email+phone',
      content_themes: [
        `Celebrate their ${streak}-year streak of giving`,
        'Show cumulative impact — their dollars at work over time',
        'Present upgrade as natural next chapter of their commitment',
        'Specific new opportunity unlocked at next level',
        'Peer social proof: "Donors like you who moved to this level saw..."',
      ],
      tone,
      cta: `Deepen your impact with a $${nextAskDollars.toLocaleString()} gift this year`,
      ask_amount_cents: nextAsk,
      rationale: `Upgrade-ready: ${streak}-year streak, strong engagement.`,
    });
  }

  // ── 7. ESTATE / PLANNED GIVING SEED ────────────────────────────────────
  if (bequeathScore >= 65 && [GiftTier.LEADERSHIP, GiftTier.MAJOR, GiftTier.PRINCIPAL].includes(tier)) {
    return new StewDecision({
      action: StewAction.ESTATE_SEED,
      tier,
      urgency: 'low',
      channel: 'email+phone',
      content_themes: [
        'Acknowledge their long-term commitment to the institution',
        'Introduce legacy giving concept through storytelling (not hard pitch)',
        'Share a compelling story about a bequest donor\'s lasting impact',
        'Offer a no-pressure guide: "How to make a legacy gift"',
        'Ask ZERO — this is education and relationship only',
      ],
      tone: 'reflective, legacy-focused, unhurried',
      cta: 'Download Legacy Giving Guide (soft CTA)',
      escalate_to_human: true,
      rationale: `Bequest score ${bequeathScore} ≥ 65 — planned giving seed conversation appropriate.`,
    });
  }

  // ── 8. IMPACT REPORT (scheduled) ───────────────────────────────────────
  if (days_since_last_contact > 90) {
    return new StewDecision({
      action: StewAction.IMPACT_REPORT,
      tier,
      urgency: 'medium',
      channel: 'email',
      content_themes: [
        'Quarterly impact update tailored to their fund designation',
        'Lead with a student story or research breakthrough tied to their giving',
        'Include one data point that shows institution progress',
        'Reference their specific giving history in present tense: "Your support has..."',
        'Close with forward-looking excitement, no explicit ask',
      ],
      tone,
      cta: 'See full impact story (read more link)',
      rationale: `${days_since_last_contact} days since last contact — scheduled impact report due.`,
    });
  }

  // ── 9. RELATIONSHIP WARMTH (default) ───────────────────────────────────
  return new StewDecision({
    action: StewAction.RELATIONSHIP_CHECKUP,
    tier,
    urgency: 'low',
    channel: 'email',
    content_themes: [
      'Check in warmly — no agenda, no ask',
      'Share an interesting institutional update relevant to their interests',
      'Invite engagement: event, volunteer opportunity, or survey',
    ],
    tone,
    cta: 'No ask — relationship maintenance',
    rationale: 'Scheduled relationship warmth touchpoint.',
  });
}

/**
 * Calculate suggested upgrade ask amount.
 */
function calculateUpgradeAsk(lastGiftCents, tier) {
  const multipliers = {
    [GiftTier.MICRO]:      2.0,
    [GiftTier.ANNUAL]:     1.5,
    [GiftTier.MID_LEVEL]:  1.35,
    [GiftTier.LEADERSHIP]: 1.25,
    [GiftTier.MAJOR]:      1.20,
    [GiftTier.PRINCIPAL]:  1.10,
  };

  let m = multipliers[tier] || 1.25;
  let upgraded = Math.round(lastGiftCents * m);

  // Round to clean amounts
  if (upgraded < 10_000) {
    // <$100: round to $5
    upgraded = Math.round(upgraded / 500) * 500;
  } else if (upgraded < 100_000) {
    // <$1K: round to $25
    upgraded = Math.round(upgraded / 2500) * 2500;
  } else if (upgraded < 1_000_000) {
    // <$10K: round to $100
    upgraded = Math.round(upgraded / 10000) * 10000;
  } else {
    // $10K+: round to $500
    upgraded = Math.round(upgraded / 50000) * 50000;
  }

  return Math.max(upgraded, lastGiftCents + 100);
}

/**
 * Format stewardship decision for injection into VSO system prompt.
 */
function formatDecisionForPrompt(decision) {
  const lines = [
    `ACTION: ${decision.action.replace(/_/g, ' ').toUpperCase()}`,
    `TIER: ${decision.tier.replace(/_/g, ' ').toUpperCase()}`,
    `URGENCY: ${decision.urgency.toUpperCase()}`,
    `CHANNEL: ${decision.channel}`,
    `TONE ANCHOR: ${decision.tone}`,
    '',
    'CONTENT DIRECTIVES:',
  ];

  decision.content_themes.forEach(t => {
    if (t) {
      lines.push(`  • ${t}`);
    }
  });

  lines.push(`\nCTA: ${decision.cta}`);
  if (decision.ask_amount_cents > 0) {
    const dollarsStr = (decision.ask_amount_cents / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    });
    lines.push(`ASK AMOUNT: ${dollarsStr}`);
  }
  if (decision.escalate_to_human) {
    lines.push('⚠ ESCALATE TO HUMAN GIFT OFFICER — DO NOT proceed with AI solicitation');
  }
  if (decision.hold_days > 0) {
    lines.push(`HOLD: Do not contact for ${decision.hold_days} days`);
  }
  lines.push(`\nRATIONALE: ${decision.rationale}`);

  return lines.join('\n');
}

module.exports = {
  StewAction,
  GiftTier,
  LapseTier,
  StewDecision,
  classifyTier,
  decideStewAction,
  calculateUpgradeAsk,
  formatDecisionForPrompt,
  TIER_ANNUAL_TOUCHPOINTS,
  TIER_CHANNELS,
  ARCHETYPE_TONES,
};
