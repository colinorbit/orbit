"""
VCO Donor Segment Profiler
===========================
Classifies donors into campaign segments for Annual Fund appeals.
Ruthless segmentation is the #1 driver of campaign response rates.
Every segment gets tailored ask amounts, messaging strategy, and channel mix.

Segments:
  LYBUNT        — Lapsed One Year But Used to, highest priority win-back
  SYBUNT        — Lapsed 2+ Years But Used to, reactivation focus
  NLYBUNT       — Never Lapsed (consecutive), retention + upgrade
  LOYAL_MID     — $500–$4,999 lifetime, upgrade to mid-level society
  MID_LEVEL     — $1K–$24.9K, upgrade toward major gift pipeline
  YOUNG_ALUMNI  — Graduated ≤10 years, acquisition focus, low ask
  PARENT        — Parent of current/recent student, family pride framing
  FIRST_TIME    — Never given, acquisition focus
  LAPSED_DEEP   — 5+ years lapsed, long-shot reactivation only
  MAJOR_ANNUAL  — $25K+ cumulative or last gift, not annual fund target
"""

from __future__ import annotations
from dataclasses import dataclass
from enum import Enum
from typing import Optional
import datetime


class DonorSegment(str, Enum):
    LYBUNT       = "lybunt"       # Lapsed 1 year — top priority
    SYBUNT       = "sybunt"       # Lapsed 2–4 years
    NLYBUNT      = "nlybunt"      # Never lapsed (consecutive giver)
    LOYAL_MID    = "loyal_mid"    # Consecutive + $500–$4,999 cumulative
    MID_LEVEL    = "mid_level"    # $1K–$24.9K last or cumulative
    YOUNG_ALUMNI = "young_alumni" # ≤10 years since graduation
    PARENT       = "parent"       # Parent of enrolled/recent student
    FIRST_TIME   = "first_time"   # Never given
    LAPSED_DEEP  = "lapsed_deep"  # 5+ years lapsed
    MAJOR_ANNUAL = "major_annual" # $25K+ — handled by VEO/MGO, not annual fund


@dataclass
class SegmentProfile:
    segment:            DonorSegment
    ask_strategy:       str          # "upgrade" | "renewal" | "acquisition" | "win_back" | "reactivation"
    base_ask_cents:     int          # Calculated suggest amount
    upgrade_ask_cents:  int          # Stretch ask
    messaging_theme:    str          # Core emotional frame
    urgency_level:      str          # "extreme" | "high" | "moderate" | "low"
    channel_priority:   list[str]    # Ordered channel preference
    touch_limit:        int          # Max touches per campaign
    subject_tone:       str          # "urgent" | "grateful" | "celebratory" | "personal" | "nostalgic"
    open_hook:          str          # Sentence to open the message
    cta_label:          str          # Button/link text
    include_in_gd:      bool         # Should this segment receive Giving Day messaging?
    pgfo_flag:          bool         # Escalate to VPGO if major gift signals present?
    personalization_vars: list[str]  # Variables to inject (e.g., "last_gift", "streak")
    segment_notes:      str          # Strategic notes for gift officer


# ── Segment-specific messaging DNA ───────────────────────────────────────────

