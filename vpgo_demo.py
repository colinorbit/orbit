#!/usr/bin/env python3
"""
VPGO Demo — Virtual Planned Giving Officer Showcase
=====================================================
Demonstrates the full Orbit VPGO intelligence pipeline:

  1. Bequest Propensity Scoring    (vpgo_intelligence)
  2. Gift Vehicle Matching         (vpgo_intelligence)
  3. Legacy Conversation Strategy  (vpgo_intelligence)
  4. Legacy Society Status         (vpgo_intelligence)
  5. Life Event Detection          (veo_intelligence)
  6. External Signals              (veo_intelligence)
  7. Claude AI Generation          (anthropic)
  8. Cost Governance               (veo_intelligence)

VPGO operates on a 45-day cultivation cadence for prospects with bequeath_score ≥ 60.
All VPGO communications are educational and informational only — never a hard ask.
VPGO plants seeds; the human PGFO closes the conversation.

DISCLAIMER: All planned giving information is educational. Not legal or tax advice.
Donors must consult independent legal and financial advisors.

Usage:
  python3 vpgo_demo.py            # Run 3 showcase donors
  python3 vpgo_demo.py --all      # Run all 10 demo donors
  python3 vpgo_demo.py --donor 4  # Run single donor by index
"""

import os
import sys
import re
import json
import argparse
from typing import Optional

import anthropic

from veo_intelligence.life_event_detector import detect_life_events, format_events_for_prompt
from veo_intelligence.signal_processor    import enrich_donor, format_signals_for_prompt
from veo_intelligence.cost_governor       import CostGovernor, DEMO_CLIENTS

from vpgo_intelligence.bequest_propensity        import score_bequest_propensity, format_bequest_for_prompt, BequestTier
from vpgo_intelligence.gift_vehicle_advisor      import advise_gift_vehicles, format_vehicles_for_prompt
from vpgo_intelligence.legacy_conversation_engine import plan_conversation_strategy, format_strategy_for_prompt
from vpgo_intelligence.legacy_society_manager    import check_legacy_society_status, format_society_for_prompt

# ── Config ───────────────────────────────────────────────────────────────────
MODEL      = "claude-sonnet-4-20250514"
MAX_TOKENS = 3000
ORG_NAME   = "Greenfield University"
CLIENT_ID  = os.environ.get("ORBIT_CLIENT_ID", "greenfield")


# ─────────────────────────────────────────────────────────────────────────────
# DEMO DONORS — Planned Giving Candidates
# Covers all stages: awareness → exploration → consideration → intention → committed
# ─────────────────────────────────────────────────────────────────────────────

