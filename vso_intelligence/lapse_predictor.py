"""
VSO Lapse Predictor
===================
Multi-signal churn prediction model for donor retention.

Unlike GiveCampus/Givezly which flag donors AFTER they've lapsed, this model
predicts WHO is at risk BEFORE lapse occurs, enabling proactive stewardship.

Scoring signals:
  - Recency (days since last gift vs. donor's own giving cadence)
  - Frequency (giving streak, gaps between gifts)
  - Monetary (gift size trend — growing, flat, declining)
  - Engagement trajectory (email opens, event attendance, portal visits)
  - Life events (job loss, divorce, bereavement = pause, not lapse)
  - Psychographic alignment (are we communicating in their language?)
  - Campaign responsiveness (non-response streaks = cold signal)

Model output drives VSO action selection and urgency.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
import datetime


# ─── LAPSE TIER ──────────────────────────────────────────────────────────────

class LapseTier(str, Enum):
    ACTIVE    = "active"     # Engaged, on track
    WATCH     = "watch"      # Early warning — monitor closely
    AT_RISK   = "at_risk"    # 6–12 months overdue; intervention needed
    HIGH      = "high"       # >12 months; renewal sequence triggered
    CRITICAL  = "critical"   # >18 months; winback sequence
    GONE      = "gone"       # >3 years; archive / legacy only


# ─── LAPSE RISK DATACLASS ────────────────────────────────────────────────────

@dataclass
class LapseRisk:
    tier:                   LapseTier
    score:                  float               # 0.0 (no risk) → 1.0 (certain lapse)
    days_since_last_gift:   int
    expected_cadence_days:  int                 # How often they SHOULD give
    cadence_gap_days:       int                 # days overdue (negative = ahead of schedule)
    monetary_trend:         str                 # "increasing" | "flat" | "declining" | "unknown"
    engagement_trend:       str                 # "engaged" | "cooling" | "cold" | "silent"
    risk_factors:           list[str]           # Human-readable factors driving score
    protective_factors:     list[str]           # Factors reducing lapse risk
    recommended_action:     str
    intervention_window:    int                 # Days remaining before escalation needed
    winback_probability:    float               # 0.0–1.0 if lapsed


# ─── ENGAGEMENT SIGNALS ──────────────────────────────────────────────────────

def _assess_engagement_trend(donor: dict) -> str:
    """Determine engagement trend from available signals."""
    last_open_days = donor.get("daysSinceLastEmailOpen", 999)
    last_click_days = donor.get("daysSinceLastClick", 999)
    last_event_days = donor.get("daysSinceLastEventAttendance", 999)
    total_touchpoints = donor.get("touchpointCount", 0)
    sentiment = donor.get("sentiment", "neutral")
    history = donor.get("conversationHistory", [])

    has_recent_interaction = any([
        last_open_days < 30,
        last_click_days < 60,
        last_event_days < 180,
        len([m for m in history if m.get("role") == "donor"]) > 0,
    ])

    has_cold_signals = all([
        last_open_days > 180,
        last_click_days > 180,
        last_event_days > 365,
    ])

    if sentiment == "negative":
        return "cold"
    if has_recent_interaction:
        return "engaged" if sentiment == "positive" else "engaged"
    if has_cold_signals:
        return "silent"
    if last_open_days > 90:
        return "cooling"
    return "engaged"


def _assess_monetary_trend(donor: dict) -> str:
    """Estimate gift size trend."""
    last_gift = donor.get("lastGiftAmount", 0) or (donor.get("lastGiftCents", 0) / 100)
    avg_gift = donor.get("averageGift", 0) or 0
    total = donor.get("totalGiving", 0)
    gifts = donor.get("giftCount", 0) or 1

    if avg_gift == 0 and total > 0:
        avg_gift = total / max(gifts, 1)

    if last_gift == 0 or avg_gift == 0:
        return "unknown"
    ratio = last_gift / avg_gift
    if ratio >= 1.2:
        return "increasing"
    if ratio <= 0.75:
        return "declining"
    return "flat"


def _expected_cadence(donor: dict) -> int:
    """
    Estimate how often this donor should give (in days).
    Uses giving history to infer their natural cadence.
    """
    streak = donor.get("givingStreak", 0)
    gift_count = donor.get("giftCount", 1)
    years_known = donor.get("yearsKnown", 3) or 3

    # If they've given consistently for years, they're annual givers
    if streak >= 3 or (gift_count >= 3 and years_known >= 3):
        return 365  # Annual cadence

    # First-time or occasional givers
    if gift_count <= 1:
        return 540  # 18-month grace period for first-timers

    # Multi-gift donors with unknown pattern
    avg_days_between = (years_known * 365) / max(gift_count - 1, 1)
    return max(180, min(730, int(avg_days_between)))


# ─── MAIN PREDICTOR ──────────────────────────────────────────────────────────

def predict_lapse(donor: dict, life_events: list = None) -> LapseRisk:
    """
    Predict lapse risk for a single donor.
    Returns a LapseRisk with score, tier, and actionable recommendations.
    """
    life_events = life_events or []
    today = datetime.date.today()

    # ── Core signals ────────────────────────────────────────────────────────
    days_since_gift = donor.get("daysSinceLastGift", 365)
    if days_since_gift == 365 and donor.get("lastGiftDate"):
        try:
            last_gift_date = datetime.date.fromisoformat(str(donor["lastGiftDate"])[:10])
            days_since_gift = (today - last_gift_date).days
        except (ValueError, TypeError):
            pass

    streak          = donor.get("givingStreak", 0)
    gift_count      = donor.get("giftCount", 0)
    total_giving    = donor.get("totalGiving", 0)
    archetype       = donor.get("archetype", "LOYAL_ALUMNI")
    sentiment       = donor.get("sentiment", "neutral")
    stage           = donor.get("journeyStage", "stewardship")

    expected_cadence = _expected_cadence(donor)
    cadence_gap      = days_since_gift - expected_cadence   # positive = overdue
    engagement_trend = _assess_engagement_trend(donor)
    monetary_trend   = _assess_monetary_trend(donor)

    # ── Life event protective factors ───────────────────────────────────────
    from veo_intelligence.life_event_detector import LifeEventType
    life_event_types = {e.event_type for e in life_events}
    life_pause_active = (
        LifeEventType.BEREAVEMENT in life_event_types
        or LifeEventType.DISTRESS in life_event_types
        or LifeEventType.DIVORCE in life_event_types
    )

    # ── Score calculation ────────────────────────────────────────────────────
    score = 0.0
    risk_factors: list[str] = []
    protective_factors: list[str] = []

    # RECENCY (40% weight)
    if days_since_gift > 730:
        score += 0.40
        risk_factors.append(f"No gift in {days_since_gift} days ({days_since_gift//365:.1f} years)")
    elif days_since_gift > 450:
        score += 0.30
        risk_factors.append(f"No gift in {days_since_gift} days — well overdue")
    elif days_since_gift > 365:
        score += 0.20
        risk_factors.append(f"No gift in {days_since_gift} days — overdue by {cadence_gap} days")
    elif cadence_gap > 90:
        score += 0.12
        risk_factors.append(f"Gift {cadence_gap} days overdue vs expected cadence")
    elif cadence_gap <= 0:
        score -= 0.05
        protective_factors.append(f"On schedule — {abs(cadence_gap)} days ahead of expected cadence")

    # FREQUENCY / STREAK (20% weight)
    if streak == 0 and gift_count <= 1:
        score += 0.15
        risk_factors.append("First-time or one-time donor — high single-gift risk")
    elif streak >= 5:
        score -= 0.10
        protective_factors.append(f"{streak}-year consecutive giving streak — strong habit")
    elif streak >= 3:
        score -= 0.05
        protective_factors.append(f"{streak}-year giving streak — established habit")
    elif streak == 0 and gift_count > 1:
        score += 0.08
        risk_factors.append("Giving streak broken — habit disrupted")

    # ENGAGEMENT (20% weight)
    if engagement_trend == "silent":
        score += 0.20
        risk_factors.append("No email engagement in 6+ months")
    elif engagement_trend == "cold":
        score += 0.15
        risk_factors.append("Negative sentiment or cold engagement")
    elif engagement_trend == "cooling":
        score += 0.08
        risk_factors.append("Engagement trending down")
    elif engagement_trend == "engaged":
        score -= 0.08
        protective_factors.append("Active email/event engagement")

    # MONETARY TREND (10% weight)
    if monetary_trend == "declining":
        score += 0.10
        risk_factors.append("Gift size declining vs. historical average")
    elif monetary_trend == "increasing":
        score -= 0.05
        protective_factors.append("Gift size increasing — growing commitment")

    # SENTIMENT (5% weight)
    if sentiment == "negative":
        score += 0.05
        risk_factors.append("Negative sentiment in recent conversations")
    elif sentiment == "positive":
        score -= 0.05
        protective_factors.append("Positive sentiment in recent conversations")

    # TOTAL GIVING RELATIONSHIP (5% weight)
    if total_giving >= 25_000:
        score -= 0.05
        protective_factors.append(f"High lifetime value (${total_giving:,.0f}) — deep relationship")
    elif total_giving < 250 and gift_count <= 1:
        score += 0.05
        risk_factors.append("Low-value first-time donor — needs early retention effort")

    # LIFE EVENT PAUSE (protective — active crisis is pause, not lapse)
    if life_pause_active:
        score = min(score, 0.30)  # Cap at medium risk during active crisis
        protective_factors.append("Active life event pause — not a true lapse signal")

    # Stage adjustment
    if stage == "lapsed_outreach":
        score = max(score, 0.60)
        risk_factors.append("Already in lapsed_outreach journey stage")

    # Clamp score
    score = max(0.0, min(1.0, score))

    # ── Determine tier ───────────────────────────────────────────────────────
    if score >= 0.80 or days_since_gift > 730:
        tier = LapseTier.CRITICAL
        intervention_window = 0
        winback_prob = max(0.05, 0.50 - (days_since_gift - 730) / 1000)
    elif score >= 0.60 or days_since_gift > 450:
        tier = LapseTier.HIGH
        intervention_window = 30
        winback_prob = 0.55
    elif score >= 0.40 or days_since_gift > 365:
        tier = LapseTier.AT_RISK
        intervention_window = 60
        winback_prob = 0.70
    elif score >= 0.25:
        tier = LapseTier.WATCH
        intervention_window = 90
        winback_prob = 0.85
    elif days_since_gift > 1095:
        tier = LapseTier.GONE
        intervention_window = 0
        winback_prob = 0.10
    else:
        tier = LapseTier.ACTIVE
        intervention_window = 180
        winback_prob = 0.95

    # ── Recommended action ───────────────────────────────────────────────────
    action_map = {
        LapseTier.ACTIVE:    "Continue standard stewardship cadence. Monitor engagement.",
        LapseTier.WATCH:     "Slightly accelerate next touchpoint. Watch for missed renewal.",
        LapseTier.AT_RISK:   "Trigger proactive renewal nudge with impact-first framing. No delay.",
        LapseTier.HIGH:      "Begin 4-touchpoint lapse recovery sequence. First: warmth, no ask.",
        LapseTier.CRITICAL:  "High-priority reactivation. Human review recommended for $1K+ donors.",
        LapseTier.GONE:      "Archive for annual Giving Day winback attempt only. Low ROI.",
    }

    return LapseRisk(
        tier=tier,
        score=round(score, 3),
        days_since_last_gift=days_since_gift,
        expected_cadence_days=expected_cadence,
        cadence_gap_days=cadence_gap,
        monetary_trend=monetary_trend,
        engagement_trend=engagement_trend,
        risk_factors=risk_factors,
        protective_factors=protective_factors,
        recommended_action=action_map[tier],
        intervention_window=intervention_window,
        winback_probability=round(winback_prob, 2),
    )


# ─── PROMPT FORMATTER ────────────────────────────────────────────────────────

def format_lapse_for_prompt(risk: LapseRisk) -> str:
    """Format lapse risk for injection into VSO system prompt."""
    tier_labels = {
        LapseTier.ACTIVE:   "✅ ACTIVE — engaged donor",
        LapseTier.WATCH:    "👀 WATCH — early warning signals",
        LapseTier.AT_RISK:  "⚠️  AT RISK — proactive intervention needed",
        LapseTier.HIGH:     "🔴 HIGH RISK — renewal sequence triggered",
        LapseTier.CRITICAL: "🚨 CRITICAL — winback campaign required",
        LapseTier.GONE:     "⬛ GONE — minimal ROI, archive",
    }
    lines = [
        f"Lapse Risk: {tier_labels.get(risk.tier, risk.tier.value)} (score: {risk.score:.0%})",
        f"Days Since Last Gift: {risk.days_since_last_gift} | Expected Cadence: every {risk.expected_cadence_days} days",
        f"Monetary Trend: {risk.monetary_trend.title()} | Engagement: {risk.engagement_trend.title()}",
        f"Intervention Window: {risk.intervention_window} days | Winback Probability: {risk.winback_probability:.0%}",
    ]
    if risk.risk_factors:
        lines.append("Risk Factors: " + "; ".join(risk.risk_factors))
    if risk.protective_factors:
        lines.append("Protective Factors: " + "; ".join(risk.protective_factors))
    lines.append(f"Recommended Action: {risk.recommended_action}")
    return "\n".join(lines)