SEGMENT_DNA = {
    DonorSegment.NLYBUNT: {
        "messaging_theme": "Celebrate loyalty; upgrade from {last_gift} to {upgrade_ask}",
        "subject_tone":    "grateful",
        "urgency_level":   "moderate",
        "touch_limit":     3,
        "include_in_gd":   True,
        "open_hook":       "Because you've given {streak} years in a row — thank you.",
        "cta_label":       "Renew My Gift",
    },
    DonorSegment.LYBUNT: {
        "messaging_theme": "You were with us. We missed you. Come back.",
        "subject_tone":    "personal",
        "urgency_level":   "high",
        "touch_limit":     4,
        "include_in_gd":   True,
        "open_hook":       "It's been a year since your last gift — and we've been thinking about you.",
        "cta_label":       "Renew My Support",
    },
    DonorSegment.SYBUNT: {
        "messaging_theme": "Reconnect before re-ask. Show what's changed. Warm before you ask.",
        "subject_tone":    "nostalgic",
        "urgency_level":   "moderate",
        "touch_limit":     2,
        "include_in_gd":   False,
        "open_hook":       "A lot has happened at {institution} since we last connected.",
        "cta_label":       "Reconnect with {institution}",
    },
    DonorSegment.LAPSED_DEEP: {
        "messaging_theme": "Low-ask re-entry. One touchpoint. If no response, pause.",
        "subject_tone":    "personal",
        "urgency_level":   "low",
        "touch_limit":     1,
        "include_in_gd":   False,
        "open_hook":       "We haven't heard from you in a while — but we haven't forgotten you.",
        "cta_label":       "Give Any Amount",
    },
    DonorSegment.YOUNG_ALUMNI: {
        "messaging_theme": "Peer social proof + mission impact + low barrier. $5 changes things.",
        "subject_tone":    "celebratory",
        "urgency_level":   "high",
        "touch_limit":     3,
        "include_in_gd":   True,
        "open_hook":       "{class_year} alumni are showing up in a big way this year.",
        "cta_label":       "I'm In",
    },
    DonorSegment.FIRST_TIME: {
        "messaging_theme": "Welcome. Make it easy. One clear ask. Remove all friction.",
        "subject_tone":    "personal",
        "urgency_level":   "moderate",
        "touch_limit":     2,
        "include_in_gd":   True,
        "open_hook":       "There's never been a better time to join thousands of {institution} alumni making a difference.",
        "cta_label":       "Make My First Gift",
    },
    DonorSegment.LOYAL_MID: {
        "messaging_theme": "Named giving society invitation. Exclusive benefits. Upgrade framing.",
        "subject_tone":    "grateful",
        "urgency_level":   "moderate",
        "touch_limit":     3,
        "include_in_gd":   True,
        "open_hook":       "Your consistent support has earned an invitation to something special.",
        "cta_label":       "Join the {society_name}",
    },
    DonorSegment.MID_LEVEL: {
        "messaging_theme": "Impact at scale. Exclusive recognition. Upgrade toward leadership.",
        "subject_tone":    "urgent",
        "urgency_level":   "high",
        "touch_limit":     3,
        "include_in_gd":   True,
        "open_hook":       "At your giving level, you're one of the most impactful supporters we have.",
        "cta_label":       "Increase My Impact",
    },
    DonorSegment.PARENT: {
        "messaging_theme": "Your student. Their future. Your gift changes their experience.",
        "subject_tone":    "personal",
        "urgency_level":   "high",
        "touch_limit":     2,
        "include_in_gd":   True,
        "open_hook":       "As a {institution} family, you see the difference we're making every day.",
        "cta_label":       "Support My Student",
    },
    DonorSegment.MAJOR_ANNUAL: {
        "messaging_theme": "Personal outreach from gift officer. No mass campaign contact.",
        "subject_tone":    "personal",
        "urgency_level":   "low",
        "touch_limit":     0,
        "include_in_gd":   False,
        "open_hook":       "[Reserved for gift officer personal note]",
        "cta_label":       "[Personal ask]",
    },
}


# ── Upgrade ask calculation ───────────────────────────────────────────────────

def _calculate_upgrade(last_gift_cents: int, segment: DonorSegment) -> tuple[int, int]:
    """
    Returns (base_ask_cents, upgrade_ask_cents).
    Base = last gift. Upgrade = next meaningful tier.
    Never ask more than 2x last gift for renewal segments.
    """
    if last_gift_cents <= 0:
        # Acquisition donor
        return (2500, 5000)  # $25 / $50 default

    # Upgrade ladder: move to next natural breakpoint
    UPGRADE_LADDER = [
        (0,       2500,   5000),    # $0–$24 → $25 / $50
        (2500,    5000,   10000),   # $25–$49 → $50 / $100
        (5000,    10000,  15000),   # $50–$99 → $100 / $150
        (10000,   15000,  25000),   # $100–$149 → $150 / $250
        (15000,   25000,  50000),   # $150–$249 → $250 / $500
        (25000,   50000,  100000),  # $250–$499 → $500 / $1,000
        (50000,   100000, 150000),  # $500–$999 → $1,000 / $1,500
        (100000,  150000, 250000),  # $1,000–$1,499 → $1,500 / $2,500
        (150000,  250000, 500000),  # $1,500–$2,499 → $2,500 / $5,000
        (250000,  500000, 1000000), # $2,500–$4,999 → $5,000 / $10,000
        (500000,  1000000,2500000), # $5,000–$9,999 → $10,000 / $25,000
    ]
    for low, base, upgrade in UPGRADE_LADDER:
        if last_gift_cents < base:
            return (last_gift_cents, base)  # Renew at last, upgrade to next tier
    return (last_gift_cents, int(last_gift_cents * 1.25))


def _estimate_grad_year(class_year: Optional[str]) -> Optional[int]:
    if not class_year:
        return None
    try:
        return int(class_year)
    except (ValueError, TypeError):
        return None


# ── Main classifier ───────────────────────────────────────────────────────────

