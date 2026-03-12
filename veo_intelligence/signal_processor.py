"""
VEO Signal Processor
====================
Normalises and enriches donor profiles with signals from external sources.

Production integrations (stubbed here with realistic mock data):
  - iWave          → philanthropic rating, capacity score, bequest inclination
  - DonorSearch    → real estate, business affiliations, philanthropy score
  - Windfall       → net worth estimate (consumer-grade, strong for young alumni)
  - WealthEngine   → investment portfolio proxy, P2G score
  - LinkedIn API   → current title, company, career trajectory
  - FEC API        → political donation history (public record)
  - Candid/990     → foundation giving, nonprofit board service
  - Zillow API     → home value + appreciation signal
  - Crunchbase     → startup/VC activity
  - News API       → recent press mentions

In production, each stub below would call the real API.
Caches results in Redis with TTL = 30 days.
"""

import random
from dataclasses import dataclass, field
from typing import Optional


# ─── ENRICHED SIGNAL PROFILE ─────────────────────────────────────────────────

@dataclass
class WealthSignals:
    estimated_net_worth: int            # cents
    real_estate_value: int              # cents (total property holdings)
    real_estate_appreciation_1yr: float # e.g. 0.12 = 12% gain
    business_ownership: bool
    public_company_executive: bool
    venture_capital_activity: bool
    political_donations_total: int      # cents, from FEC public records
    foundation_giving_total: int        # cents, from 990 filings
    iwave_capacity_rating: int          # 1–10 iWave scale
    iwave_affinity_rating: int          # 1–10 iWave scale
    iwave_propensity_rating: int        # 1–10 iWave scale
    donor_search_philanthropy_score: int # 1–5 DonorSearch scale
    windfall_net_worth_confidence: str  # "high", "medium", "low"
    source_notes: list[str] = field(default_factory=list)


@dataclass
class ProfessionalSignals:
    current_title: str
    current_company: str
    seniority_level: str        # "C-suite", "VP", "Director", "Manager", "Individual"
    industry: str
    years_at_company: int
    career_trajectory: str      # "ascending", "stable", "transitioning"
    linkedin_connections: int   # proxy for network influence
    board_memberships: list[str] = field(default_factory=list)
    nonprofit_board_service: list[str] = field(default_factory=list)


@dataclass
class EngagementSignals:
    email_open_rate_30d: float      # 0–1
    email_click_rate_30d: float     # 0–1
    last_email_opened: Optional[str]
    website_visits_90d: int
    giving_page_visits_90d: int
    event_attendance_2yr: int
    volunteer_hours_1yr: int
    alumni_network_activity: str    # "high", "medium", "low", "none"
    social_media_engagement: str    # "high", "medium", "low", "none"


@dataclass
class EnrichedDonorSignals:
    donor_id: str
    wealth: WealthSignals
    professional: ProfessionalSignals
    engagement: EngagementSignals
    news_mentions: list[str]        # Recent press mentions
    philanthropy_notes: str         # AI-synthesized summary of philanthropic profile


# ─── MOCK ENRICHMENT (replace with real API calls in production) ─────────────

def _estimate_capacity_from_profile(donor: dict) -> int:
    """
    In production: call iWave/WealthEngine API.
    Here: use donor profile to produce a realistic estimate.
    """
    # Start from whatever's in the donor profile
    base = donor.get("wealthCapacity", 0)
    # Apply a small variance to simulate external data differing from CRM
    variance = random.uniform(0.85, 1.15)
    return int(base * variance)


_SENIORITY_KEYWORDS = {
    "C-suite": ["ceo", "cfo", "coo", "cto", "chief", "president", "founder"],
    "VP": ["vice president", "vp ", "managing director", "managing partner"],
    "Director": ["director", "head of", "principal"],
    "Manager": ["manager", "lead ", "senior "],
    "Partner": ["partner", "associate"],
}

def _detect_seniority(email: str, interests: list) -> str:
    """Infer seniority from email domain and interests."""
    email_lower = email.lower()
    # VC/family office = C-suite proxy
    if any(k in email_lower for k in ["ventures", "familyoffice", "capital", "partners", "group"]):
        return "C-suite"
    if any(k in email_lower for k in ["associates", "consulting", "advisors"]):
        return "VP"
    return "Director"


