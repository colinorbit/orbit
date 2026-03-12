"""
VCO Campaign Engine
===================
Core campaign strategy object, segment-to-messaging mapping,
and campaign stage awareness. The brain of the VCO.

Campaign types:
  GIVING_DAY          — 24-hour sprint campaign (Giving Tuesday, institution day)
  YEAR_END            — November–December year-end appeal series
  SPRING_APPEAL       — February–April spring giving push
  MATCHING_CHALLENGE  — Board or donor match offer with deadline
  SENIOR_CLASS_GIFT   — Graduating class participation challenge
  CROWDFUNDING        — Project-specific peer-to-peer or crowd campaign
  SPECIAL_OCCASION    — Anniversary, reunion year, milestone push
  PHONE_CAMPAIGN      — Student phonathon / calling program

Campaign stages:
  PRE_LAUNCH    — T-14 to T-1: awareness and warm-up
  LAUNCH        — T+0 to T+6h: opening push and momentum
  MID_CAMPAIGN  — T+6h to T-6h: sustaining energy and milestones
  FINAL_HOURS   — Last 6 hours: maximum urgency
  CLOSED        — Campaign ended
  POST_CAMPAIGN — Thank you and results sharing
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
import datetime


class CampaignType(str, Enum):
    GIVING_DAY         = "giving_day"
    YEAR_END           = "year_end"
    SPRING_APPEAL      = "spring_appeal"
    MATCHING_CHALLENGE = "matching_challenge"
    SENIOR_CLASS_GIFT  = "senior_class_gift"
    CROWDFUNDING       = "crowdfunding"
    SPECIAL_OCCASION   = "special_occasion"
    PHONE_CAMPAIGN     = "phone_campaign"


class CampaignStage(str, Enum):
    PRE_LAUNCH    = "pre_launch"    # T-14 through T-1
    LAUNCH        = "launch"        # T+0 to T+6h (or Day 1)
    MID_CAMPAIGN  = "mid_campaign"  # Active middle phase
    FINAL_HOURS   = "final_hours"   # Last 6 hours / last day
    CLOSED        = "closed"        # Campaign complete
    POST_CAMPAIGN = "post_campaign" # Thank you + results phase


@dataclass
class CampaignConfig:
    """Institutional campaign configuration."""
    campaign_type:    CampaignType
    campaign_name:    str                 # e.g., "Greenfield Giving Day 2026"
    institution_name: str
    start_dt:         datetime.datetime
    end_dt:           datetime.datetime
    goal_cents:       int                 # Revenue goal in cents
    goal_donors:      Optional[int]       # Unique donor count goal
    fund_designation: str                 # "unrestricted" | "scholarship" | specific fund name
    challenge_grants: list[dict]          # [{donor_name, amount_cents, threshold, unlocked}]
    matching_ratio:   str                 # "1:1" | "2:1" | "3:1" | None
    matching_cap_cents: int               # Maximum matching amount (0 = unlimited)
    campaign_hashtag: Optional[str]       # e.g., "#GivingDayGreenfield"
    thermometer_public: bool              # Show public progress thermometer?
    leaderboard_active: bool              # School/class/chapter competition?
    sms_enabled:      bool
    phone_enabled:    bool
    social_enabled:   bool
    institution_record_donors: Optional[int]  # Previous best for social proof
    institution_record_raised: Optional[int]  # Previous best in cents


@dataclass
class CampaignStrategy:
    """Per-donor campaign strategy derived from segment + campaign context."""
    campaign_type:         CampaignType
    campaign_stage:        CampaignStage
    segment_play:          str          # "renewal" | "upgrade" | "win_back" | "acquisition" etc.
    primary_hook:          str          # The one emotional or rational hook to lead with
    urgency_frame:         str          # How to frame the deadline
    match_frame:           Optional[str] # How to frame matching gift if applicable
    social_proof_line:     Optional[str] # Peer or progress social proof
    suggested_ask_cents:   int
    upgrade_ask_cents:     int
    include_thermometer:   bool
    include_challenge:     bool
    recommended_tone:      str          # "urgent" | "grateful" | "celebratory" | "personal"
    send_timing:           str          # When to send relative to campaign clock
    subject_lines:         list[str]    # 3–5 A/B subject line options
    preview_texts:         list[str]    # Matching preview texts
    strategic_notes:       str


# ── Stage detection ───────────────────────────────────────────────────────────

def detect_campaign_stage(
    campaign: CampaignConfig, now: Optional[datetime.datetime] = None
) -> CampaignStage:
    """Detect current campaign stage based on time."""
    now = now or datetime.datetime.now()

    if now >= campaign.end_dt:
        # If within 3 days of end, post-campaign
        days_after = (now - campaign.end_dt).days
        return CampaignStage.POST_CAMPAIGN if days_after <= 3 else CampaignStage.CLOSED

    if now < campaign.start_dt:
        return CampaignStage.PRE_LAUNCH

    # During campaign
    total_duration = (campaign.end_dt - campaign.start_dt).total_seconds()
    elapsed        = (now - campaign.start_dt).total_seconds()
    pct_elapsed    = elapsed / total_duration if total_duration > 0 else 0

    if pct_elapsed < 0.10:
        return CampaignStage.LAUNCH
    elif pct_elapsed > 0.85:
        return CampaignStage.FINAL_HOURS
    else:
        return CampaignStage.MID_CAMPAIGN


# ── Subject line generators ───────────────────────────────────────────────────

SUBJECT_LINE_TEMPLATES = {
    CampaignType.GIVING_DAY: {
        "urgent":       [
            "TODAY ONLY: Your gift to {institution} is matched {ratio}",
            "{hours_left} hours left — {institution} needs you now",
            "It ends at midnight. Will you join us?",
            "🕐 {hours_left} hours: {donor_count} donors and counting",
            "Last chance — your matched gift expires tonight",
        ],
        "grateful":     [
            "{name}, you've given {streak} years in a row. Thank you.",
            "Because of donors like you, {institution} can do this",
            "You're the reason {institution} Giving Day works, {name}",
            "Your {streak}-year streak is remarkable — one more?",
            "With gratitude: {institution} Giving Day",
        ],
        "celebratory":  [
            "🎉 {donor_count} donors — and we're just getting started!",
            "WE DID IT: {milestone_label} unlocked!",
            "{class_year} leads the class challenge — but barely 🔥",
            "This is what community looks like: {donor_count} strong",
            "Going for a record today. Are you in?",
        ],
        "personal":     [
            "{name}, your class needs you today",
            "A message from President {president_name}",
            "One year. One day. One chance. {name}, make it count.",
            "For {student_name}'s scholarship — today only",
            "The student you helped last year is asking today",
        ],
        "nostalgic":    [
            "Remember why you fell in love with {institution}?",
            "It started with a classroom. Today, you keep it alive.",
            "{name}, it's {institution} Giving Day. Come home.",
            "The {institution} you love still exists because of you",
            "Your {streak} years of giving have built something lasting",
        ],
    },
    CampaignType.YEAR_END: {
        "urgent":       [
            "Tax deadline in {days_left} days — your gift is still deductible",
            "December 31 closes tomorrow. Give before midnight.",
            "Year-end giving: last call for your 2026 tax deduction",
            "{name}, your matched gift offer expires December 31",
            "48 hours until your tax deduction window closes",
        ],
        "grateful":     [
            "{name}, thank you for another year of partnership",
            "Your {streak} years mean everything to us. End the year strong.",
            "Before the year ends, a thank you — and one more ask",
            "The year in review: what your giving made possible",
            "{institution} 2026: the year you made different",
        ],
        "personal":     [
            "{name}, will you end the year with us?",
            "A personal note before December 31",
            "Your year-end gift could be your most impactful",
            "This student's story ends differently because of donors like you",
            "{name}, we're {amount_away} from our year-end goal",
        ],
    },
    CampaignType.MATCHING_CHALLENGE: {
        "urgent":       [
            "MATCH OFFER: Give today and {donor_name} will double it",
            "Double your impact: {ratio} match for the next {hours_left} hours",
            "Someone has offered to match every dollar. Time's running out.",
            "2:1 match — your ${ask} becomes ${matched_ask} for students",
            "Match expires {deadline}. Don't leave money on the table.",
        ],
        "celebratory":  [
            "WE UNLOCKED IT: {donor_name}'s ${match_amount:,} match is live!",
            "You did it — ${amount_raised:,} raised, match unlocked 🎉",
            "The board match is LIVE. Here's how to double your gift.",
            "Because you showed up: {match_unlocked_label} achieved",
        ],
    },
    CampaignType.SENIOR_CLASS_GIFT: {
        "celebratory":  [
            "Class of {grad_year}: 🔥 {participation_pct}% participation and climbing",
            "{grad_year}: We're {donors_needed} donors from the record",
            "Your class is {pct_to_goal}% of the way there — let's finish this",
            "Seniors: {rival_class} is watching. Don't let them win.",
        ],
        "personal":     [
            "{name}, be part of your class's legacy",
            "Every senior. Every dollar. Class of {grad_year}.",
            "Your first gift as an alum starts today, {name}",
            "One day. One class. One legacy.",
        ],
    },
}


def _get_subject_lines(
    campaign_type: CampaignType, tone: str, campaign: CampaignConfig, donor: dict
) -> list[str]:
    """Get 3–5 subject line options for this segment/campaign combination."""
    templates = SUBJECT_LINE_TEMPLATES.get(campaign_type, {}).get(
        tone,
        SUBJECT_LINE_TEMPLATES.get(CampaignType.GIVING_DAY, {}).get(tone, [])
    )
    if not templates:
        templates = [
            f"Your gift to {campaign.institution_name} matters",
            f"{campaign.campaign_name} — will you join us?",
            f"{donor.get('name', 'Friend')}, {campaign.institution_name} needs your support",
        ]
    return templates[:5]


def _get_preview_texts(tone: str, campaign: CampaignConfig) -> list[str]:
    """Matching preview texts for subject lines."""
    base = {
        "urgent":      ["Time is running out.", "Every second counts.", "Don't miss this."],
        "grateful":    ["Because of you.", "Thank you for everything.", "Your impact is real."],
        "celebratory": ["Look what we've done together!", "The momentum is incredible.", "Join the celebration!"],
        "personal":    ["I've been thinking about you.", "A personal message inside.", "This one's for you."],
        "nostalgic":   ["Remember why it matters.", "Some things are worth returning to.", "Your roots are calling."],
    }
    return base.get(tone, ["Your gift changes everything."])


# ── Campaign strategy builder ─────────────────────────────────────────────────

def build_campaign_strategy(
    campaign: CampaignConfig,
    segment_profile,    # SegmentProfile from segment_profiler
    donor: dict,
    now: Optional[datetime.datetime] = None,
) -> CampaignStrategy:
    """
    Build a per-donor campaign strategy combining:
    - Campaign context (type, stage, goals)
    - Segment profile (urgency, ask, tone)
    - Donor attributes (archetype, history)
    """
    now   = now or datetime.datetime.now()
    stage = detect_campaign_stage(campaign, now)

    # ── Primary hook ──────────────────────────────────────────────────────────
    hook_map = {
        CampaignStage.PRE_LAUNCH:    "Preview: something exciting is coming",
        CampaignStage.LAUNCH:        "We're live — join us today",
        CampaignStage.MID_CAMPAIGN:  "The momentum is building",
        CampaignStage.FINAL_HOURS:   "Last chance — this is it",
        CampaignStage.POST_CAMPAIGN: "Look what we did together",
        CampaignStage.CLOSED:        "Thank you — here's what your gift accomplished",
    }

    # Segment-specific hook override
    segment_play = segment_profile.ask_strategy
    if segment_play == "win_back":
        hook_override = "We missed you — and we need you back"
    elif segment_play == "upgrade":
        hook_override = f"You're ready for the next level: ${segment_profile.upgrade_ask_cents/100:,.0f}"
    elif segment_play == "acquisition":
        hook_override = "This is the moment to make your first gift"
    else:
        hook_override = None

    primary_hook = hook_override or hook_map.get(stage, "Your gift matters today")

    # ── Urgency frame ─────────────────────────────────────────────────────────
    if stage == CampaignStage.FINAL_HOURS:
        hours_remaining = max(0, (campaign.end_dt - now).seconds // 3600)
        urgency_frame   = f"ONLY {hours_remaining} HOURS LEFT — give before midnight"
    elif stage == CampaignStage.PRE_LAUNCH:
        days_to_launch = max(0, (campaign.start_dt - now).days)
        urgency_frame  = f"{days_to_launch} days until {campaign.campaign_name}"
    elif campaign.end_dt.date() == now.date():
        urgency_frame = "TODAY ONLY — this opportunity ends at midnight"
    else:
        days_left     = max(1, (campaign.end_dt - now).days)
        urgency_frame = f"{days_left} days remaining — don't wait"

    # ── Match frame ───────────────────────────────────────────────────────────
    match_frame = None
    if campaign.matching_ratio and campaign.matching_ratio != "none":
        cap_str   = f" (up to ${campaign.matching_cap_cents/100:,.0f})" if campaign.matching_cap_cents else ""
        match_frame = (
            f"A generous donor will match your gift {campaign.matching_ratio}{cap_str}. "
            f"Your ${segment_profile.upgrade_ask_cents/100:,.0f} becomes "
            f"${_matched_amount(segment_profile.upgrade_ask_cents, campaign.matching_ratio)/100:,.0f} — at no extra cost to you."
        )

    # ── Social proof ──────────────────────────────────────────────────────────
    social_proof = None
    if campaign.goal_donors:
        pct = min(99, int(0.4 * 100))  # Assume 40% progress at mid-point
        social_proof = f"Join {pct}% of your fellow alumni who've already given today"
    if campaign.institution_record_donors:
        social_proof = (
            f"We set a record last year with {campaign.institution_record_donors:,} donors. "
            f"Help us beat it today."
        )

    # ── Include thermometer / challenge ──────────────────────────────────────
    include_therm     = campaign.thermometer_public and stage in (
        CampaignStage.LAUNCH, CampaignStage.MID_CAMPAIGN, CampaignStage.FINAL_HOURS
    )
    include_challenge = bool(campaign.challenge_grants) and stage != CampaignStage.POST_CAMPAIGN

    # ── Tone and timing ───────────────────────────────────────────────────────
    tone          = segment_profile.subject_tone
    send_timing   = _recommend_send_timing(stage, campaign.campaign_type)
    subject_lines = _get_subject_lines(campaign.campaign_type, tone, campaign, donor)
    preview_texts = _get_preview_texts(tone, campaign)

    # ── Notes ─────────────────────────────────────────────────────────────────
    notes_parts = [segment_profile.segment_notes]
    if campaign.leaderboard_active:
        notes_parts.append("Leaderboard is active — class/school competition can be a hook.")
    if campaign.sms_enabled and "sms" in segment_profile.channel_priority:
        notes_parts.append("SMS enabled — send final-hours text if no email open by noon.")
    strategic_notes = " ".join(notes_parts)

    return CampaignStrategy(
        campaign_type=campaign.campaign_type,
        campaign_stage=stage,
        segment_play=segment_play,
        primary_hook=primary_hook,
        urgency_frame=urgency_frame,
        match_frame=match_frame,
        social_proof_line=social_proof,
        suggested_ask_cents=segment_profile.base_ask_cents,
        upgrade_ask_cents=segment_profile.upgrade_ask_cents,
        include_thermometer=include_therm,
        include_challenge=include_challenge,
        recommended_tone=tone,
        send_timing=send_timing,
        subject_lines=subject_lines,
        preview_texts=preview_texts,
        strategic_notes=strategic_notes,
    )


def _matched_amount(ask_cents: int, ratio: str) -> int:
    """Calculate total with match applied."""
    ratio_map = {"1:1": 2, "2:1": 3, "3:1": 4}
    multiplier = ratio_map.get(ratio, 2)
    return ask_cents * multiplier


def _recommend_send_timing(stage: CampaignStage, ctype: CampaignType) -> str:
    timing_map = {
        CampaignStage.PRE_LAUNCH:    "T-7: Save-the-date. T-3: Preview campaign goal.",
        CampaignStage.LAUNCH:        "8–9am: Launch email. 11am: SMS if not opened.",
        CampaignStage.MID_CAMPAIGN:  "12pm: Progress update + milestone unlock.",
        CampaignStage.FINAL_HOURS:   "6pm: Final hours email. 10pm: Last chance SMS.",
        CampaignStage.POST_CAMPAIGN: "T+24h: Thank you + results. T+72h: Impact share.",
        CampaignStage.CLOSED:        "No more outreach — stewardship mode only.",
    }
    return timing_map.get(stage, "Campaign timing varies — follow institutional calendar.")


# ── Prompt formatter ──────────────────────────────────────────────────────────

def format_campaign_for_prompt(strategy: CampaignStrategy, campaign: CampaignConfig) -> str:
    """Format campaign strategy for VCO system prompt injection."""
    lines = [
        f"Campaign: {campaign.campaign_name} ({strategy.campaign_type.value.upper().replace('_',' ')})",
        f"Campaign Stage: {strategy.campaign_stage.value.upper().replace('_',' ')} | Tone: {strategy.recommended_tone.upper()}",
        f"Segment Play: {strategy.segment_play.upper()}",
        f"Primary Hook: {strategy.primary_hook}",
        f"Urgency Frame: {strategy.urgency_frame}",
        f"Ask: ${strategy.suggested_ask_cents/100:,.0f} | Upgrade: ${strategy.upgrade_ask_cents/100:,.0f}",
        f"Fund: {campaign.fund_designation}",
        "",
        f"Send Timing: {strategy.send_timing}",
    ]
    if strategy.match_frame:
        lines.append(f"\nMATCH OPPORTUNITY:\n{strategy.match_frame}")
    if strategy.social_proof_line:
        lines.append(f"\nSOCIAL PROOF: {strategy.social_proof_line}")
    if strategy.include_thermometer:
        lines.append("THERMOMETER: Include campaign progress bar in email")
    if strategy.include_challenge:
        lines.append("CHALLENGE GRANTS: Reference unlockable challenge grants")
    lines.append(f"\nSUBJECT LINE OPTIONS (A/B test):")
    for i, sl in enumerate(strategy.subject_lines[:5], 1):
        lines.append(f"  Option {i}: {sl}")
    lines.append(f"\nSTRATEGIC NOTES: {strategy.strategic_notes}")
    return "\n".join(lines)