VPGO_DONORS = [

    # ── 1. Classic Bequest Prospect — Legacy Builder, 25yr streak, age ~69 ──
    {
        "id": "vpgo-001",
        "firstName": "Eleanor",
        "lastName": "Whitfield",
        "email": "ewhitfield@retired.net",
        "classYear": "1979",   # Estimated age ~69
        "archetype": "LEGACY_BUILDER",
        "journeyStage": "stewardship",
        "lastGiftAmount": 5000,
        "totalGiving": 98000,
        "givingStreak": 25,
        "giftCount": 25,
        "daysSinceLastGift": 280,
        "daysSinceLastContact": 180,
        "fundDesignation": "Whitfield Prize for Excellence in the Arts",
        "interests": ["arts", "legacy", "endowment", "faculty"],
        "title": "Retired Professor of Art History",
        "bequeathScore": 78,
        "sentiment": "positive",
        "wealthEstimate": 3200000,
        "conversationHistory": [
            {"role": "donor", "content": "I want Greenfield to still be a center for the arts in 50 years. That's why I keep giving."},
            {"role": "vpgo", "content": "Your commitment is what makes that future possible."},
        ],
    },

    # ── 2. QCD Candidate — Retired, age ~76, IRA signals ──────────────────
    {
        "id": "vpgo-002",
        "firstName": "Harold",
        "lastName": "Summers",
        "email": "hsummers@email.com",
        "classYear": "1972",   # ~76
        "archetype": "PRAGMATIC_PARTNER",
        "journeyStage": "stewardship",
        "lastGiftAmount": 10000,
        "totalGiving": 65000,
        "givingStreak": 18,
        "giftCount": 18,
        "daysSinceLastGift": 320,
        "daysSinceLastContact": 150,
        "fundDesignation": "Business School Excellence Fund",
        "interests": ["business", "entrepreneurship", "tax efficiency"],
        "title": "Retired CEO",
        "bequeathScore": 70,
        "sentiment": "positive",
        "wealthEstimate": 5800000,
        "conversationHistory": [
            {"role": "donor", "content": "My accountant keeps telling me to use my IRA for charitable gifts this year because of the RMD tax situation. I'm not sure exactly how that works with Greenfield."},
        ],
    },

    # ── 3. Faith-Driven, considering estate plan, age ~74 ─────────────────
    {
        "id": "vpgo-003",
        "firstName": "Margaret",
        "lastName": "Holloway",
        "email": "mholloway@retired.net",
        "classYear": "1974",   # ~74
        "archetype": "FAITH_DRIVEN",
        "journeyStage": "stewardship",
        "lastGiftAmount": 3000,
        "totalGiving": 48500,
        "givingStreak": 15,
        "giftCount": 16,
        "daysSinceLastGift": 280,
        "daysSinceLastContact": 45,
        "fundDesignation": "Chapel Endowment and Campus Ministry Fund",
        "interests": ["faith", "community", "scholarship", "legacy"],
        "title": "Retired Teacher",
        "bequeathScore": 82,
        "sentiment": "positive",
        "wealthEstimate": 2200000,
        "conversationHistory": [
            {"role": "donor", "content": "I've been thinking a lot about what I want to leave behind. I recently updated my estate plan with my attorney. I want Greenfield to still be a place of faith and service long after I'm gone."},
            {"role": "vpgo", "content": "We share that vision deeply, Margaret."},
        ],
    },

    # ── 4. CGA Prospect — age ~68, has appreciated stock ──────────────────
    {
        "id": "vpgo-004",
        "firstName": "Walter",
        "lastName": "Brennan",
        "email": "wbrennan@finance.net",
        "classYear": "1980",   # ~68
        "archetype": "IMPACT_INVESTOR",
        "journeyStage": "stewardship",
        "lastGiftAmount": 15000,
        "totalGiving": 82000,
        "givingStreak": 12,
        "giftCount": 12,
        "daysSinceLastGift": 200,
        "daysSinceLastContact": 90,
        "fundDesignation": "Economic Research and Innovation Fund",
        "interests": ["research", "economics", "data", "tax efficiency"],
        "title": "Retired Investment Manager",
        "bequeathScore": 65,
        "sentiment": "positive",
        "wealthEstimate": 9500000,
        "conversationHistory": [
            {"role": "donor", "content": "I've got a significant amount of stock that's appreciated considerably. My advisor keeps telling me to think about ways to diversify without a big capital gains hit. I wonder if there's a way to do that while also supporting Greenfield."},
        ],
    },

    # ── 5. Declared Bequest — already has will, needs stewardship ─────────
    {
        "id": "vpgo-005",
        "firstName": "Dorothy",
        "lastName": "Svensson",
        "email": "dsvensson@email.com",
        "classYear": "1968",   # ~80
        "archetype": "LOYAL_ALUMNI",
        "journeyStage": "legacy_cultivation",
        "lastGiftAmount": 2500,
        "totalGiving": 38500,
        "givingStreak": 30,
        "giftCount": 30,
        "daysSinceLastGift": 300,
        "daysSinceLastContact": 60,
        "fundDesignation": "Dorothy Svensson Scholarship for First-Generation Students",
        "interests": ["scholarship", "access", "legacy"],
        "title": "Retired Librarian",
        "bequeathScore": 92,
        "sentiment": "positive",
        "wealthEstimate": 1800000,
        "conversationHistory": [
            {"role": "donor", "content": "I wanted you to know that I have included Greenfield in my will. I've designated 20% of my residual estate to my scholarship fund. My attorney drafted the language last spring."},
            {"role": "vpgo", "content": "Dorothy, this is extraordinarily meaningful. We are honored beyond words."},
        ],
    },

    # ── 6. CRUT Candidate — age ~62, major business exit ──────────────────
    {
        "id": "vpgo-006",
        "firstName": "James",
        "lastName": "Rutherford",
        "email": "jrutherford@ventures.com",
        "classYear": "1986",   # ~62
        "archetype": "IMPACT_INVESTOR",
        "journeyStage": "stewardship",
        "lastGiftAmount": 25000,
        "totalGiving": 145000,
        "givingStreak": 8,
        "giftCount": 8,
        "daysSinceLastGift": 120,
        "daysSinceLastContact": 60,
        "fundDesignation": "Entrepreneurship and Innovation Fund",
        "interests": ["entrepreneurship", "research", "innovation"],
        "title": "Founder, Rutherford Capital Partners",
        "bequeathScore": 60,
        "sentiment": "positive",
        "wealthEstimate": 22000000,
        "conversationHistory": [
            {"role": "donor", "content": "We just sold a major portfolio company — probably our best exit in 15 years. I'm thinking about what to do with the capital gains situation. My estate plan is pretty substantial at this point."},
        ],
    },

    # ── 7. Young Awareness — just retired, age ~64 ────────────────────────
    {
        "id": "vpgo-007",
        "firstName": "Barbara",
        "lastName": "Chen",
        "email": "bchen@retired.org",
        "classYear": "1984",   # ~64
        "archetype": "COMMUNITY_CHAMPION",
        "journeyStage": "stewardship",
        "lastGiftAmount": 1000,
        "totalGiving": 12000,
        "givingStreak": 8,
        "giftCount": 8,
        "daysSinceLastGift": 250,
        "daysSinceLastContact": 120,
        "fundDesignation": "Community Engagement and Public Service Fund",
        "interests": ["community", "public service", "access"],
        "title": "Recently Retired Social Worker",
        "bequeathScore": 48,
        "sentiment": "positive",
        "wealthEstimate": 950000,
        "conversationHistory": [
            {"role": "donor", "content": "I just retired last fall after 35 years of social work. Greenfield really shaped who I became as a professional."},
        ],
    },

    # ── 8. DAF Holder — multi-charity giver, needs DAF angle ──────────────
    {
        "id": "vpgo-008",
        "firstName": "Richard",
        "lastName": "Okonkwo",
        "email": "rokonkwo@family.org",
        "classYear": "1977",   # ~71
        "archetype": "LEGACY_BUILDER",
        "journeyStage": "stewardship",
        "lastGiftAmount": 8000,
        "totalGiving": 73000,
        "givingStreak": 20,
        "giftCount": 22,
        "daysSinceLastGift": 180,
        "daysSinceLastContact": 90,
        "fundDesignation": "Okonkwo Family Engineering Excellence Award",
        "interests": ["engineering", "scholarship", "family legacy", "community"],
        "title": "Retired Civil Engineer",
        "bequeathScore": 75,
        "sentiment": "positive",
        "wealthEstimate": 4100000,
        "conversationHistory": [
            {"role": "donor", "content": "We have a family foundation through Fidelity Charitable. Most of our charitable giving goes through it. I do want Greenfield to be part of our estate plan but I haven't gotten around to talking to my attorney about it."},
        ],
    },

    # ── 9. Exploration — First-time estate conversation, age ~66 ─────────
    {
        "id": "vpgo-009",
        "firstName": "Susan",
        "lastName": "Nakamura",
        "email": "snakamura@email.com",
        "classYear": "1982",   # ~66
        "archetype": "MISSION_ZEALOT",
        "journeyStage": "stewardship",
        "lastGiftAmount": 2000,
        "totalGiving": 22000,
        "givingStreak": 10,
        "giftCount": 11,
        "daysSinceLastGift": 210,
        "daysSinceLastContact": 90,
        "fundDesignation": "Environmental Science and Sustainability Research Fund",
        "interests": ["environment", "sustainability", "research", "climate"],
        "title": "Environmental Scientist (semi-retired)",
        "bequeathScore": 58,
        "sentiment": "positive",
        "wealthEstimate": 1600000,
        "conversationHistory": [
            {"role": "donor", "content": "Someone at the alumni event mentioned planned giving. I'd never really thought about it before. What does that even mean exactly?"},
        ],
    },

    # ── 10. High-Net-Worth CLT Candidate — age ~58, estate planning focus ──
    {
        "id": "vpgo-010",
        "firstName": "Alexander",
        "lastName": "Montgomery",
        "email": "amontgomery@family.law",
        "classYear": "1990",   # ~58
        "archetype": "PRAGMATIC_PARTNER",
        "journeyStage": "stewardship",
        "lastGiftAmount": 50000,
        "totalGiving": 287000,
        "givingStreak": 10,
        "giftCount": 10,
        "daysSinceLastGift": 150,
        "daysSinceLastContact": 60,
        "fundDesignation": "Montgomery Family Endowed Chair in Law",
        "interests": ["faculty", "research", "estate planning", "family legacy"],
        "title": "Senior Partner, Montgomery Law Group",
        "bequeathScore": 72,
        "sentiment": "positive",
        "wealthEstimate": 28000000,
        "conversationHistory": [
            {"role": "donor", "content": "I'm working with my estate planning team on a significant restructuring. We're looking at ways to transfer wealth to my children in a tax-efficient way. I want Greenfield to be part of that conversation."},
        ],
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# SYSTEM PROMPT BUILDER
# ─────────────────────────────────────────────────────────────────────────────

def build_vpgo_system_prompt(
    donor: dict,
    bequest_profile,
    vehicle_rec,
    conv_strategy,
    legacy_society,
    life_events: list,
    signals,
) -> str:
    """Build the full VPGO system prompt from all intelligence layers."""

    bequest_ctx  = format_bequest_for_prompt(bequest_profile)
    vehicle_ctx  = format_vehicles_for_prompt(vehicle_rec)
    strategy_ctx = format_strategy_for_prompt(conv_strategy)
    society_ctx  = format_society_for_prompt(legacy_society)
    life_ctx     = format_events_for_prompt(life_events) if life_events else "No life events detected."
    signal_ctx   = format_signals_for_prompt(signals) if signals else "No external signals."

    archetype  = donor.get("archetype", "LOYAL_ALUMNI")
    streak     = donor.get("givingStreak", 0)
    total      = donor.get("totalGiving", 0)
    class_year = donor.get("classYear", "")
    age_est    = bequest_profile.estimated_age or "Unknown"

    return f"""You are the Virtual Planned Giving Officer (VPGO) for {ORG_NAME} — an AI-native planned giving cultivation system.

Your mission: Educate, cultivate, and warm planned giving prospects with the patience of a seasoned PGFO.
You plant seeds. You educate. You inspire. You never pressure. Human gift officers close the conversation.

IMPORTANT DISCLAIMER: All VPGO communications are informational and educational only.
They do not constitute legal, tax, or financial advice. Always recommend donors consult
their independent legal and financial advisors before making planned giving decisions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DONOR PROFILE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name: {donor['firstName']} {donor['lastName']}
Class Year: {class_year} | Estimated Age: {age_est}
Archetype: {archetype.replace('_', ' ').title()} | Giving Streak: {streak} years
Total Lifetime Giving: ${total:,.0f}
Fund: {donor.get('fundDesignation', 'Annual Fund')}
Journey Stage: {donor.get('journeyStage', 'stewardship').replace('_', ' ').title()}
Title/Role: {donor.get('title', 'N/A')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BEQUEST PROPENSITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{bequest_ctx}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GIFT VEHICLE RECOMMENDATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{vehicle_ctx}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LEGACY CONVERSATION STRATEGY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{strategy_ctx}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LEGACY SOCIETY STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{society_ctx}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LIFE EVENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{life_ctx}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXTERNAL SIGNALS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{signal_ctx}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. NEVER make a hard ask for a planned gift — educate, inspire, invite
2. NEVER quote specific gift amounts unless the donor has provided them
3. ALWAYS include the disclaimer: "This is not legal or tax advice. Please consult your independent advisors."
4. ALWAYS disclose: "This message was prepared by Greenfield's AI planned giving system."
5. Use [PLACEHOLDER] for any specific data points that need real figures
6. If PGFO_REQUIRED: prepare the message AND include staff coaching notes for the human
7. Tone: warm, expert, unhurried, deeply respectful of the donor's life stage
8. NEVER mention death explicitly — use "estate plan," "legacy," "long-term planning"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESPONSE FORMAT (JSON only, no markdown)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return a JSON object:
{{
  "conversation_stage": "<awareness|exploration|consideration|intention|committed>",
  "vehicle_recommended": "<primary vehicle name>",
  "pgfo_required": <true|false>,
  "pgfo_escalation_reason": "<reason if required, else null>",
  "vpgo_reasoning": "<2-3 sentence explanation of strategy>",
  "subject": "<email subject line>",
  "message": "<full planned giving cultivation message — personalized, educational, archetype-tuned>",
  "staff_note": "<internal coaching note for PGFO — what they need to know and do next>",
  "sample_bequest_language": "<if appropriate: one-sentence sample bequest language>",
  "follow_up_days": <number>,
  "predicted_response": "<brief prediction of donor reaction>"
}}"""


# ─────────────────────────────────────────────────────────────────────────────
# MAIN RUNNER
# ─────────────────────────────────────────────────────────────────────────────

def run_donor_vpgo(client: anthropic.Anthropic, donor: dict, index: int, governor: Optional[CostGovernor] = None) -> dict:
    """Run the full VPGO pipeline for one donor."""

    print(f"\n{'═'*70}")
    print(f"  VPGO RUN #{index+1}: {donor['firstName']} {donor['lastName']}")
    print(f"  Archetype: {donor['archetype']} | Bequest Score: {donor.get('bequeathScore', 0)}")
    print(f"  Total Giving: ${donor.get('totalGiving',0):,.0f} | Streak: {donor.get('givingStreak',0)}yr")
    print(f"{'═'*70}")

    # ── Step 1: Life Events ──────────────────────────────────────────────────
    print("  ⊕ Detecting life events...")
    life_events = detect_life_events(donor)
    if life_events:
        for e in life_events[:2]:
            print(f"    [{e.urgency.upper()}] {e.event_type.value}: {e.detail[:55]}...")

    # ── Step 2: External Signals ─────────────────────────────────────────────
    print("  ⊕ Fetching external signals...")
    signals = enrich_donor(donor)
    print(f"    Net worth est: ${signals.wealth.estimated_net_worth//100:,.0f} | iWave capacity: {signals.wealth.iwave_capacity_rating}/10")

    # ── Step 3: Bequest Propensity ───────────────────────────────────────────
    print("  ⊕ Scoring bequest propensity...")
    bequest_profile = score_bequest_propensity(donor, life_events, signals)
    print(f"    Score: {bequest_profile.score:.0f}/100 | Tier: {bequest_profile.tier.value.upper()}")
    print(f"    Est. age: {bequest_profile.estimated_age} | Vehicles: {', '.join(bequest_profile.vehicle_likely[:3])}")

    # Only run VPGO if propensity is high enough
    if bequest_profile.tier == BequestTier.NOT_READY:
        print(f"  ℹ VPGO skipped — propensity too low (score: {bequest_profile.score:.0f})")
        return {
            "donor_id": donor["id"], "skipped": True,
            "reason": f"Bequest propensity too low ({bequest_profile.score:.0f}/100 — needs ≥20)",
        }

    # ── Step 4: Gift Vehicle Advisor ─────────────────────────────────────────
    print("  ⊕ Advising gift vehicles...")
    vehicle_rec = advise_gift_vehicles(donor, bequest_profile, signals)
    print(f"    Primary: {vehicle_rec.primary.name}")
    if vehicle_rec.secondary:
        print(f"    Secondary: {vehicle_rec.secondary.name}")

    # ── Step 5: Legacy Conversation Strategy ────────────────────────────────
    print("  ⊕ Planning conversation strategy...")
    conv_strategy = plan_conversation_strategy(donor, bequest_profile, vehicle_rec)
    print(f"    Stage: {conv_strategy.stage.value.title()} | PGFO needed: {conv_strategy.requires_human}")

    # ── Step 6: Legacy Society Status ───────────────────────────────────────
    print("  ⊕ Checking legacy society status...")
    legacy_society = check_legacy_society_status(donor, bequest_profile)
    print(f"    Status: {legacy_society.tier.value.replace('_', ' ').title()}")

    # ── Step 7: Budget Check ─────────────────────────────────────────────────
    if governor:
        budget_ok, budget_msg = governor.check_budget(MAX_TOKENS)
        if not budget_ok:
            print(f"  🚫 BUDGET BLOCKED: {budget_msg}")
            return {"donor_id": donor["id"], "blocked": True, "reason": budget_msg}

    # ── Step 8: Build System Prompt ──────────────────────────────────────────
    print("  ⊕ Calling Claude VPGO agent...")
    system_prompt = build_vpgo_system_prompt(
        donor, bequest_profile, vehicle_rec, conv_strategy,
        legacy_society, life_events, signals,
    )

    # ── Step 9: Claude API Call ───────────────────────────────────────────────
    user_message = (
        f"Generate the optimal planned giving cultivation message for {donor['firstName']} {donor['lastName']}. "
        f"Conversation stage: {conv_strategy.stage.value}. "
        f"Primary vehicle: {vehicle_rec.primary.name}. "
        f"Use all intelligence provided. Return ONLY valid JSON with no markdown formatting."
    )

    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )

    raw   = response.content[0].text.strip()
    usage = response.usage

    if governor:
        governor.record_usage(
            donor_id=donor["id"],
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            action_type="vpgo_planned_giving_run",
            stage=donor.get("journeyStage", "legacy_cultivation"),
        )

    print(f"  ✓ Claude responded ({usage.input_tokens:,} in / {usage.output_tokens:,} out tokens)")

    # ── Step 10: Parse JSON ──────────────────────────────────────────────────
    clean = re.sub(r"```(?:json)?\s*", "", raw)
    clean = re.sub(r"```\s*$", "", clean)
    clean = re.sub(r"\bundefined\b", "null", clean)
    clean = re.sub(r",\s*([}\]])", r"\1", clean)

    try:
        decision = json.loads(clean)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', clean, re.DOTALL)
        if match:
            try:
                decision = json.loads(match.group())
            except json.JSONDecodeError:
                decision = {"raw_response": raw, "parse_error": True}
        else:
            decision = {"raw_response": raw, "parse_error": True}

    return {
        "donor_id":         donor["id"],
        "donor_name":       f"{donor['firstName']} {donor['lastName']}",
        "archetype":        donor["archetype"],
        "bequest_tier":     bequest_profile.tier.value,
        "conv_stage":       conv_strategy.stage.value,
        "vehicle":          vehicle_rec.primary.vehicle.value,
        "pgfo_required":    conv_strategy.requires_human,
        "tokens_in":        usage.input_tokens,
        "tokens_out":       usage.output_tokens,
        "decision":         decision,
    }


def print_result(result: dict):
    """Pretty-print a VPGO decision result."""
    if result.get("blocked"):
        print(f"\n  🚫 BLOCKED: {result['reason']}")
        return
    if result.get("skipped"):
        print(f"\n  ℹ SKIPPED: {result['reason']}")
        return

    decision = result.get("decision", {})
    if decision.get("parse_error"):
        print(f"\n  ⚠ Parse error — response preview:")
        print(f"  {decision.get('raw_response', '')[:300]}")
        return

    print(f"\n  {'─'*66}")
    print(f"  STAGE: {decision.get('conversation_stage', result['conv_stage']).upper()}")
    print(f"  VEHICLE: {decision.get('vehicle_recommended', result['vehicle'])}")
    if decision.get("pgfo_required"):
        print(f"  ⚠  PGFO REQUIRED: {decision.get('pgfo_escalation_reason', '')}")
    print(f"\n  VPGO REASONING:")
    print(f"  {decision.get('vpgo_reasoning', '')}")

    subject = decision.get("subject")
    if subject:
        print(f"\n  SUBJECT: {subject}")

    message = decision.get("message", "")
    if message:
        print(f"\n  MESSAGE:")
        words = message.split()
        line, lines = "", []
        for w in words:
            if len(line) + len(w) + 1 > 65:
                lines.append(line)
                line = w
            else:
                line = (line + " " + w).strip()
        if line:
            lines.append(line)
        for l in lines[:20]:
            print(f"  {l}")
        if len(lines) > 20:
            print(f"  ... ({len(lines)-20} more lines)")

    bequest_lang = decision.get("sample_bequest_language")
    if bequest_lang:
        print(f"\n  SAMPLE BEQUEST LANGUAGE:")
        print(f"  \"{bequest_lang}\"")

    staff_note = decision.get("staff_note", "")
    if staff_note:
        print(f"\n  STAFF NOTE (PGFO):")
        print(f"  {staff_note[:220]}{'...' if len(staff_note) > 220 else ''}")

    follow_up = decision.get("follow_up_days", 0)
    predicted = decision.get("predicted_response", "")
    if predicted:
        print(f"\n  PREDICTED RESPONSE: {predicted}")
    if follow_up:
        print(f"  FOLLOW-UP IN: {follow_up} days")


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Orbit VPGO Demo — Virtual Planned Giving Officer")
    group = parser.add_mutually_exclusive_group()
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
    print(f"  ORBIT VIRTUAL PLANNED GIVING OFFICER (VPGO) — Demo Session")
    print(f"  Institution: {ORG_NAME}")
    print(f"  Client: {CLIENT_ID} | Model: {MODEL}")
    print(f"  DISCLAIMER: Educational only. Not legal or tax advice.")
    print(f"{'='*70}")
    governor.print_live_status()

    # Select donors
    if args.all:
        donors = VPGO_DONORS
    elif args.donor:
        idx = args.donor - 1
        if idx < 0 or idx >= len(VPGO_DONORS):
            print(f"ERROR: Donor index must be 1–{len(VPGO_DONORS)}")
            sys.exit(1)
        donors = [VPGO_DONORS[idx]]
    else:
        # Default: 3 showcase donors covering different stages
        donors = [VPGO_DONORS[0], VPGO_DONORS[1], VPGO_DONORS[2]]  # Eleanor, Harold, Margaret

    results = []
    for i, donor in enumerate(donors):
        try:
            result = run_donor_vpgo(client, donor, i, governor)
            results.append(result)
            print_result(result)
        except anthropic.APIError as e:
            print(f"\n  ✗ API Error: {e}")
        except Exception as e:
            print(f"\n  ✗ Error: {e}")
            import traceback
            traceback.print_exc()

    # ── Session Summary ───────────────────────────────────────────────────────
    print(f"\n\n{'='*70}")
    print(f"  VPGO SESSION COMPLETE — {len(results)} donors processed")
    print(f"{'='*70}")
    if results:
        successful = [r for r in results if not r.get("blocked") and not r.get("skipped") and not r.get("decision", {}).get("parse_error")]
        pgfo_req   = [r for r in successful if r.get("pgfo_required")]
        total_in   = sum(r.get("tokens_in", 0) for r in results)
        total_out  = sum(r.get("tokens_out", 0) for r in results)
        print(f"  Successful: {len(successful)} | PGFO escalations: {len(pgfo_req)}")
        print(f"  Total tokens: {total_in:,} in / {total_out:,} out")

    report = governor.generate_report()
    print(f"\n  {'─'*66}")
    print(f"  BILLING SUMMARY ({CLIENT_ID})")
    print(f"  {'─'*66}")
    for line in report.to_invoice_lines():
        print(f"  {line}")

    print(f"\n  Session complete — {len(results)} VPGO cultivations generated")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    main()
