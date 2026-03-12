#!/usr/bin/env python3
"""
VCO Demo — Virtual Campaign Officer Showcase
=============================================
Demonstrates the full Orbit VCO intelligence pipeline:

  1. Donor Segment Profiling    (vco_intelligence)
  2. Campaign Strategy Engine   (vco_intelligence)
  3. Giving Day Orchestration   (vco_intelligence)
  4. Match Engine               (vco_intelligence)
  5. Appeal Sequencer           (vco_intelligence)
  6. Life Event Detection       (veo_intelligence)
  7. Claude AI Generation       (anthropic)
  8. Cost Governance            (veo_intelligence)

VCO is the sprint-mode agent. Unlike VEO (continuous cultivation),
VCO runs on campaign calendars: Giving Day, year-end, spring appeal,
matching challenges, senior class gift, and more.

Campaign features demonstrated:
  - Greenfield Giving Day 2026 (April 15, 2026)
  - Board match: 1:1 up to $50,000
  - Challenge grant: $25,000 unlock at 500 donors
  - School leaderboard + class year competition
  - 7 donor segments (NLYBUNT, LYBUNT, SYBUNT, young alumni, mid-level, parent, first-time)

Usage:
  python3 vco_demo.py            # Run 3 showcase donors
  python3 vco_demo.py --all      # Run all 10 demo donors
  python3 vco_demo.py --donor 4  # Run single donor by 1-based index
"""

import os
import sys
import re
import json
import argparse
import datetime
from typing import Optional

import anthropic

from veo_intelligence.life_event_detector import detect_life_events, format_events_for_prompt
from veo_intelligence.cost_governor       import CostGovernor, DEMO_CLIENTS

from vco_intelligence.segment_profiler        import classify_donor_segment, format_segment_for_prompt
from vco_intelligence.campaign_engine         import (
    CampaignType, CampaignConfig, build_campaign_strategy, format_campaign_for_prompt
)
from vco_intelligence.giving_day_orchestrator import (
    ChallengeGrant, orchestrate_giving_day, format_gd_for_prompt
)
from vco_intelligence.match_engine            import detect_match_opportunities, format_match_for_prompt
from vco_intelligence.appeal_sequencer        import sequence_appeal, format_series_for_prompt

# ── Config ───────────────────────────────────────────────────────────────────
MODEL      = "claude-sonnet-4-20250514"
MAX_TOKENS = 3000
ORG_NAME   = "Greenfield University"
CLIENT_ID  = os.environ.get("ORBIT_CLIENT_ID", "greenfield")

# ── Giving Day config (April 15, 2026 — midday surge) ────────────────────────
# Simulating launch day, 2pm (midday surge stage for demo variety)
GD_LAUNCH = datetime.datetime(2026, 4, 15, 8, 0, 0)
GD_END    = datetime.datetime(2026, 4, 15, 23, 59, 59)
GD_NOW    = datetime.datetime(2026, 4, 15, 14, 0, 0)  # 2pm = midday surge

GIVING_DAY_CONFIG = CampaignConfig(
    campaign_type=CampaignType.GIVING_DAY,
    campaign_name="Greenfield Giving Day 2026",
    institution_name=ORG_NAME,
    start_dt=GD_LAUNCH,
    end_dt=GD_END,
    goal_cents=250_000_00,             # $250,000 goal
    goal_donors=750,                   # 750 unique donor goal
    fund_designation="unrestricted annual fund",
    challenge_grants=[],               # Populated below
    matching_ratio="1:1",
    matching_cap_cents=50_000_00,      # $50K board match cap
    campaign_hashtag="#GivingDayGreenfield",
    thermometer_public=True,
    leaderboard_active=True,
    sms_enabled=True,
    phone_enabled=False,
    social_enabled=True,
    institution_record_donors=612,     # Previous best
    institution_record_raised=198_000_00,
)

