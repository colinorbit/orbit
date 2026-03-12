"""
VSO Recognition Engine
======================
Giving societies, cumulative milestones, giving streaks, society upgrades,
and personalized recognition event invitations.

Milestones that trigger recognition events:
  - First gift ever
  - Consecutive giving streaks (3, 5, 10, 15, 20, 25, 30, 40, 50 years)
  - Cumulative giving thresholds ($1K, $5K, $10K, $25K, $50K, $100K, $250K, $500K, $1M)
  - Giving society upgrades (automatically detected from cumulative total)
  - Reunion giving year (5-year intervals, class year)
  - Lapsed donor returning (first gift after gap ≥ 2 years)
  - Matching gift completion (employer match received)
  - Pledge fulfillment milestone (25%, 50%, 75%, 100%)

Giving Society Structure (cumulative lifetime):
  FRIEND        $1 – $999
  SUPPORTER     $1,000 – $4,999
  PATRON        $5,000 – $9,999
  GUARDIAN      $10,000 – $24,999
  BENEFACTOR    $25,000 – $49,999
  AMBASSADOR    $50,000 – $99,999
  CHANCELLOR     $100,000 – $249,999
  FOUNDER        $250,000 – $499,999
  LEGACY         $500,000 – $999,999
  PRESIDENT'S    $1,000,000+
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ─── GIVING SOCIETIES ────────────────────────────────────────────────────────

@dataclass
class GivingSociety:
    name:           str
    min_cumulative: int     # cents
    max_cumulative: int     # cents (-1 = no max)
    annual_minimum: int     # cents (for annual membership track, 0 = no annual req)
    benefits:       list[str]
    upgrade_message:str     # Message when donor crosses into this society
    color:          str     # For recognition wall / print materials


GIVING_SOCIETIES: list[GivingSociety] = [
    GivingSociety(
        name="Friend",
        min_cumulative=1_00,
        max_cumulative=999_99,
        annual_minimum=0,
        benefits=["Quarterly e-newsletter", "Annual report"],
        upgrade_message="Welcome to the Greenfield family of donors. Your first gift has set something in motion.",
        color="#A8D5A2",
    ),
    GivingSociety(
        name="Supporter",
        min_cumulative=1_000_00,
        max_cumulative=4_999_99,
        annual_minimum=0,
        benefits=["All Friend benefits", "Exclusive donor impact report", "Recognition in Annual Report", "Priority event registration"],
        upgrade_message="You've reached Supporter level — your cumulative giving has crossed $1,000. Thank you for your sustained commitment.",
        color="#7EC8C8",
    ),
    GivingSociety(
        name="Patron",
        min_cumulative=5_000_00,
        max_cumulative=9_999_99,
        annual_minimum=0,
        benefits=["All Supporter benefits", "Named recognition at campus event", "Semi-annual personal update from Dean/President", "Exclusive Patron reception invitation"],
        upgrade_message="You've joined the Patron Society — your lifetime giving has reached $5,000. You are now among our most dedicated institutional partners.",
        color="#F4A261",
    ),
    GivingSociety(
        name="Guardian",
        min_cumulative=10_000_00,
        max_cumulative=24_999_99,
        annual_minimum=0,
        benefits=["All Patron benefits", "Permanent recognition on campus donor wall", "Private campus tour with senior leadership", "Annual personal call from President", "Exclusive Guardian briefing (institutional priorities)"],
        upgrade_message="You've achieved Guardian Society status — $10,000 lifetime. Your name joins a distinguished group committed to institutional excellence.",
        color="#E76F51",
    ),
    GivingSociety(
        name="Benefactor",
        min_cumulative=25_000_00,
        max_cumulative=49_999_99,
        annual_minimum=0,
        benefits=["All Guardian benefits", "Named fund opportunities available", "Private dinner with President and Board Chair", "Annual impact briefing by Provost", "Gift agreement option"],
        upgrade_message="Benefactor Society. $25,000 lifetime. You are now in the realm of transformational donors. A personal call from the President is coming.",
        color="#2A9D8F",
    ),
    GivingSociety(
        name="Ambassador",
        min_cumulative=50_000_00,
        max_cumulative=99_999_99,
        annual_minimum=0,
        benefits=["All Benefactor benefits", "Naming opportunities for spaces and programs", "Seat on advisory council", "Advance notice of institutional announcements", "Honorary trustee consideration"],
        upgrade_message="Ambassador Society. $50,000 lifetime. This is a profound commitment — a human conversation is required. Escalating to your gift officer now.",
        color="#264653",
    ),
    GivingSociety(
        name="Chancellor's Circle",
        min_cumulative=100_000_00,
        max_cumulative=249_999_99,
        annual_minimum=0,
        benefits=["All Ambassador benefits", "Named professorship opportunities", "Annual Chancellor's Dinner", "Board of Trustees invitation", "Planned giving conversation available"],
        upgrade_message="Chancellor's Circle. $100,000 lifetime. This gift requires a personal, human relationship. Escalating immediately.",
        color="#1A1A2E",
    ),
    GivingSociety(
        name="Founders' Society",
        min_cumulative=250_000_00,
        max_cumulative=499_999_99,
        annual_minimum=0,
        benefits=["All Chancellor benefits", "Building/space naming eligibility", "Permanent legacy recognition", "Annual private dinner with full board", "Life member of Advisory Council"],
        upgrade_message="Founders' Society. $250,000 lifetime. Immediate escalation to President and CDO required.",
        color="#8B0000",
    ),
    GivingSociety(
        name="Legacy Society",
        min_cumulative=500_000_00,
        max_cumulative=999_999_99,
        annual_minimum=0,
        benefits=["All Founders benefits", "Major naming opportunity priority access", "Lifetime honorary degree consideration", "Permanent endowment options"],
        upgrade_message="Legacy Society. $500,000 lifetime. Presidential and Board-level relationship required. Immediate escalation.",
        color="#4B0082",
    ),
    GivingSociety(
        name="President's Circle",
        min_cumulative=1_000_000_00,
        max_cumulative=-1,
        annual_minimum=0,
        benefits=["All Legacy benefits", "Building or program naming rights", "Honorary trustee", "Permanent legacy recognition", "Estate planning consultation"],
        upgrade_message="President's Circle. $1,000,000+ lifetime. This is a transformational relationship. Presidential meeting required immediately.",
        color="#000080",
    ),
]


def get_society(cumulative_cents: int) -> Optional[GivingSociety]:
    """Return the giving society for a cumulative total."""
    for society in reversed(GIVING_SOCIETIES):
        if cumulative_cents >= society.min_cumulative:
            return society
    return None


def get_next_society(cumulative_cents: int) -> Optional[GivingSociety]:
    """Return the next society tier above current."""
    current = get_society(cumulative_cents)
    if not current:
        return GIVING_SOCIETIES[0]
    for i, s in enumerate(GIVING_SOCIETIES):
        if s.name == current.name and i + 1 < len(GIVING_SOCIETIES):
            return GIVING_SOCIETIES[i + 1]
    return None


# ─── RECOGNITION EVENT ───────────────────────────────────────────────────────

@dataclass
class RecognitionEvent:
    event_type:         str     # milestone type
    description:        str     # human-readable
    urgency:            str     # "immediate" | "high" | "medium" | "low"
    society_upgrade:    bool    # Whether this triggers society welcome
    new_society:        Optional[GivingSociety]
    cta:                str     # Call to action for this recognition moment
    escalate_to_human:  bool    # Require human for this recognition
    message_theme:      str     # Theme directive for content
    public_recognition: bool    # Worth mentioning on donor wall / annual report
    gift_opportunity:   bool    # Does this recognition moment create an upgrade ask opportunity?


# ─── DETECTION ───────────────────────────────────────────────────────────────

STREAK_MILESTONES  = {3, 5, 10, 15, 20, 25, 30, 40, 50}
CUMULATIVE_DOLLARS = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000]
CUMULATIVE_CENTS   = [d * 100 for d in CUMULATIVE_DOLLARS]


def detect_recognition_events(donor: dict) -> list[RecognitionEvent]:
    """
    Scan donor profile for recognition milestones.
    Returns list sorted by urgency (immediate → high → medium → low).
    """
    events: list[RecognitionEvent] = []

    streak          = donor.get("givingStreak", 0)
    total_cents     = donor.get("totalGiving", 0)
    if total_cents < 1_000_000:
        # Likely stored as dollars, not cents
        total_cents = int(donor.get("totalGiving", 0) * 100)
    gift_count      = donor.get("giftCount", 0)
    last_gift_cents = donor.get("lastGiftCents", 0) or int(donor.get("lastGiftAmount", 0) * 100)
    days_since_gift = donor.get("daysSinceLastGift", 999)
    class_year      = donor.get("classYear")
    stage           = donor.get("journeyStage", "stewardship")
    prev_total      = int(total_cents - last_gift_cents) if last_gift_cents else total_cents

    current_society  = get_society(total_cents)
    previous_society = get_society(prev_total)

    # ── Society upgrade ──────────────────────────────────────────────────────
    if current_society and previous_society and current_society.name != previous_society.name:
        escalate = total_cents >= 25_000_00  # $25K+ requires human
        events.append(RecognitionEvent(
            event_type="society_upgrade",
            description=f"Crossed into {current_society.name} Society (${total_cents // 100:,.0f} lifetime)",
            urgency="immediate" if escalate else "high",
            society_upgrade=True,
            new_society=current_society,
            cta=f"Welcome letter to {current_society.name} Society + benefits fulfillment",
            escalate_to_human=escalate,
            message_theme=current_society.upgrade_message,
            public_recognition=total_cents >= 1_000_00,
            gift_opportunity=False,  # Never ask immediately on society upgrade
        ))

    # ── Cumulative threshold crossed ─────────────────────────────────────────
    for threshold in CUMULATIVE_CENTS:
        if total_cents >= threshold > prev_total:
            events.append(RecognitionEvent(
                event_type=f"cumulative_${threshold // 100:,.0f}",
                description=f"Crossed ${threshold // 100:,.0f} in lifetime giving",
                urgency="high",
                society_upgrade=False,
                new_society=None,
                cta=f"Acknowledge cumulative milestone — make them feel the weight of their impact",
                escalate_to_human=threshold >= 2_500_000,  # $25K+
                message_theme=f"${threshold // 100:,.0f} lifetime milestone — {_cumulative_message(threshold)}",
                public_recognition=threshold >= 1_000_00,
                gift_opportunity=False,
            ))

    # ── Consecutive giving streak ─────────────────────────────────────────────
    if streak in STREAK_MILESTONES:
        events.append(RecognitionEvent(
            event_type=f"streak_{streak}_years",
            description=f"{streak}-year consecutive giving streak",
            urgency="high" if streak >= 10 else "medium",
            society_upgrade=False,
            new_society=None,
            cta=f"Streak recognition message — make their {streak}-year loyalty feel historic",
            escalate_to_human=False,
            message_theme=f"{streak}-year giving streak — this is identity, not just a transaction",
            public_recognition=streak >= 10,
            gift_opportunity=streak >= 5,  # Upgrade ask appropriate after recognition
        ))

    # ── First gift ────────────────────────────────────────────────────────────
    if gift_count == 1 and days_since_gift <= 7:
        events.append(RecognitionEvent(
            event_type="first_gift",
            description="First-ever gift to Greenfield",
            urgency="immediate",
            society_upgrade=False,
            new_society=GIVING_SOCIETIES[0],
            cta="Welcome to the community — personal, warm, memorable first impression",
            escalate_to_human=False,
            message_theme="First gift: this is the beginning of a relationship, not a transaction",
            public_recognition=False,
            gift_opportunity=False,  # Never ask on first gift acknowledgment
        ))

    # ── Lapsed donor returning ────────────────────────────────────────────────
    if stage == "lapsed_outreach" and days_since_gift <= 30:
        events.append(RecognitionEvent(
            event_type="lapsed_return",
            description="Donor returned after lapse",
            urgency="high",
            society_upgrade=False,
            new_society=None,
            cta="Welcome back — acknowledge the gap warmly, no guilt, strong gratitude",
            escalate_to_human=last_gift_cents >= 100_000_00,
            message_theme="Returning donor: 'We missed you. We're grateful you're back. Here's what's changed.'",
            public_recognition=False,
            gift_opportunity=False,
        ))

    # ── Reunion year ─────────────────────────────────────────────────────────
    if class_year:
        try:
            grad_year = int(class_year)
            years_since = 2026 - grad_year
            if years_since % 5 == 0 and 5 <= years_since <= 60:
                events.append(RecognitionEvent(
                    event_type=f"reunion_{years_since}",
                    description=f"Class of {class_year} — {years_since}-year reunion (2026)",
                    urgency="medium",
                    society_upgrade=False,
                    new_society=None,
                    cta="Reunion giving ask with class challenge framing",
                    escalate_to_human=False,
                    message_theme=f"{years_since}-year reunion: peak nostalgia + identity + peer competition",
                    public_recognition=True,
                    gift_opportunity=True,
                ))
        except (ValueError, TypeError):
            pass

    # ── Giving Day approach ───────────────────────────────────────────────────
    # Giving Day is typically in spring — if within 30 days, trigger prep
    import datetime
    today = datetime.date.today()
    giving_day = datetime.date(today.year, 4, 15)  # Example: April 15
    days_to_giving_day = (giving_day - today).days
    if 0 <= days_to_giving_day <= 30:
        events.append(RecognitionEvent(
            event_type="giving_day_prep",
            description=f"Giving Day in {days_to_giving_day} days",
            urgency="medium",
            society_upgrade=False,
            new_society=None,
            cta="Giving Day warm-up — build excitement and peer momentum",
            escalate_to_human=False,
            message_theme="Giving Day: urgency + community + matching gift + peer challenge",
            public_recognition=True,
            gift_opportunity=True,
        ))

    # Sort by urgency
    urgency_order = {"immediate": 0, "high": 1, "medium": 2, "low": 3}
    events.sort(key=lambda e: urgency_order.get(e.urgency, 9))

    return events


def _cumulative_message(threshold_cents: int) -> str:
    """Return the appropriate milestone message for a cumulative threshold."""
    labels = {
        1_000_00:     "a foundational level of sustained commitment",
        5_000_00:     "five years of average giving or equivalent — a real patron of Greenfield",
        10_000_00:    "five figures — you are now among our most committed institutional partners",
        25_000_00:    "a transformational level — equivalent to a full scholarship funded",
        50_000_00:    "a half-century of impact — your generosity has shaped generations",
        100_000_00:   "six figures — a lifetime achievement in institutional partnership",
        250_000_00:   "a quarter-million — this is foundational philanthropy",
        500_000_00:   "half a million — your name is synonymous with this institution",
        1_000_000_00: "one million dollars — you have changed Greenfield forever",
    }
    return labels.get(threshold_cents, "a remarkable philanthropic milestone")


def get_society_progress(donor: dict) -> dict:
    """Return progress toward next giving society tier."""
    total_cents = donor.get("totalGiving", 0)
    if total_cents < 1_000_000:
        total_cents = int(total_cents * 100)
    current = get_society(total_cents)
    next_soc = get_next_society(total_cents)
    if not current:
        return {"current": "None", "next": "Friend", "progress_pct": 0}
    if not next_soc:
        return {"current": current.name, "next": "Maximum tier", "progress_pct": 100}
    progress = (total_cents - current.min_cumulative) / (next_soc.min_cumulative - current.min_cumulative)
    dollars_to_next = (next_soc.min_cumulative - total_cents) // 100
    return {
        "current_society":    current.name,
        "next_society":       next_soc.name,
        "progress_pct":       round(progress * 100, 1),
        "dollars_to_next":    dollars_to_next,
        "next_society_benefits": next_soc.benefits[:3],  # Top 3 benefits
    }


# ─── PROMPT FORMATTER ────────────────────────────────────────────────────────

def format_recognition_for_prompt(events: list[RecognitionEvent], donor: dict) -> str:
    """Format recognition events + society status for VSO prompt injection."""
    lines = []

    # Society status
    society_info = get_society_progress(donor)
    lines.append(f"Giving Society: {society_info.get('current_society', 'None')} | Next: {society_info.get('next_society', 'N/A')}")
    if "dollars_to_next" in society_info:
        lines.append(f"  Progress: {society_info['progress_pct']}% of the way to {society_info['next_society']} "
                     f"(${society_info['dollars_to_next']:,} more needed)")
        lines.append(f"  Benefits unlocked at next tier: {', '.join(society_info.get('next_society_benefits', []))}")

    if not events:
        lines.append("\nNo recognition milestones detected at this time.")
        return "\n".join(lines)

    lines.append(f"\nRecognition Events ({len(events)} detected):")
    for e in events:
        lines.append(
            f"\n  [{e.urgency.upper()}] {e.event_type.replace('_', ' ').title()}"
            f"\n    {e.description}"
            f"\n    Message Theme: {e.message_theme}"
            f"\n    CTA: {e.cta}"
            + (f"\n    ⚠ ESCALATE TO HUMAN" if e.escalate_to_human else "")
            + (f"\n    Gift Opportunity: Yes" if e.gift_opportunity else "")
        )

    return "\n".join(lines)