def classify_donor_segment(donor: dict) -> SegmentProfile:
    """
    Classify a donor into the correct campaign segment.
    Returns SegmentProfile with ask amounts, messaging strategy, and channel mix.
    """
    current_year    = datetime.date.today().year
    streak          = donor.get("givingStreak", 0)
    total_giving    = donor.get("totalGiving", 0)          # dollars
    last_gift_cents = donor.get("lastGiftCents", 0) or int(donor.get("lastGiftAmount", 0) * 100)
    last_gift_year  = donor.get("lastGiftYear", 0)
    is_parent       = donor.get("isParent", False)
    grad_year       = _estimate_grad_year(donor.get("classYear"))
    gift_count      = donor.get("giftCount", 0)
    archetype       = donor.get("archetype", "LOYAL_ALUMNI")
    stage           = donor.get("journeyStage", "stewardship")

    years_since_gift = (current_year - last_gift_year) if last_gift_year else 99
    years_since_grad = (current_year - grad_year) if grad_year else 99

    # ── Segment determination ─────────────────────────────────────────────────

    # Major donors: VEO/MGO handles — exclude from annual fund campaigns
    if total_giving >= 25_000 or last_gift_cents >= 2_500_000:
        segment = DonorSegment.MAJOR_ANNUAL

    # Parents of current/recent students
    elif is_parent:
        segment = DonorSegment.PARENT

    # Mid-level: last gift $1K+ or cumulative $1K–$24.9K
    elif last_gift_cents >= 100_000 or (total_giving >= 1_000 and total_giving < 25_000):
        segment = DonorSegment.MID_LEVEL

    # Loyal consecutive with $500+ cumulative → mid-level society invite
    elif streak >= 3 and total_giving >= 500:
        segment = DonorSegment.LOYAL_MID

    # Young alumni (graduated ≤10 years)
    elif years_since_grad <= 10:
        segment = DonorSegment.YOUNG_ALUMNI

    # First-time: never given
    elif gift_count == 0 or last_gift_cents == 0:
        segment = DonorSegment.FIRST_TIME

    # Consecutive giver, gave last year
    elif streak >= 1 and years_since_gift <= 1:
        segment = DonorSegment.NLYBUNT

    # Lapsed 1 year
    elif years_since_gift == 1 or (years_since_gift <= 2 and streak > 0):
        segment = DonorSegment.LYBUNT

    # Lapsed 2–4 years
    elif years_since_gift <= 4 and gift_count > 0:
        segment = DonorSegment.SYBUNT

    # Lapsed 5+ years
    elif gift_count > 0:
        segment = DonorSegment.LAPSED_DEEP

    else:
        segment = DonorSegment.FIRST_TIME

    # ── Build profile ─────────────────────────────────────────────────────────
    dna = SEGMENT_DNA[segment]
    base_ask, upgrade_ask = _calculate_upgrade(last_gift_cents, segment)

    # Channel priority by segment
    channel_priority = _channel_priority(segment, archetype)

    # Ask strategy label
    ask_strategy_map = {
        DonorSegment.NLYBUNT:      "renewal",
        DonorSegment.LYBUNT:       "win_back",
        DonorSegment.SYBUNT:       "reactivation",
        DonorSegment.LAPSED_DEEP:  "reactivation",
        DonorSegment.YOUNG_ALUMNI: "acquisition",
        DonorSegment.FIRST_TIME:   "acquisition",
        DonorSegment.LOYAL_MID:    "upgrade",
        DonorSegment.MID_LEVEL:    "upgrade",
        DonorSegment.PARENT:       "renewal",
        DonorSegment.MAJOR_ANNUAL: "personal",
    }

    # Personalization vars
    pers_vars = ["name", "institution"]
    if streak > 0:    pers_vars.append("streak")
    if last_gift_cents > 0: pers_vars.extend(["last_gift", "upgrade_ask"])
    if grad_year:     pers_vars.append("class_year")

    # PGFO flag: mid-level+ who have been giving 10+ years
    pgfo_flag = (
        segment in (DonorSegment.MID_LEVEL, DonorSegment.LOYAL_MID)
        and streak >= 10
    )

    # Segment notes
    notes = _build_segment_notes(segment, donor, years_since_gift, years_since_grad, pgfo_flag)

    return SegmentProfile(
        segment=segment,
        ask_strategy=ask_strategy_map.get(segment, "renewal"),
        base_ask_cents=base_ask,
        upgrade_ask_cents=upgrade_ask,
        messaging_theme=dna["messaging_theme"],
        urgency_level=dna["urgency_level"],
        channel_priority=channel_priority,
        touch_limit=dna["touch_limit"],
        subject_tone=dna["subject_tone"],
        open_hook=dna["open_hook"],
        cta_label=dna["cta_label"],
        include_in_gd=dna["include_in_gd"],
        pgfo_flag=pgfo_flag,
        personalization_vars=pers_vars,
        segment_notes=notes,
    )


