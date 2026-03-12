"""
VEO Predictive Engine v2
========================
5-layer composite scoring model that produces:
  - Contact readiness score (0–100)
  - Upgrade path recommendation
  - Ask readiness level
  - Engagement strategy recommendation
  - Predicted giving range for next 12 months

How we beat GiveCampus without their proprietary peer data:
  We replace "what do donors like this historically give?" with
  "what do we know about THIS person RIGHT NOW?" — combining
  psychographic modeling, real-time wealth signals, life events,
  and engagement behavior into a single composite score.

Layers:
  1. Capacity     (30%) — what they CAN give
  2. Propensity   (25%) — likelihood they WILL give
  3. Affinity     (20%) — how connected they FEEL
  4. Timing       (15%) — is NOW the right moment?
  5. Psychographic (10%) — archetype fit / communication DNA match

Each layer returns a 0–100 sub-score with supporting signals.
"""

from dataclasses import dataclass, field
from typing import Optional
from .signal_processor import EnrichedDonorSignals
from .life_event_detector import LifeEvent, LifeEventType


# ─── OUTPUT STRUCTURES ────────────────────────────────────────────────────────

@dataclass
class LayerScore:
    name: str
    weight: float
    raw_score: float        # 0–100
    weighted_score: float   # raw * weight
    signals: list[str]      # evidence for this score
    notes: str = ""


@dataclass
class PredictiveProfile:
    composite_score: float              # 0–100 weighted composite
    contact_readiness: str              # "hot", "warm", "cool", "cold", "do_not_contact"
    ask_readiness: str                  # "hard_ask", "soft_ask", "cultivate", "not_ready", "escalate"
    layers: list[LayerScore]

    # Giving predictions
    current_ask_amount: int             # cents — recommended next ask
    upgrade_multiplier: float           # e.g. 2.0 = ask for 2x last gift
    predicted_12mo_gift: int            # cents — expected gift value in 12 months
    predicted_lifetime_value: int       # cents — remaining predicted lifetime giving

    # Strategy
    primary_strategy: str               # one-line engagement strategy
    content_themes: list[str]           # recommended content topics
    best_channel: str                   # email / phone / event / sms
    next_milestone: str                 # what to work toward

    # Flags
    planned_giving_candidate: bool
    major_gift_candidate: bool
    lapse_risk: float                   # 0–1 probability of lapsing in 12mo


# ─── LAYER CALCULATORS ────────────────────────────────────────────────────────

def _score_capacity(donor: dict, signals: EnrichedDonorSignals) -> LayerScore:
    """Layer 1: What can they give?"""
    evidence = []
    score = 0.0

    w = signals.wealth
    net_worth = w.estimated_net_worth

    # iWave capacity as primary signal
    if w.iwave_capacity_rating >= 9:
        score += 90
        evidence.append(f"iWave capacity rating: {w.iwave_capacity_rating}/10 (exceptional wealth)")
    elif w.iwave_capacity_rating >= 7:
        score += 72
        evidence.append(f"iWave capacity rating: {w.iwave_capacity_rating}/10 (high wealth)")
    elif w.iwave_capacity_rating >= 5:
        score += 52
        evidence.append(f"iWave capacity rating: {w.iwave_capacity_rating}/10 (moderate wealth)")
    else:
        score += w.iwave_capacity_rating * 8
        evidence.append(f"iWave capacity rating: {w.iwave_capacity_rating}/10 (limited wealth signal)")

    # Real estate appreciation as wealth growth signal
    if w.real_estate_appreciation_1yr > 0.10:
        score = min(100, score + 5)
        evidence.append(f"Real estate appreciated {w.real_estate_appreciation_1yr:.0%} YoY — growing capacity")

    # Business ownership / VC as multiplier signal
    if w.business_ownership:
        score = min(100, score + 5)
        evidence.append("Business owner — liquid event capacity possible")
    if w.venture_capital_activity:
        score = min(100, score + 5)
        evidence.append("VC activity detected — potential large liquidity event")
    if w.public_company_executive:
        score = min(100, score + 8)
        evidence.append("Public company executive — stock compensation signals high capacity")

    # Political/foundation giving as capacity confirmation
    if w.political_donations_total > 100_000_00:
        score = min(100, score + 3)
        evidence.append(f"FEC: ${w.political_donations_total / 100:,.0f} political giving confirms discretionary capacity")

    return LayerScore(
        name="Capacity",
        weight=0.30,
        raw_score=min(100, score),
        weighted_score=min(100, score) * 0.30,
        signals=evidence,
    )