def _estimate_iwave_ratings(donor: dict, net_worth: int) -> tuple[int, int, int]:
    """
    Estimate iWave Capacity / Affinity / Propensity ratings.
    Real iWave returns a 1–10 score on each dimension.
    """
    # Capacity (based on wealth)
    if net_worth > 100_000_000_00:   # >$100M
        capacity = 10
    elif net_worth > 10_000_000_00:  # >$10M
        capacity = 8
    elif net_worth > 1_000_000_00:   # >$1M
        capacity = 6
    elif net_worth > 100_000_00:     # >$100K
        capacity = 4
    else:
        capacity = 2

    # Affinity (based on giving streak + touchpoints + class year recency)
    streak = donor.get("givingStreak", 0)
    touches = donor.get("touchpointCount", 0)
    try:
        years_since_grad = 2026 - int(donor.get("classYear", "2000"))
    except (ValueError, TypeError):
        years_since_grad = 20

    affinity_raw = min(10, max(1,
        (streak * 0.15) +
        (touches * 0.05) +
        (max(0, 50 - years_since_grad) * 0.05) +
        (5 if donor.get("sentiment") == "positive" else 2)
    ))
    affinity = round(affinity_raw)

    # Propensity (based on total giving + propensity score)
    prop_score = donor.get("propensityScore", 50)
    propensity = max(1, min(10, round(prop_score / 10)))

    return capacity, affinity, propensity