def _channel_priority(segment: DonorSegment, archetype: str) -> list[str]:
    """Return ordered channel list for this segment."""
    base = {
        DonorSegment.NLYBUNT:      ["email", "sms"],
        DonorSegment.LYBUNT:       ["email", "phone_prep", "sms"],
        DonorSegment.SYBUNT:       ["email"],
        DonorSegment.LAPSED_DEEP:  ["email"],
        DonorSegment.YOUNG_ALUMNI: ["email", "sms", "social"],
        DonorSegment.FIRST_TIME:   ["email", "social"],
        DonorSegment.LOYAL_MID:    ["email", "phone_prep"],
        DonorSegment.MID_LEVEL:    ["email", "phone_prep", "handwritten_note"],
        DonorSegment.PARENT:       ["email", "sms"],
        DonorSegment.MAJOR_ANNUAL: ["phone_prep", "handwritten_note"],
    }
    channels = base.get(segment, ["email"])
    # SOCIAL_CONNECTOR archetype: boost social
    if archetype == "SOCIAL_CONNECTOR" and "social" not in channels:
        channels.append("social")
    return channels


def _build_segment_notes(
    segment: DonorSegment, donor: dict, years_since_gift: int, years_since_grad: int, pgfo_flag: bool
) -> str:
    streak = donor.get("givingStreak", 0)
    total  = donor.get("totalGiving", 0)

    notes_map = {
        DonorSegment.NLYBUNT:      f"{streak}-year consecutive giver — protect at all costs. Upgrade ask is the play.",
        DonorSegment.LYBUNT:       f"Lapsed {years_since_gift}yr. Reconnect before asking. Lead with impact.",
        DonorSegment.SYBUNT:       f"Lapsed {years_since_gift}yr. Warm touch first. Single ask max.",
        DonorSegment.LAPSED_DEEP:  f"Deep lapse ({years_since_gift}yr). One email only. Accept any amount as re-entry.",
        DonorSegment.YOUNG_ALUMNI: f"Graduated ~{years_since_grad}yr ago. Mobile-first. Peer pressure and class competition work.",
        DonorSegment.FIRST_TIME:   "Never given. Remove all friction. Low ask. Quick giving form.",
        DonorSegment.LOYAL_MID:    f"${total:,.0f} cumulative. Society invite required. Name the recognition.",
        DonorSegment.MID_LEVEL:    f"${total:,.0f} cumulative. PGFO flag: {pgfo_flag}. Bridge toward major gift conversation.",
        DonorSegment.PARENT:       "Family connection is the hook. Student experience + parent pride.",
        DonorSegment.MAJOR_ANNUAL: "Exclude from mass campaign. Route to gift officer for personal outreach.",
    }
    return notes_map.get(segment, "")


# ── Prompt formatter ──────────────────────────────────────────────────────────

def format_segment_for_prompt(profile: SegmentProfile) -> str:
    """Format segment profile for VCO system prompt injection."""
    last_gift_str  = f"${profile.base_ask_cents/100:,.0f}" if profile.base_ask_cents else "n/a"
    upgrade_str    = f"${profile.upgrade_ask_cents/100:,.0f}" if profile.upgrade_ask_cents else "n/a"
    channel_str    = " → ".join(profile.channel_priority)

    lines = [
        f"Donor Segment: {profile.segment.value.upper().replace('_', ' ')} | Strategy: {profile.ask_strategy.upper()}",
        f"Ask Amounts: Base {last_gift_str} | Upgrade {upgrade_str}",
        f"Urgency Level: {profile.urgency_level.upper()} | Touch Limit: {profile.touch_limit}/campaign",
        f"Channel Priority: {channel_str}",
        f"Include in Giving Day: {'YES' if profile.include_in_gd else 'NO'}",
        f"Messaging Theme: {profile.messaging_theme}",
        f"Subject Tone: {profile.subject_tone.upper()}",
        f"Opening Hook: \"{profile.open_hook}\"",
        f"CTA Label: \"{profile.cta_label}\"",
        "",
        f"PERSONALIZE WITH: {', '.join(profile.personalization_vars)}",
        f"SEGMENT NOTES: {profile.segment_notes}",
    ]
    if profile.pgfo_flag:
        lines.append("⚠ PGFO FLAG: Consider planned giving conversation at this giving level + tenure")
    if profile.ask_strategy == "personal":
        lines.append("⛔ DO NOT INCLUDE IN MASS CAMPAIGN — route to gift officer")
    return "\n".join(lines)