def _score_propensity(donor: dict, signals: EnrichedDonorSignals) -> LayerScore:
    """Layer 2: How likely are they to give?"""
    evidence = []
    score = float(donor.get("propensityScore", 50))  # start from CRM propensity
    evidence.append(f"CRM propensity score: {score}/100")

    w = signals.wealth
    e = signals.engagement

    # DonorSearch philanthropy score
    if w.donor_search_philanthropy_score >= 4:
        score = min(100, score + 15)
        evidence.append(f"DonorSearch philanthropy score {w.donor_search_philanthropy_score}/5 — strong philanthropic history")
    elif w.donor_search_philanthropy_score >= 3:
        score = min(100, score + 8)
        evidence.append(f"DonorSearch philanthropy score {w.donor_search_philanthropy_score}/5 — moderate philanthropic history")

    # External philanthropy
    if w.foundation_giving_total > 500_000_00:
        score = min(100, score + 10)
        evidence.append(f"Candid 990: ${w.foundation_giving_total / 100:,.0f} philanthropic giving to other orgs")

    # Giving streak as propensity signal
    streak = donor.get("givingStreak", 0)
    if streak >= 20:
        score = min(100, score + 12)
        evidence.append(f"{streak}-year consecutive giving streak — extremely high loyalty signal")
    elif streak >= 10:
        score = min(100, score + 8)
        evidence.append(f"{streak}-year giving streak — strong commitment signal")
    elif streak >= 5:
        score = min(100, score + 4)
        evidence.append(f"{streak}-year giving streak — established giving pattern")

    # Lapsed donors penalise propensity
    lapsed = donor.get("lapsedYears", 0)
    if lapsed >= 3:
        score = max(0, score - 20)
        evidence.append(f"LAPSED {lapsed} years — significant propensity reduction")
    elif lapsed == 2:
        score = max(0, score - 10)
        evidence.append(f"Lapsed {lapsed} years — moderate reduction")
    elif lapsed == 1:
        score = max(0, score - 5)
        evidence.append(f"Lapsed {lapsed} year — mild reduction")

    # Email engagement as real-time signal
    if e.email_open_rate_30d > 0.60:
        score = min(100, score + 8)
        evidence.append(f"Email open rate {e.email_open_rate_30d:.0%} — highly engaged")
    elif e.email_open_rate_30d > 0.35:
        score = min(100, score + 3)
        evidence.append(f"Email open rate {e.email_open_rate_30d:.0%} — moderate engagement")

    # Giving page visits are the strongest real-time signal
    if e.giving_page_visits_90d > 0:
        score = min(100, score + 15)
        evidence.append(f"Visited giving page {e.giving_page_visits_90d}x in 90 days — high intent signal")

    # Nonprofit board service = philanthropic mindset
    if signals.professional.nonprofit_board_service:
        score = min(100, score + 5)
        evidence.append(f"Serves on nonprofit boards — philanthropic identity confirmed")

    return LayerScore(
        name="Propensity",
        weight=0.25,
        raw_score=min(100, score),
        weighted_score=min(100, score) * 0.25,
        signals=evidence,
    )


