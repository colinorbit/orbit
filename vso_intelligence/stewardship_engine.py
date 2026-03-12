"""
VSO Stewardship Engine
======================
Core decision engine for the Virtual Stewardship Officer.

Determines the RIGHT action, RIGHT channel, RIGHT timing, and RIGHT content
strategy for every stewardship touchpoint. Tiered by gift level, archetype,
engagement health, and life events.

Beats GiveCampus / Givezly by:
  - AUTONOMOUS action selection (not dashboard prompts)
  - Psychographic content DNA per archetype (not generic thank-yous)
  - Gift-tier-aware cadence (annual fund through principal gift)
  - Upgrade pathway modeling baked into every stewardship action
  - Life event awareness (pause, pivot, or deepen based on signal)
  - Named fund / impact matching (specificity that platforms can't match)
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ─── ACTION TYPES ────────────────────────────────────────────────────────────

class StewAction(str, Enum):
    GIFT_ACKNOWLEDGMENT      = "gift_acknowledgment"       # Triggered immediately post-gift
    IMPACT_REPORT            = "impact_report"              # Quarterly / annual fund report
    RENEWAL_NUDGE            = "renewal_nudge"              # Proactive renewal (before lapse)
    UPGRADE_ASK              = "upgrade_ask"                # Upgrade pitch to next level
    MILESTONE_RECOGNITION    = "milestone_recognition"      # Streak, cumulative, society upgrade
    SOFT_SOLICITATION        = "soft_solicitation"          # Light ask after cultivation
    ESTATE_SEED              = "estate_seed"                # Planned giving conversation plant
    LAPSE_WARM_OUTREACH      = "lapse_warm_outreach"        # First re-engagement (no ask)
    LAPSE_SOFT_ASK           = "lapse_soft_ask"             # Second / third lapsed re-ask
    RELATIONSHIP_CHECKUP     = "relationship_checkup"       # Pure warmth, no ask
    GIVING_DAY_PREP          = "giving_day_prep"            # Pre-Giving Day engagement
    SOCIETY_WELCOME          = "society_welcome"            # Welcome to new giving society
    MATCHING_GIFT_ALERT      = "matching_gift_alert"        # Unclaimed employer match
    PLEDGE_REMINDER          = "pledge_reminder"            # Upcoming pledge installment
    EVENT_INVITATION         = "event_invitation"           # Stewardship / recognition event
    NAMED_FUND_UPDATE        = "named_fund_update"          # Named fund / scholarship report
    ESCALATE_TO_MGO          = "escalate_to_mgo"            # Hand off to human gift officer


# ─── GIFT TIERS ──────────────────────────────────────────────────────────────

class GiftTier(str, Enum):
    MICRO        = "micro"        # <$100
    ANNUAL       = "annual"       # $100–$999
    MID_LEVEL    = "mid_level"    # $1,000–$9,999
    LEADERSHIP   = "leadership"   # $10,000–$24,999
    MAJOR        = "major"        # $25,000–$99,999
    PRINCIPAL    = "principal"    # $100,000+


def classify_tier(last_gift_cents: int, total_giving_cents: int) -> GiftTier:
    """Classify donor tier based on most recent gift and cumulative giving."""
    lg = last_gift_cents
    if lg == 0:
        # Use lifetime if no last gift
        lg = total_giving_cents // max(1, 1)
    if lg >= 10_000_00:
        return GiftTier.PRINCIPAL
    if lg >= 2_500_00:
        return GiftTier.MAJOR
    if lg >= 1_000_00:
        return GiftTier.LEADERSHIP
    if lg >= 100_00:
        return GiftTier.MID_LEVEL
    if lg >= 100_00:  # $100
        return GiftTier.ANNUAL
    return GiftTier.MICRO


# ─── STEWARDSHIP DECISION ────────────────────────────────────────────────────

@dataclass
class StewDecision:
    action:             StewAction
    tier:               GiftTier
    urgency:            str             # "immediate" | "high" | "medium" | "low"
    channel:            str             # "email" | "email+phone" | "phone" | "handwritten" | "portal"
    content_themes:     list[str]       # Ordered list of content directives
    tone:               str             # Tone anchor for this message
    cta:                str             # Clear call-to-action
    ask_amount_cents:   int = 0         # 0 = no ask; >0 = upgrade/renewal amount
    escalate_to_human:  bool = False
    hold_days:          int = 0         # Days to wait before executing (cooling-off)
    rationale:          str = ""        # Why this action was chosen


# ─── TIER CADENCES ───────────────────────────────────────────────────────────

# Touchpoints per year by tier (VSO-managed)
TIER_ANNUAL_TOUCHPOINTS = {
    GiftTier.MICRO:      2,
    GiftTier.ANNUAL:     4,
    GiftTier.MID_LEVEL:  6,
    GiftTier.LEADERSHIP: 10,
    GiftTier.MAJOR:      14,
    GiftTier.PRINCIPAL:  0,   # Human-managed; VSO supports only
}

TIER_CHANNELS = {
    GiftTier.MICRO:      "email",
    GiftTier.ANNUAL:     "email",
    GiftTier.MID_LEVEL:  "email",
    GiftTier.LEADERSHIP: "email+phone",
    GiftTier.MAJOR:      "phone",
    GiftTier.PRINCIPAL:  "handwritten",
}

ARCHETYPE_TONES = {
    "LEGACY_BUILDER":     "reverent, legacy-focused, institutional pride",
    "COMMUNITY_CHAMPION": "warm, communal, shared-mission, inclusive",
    "IMPACT_INVESTOR":    "data-driven, outcomes-focused, ROI-framed",
    "LOYAL_ALUMNI":       "nostalgic, identity-affirming, belonging",
    "MISSION_ZEALOT":     "passionate, mission-first, urgency without pressure",
    "SOCIAL_CONNECTOR":   "energetic, peer-referencing, social proof-heavy",
    "PRAGMATIC_PARTNER":  "direct, value-exchange, efficient, no fluff",
    "FAITH_DRIVEN":       "values-anchored, purposeful, service-oriented",
}


# ─── CORE DECISION FUNCTION ──────────────────────────────────────────────────

def decide_stewardship_action(
    donor: dict,
    lapse_risk=None,           # LapseRisk from lapse_predictor
    recognition_events=None,   # list[RecognitionEvent] from recognition_engine
    life_events=None,          # list[LifeEvent] from life_event_detector
    days_since_last_gift: int = 0,
    days_since_last_contact: int = 0,
) -> StewDecision:
    """
    Determine the optimal stewardship action for a donor right now.
    Decision hierarchy (priority order):
      1. Life event override (bereavement/distress → hold; estate → escalate)
      2. Immediate post-gift acknowledgment
      3. Pledge installment reminder
      4. Recognition milestone
      5. Lapse risk intervention
      6. Upgrade pathway
      7. Impact reporting (scheduled)
      8. Relationship warmth (scheduled)
    """
    recognition_events = recognition_events or []
    life_events = life_events or []

    last_gift_cents = donor.get("lastGiftCents", 0) or (donor.get("lastGiftAmount", 0) * 100)
    total_cents     = donor.get("totalGiving", 0) * 100 if donor.get("totalGiving", 0) < 1_000_000 else donor.get("totalGiving", 0)
    streak          = donor.get("givingStreak", 0)
    archetype       = donor.get("archetype", "LOYAL_ALUMNI")
    stage           = donor.get("journeyStage", "stewardship")
    bequeath_score  = donor.get("bequeathScore", 0)

    tier = classify_tier(last_gift_cents, int(total_cents))
    tone = ARCHETYPE_TONES.get(archetype, "warm, personalized, authentic")

    # ── 1. LIFE EVENT OVERRIDES ──────────────────────────────────────────────
    if life_events:
        urgencies = {e.urgency for e in life_events}
        types = {e.event_type for e in life_events}
        from veo_intelligence.life_event_detector import LifeEventType
        if LifeEventType.OPT_OUT_REQUEST in types:
            return StewDecision(
                action=StewAction.ESCALATE_TO_MGO,
                tier=tier, urgency="immediate",
                channel="none",
                content_themes=["Opt-out acknowledged — suppress all AI outreach"],
                tone="none",
                cta="none",
                escalate_to_human=True,
                hold_days=365,
                rationale="Donor requested opt-out. All outreach suspended.",
            )
        if LifeEventType.BEREAVEMENT in types or LifeEventType.DISTRESS in types:
            return StewDecision(
                action=StewAction.RELATIONSHIP_CHECKUP,
                tier=tier, urgency="high",
                channel="handwritten" if tier in (GiftTier.MAJOR, GiftTier.PRINCIPAL) else "email",
                content_themes=[
                    "Genuine care message — NO solicitation of any kind",
                    "Acknowledge their difficulty without being intrusive",
                    "Offer connection to human relationship manager",
                ],
                tone="compassionate, human, unhurried",
                cta="No CTA — purely supportive",
                escalate_to_human=tier in (GiftTier.LEADERSHIP, GiftTier.MAJOR, GiftTier.PRINCIPAL),
                hold_days=0,
                rationale="Life event detected. Stewardship pivots to pure care with zero ask.",
            )
        # Estate planning → planned giving escalation
        if LifeEventType.COMPANY_IPO in types or any(
            "estate" in getattr(e, "detail", "").lower() for e in life_events
        ):
            return StewDecision(
                action=StewAction.ESCALATE_TO_MGO,
                tier=tier, urgency="immediate",
                channel="phone",
                content_themes=[
                    "Major capacity event detected",
                    "Hand off to Major Gifts Officer for personal conversation",
                    "Do NOT make ask via AI under any circumstance",
                ],
                tone="none — human takeover",
                cta="none",
                escalate_to_human=True,
                hold_days=0,
                rationale="Wealth event or estate planning signal — must escalate to MGO.",
            )

    # ── 2. POST-GIFT ACKNOWLEDGMENT (within 24 hrs) ──────────────────────────
    if days_since_last_gift <= 1 and last_gift_cents > 0:
        channel = TIER_CHANNELS.get(tier, "email")
        return StewDecision(
            action=StewAction.GIFT_ACKNOWLEDGMENT,
            tier=tier, urgency="immediate",
            channel=channel,
            content_themes=[
                f"Thank donor for their ${last_gift_cents // 100:,} gift — specific, not generic",
                "Reference exact fund or program this gift supports",
                "Share ONE concrete impact story (student, research, or program) tied to this fund",
                "Reinforce donor identity: they are a changemaker, not just a donor",
                "Giving streak recognition if applicable" if streak >= 3 else "",
                "Soft forward: 'Your continued support makes next year's plans possible'",
            ],
            tone=tone,
            cta="No ask — this is pure gratitude",
            rationale=f"Post-gift acknowledgment within 24 hours for ${last_gift_cents // 100:,} gift.",
        )

    # ── 3. PLEDGE REMINDER ───────────────────────────────────────────────────
    if stage == "committed" and donor.get("pledgeInstallmentDueSoon"):
        return StewDecision(
            action=StewAction.PLEDGE_REMINDER,
            tier=tier, urgency="high",
            channel="email",
            content_themes=[
                "Warm reminder of upcoming pledge installment",
                "Reference the impact their pledge is making so far",
                "Easy payment link/instructions",
                "Offer to adjust schedule if needed — show flexibility",
            ],
            tone="appreciative, easy-going, no pressure",
            cta="Pay installment (link)",
            rationale="Pledge installment coming due.",
        )

    # ── 4. RECOGNITION MILESTONES ────────────────────────────────────────────
    if recognition_events:
        most_urgent = recognition_events[0]  # Already sorted by priority
        channel = TIER_CHANNELS.get(tier, "email")
        if tier in (GiftTier.MAJOR, GiftTier.PRINCIPAL):
            channel = "handwritten"
        return StewDecision(
            action=StewAction.MILESTONE_RECOGNITION,
            tier=tier, urgency="high",
            channel=channel,
            content_themes=[
                f"Recognize: {most_urgent.description}",
                "Make donor feel genuinely seen and special — not a mail-merge",
                "Reference their cumulative impact over the years",
                "Invite to higher recognition tier or exclusive experience" if most_urgent.society_upgrade else "",
                "Frame milestone as community achievement, not just personal",
            ],
            tone=tone,
            cta=most_urgent.cta if hasattr(most_urgent, "cta") else "No ask — recognition only",
            rationale=f"Milestone detected: {most_urgent.description}",
        )

    # ── 5. LAPSE RISK INTERVENTION ───────────────────────────────────────────
    if lapse_risk:
        from .lapse_predictor import LapseTier
        if lapse_risk.tier == LapseTier.CRITICAL:
            return StewDecision(
                action=StewAction.LAPSE_WARM_OUTREACH,
                tier=tier, urgency="high",
                channel=TIER_CHANNELS.get(tier, "email"),
                content_themes=[
                    "Reconnect — NOT a guilt-trip, NOT an ask",
                    "Reference their history of impact warmly",
                    "Share what has changed/improved since last contact",
                    "Ask a question to re-engage: 'What matters most to you this year?'",
                    "Only if re-engagement succeeds → soft renewal in follow-up",
                ],
                tone="warm, genuine, no pressure",
                cta="Reply or click — conversational engagement",
                rationale=f"Critical lapse risk: {lapse_risk.days_since_last_gift} days since last gift.",
            )
        if lapse_risk.tier == LapseTier.HIGH:
            return StewDecision(
                action=StewAction.RENEWAL_NUDGE,
                tier=tier, urgency="medium",
                channel="email",
                content_themes=[
                    "Proactive renewal before lapse occurs",
                    "Reference their giving streak / loyalty",
                    "Show concrete impact from their previous gift",
                    "Make renewal feel like the natural continuation of their story",
                ],
                tone=tone,
                cta=f"Renew your ${last_gift_cents // 100:,} gift" if last_gift_cents else "Make your annual gift",
                ask_amount_cents=last_gift_cents,
                rationale=f"High lapse risk: {lapse_risk.days_since_last_gift} days since last gift.",
            )

    # ── 6. UPGRADE PATHWAY ───────────────────────────────────────────────────
    # Upgrade ask only when: high engagement, long streak, capacity signal, appropriate timing
    upgrade_eligible = (
        streak >= 3
        and days_since_last_gift < 365
        and days_since_last_contact < 90
        and lapse_risk is None
        and tier not in (GiftTier.PRINCIPAL,)
    )
    if upgrade_eligible and donor.get("upgradeReady"):
        next_ask = _calculate_upgrade_ask(last_gift_cents, tier)
        return StewDecision(
            action=StewAction.UPGRADE_ASK,
            tier=tier, urgency="medium",
            channel="email" if tier == GiftTier.ANNUAL else "email+phone",
            content_themes=[
                f"Celebrate their {streak}-year streak of giving",
                "Show cumulative impact — their dollars at work over time",
                "Present upgrade as natural next chapter of their commitment",
                "Specific new opportunity unlocked at next level",
                "Peer social proof: 'Donors like you who moved to this level saw...'",
            ],
            tone=tone,
            cta=f"Deepen your impact with a ${next_ask // 100:,} gift this year",
            ask_amount_cents=next_ask,
            rationale=f"Upgrade-ready: {streak}-year streak, strong engagement.",
        )

    # ── 7. ESTATE / PLANNED GIVING SEED ──────────────────────────────────────
    if bequeath_score >= 65 and tier in (GiftTier.LEADERSHIP, GiftTier.MAJOR, GiftTier.PRINCIPAL):
        return StewDecision(
            action=StewAction.ESTATE_SEED,
            tier=tier, urgency="low",
            channel="email+phone",
            content_themes=[
                "Acknowledge their long-term commitment to the institution",
                "Introduce legacy giving concept through storytelling (not hard pitch)",
                "Share a compelling story about a bequest donor's lasting impact",
                "Offer a no-pressure guide: 'How to make a legacy gift at Greenfield'",
                "Ask ZERO — this is education and relationship only",
            ],
            tone="reflective, legacy-focused, unhurried",
            cta="Download Legacy Giving Guide (soft CTA)",
            escalate_to_human=True,
            rationale=f"Bequest score {bequeath_score} ≥ 65 — planned giving seed conversation appropriate.",
        )

    # ── 8. IMPACT REPORT (scheduled) ─────────────────────────────────────────
    month = 3  # March impact season default
    if days_since_last_contact > 90:
        return StewDecision(
            action=StewAction.IMPACT_REPORT,
            tier=tier, urgency="medium",
            channel="email",
            content_themes=[
                "Quarterly impact update tailored to their fund designation",
                "Lead with a student story or research breakthrough tied to their giving",
                "Include one data point that shows institution progress",
                "Reference their specific giving history in present tense: 'Your support has...'",
                "Close with forward-looking excitement, no explicit ask",
            ],
            tone=tone,
            cta="See full impact story (read more link)",
            rationale=f"{days_since_last_contact} days since last contact — scheduled impact report due.",
        )

    # ── 9. RELATIONSHIP WARMTH (default) ────────────────────────────────────
    return StewDecision(
        action=StewAction.RELATIONSHIP_CHECKUP,
        tier=tier, urgency="low",
        channel="email",
        content_themes=[
            "Check in warmly — no agenda, no ask",
            "Share an interesting institutional update relevant to their interests",
            "Invite engagement: event, volunteer opportunity, or survey",
        ],
        tone=tone,
        cta="No ask — relationship maintenance",
        rationale="Scheduled relationship warmth touchpoint.",
    )


def _calculate_upgrade_ask(last_gift_cents: int, tier: GiftTier) -> int:
    """Calculate suggested upgrade ask amount."""
    multipliers = {
        GiftTier.MICRO:      2.0,
        GiftTier.ANNUAL:     1.5,
        GiftTier.MID_LEVEL:  1.35,
        GiftTier.LEADERSHIP: 1.25,
        GiftTier.MAJOR:      1.20,
        GiftTier.PRINCIPAL:  1.10,
    }
    m = multipliers.get(tier, 1.25)
    upgraded = int(last_gift_cents * m)
    # Round to nearest clean amount
    if upgraded < 10_000:      # <$100: round to $5
        upgraded = round(upgraded / 500) * 500
    elif upgraded < 100_000:   # <$1K: round to $25
        upgraded = round(upgraded / 2500) * 2500
    elif upgraded < 1_000_000: # <$10K: round to $100
        upgraded = round(upgraded / 10000) * 10000
    else:                      # $10K+: round to $500
        upgraded = round(upgraded / 50000) * 50000
    return max(upgraded, last_gift_cents + 100)


# ─── PROMPT FORMATTER ────────────────────────────────────────────────────────

def format_decision_for_prompt(decision: StewDecision) -> str:
    """Format stewardship decision for injection into VSO system prompt."""
    lines = [
        f"ACTION: {decision.action.value.replace('_', ' ').title()}",
        f"TIER: {decision.tier.value.replace('_', ' ').title()}",
        f"URGENCY: {decision.urgency.upper()}",
        f"CHANNEL: {decision.channel}",
        f"TONE ANCHOR: {decision.tone}",
        "",
        "CONTENT DIRECTIVES:",
    ]
    for t in decision.content_themes:
        if t:
            lines.append(f"  • {t}")
    lines.append(f"\nCTA: {decision.cta}")
    if decision.ask_amount_cents > 0:
        lines.append(f"ASK AMOUNT: ${decision.ask_amount_cents // 100:,}")
    if decision.escalate_to_human:
        lines.append("⚠ ESCALATE TO HUMAN GIFT OFFICER — DO NOT proceed with AI solicitation")
    if decision.hold_days > 0:
        lines.append(f"HOLD: Do not contact for {decision.hold_days} days")
    lines.append(f"\nRATIONALE: {decision.rationale}")
    return "\n".join(lines)