def enrich_donor(donor: dict) -> EnrichedDonorSignals:
    """
    Enrich a donor profile with external signals.

    Production: async calls to wealth APIs, LinkedIn, FEC, Candid.
    Here: intelligent simulation based on profile attributes.
    """
    email = donor.get("email", "")
    interests = donor.get("interests", [])
    class_year = donor.get("classYear")
    total_giving = donor.get("totalGiving", 0)
    wealth_cap = donor.get("wealthCapacity", 0)

    # ── Wealth signals ──────────────────────────────────────────────────────
    net_worth = _estimate_capacity_from_profile(donor)

    real_estate_value = int(net_worth * random.uniform(0.08, 0.25))
    real_estate_appr = random.uniform(-0.02, 0.18)

    # Business ownership proxy: VC/venture/group/partners in email
    biz_owner = any(k in email.lower() for k in
                    ["ventures", "group", "partners", "capital", "associates",
                     "construction", "advisors", "consulting", "law"])

    # PE/VC activity
    vc_active = any(k in " ".join(interests).lower() for k in
                    ["venture capital", "startup", "vc ", "private equity"])

    # Political giving proxy: high-wealth, business-owning, older alumni
    pol_donations = 0
    try:
        grad_year = int(class_year or "2000")
        age_proxy = 2026 - grad_year
        if wealth_cap > 50_000_000_00 and age_proxy > 40:
            pol_donations = random.randint(5000_00, 500000_00)
    except (ValueError, TypeError):
        pass

    # Foundation / 990 giving: proxy from total institutional giving
    foundation_giving = int(total_giving * random.uniform(0.5, 3.0)) if total_giving > 50000_00 else 0

    capacity_r, affinity_r, propensity_r = _estimate_iwave_ratings(donor, net_worth)

    ds_score = max(1, min(5, round(
        (propensity_r / 10) * 2 +
        (affinity_r / 10) * 2 +
        (1 if total_giving > 0 else 0)
    )))

    confidence = "high" if wealth_cap > 500_000_00 else ("medium" if wealth_cap > 50_000_00 else "low")

    source_notes = []
    if pol_donations > 0:
        source_notes.append(f"FEC records show ${pol_donations / 100:,.0f} in federal political donations")
    if foundation_giving > 0:
        source_notes.append(f"Candid 990 data suggests ${foundation_giving / 100:,.0f} in philanthropic giving to other orgs")
    if biz_owner:
        source_notes.append("Business/practice email domain suggests ownership or senior partnership")
    if vc_active:
        source_notes.append("Interest profile indicates active venture capital or startup involvement")

    wealth = WealthSignals(
        estimated_net_worth=net_worth,
        real_estate_value=real_estate_value,
        real_estate_appreciation_1yr=real_estate_appr,
        business_ownership=biz_owner,
        public_company_executive=any(k in email.lower() for k in [".com", ".io", "corp", "inc"]) and wealth_cap > 100_000_000_00,
        venture_capital_activity=vc_active,
        political_donations_total=pol_donations,
        foundation_giving_total=foundation_giving,
        iwave_capacity_rating=capacity_r,
        iwave_affinity_rating=affinity_r,
        iwave_propensity_rating=propensity_r,
        donor_search_philanthropy_score=ds_score,
        windfall_net_worth_confidence=confidence,
        source_notes=source_notes,
    )

    # ── Professional signals ────────────────────────────────────────────────
    seniority = _detect_seniority(email, interests)
    industry = "Finance" if "finance" in " ".join(interests).lower() else \
               "Technology" if any(k in " ".join(interests).lower() for k in ["tech", "ai", "software", "startup"]) else \
               "Law" if "law" in " ".join(interests).lower() else \
               "Education" if "education" in " ".join(interests).lower() else \
               "Nonprofit" if "nonprofit" in email.lower() else "Business"

    professional = ProfessionalSignals(
        current_title=donor.get("title", f"{seniority} — {industry}"),
        current_company=email.split("@")[1].split(".")[0].title() if "@" in email else "Unknown",
        seniority_level=seniority,
        industry=industry,
        years_at_company=random.randint(3, 15),
        career_trajectory="ascending" if seniority in ("C-suite", "VP") else "stable",
        linkedin_connections=random.randint(200, 2000) if seniority in ("C-suite", "VP") else random.randint(50, 500),
        board_memberships=["Local Arts Council", "City Business Alliance"] if biz_owner and wealth_cap > 100_000_000_00 else [],
        nonprofit_board_service=["United Way", "Community Foundation"] if foundation_giving > 100_000_00 else [],
    )

    # ── Engagement signals ──────────────────────────────────────────────────
    sentiment = donor.get("sentiment", "neutral")
    base_open_rate = {"positive": 0.65, "neutral": 0.38, "negative": 0.12, "unknown": 0.25}.get(sentiment, 0.35)
    touches = donor.get("touchpointCount", 0)

    engagement = EngagementSignals(
        email_open_rate_30d=min(1.0, base_open_rate + random.uniform(-0.1, 0.1)),
        email_click_rate_30d=min(1.0, base_open_rate * 0.35 + random.uniform(-0.05, 0.05)),
        last_email_opened=donor.get("lastContactDate"),
        website_visits_90d=random.randint(0, 8) if sentiment == "positive" else random.randint(0, 2),
        giving_page_visits_90d=random.randint(0, 3) if donor.get("propensityScore", 50) > 70 else 0,
        event_attendance_2yr=random.randint(0, 4) if touches > 10 else random.randint(0, 1),
        volunteer_hours_1yr=random.randint(0, 40) if "volunteer" in " ".join(interests).lower() else 0,
        alumni_network_activity="high" if touches > 20 else ("medium" if touches > 8 else "low"),
        social_media_engagement="high" if donor.get("archetype") == "SOCIAL_CONNECTOR" else "low",
    )

    # ── News mentions ───────────────────────────────────────────────────────
    news_mentions = []
    if vc_active and wealth_cap > 500_000_000_00:
        news_mentions.append(f"TechCrunch (2025-10): Venture portfolio company raised $40M Series B")
    if biz_owner and wealth_cap > 200_000_000_00:
        news_mentions.append(f"Business Journal (2025-08): Named to regional '40 Under 60' list")
    if seniority == "C-suite" and wealth_cap > 100_000_000_00:
        news_mentions.append(f"LinkedIn (2025-11): Published thought leadership article, 1,400+ reactions")

    # ── Philanthropy narrative ──────────────────────────────────────────────
    narrative_parts = []
    if foundation_giving > 0:
        narrative_parts.append(f"990 data shows ${foundation_giving / 100:,.0f} in giving to other organizations")
    if pol_donations > 0:
        narrative_parts.append(f"FEC records indicate ${pol_donations / 100:,.0f} in political giving (wealth signal)")
    if professional.nonprofit_board_service:
        narrative_parts.append(f"Serves on boards of: {', '.join(professional.nonprofit_board_service)}")
    if not narrative_parts:
        narrative_parts.append("No external philanthropy data found — institutional giving may be concentrated")

    philanthropy_notes = ". ".join(narrative_parts) + "."

    return EnrichedDonorSignals(
        donor_id=donor.get("id", "unknown"),
        wealth=wealth,
        professional=professional,
        engagement=engagement,
        news_mentions=news_mentions,
        philanthropy_notes=philanthropy_notes,
    )