GIVING_DAY_CHALLENGES = [
    ChallengeGrant(
        donor_name="The Whitfield Family Foundation",
        amount_cents=25_000_00,
        trigger_type="donor_count",
        trigger_value=500,
        time_window=None,
        unlocked=False,    # Not yet unlocked at 2pm (425 donors so far)
        description="Reach 500 donors and unlock a $25,000 challenge grant!",
    ),
    ChallengeGrant(
        donor_name="Anonymous Board Member",
        amount_cents=10_000_00,
        trigger_type="dollar_milestone",
        trigger_value=150_000_00,   # $150K milestone
        time_window="12pm–6pm only",
        unlocked=True,              # Unlocked at noon
        description="Afternoon challenge: already unlocked!",
    ),
]

# Live stats at 2pm demo snapshot
GD_DONORS_SO_FAR = 425
GD_RAISED_CENTS  = 148_750_00  # ~$148,750 (59.5% to goal)

GD_LEADERBOARD = {
    "School of Business":    "142 donors",
    "Class of 1998":         "67 donors",
    "Engineering Alumni":    "58 donors",
}


# ─────────────────────────────────────────────────────────────────────────────
# DEMO DONORS — Annual Fund Campaign Segments
# Covers 7 segments: NLYBUNT, LYBUNT, SYBUNT, young alumni, mid-level, parent, first-time
# ─────────────────────────────────────────────────────────────────────────────