def _score_affinity(donor: dict, signals: EnrichedDonorSignals) -> LayerScore:
    """Layer 3: How connected do they feel to the institution?"""
    evidence = []
    score = float(signals.wealth.iwave_affinity_rating * 10)
    evidence.append(f"iWave affinity rating: {signals.wealth.iwave_affinity_rating}/10")

    touches = donor.get("touchpointCount", 0)
    sentiment = donor.get("sentiment", "neutral")
    streak = donor.get("givingStreak", 0)
    e = signals.engagement

    # Touchpoint depth
    if touches >= 30:
        score = min(100, score + 15)
        evidence.append(f"{touches} touchpoints — deep relationship established")
    elif touches >= 15:
        score = min(100, score + 8)
        evidence.append(f"{touches} touchpoints — solid relationship built")
    elif touches >= 5:
        score = min(100, score + 4)
        evidence.append(f"{touches} touchpoints — developing relationship")

    # Sentiment
    sentiment_bonus = {"positive": 15, "neutral": 0, "negative": -20, "unknown": -5}
    score = max(0, min(100, score + sentiment_bonus.get(sentiment, 0)))
    evidence.append(f"Sentiment: {sentiment}")

    # Event attendance
    if e.event_attendance_2yr >= 3:
        score = min(100, score + 10)
        evidence.append(f"Attended {e.event_attendance_2yr} events in 2 years — high in-person affinity")
    elif e.event_attendance_2yr >= 1:
        score = min(100, score + 5)
        evidence.append(f"Attended {e.event_attendance_2yr} event(s) — some in-person connection")

    # Volunteer hours
    if e.volunteer_hours_1yr > 20:
        score = min(100, score + 10)
        evidence.append(f"{e.volunteer_hours_1yr} volunteer hours — time investment = high affinity")

    # Alumni network activity
    activity_bonus = {"high": 8, "medium": 4, "low": 0, "none": -3}
    score = min(100, score + activity_bonus.get(e.alumni_network_activity, 0))

    # Recency of graduation (more recent = still emotionally close)
    try:
        years_since_grad = 2026 - int(donor.get("classYear", "2000"))
        if years_since_grad <= 5:
            score = min(100, score + 10)
            evidence.append(f"Recent grad ({years_since_grad} yrs) — emotionally proximate")
        elif years_since_grad <= 15:
            score = min(100, score + 5)
            evidence.append(f"Mid-career alum ({years_since_grad} yrs) — nostalgic connection active")
    except (ValueError, TypeError):
        pass

    return LayerScore(
        name="Affinity",
        weight=0.20,
        raw_score=min(100, score),
        weighted_score=min(100, score) * 0.20,
        signals=evidence,
    )


def _score_timing(donor: dict, signals: EnrichedDonorSignals, life_events: list[LifeEvent]) -> LayerScore:
    """Layer 4: Is NOW the right moment?"""
    evidence = []
    score = 50.0  # neutral baseline

    stage = donor.get("currentStage", "")
    last_contact = donor.get("lastContactDate")

    # Stage readiness
    stage_scores = {
        "solicitation": 30,
        "discovery": 20,
        "cultivation": 10,
        "lapsed_outreach": 5,
        "opted_in": 5,
        "stewardship": 0,
        "committed": -10,
        "uncontacted": 0,
    }
    stage_boost = stage_scores.get(stage, 0)
    score = min(100, score + stage_boost)
    evidence.append(f"Journey stage: {stage} ({'+' if stage_boost >= 0 else ''}{stage_boost} timing points)")

    # Life events as timing amplifiers
    for event in life_events:
        if event.event_type == LifeEventType.REUNION_YEAR:
            score = min(100, score + 20)
            evidence.append(f"REUNION YEAR — peak giving motivation, +20 timing")
        elif event.event_type == LifeEventType.GIVING_MILESTONE:
            score = min(100, score + 10)
            evidence.append(f"Giving milestone year — identity moment, +10 timing")
        elif event.event_type == LifeEventType.PROMOTION:
            score = min(100, score + 15)
            evidence.append(f"Career advancement detected — capacity + emotional moment, +15 timing")
        elif event.event_type in (LifeEventType.BEREAVEMENT, LifeEventType.DIVORCE, LifeEventType.DISTRESS):
            score = max(0, score - 40)
            evidence.append(f"Life distress event — timing is POOR, -40")
        elif event.event_type == LifeEventType.COMPANY_IPO:
            score = min(100, score + 25)
            evidence.append(f"Wealth event (IPO/funding) — major ask timing window, +25")
        elif event.event_type == LifeEventType.RETIREMENT:
            score = min(100, score + 12)
            evidence.append(f"Retirement signals — planned giving conversation timing is ideal, +12")

    # Fiscal calendar (Q4 = highest giving season)
    # Simulated as current month = March (Q1)
    current_month = 3
    if current_month in (10, 11, 12):
        score = min(100, score + 15)
        evidence.append("Q4 fiscal calendar — peak giving season")
    elif current_month in (4,):  # April = Giving Day season
        score = min(100, score + 10)
        evidence.append("Giving Day season — campaign momentum active")

    # Time since last contact
    if last_contact:
        # Simplified: check if recent (within 30 days = active, don't over-contact)
        import re
        year_match = re.search(r'20\d\d', last_contact)
        if year_match:
            contact_year = int(year_match.group())
            if contact_year == 2026:
                score = max(0, score - 10)
                evidence.append("Very recent contact (2026) — avoid over-contacting")
            elif contact_year == 2024:
                score = min(100, score + 8)
                evidence.append("Not contacted since 2024 — relationship warming opportunity")

    # Giving streak end-of-year maintenance
    streak = donor.get("givingStreak", 0)
    if streak > 0 and current_month >= 10:
        score = min(100, score + 8)
        evidence.append(f"Active {streak}-year streak approaching year-end — streak maintenance motivation")

    return LayerScore(
        name="Timing",
        weight=0.15,
        raw_score=min(100, max(0, score)),
        weighted_score=min(100, max(0, score)) * 0.15,
        signals=evidence,
    )