def format_signals_for_prompt(signals: EnrichedDonorSignals) -> str:
    """Format enriched signals for injection into VEO system prompt."""
    w = signals.wealth
    p = signals.professional
    e = signals.engagement

    def fmt(cents: int) -> str:
        if cents >= 100_000_000_00:
            return f"${cents / 100_000_000_00:.1f}B"
        if cents >= 1_000_000_00:
            return f"${cents / 1_000_000_00:.1f}M"
        if cents >= 1_000_00:
            return f"${cents / 1_000_00:.0f}K"
        return f"${cents / 100:,.0f}"

    lines = [
        "### Wealth Intelligence (iWave + DonorSearch + Windfall)",
        f"  Est. Net Worth:       {fmt(w.estimated_net_worth)} ({w.windfall_net_worth_confidence} confidence)",
        f"  Real Estate:         {fmt(w.real_estate_value)} ({w.real_estate_appreciation_1yr:+.0%} YoY)",
        f"  iWave Ratings:       Capacity {w.iwave_capacity_rating}/10 | Affinity {w.iwave_affinity_rating}/10 | Propensity {w.iwave_propensity_rating}/10",
        f"  DonorSearch Score:   {w.donor_search_philanthropy_score}/5",
        f"  Business Owner:      {'Yes' if w.business_ownership else 'No'} | VC Active: {'Yes' if w.venture_capital_activity else 'No'}",
    ]

    if w.political_donations_total > 0:
        lines.append(f"  FEC Political Giving: {fmt(w.political_donations_total)} (wealth signal, public record)")
    if w.foundation_giving_total > 0:
        lines.append(f"  Other Philanthropy:  {fmt(w.foundation_giving_total)} (Candid 990 data)")
    if w.source_notes:
        for note in w.source_notes:
            lines.append(f"  Note: {note}")

    lines += [
        "",
        "### Professional Intelligence (LinkedIn proxy)",
        f"  Title / Company:     {p.current_title} @ {p.current_company}",
        f"  Seniority:           {p.seniority_level} | Industry: {p.industry}",
        f"  Career Trajectory:   {p.career_trajectory}",
        f"  LinkedIn Network:    {p.linkedin_connections:,} connections",
    ]
    if p.board_memberships:
        lines.append(f"  Board Memberships:   {', '.join(p.board_memberships)}")
    if p.nonprofit_board_service:
        lines.append(f"  Nonprofit Boards:    {', '.join(p.nonprofit_board_service)}")

    lines += [
        "",
        "### Engagement Intelligence",
        f"  Email Open Rate:     {e.email_open_rate_30d:.0%} (30-day)",
        f"  Email Click Rate:    {e.email_click_rate_30d:.0%} (30-day)",
        f"  Website Visits:      {e.website_visits_90d} (90-day) | Giving Page: {e.giving_page_visits_90d} visits",
        f"  Event Attendance:    {e.event_attendance_2yr} events (2-year)",
        f"  Alumni Network:      {e.alumni_network_activity}",
    ]

    if signals.news_mentions:
        lines.append("")
        lines.append("### Recent News & Press")
        for mention in signals.news_mentions:
            lines.append(f"  - {mention}")

    lines += [
        "",
        "### Philanthropy Profile",
        f"  {signals.philanthropy_notes}",
    ]

    return "\n".join(lines)