VCO_DONORS = [
    {
        # ── [0] NLYBUNT — 22-year streak, upgrade target ──────────────────────
        "name":             "Patricia Morrison",
        "id":               "D-VCO-001",
        "classYear":        "1985",
        "archetype":        "LOYAL_ALUMNI",
        "journeyStage":     "stewardship",
        "givingStreak":     22,
        "totalGiving":      4_850,
        "lastGiftCents":    25000,       # $250 last gift
        "lastGiftYear":     2025,
        "giftCount":        22,
        "fundDesignation":  "Annual Scholarship Fund",
        "interests":        ["scholarships", "students", "annual giving"],
        "sentiment":        "positive",
        "employer":         "Retired (Education)",
        "isParent":         False,
        "conversationHistory": [],
        "notes": "22-year consecutive giver. Ready for $500 upgrade. Loyal to scholarship fund.",
    },
    {
        # ── [1] LYBUNT — Missed 2025, strong prior history ────────────────────
        "name":             "David Nakamura",
        "id":               "D-VCO-002",
        "classYear":        "1997",
        "archetype":        "IMPACT_INVESTOR",
        "journeyStage":     "lapsed_outreach",
        "givingStreak":     0,           # Broke streak last year
        "totalGiving":      1_650,
        "lastGiftCents":    15000,       # $150 last gift
        "lastGiftYear":     2024,        # Missed 2025
        "giftCount":        9,
        "fundDesignation":  "Research Innovation Fund",
        "interests":        ["research", "innovation", "impact", "data"],
        "sentiment":        "neutral",
        "employer":         "Google",    # Employer match eligible!
        "isParent":         False,
        "conversationHistory": [],
        "notes": "9 gifts over 10 years, missed last year. Google employer match = 2x his gift.",
    },
    {
        # ── [2] YOUNG ALUMNI — Class of 2021, first campaign ─────────────────
        "name":             "Sofia Chen",
        "id":               "D-VCO-003",
        "classYear":        "2021",
        "archetype":        "SOCIAL_CONNECTOR",
        "journeyStage":     "cultivation",
        "givingStreak":     2,
        "totalGiving":      75,
        "lastGiftCents":    2500,        # $25 last gift
        "lastGiftYear":     2025,
        "giftCount":        2,
        "fundDesignation":  "unrestricted",
        "interests":        ["community", "social media", "networking", "peers"],
        "sentiment":        "positive",
        "employer":         "Salesforce",
        "isParent":         False,
        "conversationHistory": [],
        "notes": "Class of 2021. Small gifts but consistent. Social Connector — class competition angle works.",
    },
    {
        # ── [3] SYBUNT — Lapsed 3 years, needs warming ───────────────────────
        "name":             "Michael Okafor",
        "id":               "D-VCO-004",
        "classYear":        "2001",
        "archetype":        "MISSION_ZEALOT",
        "journeyStage":     "lapsed_outreach",
        "givingStreak":     0,
        "totalGiving":      800,
        "lastGiftCents":    10000,       # $100 last gift
        "lastGiftYear":     2022,        # 3 years lapsed
        "giftCount":        7,
        "fundDesignation":  "Community Engagement Fund",
        "interests":        ["community", "mission", "service", "access"],
        "sentiment":        "neutral",
        "employer":         "Nonprofit sector",
        "isParent":         False,
        "conversationHistory": [],
        "notes": "SYBUNT 3yr. Mission Zealot — warm with mission story before asking.",
    },
    {
        # ── [4] PARENT — Current student family ──────────────────────────────
        "name":             "James and Linda Wheeler",
        "id":               "D-VCO-005",
        "classYear":        None,
        "archetype":        "COMMUNITY_CHAMPION",
        "journeyStage":     "cultivation",
        "givingStreak":     2,
        "totalGiving":      600,
        "lastGiftCents":    30000,       # $300 last gift
        "lastGiftYear":     2025,
        "giftCount":        2,
        "fundDesignation":  "Student Experience Fund",
        "interests":        ["students", "campus life", "athletics", "family"],
        "sentiment":        "positive",
        "employer":         "Boeing",    # Boeing employer match!
        "isParent":         True,        # Parent flag!
        "studentName":      "Emma Wheeler (Class of 2027)",
        "conversationHistory": [],
        "notes": "Parents of Emma Wheeler (junior). Boeing employer match. Very engaged family.",
    },
    {
        # ── [5] MID-LEVEL UPGRADE — Leadership giving society candidate ───────
        "name":             "Catherine Reyes",
        "id":               "D-VCO-006",
        "classYear":        "1993",
        "archetype":        "LEGACY_BUILDER",
        "journeyStage":     "discovery",
        "givingStreak":     12,
        "totalGiving":      8_400,
        "lastGiftCents":    100000,      # $1,000 last gift
        "lastGiftYear":     2025,
        "giftCount":        12,
        "fundDesignation":  "Dean's Excellence Fund",
        "interests":        ["legacy", "excellence", "scholarships", "endowment"],
        "sentiment":        "positive",
        "employer":         "Law firm (partner)",
        "isParent":         False,
        "conversationHistory": [],
        "notes": "12-year streak, $8,400 cumulative. Ready for Chancellor's Circle ($2,500+). Legacy Builder.",
    },
    {
        # ── [6] FIRST-TIME SOLICITATION — Never given ────────────────────────
        "name":             "Ryan Park",
        "id":               "D-VCO-007",
        "classYear":        "2015",
        "archetype":        "PRAGMATIC_PARTNER",
        "journeyStage":     "cultivation",
        "givingStreak":     0,
        "totalGiving":      0,
        "lastGiftCents":    0,
        "lastGiftYear":     0,
        "giftCount":        0,
        "fundDesignation":  "unrestricted",
        "interests":        ["efficiency", "outcomes", "career services"],
        "sentiment":        "neutral",
        "employer":         "Amazon",    # Amazon employer match!
        "isParent":         False,
        "conversationHistory": [],
        "notes": "Never given. Class of 2015 (11yr out). Amazon employer match. First-time acquisition target.",
    },
    {
        # ── [7] NLYBUNT — Long streak, employer match opportunity ─────────────
        "name":             "Dr. Margaret Osei",
        "id":               "D-VCO-008",
        "classYear":        "1979",
        "archetype":        "FAITH_DRIVEN",
        "journeyStage":     "stewardship",
        "givingStreak":     30,
        "totalGiving":      15_200,
        "lastGiftCents":    50000,       # $500 last gift
        "lastGiftYear":     2025,
        "giftCount":        30,
        "fundDesignation":  "Campus Ministry Endowment",
        "interests":        ["faith", "community", "service", "permanence"],
        "sentiment":        "positive",
        "employer":         "Retired (Medical)",
        "isParent":         False,
        "conversationHistory": [],
        "notes": "30-year streak! $500 → $1,000 upgrade is the play. Faith Driven. Chapel/ministry fund.",
    },
    {
        # ── [8] LYBUNT — High-value lapsed, match opportunity ────────────────
        "name":             "Thomas Adeyemi",
        "id":               "D-VCO-009",
        "classYear":        "1990",
        "archetype":        "IMPACT_INVESTOR",
        "journeyStage":     "lapsed_outreach",
        "givingStreak":     0,
        "totalGiving":      3_200,
        "lastGiftCents":    50000,       # $500 last gift — missed one year
        "lastGiftYear":     2024,
        "giftCount":        14,
        "fundDesignation":  "Innovation and Technology Fund",
        "interests":        ["technology", "innovation", "data", "impact measurement"],
        "sentiment":        "neutral",
        "employer":         "Goldman Sachs",  # Goldman Sachs match!
        "isParent":         False,
        "conversationHistory": [],
        "notes": "High-value LYBUNT. Goldman Sachs match doubles his $500 gift to $1,000.",
    },
    {
        # ── [9] YOUNG ALUMNI — Giving Day first-timer ────────────────────────
        "name":             "Aaliyah Johnson",
        "id":               "D-VCO-010",
        "classYear":        "2023",
        "archetype":        "COMMUNITY_CHAMPION",
        "journeyStage":     "opted_in",
        "givingStreak":     1,
        "totalGiving":      25,
        "lastGiftCents":    2500,
        "lastGiftYear":     2025,
        "giftCount":        1,
        "fundDesignation":  "unrestricted",
        "interests":        ["community", "social justice", "peers", "campus life"],
        "sentiment":        "positive",
        "employer":         "Entry level — Deloitte",
        "isParent":         False,
        "conversationHistory": [],
        "notes": "One prior Giving Day gift of $25. Class of 2023. Community Champion. Very engaged.",
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# SYSTEM PROMPT BUILDER
# ─────────────────────────────────────────────────────────────────────────────

def build_vco_system_prompt(
    donor: dict,
    segment_profile,
    campaign_strategy,
    gd_status,
    match_opportunities: list,
    appeal_series,
    life_events: list,
    gd_now: datetime.datetime,
) -> str:
    """Build the VCO system prompt injected into every Claude call."""
    donor_age = ""
    if donor.get("classYear"):
        try:
            grad_yr  = int(donor["classYear"])
            est_age  = 2026 - grad_yr + 22
            donor_age = f"Est. age {est_age}"
        except (ValueError, TypeError):
            pass

    # Life events section
    life_events_str = format_events_for_prompt(life_events) if life_events else "No recent life events detected."

    # Match section
    match_str = format_match_for_prompt(match_opportunities, donor, ORG_NAME) if match_opportunities else "No matching gift opportunities detected."

    return f"""You are the ORBIT Virtual Campaign Officer (VCO) for {ORG_NAME}.
You are generating campaign outreach for Greenfield Giving Day 2026 — a 24-hour annual fund sprint.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CAMPAIGN CONTEXT (LIVE: {gd_now.strftime('%I:%M %p')} — {gd_status.stage.value.upper().replace('_', ' ')})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{format_gd_for_prompt(gd_status, GIVING_DAY_CONFIG)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CAMPAIGN STRATEGY (THIS DONOR)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{format_campaign_for_prompt(campaign_strategy, GIVING_DAY_CONFIG)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DONOR SEGMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{format_segment_for_prompt(segment_profile)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MATCHING GIFT INTELLIGENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{match_str}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
APPEAL SERIES DESIGN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{format_series_for_prompt(appeal_series)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DONOR PROFILE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name: {donor['name']} | Class: {donor.get('classYear', 'n/a')} | {donor_age}
Archetype: {donor.get('archetype', 'LOYAL_ALUMNI')} | Stage: {donor.get('journeyStage', 'stewardship')}
Giving Streak: {donor.get('givingStreak', 0)} years | Last Gift: ${donor.get('lastGiftCents', 0)/100:,.0f} ({donor.get('lastGiftYear', 'n/a')})
Total Giving: ${donor.get('totalGiving', 0):,.0f} | Fund: {donor.get('fundDesignation', 'unrestricted')}
Employer: {donor.get('employer', 'n/a')} | Parent: {'Yes' if donor.get('isParent') else 'No'}

LIFE EVENTS: {life_events_str}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VCO OPERATING RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. URGENCY IS THE CAMPAIGN: It's 2pm on Giving Day. 10 hours left. Every word drives action.
2. LEAD WITH THE MATCH: If a match exists, it goes in the subject line AND the first paragraph.
3. SHOW THE MATH: "$100 → $200" is more compelling than "your gift is matched."
4. SEGMENT-SPECIFIC TONE: LYBUNT = warm + personal. Young alumni = energy + competition. Mid-level = exclusive + upgrade.
5. SPECIFIC ASK AMOUNT: Never say "any gift." Always suggest the upgrade amount.
6. USE THE P.S.: The P.S. is the second-most-read element. Use it for match expiry, streak, or upgrade.
7. CHALLENGE GRANT: We are 75 donors from unlocking the Whitfield $25,000 challenge! USE THIS.
8. NO FABRICATION: Never invent statistics. Use only data provided above.
9. DISCLOSURE: Every message must include: "This message was prepared with the assistance of AI. Questions? Contact advancement@greenfield.edu."
10. CAN-SPAM: Every email must include unsubscribe language at the bottom.
"""


# ─────────────────────────────────────────────────────────────────────────────
# VCO USER PROMPT
# ─────────────────────────────────────────────────────────────────────────────

def build_vco_user_prompt(donor: dict, segment_profile, campaign_strategy, match_opps: list) -> str:
    """Build the VCO user-side prompt for Claude."""
    seg_name  = segment_profile.segment.value.upper().replace("_", " ")
    ask       = f"${campaign_strategy.suggested_ask_cents/100:,.0f}"
    upgrade   = f"${campaign_strategy.upgrade_ask_cents/100:,.0f}"
    match_str = ""
    if match_opps:
        top = match_opps[0]
        match_str = f"Match available: {top.donor_name} ({top.ratio_label}). "

    return f"""Generate a Giving Day campaign email for {donor['name']}.
Segment: {seg_name} | Ask: {ask} | Upgrade ask: {upgrade}
Campaign stage: MIDDAY SURGE (2pm — 10 hours remaining)
{match_str}Key angle: {campaign_strategy.primary_hook}
Challenge: 75 donors from unlocking the Whitfield $25,000 challenge!

Return ONLY valid JSON with these exact fields:
{{
    "segment": "{seg_name}",
    "strategy_used": "[one sentence: the core angle you chose and why for this segment]",
    "vco_reasoning": "[2-3 sentences: why this message will drive action for THIS donor]",
    "subject_a": "[best subject line — includes urgency or match]",
    "subject_b": "[A/B test variant — different angle]",
    "preview_text": "[preview text 40–80 chars]",
    "email_body": "[full email body, 200–350 words, with match math, challenge, ask amount, and P.S.]",
    "cta_label": "[CTA button text]",
    "sms_version": "[SMS text under 160 chars with link placeholder]",
    "ab_recommendation": "[which subject to use first and why]",
    "upgrade_ask_used": "[the specific dollar amount used as upgrade ask]",
    "match_featured": [true/false],
    "challenge_featured": [true/false],
    "predicted_response_rate": "[estimated open rate for this segment, e.g. '28-35%']",
    "staff_note": "[gift officer note: anything VCO flagged, PGFO needed, employer match reminder, follow-up]"
}}"""


# ─────────────────────────────────────────────────────────────────────────────
# VCO RUN FUNCTION
# ─────────────────────────────────────────────────────────────────────────────

def run_donor_vco(
    client: anthropic.Anthropic,
    donor: dict,
    index: int,
    governor: Optional[CostGovernor] = None,
) -> dict:
    """Run the full VCO pipeline for one donor."""
    print(f"\n{'═'*70}")
    print(f"  VCO RUN #{index+1}: {donor['name']}")
    print(f"  Archetype: {donor.get('archetype','?')} | Streak: {donor.get('givingStreak',0)}yr")
    print(f"  Total Giving: ${donor.get('totalGiving',0):,.0f} | Last Gift: ${donor.get('lastGiftCents',0)/100:,.0f}")
    print(f"{'═'*70}")

    # Step 1: Detect life events
    print("  ⊕ Detecting life events...")
    life_events = detect_life_events(donor)
    for e in life_events:
        short = (str(e.detail)[:60] + "...") if len(str(e.detail)) > 60 else str(e.detail)
        print(f"    [{e.urgency.upper()}] {e.event_type.value}: {short}")
    if not life_events:
        print("    None detected")

    # Step 2: Classify segment
    print("  ⊕ Classifying donor segment...")
    segment_profile = classify_donor_segment(donor)
    print(f"    Segment: {segment_profile.segment.value.upper().replace('_',' ')} | Strategy: {segment_profile.ask_strategy.upper()}")
    print(f"    Ask: ${segment_profile.base_ask_cents/100:,.0f} | Upgrade: ${segment_profile.upgrade_ask_cents/100:,.0f}")

    # Step 3: Build campaign strategy
    print("  ⊕ Building campaign strategy...")
    campaign_strategy = build_campaign_strategy(GIVING_DAY_CONFIG, segment_profile, donor, now=GD_NOW)
    print(f"    Stage: {campaign_strategy.campaign_stage.value.upper().replace('_',' ')} | Hook: {campaign_strategy.primary_hook[:55]}...")

    # Step 4: Orchestrate Giving Day
    print("  ⊕ Orchestrating Giving Day status...")
    gd_status = orchestrate_giving_day(
        campaign_config=GIVING_DAY_CONFIG,
        challenges=GIVING_DAY_CHALLENGES,
        donors_so_far=GD_DONORS_SO_FAR,
        raised_cents=GD_RAISED_CENTS,
        leaderboard=GD_LEADERBOARD,
        record_donors=GIVING_DAY_CONFIG.institution_record_donors,
        now=GD_NOW,
    )
    print(f"    GD Stage: {gd_status.stage.value.upper().replace('_',' ')}")
    print(f"    Progress: {gd_status.pct_to_goal*100:.0f}% of goal | {GD_DONORS_SO_FAR} donors | {gd_status.hours_remaining:.0f}h remaining")
    if gd_status.next_challenge_gap:
        print(f"    Challenge: {gd_status.next_challenge_gap}")

    # Step 5: Match engine
    print("  ⊕ Detecting match opportunities...")
    match_opps = detect_match_opportunities(donor, GIVING_DAY_CONFIG, GIVING_DAY_CHALLENGES)
    if match_opps:
        for m in match_opps:
            print(f"    [{m.match_type.value.upper().replace('_',' ')}] {m.donor_name} — {m.ratio_label} | {m.math_example}")
    else:
        print("    None detected")

    # Step 6: Appeal sequencer
    print("  ⊕ Sequencing appeal series...")
    appeal_series = sequence_appeal(
        segment=segment_profile,
        campaign_config=GIVING_DAY_CONFIG,
        match_opportunity=match_opps[0] if match_opps else None,
        donor=donor,
    )
    print(f"    Series: {appeal_series.total_touches} touches | Channels: {', '.join(appeal_series.channel_mix)}")

    # Step 7: Claude call
    print("  ⊕ Calling Claude VCO agent...")

    system_prompt = build_vco_system_prompt(
        donor=donor,
        segment_profile=segment_profile,
        campaign_strategy=campaign_strategy,
        gd_status=gd_status,
        match_opportunities=match_opps,
        appeal_series=appeal_series,
        life_events=life_events,
        gd_now=GD_NOW,
    )
    user_prompt = build_vco_user_prompt(donor, segment_profile, campaign_strategy, match_opps)

    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )

    in_tokens  = response.usage.input_tokens
    out_tokens = response.usage.output_tokens
    print(f"  ✓ Claude responded ({in_tokens:,} in / {out_tokens:,} out tokens)")

    # Step 8: Parse JSON
    raw = response.content[0].text.strip()
    json_match = re.search(r"\{.*\}", raw, re.DOTALL)
    if json_match:
        try:
            result = json.loads(json_match.group())
        except json.JSONDecodeError:
            result = {"raw_output": raw}
    else:
        result = {"raw_output": raw}

    # Step 9: Cost governance
    if governor:
        try:
            governor.record_usage(
                donor_id=donor.get("id", f"donor_{index}"),
                input_tokens=in_tokens,
                output_tokens=out_tokens,
                action_type="vco_campaign_run",
                stage=donor.get("journeyStage", "stewardship"),
            )
        except Exception:
            pass

    result["_meta"] = {
        "donor_id":     donor.get("id"),
        "donor_name":   donor["name"],
        "segment":      segment_profile.segment.value,
        "in_tokens":    in_tokens,
        "out_tokens":   out_tokens,
        "match_found":  len(match_opps) > 0,
    }
    return result


# ─────────────────────────────────────────────────────────────────────────────
# OUTPUT PRINTER
# ─────────────────────────────────────────────────────────────────────────────

def print_result(result: dict):
    """Pretty-print VCO result."""
    if result.get("skipped"):
        print(f"\n  ⊝ Skipped: {result.get('reason', 'no reason')}")
        return

    meta    = result.get("_meta", {})
    segment = result.get("segment", meta.get("segment", "?")).upper().replace("_"," ")

    print(f"\n  {'─'*66}")
    print(f"  SEGMENT: {segment}")
    if result.get("strategy_used"):
        print(f"  STRATEGY: {result['strategy_used']}")

    if result.get("vco_reasoning"):
        print(f"\n  VCO REASONING:")
        reasoning_lines = result["vco_reasoning"].split(". ")
        for line in reasoning_lines:
            if line.strip():
                print(f"  {line.strip()}.")

    # Subject lines
    if result.get("subject_a"):
        print(f"\n  SUBJECT A: {result['subject_a']}")
    if result.get("subject_b"):
        print(f"  SUBJECT B: {result['subject_b']}")
    if result.get("preview_text"):
        print(f"  PREVIEW:   {result['preview_text']}")
    if result.get("ab_recommendation"):
        print(f"  A/B REC:   {result['ab_recommendation']}")

    # Email body (truncated for readability)
    if result.get("email_body"):
        body = result["email_body"]
        lines = body.split("\n")
        displayed_lines = lines[:20]  # Show first ~20 lines
        print(f"\n  EMAIL BODY ({len(lines)} lines):")
        for line in displayed_lines:
            print(f"  {line}")
        if len(lines) > 20:
            print(f"  ... ({len(lines) - 20} more lines)")

    # SMS
    if result.get("sms_version"):
        print(f"\n  SMS VERSION:")
        print(f"  {result['sms_version']}")

    # Upgrade + flags
    if result.get("upgrade_ask_used"):
        print(f"\n  UPGRADE ASK: {result['upgrade_ask_used']}")
    flags = []
    if result.get("match_featured"):     flags.append("✅ Match featured")
    if result.get("challenge_featured"): flags.append("⚡ Challenge grant featured")
    if flags:
        print(f"  FLAGS: {' | '.join(flags)}")

    if result.get("predicted_response_rate"):
        print(f"  PREDICTED OPEN RATE: {result['predicted_response_rate']}")

    if result.get("staff_note"):
        note = result["staff_note"]
        print(f"\n  STAFF NOTE: {note[:150]}..." if len(note) > 150 else f"\n  STAFF NOTE: {note}")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="VCO Giving Day Demo")
    group  = parser.add_mutually_exclusive_group()
    group.add_argument("--all",   action="store_true", help="Run all demo donors")
    group.add_argument("--donor", type=int, metavar="N", help="Run single donor by 1-based index")
    args = parser.parse_args()

    api_key = (
        os.environ.get("ANTHROPIC_API_KEY")
        or os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")
    )
    if not api_key:
        print("ERROR: Set ANTHROPIC_API_KEY environment variable")
        sys.exit(1)
    client = anthropic.Anthropic(api_key=api_key)
    client_config = DEMO_CLIENTS.get(CLIENT_ID, DEMO_CLIENTS["greenfield"])
    governor = CostGovernor(client_config)

    print(f"\n{'='*70}")
    print(f"  ORBIT VIRTUAL CAMPAIGN OFFICER (VCO) — Giving Day 2026 Demo")
    print(f"  Institution: {ORG_NAME}")
    print(f"  Campaign: Greenfield Giving Day 2026 (April 15 — simulated 2pm)")
    print(f"  Live Stats: {GD_DONORS_SO_FAR} donors | ${GD_RAISED_CENTS/100:,.0f} raised | "
          f"{GD_RAISED_CENTS/GIVING_DAY_CONFIG.goal_cents*100:.0f}% to goal")
    print(f"  Board Match: 1:1 up to $50,000 | Challenge: {GD_DONORS_SO_FAR}/500 donors (Whitfield $25K)")
    print(f"  Client: {CLIENT_ID} | Model: {MODEL}")
    print(f"{'='*70}")
    governor.print_live_status()

    # Select donors
    if args.all:
        donors = VCO_DONORS
    elif args.donor:
        idx = args.donor - 1
        if idx < 0 or idx >= len(VCO_DONORS):
            print(f"ERROR: Donor index must be 1–{len(VCO_DONORS)}")
            sys.exit(1)
        donors = [VCO_DONORS[idx]]
    else:
        # Default: 3 showcase donors covering NLYBUNT, LYBUNT, YOUNG ALUMNI
        donors = [VCO_DONORS[0], VCO_DONORS[1], VCO_DONORS[2]]

    results = []
    for i, donor in enumerate(donors):
        try:
            result = run_donor_vco(client, donor, i, governor)
            results.append(result)
            print_result(result)
        except anthropic.APIError as e:
            print(f"\n  ✗ API Error: {e}")
        except Exception as e:
            print(f"\n  ✗ Error: {e}")
            import traceback
            traceback.print_exc()

    # ── Session Summary ───────────────────────────────────────────────────────
    successful = [r for r in results if not r.get("skipped") and "raw_output" not in r]
    total_in   = sum(r.get("_meta", {}).get("in_tokens", 0) for r in successful)
    total_out  = sum(r.get("_meta", {}).get("out_tokens", 0) for r in successful)

    print(f"\n\n{'='*70}")
    print(f"  VCO SESSION COMPLETE — {len(successful)} campaign emails generated")
    print(f"{'='*70}")
    print(f"  Successful: {len(successful)} | Total tokens: {total_in:,} in / {total_out:,} out")
    print()
    report = governor.generate_report()
    print(f"\n  {'─'*66}")
    print(f"  BILLING SUMMARY ({CLIENT_ID})")
    print(f"  {'─'*66}")
    for line in report.to_invoice_lines():
        print(f"  {line}")
    print(f"\n  Session complete — {len(successful)} VCO campaign emails generated")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