def _score_psychographic(donor: dict) -> LayerScore:
    """Layer 5: Archetype fit and communication DNA match."""
    evidence = []
    score = 70.0  # baseline — archetype is always useful

    archetype = donor.get("archetype", "")
    stage = donor.get("currentStage", "")
    comm_pref = donor.get("communicationPref", "email")

    # High-engagement archetypes respond more reliably to AI outreach
    archetype_engagement = {
        "MISSION_ZEALOT": 90,       # Highly motivated — AI can really speak to their cause
        "LOYAL_ALUMNI": 85,         # Strong identity match — nostalgia works great in email
        "COMMUNITY_CHAMPION": 82,   # Social, responsive, loves recognition
        "IMPACT_INVESTOR": 78,      # Responds to data — AI can deliver this consistently
        "LEGACY_BUILDER": 70,       # Formal tone needed — AI can do this but human touch helps
        "SOCIAL_CONNECTOR": 68,     # Needs exclusivity signals — human events are more powerful
        "FAITH_DRIVEN": 65,         # Sensitive tone — AI can do it but human preferred for major moments
        "PRAGMATIC_PARTNER": 92,    # Most AI-friendly — wants efficiency, brevity, clear CTAs
    }
    score = float(archetype_engagement.get(archetype, 70))
    evidence.append(f"Archetype: {archetype} — AI engagement fit: {score:.0f}/100")

    # Communication pref alignment
    if comm_pref == "email":
        evidence.append("Email preference — primary VEO channel, optimal match")
    elif comm_pref == "both":
        score = min(100, score + 5)
        evidence.append("Multi-channel preference — allows SMS + email sequencing")

    # Stage appropriateness for AI
    if stage in ("stewardship", "opted_in", "cultivation"):
        score = min(100, score + 5)
        evidence.append(f"Stage '{stage}' is ideal for AI-led cultivation")
    elif stage in ("solicitation", "discovery"):
        evidence.append(f"Stage '{stage}' — AI can assist but human oversight recommended for asks >$10K")
    elif stage == "committed":
        score = max(0, score - 10)
        evidence.append("Committed stage — AI role is acknowledgment only, avoid new asks")

    return LayerScore(
        name="Psychographic",
        weight=0.10,
        raw_score=min(100, score),
        weighted_score=min(100, score) * 0.10,
        signals=evidence,
    )


# ─── ASK CALIBRATION ─────────────────────────────────────────────────────────

