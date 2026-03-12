"""
VSO Stewardship Calendar
========================
Builds optimized annual touchpoint calendars for every donor based on:
  - Gift tier (Micro → Principal)
  - Donor archetype (8 types)
  - Recognition milestones (reunion, streak, society level)
  - Institutional calendar (Giving Day, fiscal year end, annual report season)
  - Lapse risk (accelerate cadence as risk grows)
  - Communication fatigue avoidance (minimum spacing between contacts)

Key Insight vs GiveCampus/Givezly:
  They schedule from the INSTITUTION's calendar outward.
  We schedule from the DONOR's lifecycle INWARD.
  Every touchpoint is purposeful and individualized — not blast-and-pray.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
import datetime


# ─── TOUCHPOINT TYPES ────────────────────────────────────────────────────────

class TouchType(str, Enum):
    IMPACT_REPORT        = "impact_report"
    GIFT_ACKNOWLEDGMENT  = "gift_acknowledgment"
    RENEWAL_ASK          = "renewal_ask"
    UPGRADE_ASK          = "upgrade_ask"
    MILESTONE            = "milestone_recognition"
    GIVING_DAY           = "giving_day"
    RELATIONSHIP_WARMTH  = "relationship_warmth"
    EVENT_INVITATION     = "event_invitation"
    LAPSE_OUTREACH       = "lapse_outreach"
    ESTATE_SEED          = "estate_seed"
    SOCIETY_WELCOME      = "society_welcome"
    PLEDGE_REMINDER      = "pledge_reminder"
    YEAR_END_GIVING      = "year_end_giving"


# ─── TOUCHPOINT SCHEDULE ─────────────────────────────────────────────────────

@dataclass
class TouchpointSchedule:
    month:          int             # 1–12
    week:           int             # Week of month (1–4)
    touch_type:     TouchType
    channel:        str             # email | sms | phone | handwritten | portal
    priority:       str             # critical | high | medium | low
    content_theme:  str             # Brief content directive
    allow_skip:     bool = False    # Can skip if donor has been contacted within 30 days
    trigger:        str = ""        # What triggers this touchpoint
    note:           str = ""        # Note for the VSO / gift officer


# ─── INSTITUTIONAL CALENDAR ──────────────────────────────────────────────────

# Key dates for a typical academic year (configurable per institution)
INSTITUTIONAL_CALENDAR = {
    "giving_day":          datetime.date(2026, 4, 15),   # Spring Giving Day
    "fiscal_year_end":     datetime.date(2026, 6, 30),   # FYE (June for most)
    "calendar_year_end":   datetime.date(2026, 12, 31),  # Dec 31 tax deadline
    "fall_semester_start": datetime.date(2026, 9, 1),    # Back to campus energy
    "spring_semester":     datetime.date(2026, 1, 15),   # New year momentum
    "homecoming":          datetime.date(2026, 10, 10),  # Fall alumni weekend
    "reunion_weekend":     datetime.date(2026, 6, 7),    # Reunion weekend
    "annual_report":       datetime.date(2026, 3, 1),    # Impact report season
    "scholarship_awards":  datetime.date(2026, 5, 15),   # Scholarship season
    "commencement":        datetime.date(2026, 5, 20),   # Graduation
}

# Optimal months by touchpoint type (for general scheduling)
OPTIMAL_MONTHS = {
    TouchType.IMPACT_REPORT:       [3, 9],           # March (annual), September (mid-year)
    TouchType.RENEWAL_ASK:         [10, 11],          # October-November (pre-year-end)
    TouchType.UPGRADE_ASK:         [4, 5, 10],        # Spring and fall
    TouchType.GIVING_DAY:          [4],               # April (giving day month)
    TouchType.YEAR_END_GIVING:     [11, 12],          # November-December
    TouchType.RELATIONSHIP_WARMTH: [1, 6, 8],         # January, summer, August
    TouchType.EVENT_INVITATION:    [2, 9],            # February, September
    TouchType.ESTATE_SEED:         [9, 10],           # Fall (estate planning season)
    TouchType.MILESTONE:           [0],               # Dynamic — whenever detected
}


# ─── ARCHETYPE CHANNEL PREFERENCES ──────────────────────────────────────────

ARCHETYPE_CHANNELS = {
    "LEGACY_BUILDER":     {"primary": "email",       "secondary": "handwritten"},
    "COMMUNITY_CHAMPION": {"primary": "email",       "secondary": "phone"},
    "IMPACT_INVESTOR":    {"primary": "email",       "secondary": "portal"},
    "LOYAL_ALUMNI":       {"primary": "email",       "secondary": "phone"},
    "MISSION_ZEALOT":     {"primary": "email",       "secondary": "sms"},
    "SOCIAL_CONNECTOR":   {"primary": "sms",         "secondary": "email"},
    "PRAGMATIC_PARTNER":  {"primary": "email",       "secondary": "phone"},
    "FAITH_DRIVEN":       {"primary": "email",       "secondary": "handwritten"},
}


# ─── TIER-BASED CADENCE TEMPLATES ────────────────────────────────────────────

# Returns list of (month, week, type, priority, theme) for each tier
# This is the BASE template; enriched with life events + milestones

def _micro_calendar(archetype: str) -> list[TouchpointSchedule]:
    """<$100 donors — 2 touchpoints/year. Digital-only."""
    ch = ARCHETYPE_CHANNELS.get(archetype, {}).get("primary", "email")
    return [
        TouchpointSchedule(3, 1, TouchType.IMPACT_REPORT, ch, "medium",
            "Brief impact report — 3 sentences max, 1 stat, 1 CTA"),
        TouchpointSchedule(11, 2, TouchType.YEAR_END_GIVING, ch, "high",
            "Year-end tax deadline renewal ask — make it easy"),
    ]


def _annual_calendar(archetype: str) -> list[TouchpointSchedule]:
    """$100–$999 donors — 4 touchpoints/year."""
    ch = ARCHETYPE_CHANNELS.get(archetype, {}).get("primary", "email")
    return [
        TouchpointSchedule(3, 1, TouchType.IMPACT_REPORT, ch, "high",
            "Annual impact report — personalized fund story with 1 student narrative"),
        TouchpointSchedule(4, 3, TouchType.GIVING_DAY, ch, "high",
            "Giving Day participation — peer challenge + matching gift angle"),
        TouchpointSchedule(9, 2, TouchType.RELATIONSHIP_WARMTH, ch, "medium",
            "Back-to-campus energy touchpoint — share fall semester news", allow_skip=True),
        TouchpointSchedule(11, 1, TouchType.RENEWAL_ASK, ch, "high",
            "Renewal ask with impact recap — '${last_gift} does this...'"),
    ]


def _mid_level_calendar(archetype: str) -> list[TouchpointSchedule]:
    """$1K–$9.9K donors — 6 touchpoints/year."""
    ch_primary   = ARCHETYPE_CHANNELS.get(archetype, {}).get("primary", "email")
    ch_secondary = ARCHETYPE_CHANNELS.get(archetype, {}).get("secondary", "phone")
    return [
        TouchpointSchedule(1, 2, TouchType.RELATIONSHIP_WARMTH, ch_primary, "medium",
            "New year warmth — genuine check-in, share one exciting initiative"),
        TouchpointSchedule(3, 1, TouchType.IMPACT_REPORT, ch_primary, "high",
            "In-depth impact report — full fund story, 2 student/faculty profiles"),
        TouchpointSchedule(4, 3, TouchType.GIVING_DAY, ch_primary, "high",
            "Giving Day — lead with community and peer challenge framing"),
        TouchpointSchedule(6, 2, TouchType.EVENT_INVITATION, ch_secondary, "medium",
            "Exclusive stewardship event invitation — dinner, campus tour, reception"),
        TouchpointSchedule(9, 1, TouchType.RELATIONSHIP_WARMTH, ch_primary, "medium",
            "Fall semester energy — share exciting campus news relevant to their interests"),
        TouchpointSchedule(10, 3, TouchType.RENEWAL_ASK, ch_primary, "high",
            "Upgrade-framed renewal ask — 'would you consider stepping up this year?'"),
    ]


def _leadership_calendar(archetype: str) -> list[TouchpointSchedule]:
    """$10K–$24.9K donors — 8 touchpoints/year. Mix of email + phone."""
    ch_primary   = ARCHETYPE_CHANNELS.get(archetype, {}).get("primary", "email")
    ch_secondary = ARCHETYPE_CHANNELS.get(archetype, {}).get("secondary", "phone")
    return [
        TouchpointSchedule(1, 3, TouchType.RELATIONSHIP_WARMTH, ch_primary, "medium",
            "Personal new year note — reference last year's impact specific to their gift"),
        TouchpointSchedule(3, 1, TouchType.IMPACT_REPORT, ch_primary, "high",
            "Full leadership impact report — named fund update + institutional priority tie-in"),
        TouchpointSchedule(4, 2, TouchType.GIVING_DAY, ch_secondary, "high",
            "Personal outreach before Giving Day — acknowledge their leadership role"),
        TouchpointSchedule(5, 3, TouchType.EVENT_INVITATION, ch_secondary, "high",
            "Scholarship awards ceremony invitation — meet recipients if applicable"),
        TouchpointSchedule(7, 1, TouchType.RELATIONSHIP_WARMTH, ch_primary, "medium",
            "Summer check-in — light, no ask, share summer research or program news"),
        TouchpointSchedule(9, 2, TouchType.UPGRADE_ASK, ch_secondary, "high",
            "Upgrade conversation prep — soft mention of Benefactor Society benefits"),
        TouchpointSchedule(10, 1, TouchType.ESTATE_SEED, ch_primary, "low",
            "Planned giving awareness — story of legacy donor, no pressure",
            allow_skip=True),
        TouchpointSchedule(11, 2, TouchType.RENEWAL_ASK, ch_primary, "critical",
            "Annual renewal — personal, detailed, acknowledge their full relationship"),
    ]


def _major_calendar(archetype: str) -> list[TouchpointSchedule]:
    """$25K–$99.9K donors — 10+ touchpoints/year. Mostly human-led."""
    ch = ARCHETYPE_CHANNELS.get(archetype, {}).get("secondary", "phone")
    return [
        TouchpointSchedule(1, 2, TouchType.RELATIONSHIP_WARMTH, "handwritten", "high",
            "Handwritten new year note from gift officer — personal, warm"),
        TouchpointSchedule(2, 3, TouchType.IMPACT_REPORT, "email", "high",
            "Early impact report — comprehensive named fund update"),
        TouchpointSchedule(3, 2, TouchType.EVENT_INVITATION, ch, "high",
            "VIP event — private campus dinner with president or dean"),
        TouchpointSchedule(4, 1, TouchType.GIVING_DAY, "email", "medium",
            "Giving Day leadership role — ask to be a challenge match donor"),
        TouchpointSchedule(5, 2, TouchType.EVENT_INVITATION, ch, "high",
            "Commencement / scholarship ceremony VIP invitation",
            note="Requires human gift officer to coordinate"),
        TouchpointSchedule(7, 3, TouchType.RELATIONSHIP_WARMTH, ch, "medium",
            "Summer outreach — personal update, upcoming institutional initiatives"),
        TouchpointSchedule(9, 1, TouchType.IMPACT_REPORT, "email", "high",
            "Mid-year impact update — preview fall semester highlights"),
        TouchpointSchedule(10, 2, TouchType.UPGRADE_ASK, ch, "high",
            "Upgrade conversation — move to next society level or named opportunity",
            note="Human gift officer required for this conversation"),
        TouchpointSchedule(10, 4, TouchType.ESTATE_SEED, "email", "medium",
            "Legacy giving introduction — if bequest score ≥ 60"),
        TouchpointSchedule(11, 3, TouchType.RENEWAL_ASK, ch, "critical",
            "Year-end major gift renewal — personal meeting or call preferred"),
    ]


def _principal_calendar(archetype: str) -> list[TouchpointSchedule]:
    """$100K+ donors — All human-managed; VSO provides briefings only."""
    return [
        TouchpointSchedule(1, 1, TouchType.RELATIONSHIP_WARMTH, "handwritten", "high",
            "VSO prepares donor briefing for gift officer handwritten note",
            note="VSO role: brief the gift officer, not contact donor directly"),
        TouchpointSchedule(3, 1, TouchType.IMPACT_REPORT, "email", "critical",
            "VSO prepares comprehensive impact brief for human delivery",
            note="Gift officer personalizes and delivers"),
        TouchpointSchedule(5, 1, TouchType.EVENT_INVITATION, "phone", "critical",
            "Presidential dinner / board briefing — VSO prepares briefing",
            note="Human-led; VSO provides intelligence only"),
        TouchpointSchedule(9, 2, TouchType.UPGRADE_ASK, "phone", "critical",
            "VSO prepares major gift briefing for gift officer",
            note="Gift officer required; $100K+ always human-managed"),
        TouchpointSchedule(11, 1, TouchType.RENEWAL_ASK, "phone", "critical",
            "Year-end major gift conversation — VSO prepares full briefing",
            note="Human gift officer only"),
    ]


TIER_CALENDAR_BUILDERS = {
    "micro":      _micro_calendar,
    "annual":     _annual_calendar,
    "mid_level":  _mid_level_calendar,
    "leadership": _leadership_calendar,
    "major":      _major_calendar,
    "principal":  _principal_calendar,
}


# ─── MAIN CALENDAR BUILDER ───────────────────────────────────────────────────

def build_annual_calendar(
    donor: dict,
    tier: str,
    recognition_events: list = None,
    lapse_risk = None,
) -> list[TouchpointSchedule]:
    """
    Build a full 12-month touchpoint calendar for this donor.
    Merges tier-based template with milestone events and lapse risk acceleration.
    """
    recognition_events = recognition_events or []
    archetype = donor.get("archetype", "LOYAL_ALUMNI")

    builder = TIER_CALENDAR_BUILDERS.get(tier, _annual_calendar)
    calendar = builder(archetype)

    # ── Add milestone touchpoints ────────────────────────────────────────────
    for event in recognition_events:
        urgency = event.urgency
        # Place milestone touchpoint in current month
        today = datetime.date.today()
        calendar.append(TouchpointSchedule(
            month=today.month,
            week=1,
            touch_type=TouchType.MILESTONE,
            channel=ARCHETYPE_CHANNELS.get(archetype, {}).get("primary", "email"),
            priority="immediate" if urgency == "immediate" else urgency,
            content_theme=event.message_theme,
            trigger=f"Recognition event: {event.description}",
        ))

    # ── Accelerate cadence if lapse risk is high ─────────────────────────────
    if lapse_risk:
        from .lapse_predictor import LapseTier
        if lapse_risk.tier in (LapseTier.AT_RISK, LapseTier.HIGH, LapseTier.CRITICAL):
            # Move all high/medium touchpoints earlier
            today = datetime.date.today()
            calendar.insert(0, TouchpointSchedule(
                month=today.month,
                week=1,
                touch_type=TouchType.LAPSE_OUTREACH,
                channel=ARCHETYPE_CHANNELS.get(archetype, {}).get("primary", "email"),
                priority="critical",
                content_theme="Lapse risk intervention — warmth first, renewal conversation in follow-up",
                trigger=f"Lapse risk: {lapse_risk.tier.value} ({lapse_risk.days_since_last_gift} days since last gift)",
            ))

    # Sort by month then priority
    priority_order = {"immediate": 0, "critical": 0, "high": 1, "medium": 2, "low": 3}
    calendar.sort(key=lambda t: (t.month, priority_order.get(t.priority, 9)))

    return calendar


def get_next_touchpoint(donor: dict, calendar: list[TouchpointSchedule] = None) -> Optional[TouchpointSchedule]:
    """Return the most urgently needed touchpoint right now."""
    if not calendar:
        return None
    today = datetime.date.today()
    current_month = today.month

    # Immediate / critical first
    for tp in calendar:
        if tp.priority in ("immediate", "critical"):
            return tp

    # Then current or overdue month
    for tp in sorted(calendar, key=lambda t: t.month):
        if tp.month <= current_month:
            return tp

    # Future months — return next one
    return calendar[0] if calendar else None


# ─── PROMPT FORMATTER ────────────────────────────────────────────────────────

def format_calendar_for_prompt(calendar: list[TouchpointSchedule], donor: dict) -> str:
    """Format stewardship calendar for VSO prompt injection."""
    if not calendar:
        return "No stewardship calendar generated."

    today = datetime.date.today()
    current_month = today.month
    next_tp = get_next_touchpoint(donor, calendar)
    month_names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                   "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    lines = [f"Annual Stewardship Plan ({len(calendar)} touchpoints scheduled):"]
    if next_tp:
        lines.append(
            f"\nNEXT TOUCHPOINT DUE: {month_names[next_tp.month]} — "
            f"{next_tp.touch_type.value.replace('_', ' ').title()} "
            f"[{next_tp.priority.upper()}] via {next_tp.channel}"
        )
        lines.append(f"  Content theme: {next_tp.content_theme}")
        if next_tp.note:
            lines.append(f"  Note: {next_tp.note}")

    lines.append("\nFull 12-Month Calendar:")
    last_month = 0
    for tp in calendar:
        if tp.month != last_month:
            lines.append(f"\n  {month_names[tp.month]}:")
            last_month = tp.month
        marker = "→" if tp.month == current_month else "  "
        lines.append(
            f"  {marker} Wk{tp.week}: [{tp.priority.upper():8}] "
            f"{tp.touch_type.value.replace('_',' ').title()} via {tp.channel}"
            + (f" — {tp.content_theme[:60]}..." if len(tp.content_theme) > 60 else f" — {tp.content_theme}")
        )
    return "\n".join(lines)
