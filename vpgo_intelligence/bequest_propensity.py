"""
VPGO Bequest Propensity Scorer
================================
Multi-signal model that scores each donor's likelihood of making a planned gift.

Signal categories (weighted):
  1. AGE & LIFE STAGE    (25%) — Older donors, retirement, class year proximity
  2. GIVING HISTORY      (20%) — Streak, lifetime total, consistency, loyalty
  3. ESTATE SIGNALS      (20%) — Explicit mentions, life events, financial events
  4. WEALTH INDICATORS   (15%) — Net worth estimate, real estate, business ownership
  5. INSTITUTIONAL DEPTH (10%) — Volunteering, board service, events, time as a donor
  6. PSYCHOGRAPHIC FIT   (10%) — Archetype alignment (Legacy Builders score highest)

Tiers:
  PLATINUM  (80–100): Immediate planned giving conversation — escalate to PGFO
  GOLD      (65–79):  Active cultivation — 45-day VPGO cadence
  SILVER    (50–64):  Passive cultivation — 90-day seed planting
  BRONZE    (35–49):  Annual seed — legacy society awareness only
  WATCH     (20–34):  Monitor; re-evaluate annually
  NOT_READY (<20):    Standard stewardship only

DISCLAIMER: Scores are predictive indicators for internal use only.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
import datetime


# ─── TIERS ────────────────────────────────────────────────────────────────────

class BequestTier(str, Enum):
    PLATINUM  = "platinum"   # 80–100: PGFO immediate conversation
    GOLD      = "gold"       # 65–79:  Active VPGO cultivation
    SILVER    = "silver"     # 50–64:  Passive cultivation
    BRONZE    = "bronze"     # 35–49:  Legacy society awareness
    WATCH     = "watch"      # 20–34:  Monitor annually
    NOT_READY = "not_ready"  # <20:    Standard stewardship


# ─── PROFILE ──────────────────────────────────────────────────────────────────

@dataclass
class BequestProfile:
    score:                  float               # 0.0–100.0
    tier:                   BequestTier
    estimated_age:          Optional[int]
    contributing_signals:   list[str]           # Factors that raised score
    moderating_signals:     list[str]           # Factors that lowered/capped score
    recommended_cadence:    int                 # Days between VPGO touches
    recommended_action:     str
    vehicle_likely:         list[str]           # Most likely gift vehicles
    conversation_readiness: str                 # "ready" | "warming" | "too_early"
    estate_signal_detected: bool
    requires_pgfo:          bool                # True = human planned giving officer needed


# ─── ARCHETYPE MULTIPLIERS ────────────────────────────────────────────────────

# How much each archetype amplifies planned giving propensity
ARCHETYPE_PG_MULTIPLIER = {
    "LEGACY_BUILDER":     1.35,   # Explicitly motivated by legacy — highest
    "FAITH_DRIVEN":       1.25,   # Stewardship of resources as calling
    "COMMUNITY_CHAMPION": 1.10,   # Wants institution to endure for community
    "LOYAL_ALUMNI":       1.10,   # Long relationship = legacy conversion candidate
    "MISSION_ZEALOT":     1.05,   # Institutional mission continuation matters
    "IMPACT_INVESTOR":    1.00,   # Neutral — needs ROI framing for PG
    "PRAGMATIC_PARTNER":  0.90,   # May prefer other vehicles; needs efficiency framing
    "SOCIAL_CONNECTOR":   0.85,   # Less motivated by legacy; more by peer recognition
}


# ─── SCORING ──────────────────────────────────────────────────────────────────

def _estimate_age(class_year: Optional[str]) -> Optional[int]:
    """Estimate donor age from class year (assumes 22 at graduation)."""
    if not class_year:
        return None
    try:
        grad_year = int(class_year)
        return 2026 - grad_year + 22
    except (ValueError, TypeError):
        return None


def score_bequest_propensity(donor: dict, life_events: list = None, signals=None) -> BequestProfile:
    """
    Score a donor's planned giving propensity.
    Returns a BequestProfile with tier, score, signals, and recommended action.
    """
    life_events = life_events or []

    # ── Core data ─────────────────────────────────────────────────────────────
    class_year      = donor.get("classYear")
    archetype       = donor.get("archetype", "LOYAL_ALUMNI")
    streak          = donor.get("givingStreak", 0)
    total_giving    = donor.get("totalGiving", 0)
    bequeath_score  = donor.get("bequeathScore", 0)
    sentiment       = donor.get("sentiment", "neutral")
    stage           = donor.get("journeyStage", "stewardship")
    interests       = donor.get("interests", [])
    conversation    = donor.get("conversationHistory", [])
    wealth_estimate = donor.get("wealthEstimate", 0)
    last_gift_cents = donor.get("lastGiftCents", 0) or int(donor.get("lastGiftAmount", 0) * 100)

    estimated_age = _estimate_age(class_year)
    score = 0.0
    contributing = []
    moderating = []
    vehicle_likely = []

    # If CRM already has a bequest score, use as starting anchor
    if bequeath_score > 0:
        score += bequeath_score * 0.5   # Weight at 50% of raw CRM score
        contributing.append(f"CRM bequest score: {bequeath_score}")

    # ── 1. AGE & LIFE STAGE (25 pts max) ────────────────────────────────────
    if estimated_age:
        if estimated_age >= 80:
            score += 25
            contributing.append(f"Est. age {estimated_age} — prime planned giving window")
            vehicle_likely.extend(["bequest", "cga", "ira_rollover"])
        elif estimated_age >= 70:
            score += 20
            contributing.append(f"Est. age {estimated_age} — strong planned giving age")
            vehicle_likely.extend(["bequest", "ira_rollover", "cga"])
        elif estimated_age >= 60:
            score += 14
            contributing.append(f"Est. age {estimated_age} — approaching planned giving years")
            vehicle_likely.extend(["bequest", "crt", "cga"])
        elif estimated_age >= 50:
            score += 7
            contributing.append(f"Est. age {estimated_age} — early planned giving awareness")
            vehicle_likely.extend(["bequest", "daf"])
        elif estimated_age < 40:
            moderating.append(f"Est. age {estimated_age} — too early for most PG conversations")

    # Check for retirement signals from life events or donor data
    from veo_intelligence.life_event_detector import LifeEventType
    life_types = {e.event_type for e in life_events}
    if LifeEventType.RETIREMENT in life_types:
        score += 8
        contributing.append("Retirement confirmed — life stage transition is prime PG moment")

    # ── 2. GIVING HISTORY (20 pts max) ──────────────────────────────────────
    if streak >= 25:
        score += 20
        contributing.append(f"{streak}-year streak — extraordinary institutional loyalty")
    elif streak >= 15:
        score += 15
        contributing.append(f"{streak}-year streak — deep identity connection")
    elif streak >= 10:
        score += 10
        contributing.append(f"{streak}-year streak — strong loyalty")
    elif streak >= 5:
        score += 5
        contributing.append(f"{streak}-year streak — established habit")

    if total_giving >= 100_000:
        score += 8
        contributing.append(f"${total_giving:,.0f} lifetime giving — major donor relationship")
    elif total_giving >= 25_000:
        score += 5
        contributing.append(f"${total_giving:,.0f} lifetime giving — significant investment")
    elif total_giving >= 5_000:
        score += 2

    # ── 3. ESTATE SIGNALS (20 pts max) ─────────────────────────────────────
    estate_signal_detected = False
    estate_keywords = [
        "estate", "will", "trust", "bequest", "legacy", "leave", "after i'm gone",
        "inheritance", "end of life", "final gift", "endure", "last chapter",
        "my children", "grandchildren", "family plan", "attorney", "financial advisor",
        "retirement savings", "ira", "401k", "assets", "property",
    ]
    for msg in conversation:
        if msg.get("role") == "donor":
            content = msg.get("content", "").lower()
            for kw in estate_keywords:
                if kw in content:
                    score += 15
                    contributing.append(f"Estate/legacy keyword detected in conversation: '{kw}'")
                    estate_signal_detected = True
                    break

    if LifeEventType.BEREAVEMENT in life_types:
        score += 10
        contributing.append("Bereavement event — estate planning often follows loss")
        estate_signal_detected = True

    # Interest alignment
    legacy_interests = ["legacy", "estate", "planned giving", "endowment", "permanent", "forever"]
    if any(i in legacy_interests for i in [x.lower() for x in interests]):
        score += 5
        contributing.append("Stated interests include legacy/endowment focus")

    # ── 4. WEALTH INDICATORS (15 pts max) ──────────────────────────────────
    if signals:
        nw = signals.wealth.estimated_net_worth
        if nw >= 5_000_000_00:   # $5M+
            score += 15
            contributing.append(f"High net worth (${nw//100:,.0f}) — significant planned gift capacity")
            vehicle_likely.extend(["crt", "clt", "daf"])
        elif nw >= 1_000_000_00:  # $1M+
            score += 10
            contributing.append(f"Significant wealth (${nw//100:,.0f}) — CGA/CRT viable")
        elif nw >= 500_000_00:    # $500K+
            score += 5
            contributing.append(f"Moderate wealth (${nw//100:,.0f}) — bequest viable")
        if signals.wealth.real_estate_value >= 500_000_00:
            score += 3
            contributing.append("Significant real estate holdings — retained life estate or CRT option")
            vehicle_likely.append("retained_life_estate")
        if signals.wealth.foundation_giving_total > 0:
            score += 2
            contributing.append("Foundation/990 giving history — philanthropic inclination confirmed")

    elif wealth_estimate >= 2_000_000:
        score += 10
        contributing.append(f"Estimated wealth ${wealth_estimate:,.0f} — planned gift viable")
    elif wealth_estimate >= 500_000:
        score += 5

    # ── 5. INSTITUTIONAL DEPTH (10 pts max) ────────────────────────────────
    years_as_donor = max(streak, donor.get("giftCount", 0))
    if years_as_donor >= 20:
        score += 10
        contributing.append("20+ years as a donor — maximum institutional depth")
    elif years_as_donor >= 10:
        score += 6
        contributing.append("10+ years as a donor — deep institutional relationship")
    elif years_as_donor >= 5:
        score += 3

    if donor.get("isVolunteer") or donor.get("isBoardMember"):
        score += 5
        contributing.append("Volunteer/board service — heightened institutional ownership")

    # ── 6. PSYCHOGRAPHIC (10 pts max) ──────────────────────────────────────
    multiplier = ARCHETYPE_PG_MULTIPLIER.get(archetype, 1.0)
    pg_psycho_base = 7 if multiplier > 1.0 else 4 if multiplier == 1.0 else 2
    score_add = pg_psycho_base * multiplier
    score += score_add
    if multiplier >= 1.25:
        contributing.append(f"Archetype {archetype.replace('_', ' ').title()} — very high PG motivation")
    elif multiplier >= 1.10:
        contributing.append(f"Archetype {archetype.replace('_', ' ').title()} — elevated PG motivation")

    # ── Moderating factors ──────────────────────────────────────────────────
    if sentiment == "negative":
        score *= 0.70
        moderating.append("Negative sentiment — relationship repair needed before PG conversation")
    if stage in ("lapsed_outreach",):
        score *= 0.80
        moderating.append("Lapsed donor — reinstate relationship before PG outreach")
    from veo_intelligence.life_event_detector import LifeEventType
    if LifeEventType.OPT_OUT_REQUEST in life_types:
        score = 0
        moderating.append("OPT-OUT REQUESTED — no outreach permitted")

    # ── Apply CRM score anchor influence ───────────────────────────────────
    # If CRM has no prior score, we use ours fully
    if bequeath_score == 0:
        final_score = min(100.0, score)
    else:
        # Blend: 60% our model, 40% existing CRM score
        final_score = min(100.0, score * 0.6 + bequeath_score * 0.4)

    # ── Tier ────────────────────────────────────────────────────────────────
    if final_score >= 80:
        tier = BequestTier.PLATINUM
        cadence = 30
        action = "Immediate PGFO escalation. Begin estate conversation at next personal meeting."
        conv_readiness = "ready"
        requires_pgfo = True
    elif final_score >= 65:
        tier = BequestTier.GOLD
        cadence = 45
        action = "Active VPGO cultivation. 45-day cadence. Seed bequest society awareness."
        conv_readiness = "warming"
        requires_pgfo = True
    elif final_score >= 50:
        tier = BequestTier.SILVER
        cadence = 90
        action = "Passive cultivation. Include legacy society in annual stewardship. No direct ask."
        conv_readiness = "warming"
        requires_pgfo = False
    elif final_score >= 35:
        tier = BequestTier.BRONZE
        cadence = 180
        action = "Annual legacy society awareness touch. Bequest brochure with impact report."
        conv_readiness = "too_early"
        requires_pgfo = False
    elif final_score >= 20:
        tier = BequestTier.WATCH
        cadence = 365
        action = "Monitor annually. Re-evaluate when life stage shifts."
        conv_readiness = "too_early"
        requires_pgfo = False
    else:
        tier = BequestTier.NOT_READY
        cadence = 0
        action = "Standard stewardship only. No planned giving outreach at this time."
        conv_readiness = "too_early"
        requires_pgfo = False

    # Deduplicate vehicle likely
    seen = set()
    vehicle_dedup = []
    for v in vehicle_likely:
        if v not in seen:
            vehicle_dedup.append(v)
            seen.add(v)
    if "bequest" not in seen:
        vehicle_dedup.insert(0, "bequest")  # Bequest is always baseline

    return BequestProfile(
        score=round(final_score, 1),
        tier=tier,
        estimated_age=estimated_age,
        contributing_signals=contributing,
        moderating_signals=moderating,
        recommended_cadence=cadence,
        recommended_action=action,
        vehicle_likely=vehicle_dedup[:5],
        conversation_readiness=conv_readiness,
        estate_signal_detected=estate_signal_detected,
        requires_pgfo=requires_pgfo,
    )


# ─── PROMPT FORMATTER ────────────────────────────────────────────────────────

def format_bequest_for_prompt(profile: BequestProfile) -> str:
    """Format bequest propensity profile for VPGO system prompt injection."""
    tier_labels = {
        BequestTier.PLATINUM:  "🏅 PLATINUM — Immediate planned giving conversation required",
        BequestTier.GOLD:      "🥇 GOLD — Active 45-day VPGO cultivation",
        BequestTier.SILVER:    "🥈 SILVER — Passive 90-day seed cultivation",
        BequestTier.BRONZE:    "🥉 BRONZE — Annual awareness only",
        BequestTier.WATCH:     "👀 WATCH — Monitor; re-evaluate annually",
        BequestTier.NOT_READY: "⬜ NOT READY — Standard stewardship only",
    }
    lines = [
        f"Planned Giving Propensity: {tier_labels.get(profile.tier, profile.tier.value)} (score: {profile.score:.0f}/100)",
        f"Estimated Age: {profile.estimated_age or 'Unknown'} | Conversation Readiness: {profile.conversation_readiness.replace('_', ' ').title()}",
        f"Estate Signal Detected: {'YES — treat as high priority' if profile.estate_signal_detected else 'No'}",
        f"Recommended Cadence: every {profile.recommended_cadence} days" if profile.recommended_cadence else "Not in VPGO cadence",
        f"Likely Vehicles: {', '.join(v.replace('_', ' ').title() for v in profile.vehicle_likely)}",
        "",
        f"RECOMMENDED ACTION: {profile.recommended_action}",
    ]
    if profile.requires_pgfo:
        lines.append("⚠ PLANNED GIVING OFFICER REQUIRED for next conversation step")
    if profile.contributing_signals:
        lines.append("\nPropensity Drivers:")
        for s in profile.contributing_signals[:5]:
            lines.append(f"  + {s}")
    if profile.moderating_signals:
        lines.append("Moderating Factors:")
        for s in profile.moderating_signals:
            lines.append(f"  – {s}")
    return "\n".join(lines)