def _calculate_ask(donor: dict, composite: float, signals: EnrichedDonorSignals) -> tuple[int, float]:
    """
    Calculate optimal ask amount and upgrade multiplier.
    Returns (ask_amount_cents, upgrade_multiplier)
    """
    last_gift = donor.get("lastGiftAmount", 0)
    streak = donor.get("givingStreak", 0)
    total = donor.get("totalGiving", 0)
    capacity = signals.wealth.estimated_net_worth
    stage = donor.get("currentStage", "")

    if stage in ("uncontacted", "opted_in") or last_gift == 0:
        # First ask: calibrate to archetype + capacity signal
        archetype_first_asks = {
            "PRAGMATIC_PARTNER": 5000_00,   # $5,000 — they want clear, simple
            "IMPACT_INVESTOR": 10000_00,    # $10,000 — signal serious intent
            "LEGACY_BUILDER": 25000_00,     # $25,000 — they think big
            "MISSION_ZEALOT": 1000_00,      # $1,000 — accessible, cause-tied
            "LOYAL_ALUMNI": 2500_00,        # $2,500 — gratitude-sized
            "COMMUNITY_CHAMPION": 1000_00,  # $1,000 — belonging ask
            "SOCIAL_CONNECTOR": 5000_00,    # $5,000 — status-appropriate
            "FAITH_DRIVEN": 1000_00,        # $1,000 — meaningful but not pushy
        }
        base_ask = archetype_first_asks.get(donor.get("archetype", ""), 2500_00)
        return base_ask, 1.0

    # Upgrade multiplier based on streak and score
    if streak >= 20:
        base_multiplier = 2.5
    elif streak >= 10:
        base_multiplier = 2.0
    elif streak >= 5:
        base_multiplier = 1.5
    else:
        base_multiplier = 1.25

    # Score-adjusted multiplier
    if composite >= 80:
        multiplier = base_multiplier * 1.25
    elif composite >= 60:
        multiplier = base_multiplier
    else:
        multiplier = max(1.0, base_multiplier * 0.75)

    # Apply capacity ceiling: never ask >0.5% of estimated net worth
    ceiling = int(capacity * 0.005)
    ask = int(last_gift * multiplier)
    ask = min(ask, ceiling)
    ask = max(ask, 2500_00)  # floor at $25

    return ask, round(multiplier, 2)


# ─── MAIN SCORING FUNCTION ────────────────────────────────────────────────────

def score_donor(donor: dict, signals: EnrichedDonorSignals, life_events: list[LifeEvent]) -> PredictiveProfile:
    """
    Full 5-layer predictive scoring for a donor.
    Returns a PredictiveProfile with composite score and strategic recommendations.
    """

    # Score all layers
    layer_capacity     = _score_capacity(donor, signals)
    layer_propensity   = _score_propensity(donor, signals)
    layer_affinity     = _score_affinity(donor, signals)
    layer_timing       = _score_timing(donor, signals, life_events)
    layer_psycho       = _score_psychographic(donor)

    layers = [layer_capacity, layer_propensity, layer_affinity, layer_timing, layer_psycho]
    composite = sum(l.weighted_score for l in layers)

    # Contact readiness
    has_blocker = any(e.event_type in (LifeEventType.OPT_OUT_REQUEST,) for e in life_events)
    has_pause = any(e.pause_outreach_days > 0 for e in life_events)

    if has_blocker:
        readiness = "do_not_contact"
    elif has_pause:
        readiness = "cool"
    elif composite >= 80:
        readiness = "hot"
    elif composite >= 60:
        readiness = "warm"
    elif composite >= 40:
        readiness = "cool"
    else:
        readiness = "cold"

    # Ask readiness
    stage = donor.get("currentStage", "")
    must_escalate = any(e.escalate_to_human for e in life_events)

    if must_escalate:
        ask_readiness = "escalate"
    elif stage == "solicitation" and composite >= 65:
        ask_readiness = "hard_ask"
    elif stage in ("discovery",) and composite >= 50:
        ask_readiness = "soft_ask"
    elif stage in ("cultivation", "stewardship", "lapsed_outreach"):
        ask_readiness = "cultivate"
    else:
        ask_readiness = "not_ready"

    # Ask amount
    ask_amount, upgrade_mult = _calculate_ask(donor, composite, signals)

    # Predicted giving
    last_gift = donor.get("lastGiftAmount", 0)
    total = donor.get("totalGiving", 0)
    streak = donor.get("givingStreak", 0)
    pred_12mo = int(ask_amount * (composite / 100) * 0.75)  # probability-adjusted
    pred_lifetime = int(pred_12mo * max(1, (15 - donor.get("lapsedYears", 0)) * 0.8))

    # Strategy recommendation
    archetype = donor.get("archetype", "")
    if ask_readiness == "escalate":
        strategy = "Immediate human escalation required — AI should not proceed"
    elif ask_readiness == "hard_ask":
        strategy = f"Ready for specific ask at ${ask_amount / 100:,.0f} — {upgrade_mult}x upgrade from last gift"
    elif ask_readiness == "soft_ask":
        strategy = f"Soft discovery ask — explore capacity and interests before calibrating to ${ask_amount / 100:,.0f}"
    elif readiness == "hot":
        strategy = "Deepen relationship with high-impact content — priming for ask in 1–2 touchpoints"
    elif composite < 40:
        strategy = "Low composite score — focus on re-engagement and sentiment recovery before any ask"
    else:
        strategy = "Continue cultivation with archetype-adapted content — build toward discovery"

    # Content themes
    interests = donor.get("interests", [])
    content_themes = interests[:3] if interests else ["alumni impact", "student success", "institutional mission"]

    # Best channel
    comm_pref = donor.get("communicationPref", "email")
    if comm_pref == "both" and composite >= 70:
        best_channel = "email + SMS sequence"
    elif composite >= 85 and stage == "solicitation":
        best_channel = "phone (human) + email"
    else:
        best_channel = "email"

    # Next milestone
    if ask_readiness == "hard_ask":
        milestone = f"Close ${ask_amount / 100:,.0f} gift to {donor.get('lastGiftFund', 'preferred fund')}"
    elif ask_readiness == "soft_ask":
        milestone = "Discovery conversation — learn capacity signals and priorities"
    elif streak >= 1:
        milestone = f"Maintain {streak + 1}-year giving streak"
    else:
        milestone = "First gift or re-engagement"

    # Flag candidates
    bequeath = donor.get("bequeathScore", 0)
    pg_candidate = bequeath >= 70 or any(e.event_type == LifeEventType.RETIREMENT for e in life_events)
    mg_candidate = signals.wealth.estimated_net_worth > 1_000_000_00 and composite >= 60

    # Lapse risk
    lapsed = donor.get("lapsedYears", 0)
    base_lapse_risk = 0.05 if streak >= 10 else (0.15 if streak >= 5 else 0.35)
    lapse_risk = min(0.95, base_lapse_risk + (lapsed * 0.15) + (0.2 if donor.get("sentiment") == "negative" else 0))

    return PredictiveProfile(
        composite_score=round(composite, 1),
        contact_readiness=readiness,
        ask_readiness=ask_readiness,
        layers=layers,
        current_ask_amount=ask_amount,
        upgrade_multiplier=upgrade_mult,
        predicted_12mo_gift=pred_12mo,
        predicted_lifetime_value=pred_lifetime,
        primary_strategy=strategy,
        content_themes=content_themes,
        best_channel=best_channel,
        next_milestone=milestone,
        planned_giving_candidate=pg_candidate,
        major_gift_candidate=mg_candidate,
        lapse_risk=round(lapse_risk, 2),
    )


def format_profile_for_prompt(profile: PredictiveProfile) -> str:
    """Format predictive profile for injection into VEO system prompt."""
    def fmt(cents: int) -> str:
        if cents >= 1_000_000_00:
            return f"${cents / 1_000_000_00:.1f}M"
        if cents >= 1_000_00:
            return f"${cents / 1_000_00:.0f}K"
        return f"${cents / 100:,.0f}"

    lines = [
        f"### Predictive Intelligence (Composite Score: {profile.composite_score}/100 — {profile.contact_readiness.upper()})",
        "",
        "Layer Scores:",
    ]

    for layer in profile.layers:
        lines.append(
            f"  {layer.name:<15} {layer.raw_score:>5.1f}/100  (weight {layer.weight:.0%})  "
            f"→ {layer.weighted_score:>5.1f} pts"
        )
        for sig in layer.signals[:2]:  # Top 2 signals per layer
            lines.append(f"    • {sig}")

    lines += [
        "",
        f"Contact Readiness:   {profile.contact_readiness.upper()}",
        f"Ask Readiness:       {profile.ask_readiness.upper()}",
        f"Recommended Ask:     {fmt(profile.current_ask_amount)} ({profile.upgrade_multiplier}x upgrade)",
        f"Predicted 12-mo:     {fmt(profile.predicted_12mo_gift)} (probability-adjusted)",
        f"Predicted Lifetime:  {fmt(profile.predicted_lifetime_value)} (remaining LTV)",
        f"Lapse Risk:          {profile.lapse_risk:.0%}",
        "",
        f"Primary Strategy:    {profile.primary_strategy}",
        f"Best Channel:        {profile.best_channel}",
        f"Content Themes:      {', '.join(profile.content_themes)}",
        f"Next Milestone:      {profile.next_milestone}",
    ]

    if profile.planned_giving_candidate:
        lines.append("⚠️  PLANNED GIVING CANDIDATE — introduce legacy conversation")
    if profile.major_gift_candidate:
        lines.append("⚠️  MAJOR GIFT CANDIDATE — flag for gift officer portfolio review")

    return "\n".join(lines)
