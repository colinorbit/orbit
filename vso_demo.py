#!/usr/bin/env python3
"""
VSO Demo — Virtual Stewardship Officer Showcase
=================================================
Demonstrates the full Orbit VSO intelligence pipeline:

  1. Life Event Detection       (veo_intelligence)
  2. Lapse Prediction           (vso_intelligence)
  3. Impact Profile Building    (vso_intelligence)
  4. Recognition Engine         (vso_intelligence)
  5. Stewardship Calendar       (vso_intelligence)
  6. Stewardship Action Engine  (vso_intelligence)
  7. Claude AI Generation       (anthropic)
  8. Cost Governance            (veo_intelligence)

Usage:
  python3 vso_demo.py             # Run 3 showcase donors
  python3 vso_demo.py --all       # Run all 12 demo donors
  python3 vso_demo.py --donor 5   # Run single donor by index

Requires: ANTHROPIC_API_KEY environment variable
"""

import os
import sys
import re
import json
import argparse
from typing import Optional

import anthropic

# ── Intelligence modules ─────────────────────────────────────────────────────
from veo_intelligence.life_event_detector import detect_life_events, format_events_for_prompt
from veo_intelligence.signal_processor    import enrich_donor, format_signals_for_prompt
from veo_intelligence.cost_governor       import CostGovernor, DEMO_CLIENTS

from vso_intelligence.lapse_predictor     import predict_lapse, format_lapse_for_prompt
from vso_intelligence.impact_reporter     import build_impact_profile, format_impact_for_prompt
from vso_intelligence.recognition_engine  import detect_recognition_events, format_recognition_for_prompt, get_society_progress
from vso_intelligence.stewardship_engine  import decide_stewardship_action, format_decision_for_prompt, classify_tier, GiftTier
from vso_intelligence.stewardship_calendar import build_annual_calendar, format_calendar_for_prompt

# ── Config ───────────────────────────────────────────────────────────────────
MODEL         = "claude-sonnet-4-20250514"
MAX_TOKENS    = 3500
ORG_NAME      = "Greenfield University"
CLIENT_ID     = os.environ.get("ORBIT_CLIENT_ID", "greenfield")


# ─────────────────────────────────────────────────────────────────────────────
# DEMO DONORS — Stewardship Stage
# Covers all gift tiers, archetypes, lapse scenarios, recognition moments
# ─────────────────────────────────────────────────────────────────────────────

DEMO_DONORS = [

    # ── 1. Loyal Annual Donor — 22-year streak, renewal due ─────────────────
    {
        "id": "vso-001",
        "firstName": "Robert",
        "lastName": "Chen",
        "email": "rchen@email.com",
        "classYear": "1987",
        "archetype": "LOYAL_ALUMNI",
        "journeyStage": "stewardship",
        "lastGiftAmount": 500,
        "lastGiftCents": 50000,
        "totalGiving": 11200,
        "givingStreak": 22,
        "giftCount": 22,
        "daysSinceLastGift": 340,
        "daysSinceLastContact": 95,
        "fundDesignation": "Annual Fund — General Support",
        "interests": ["alumni events", "scholarship"],
        "title": "Retired Engineer",
        "bequeathScore": 55,
        "sentiment": "positive",
        "upgradeReady": False,
        "conversationHistory": [
            {"role": "donor", "content": "I always enjoy hearing how my donations help students."},
            {"role": "vso", "content": "Your 22 years of support have been transformational."},
        ],
    },

    # ── 2. Mid-Level — Impact Investor, has named scholarship, streak 10yr ──
    {
        "id": "vso-002",
        "firstName": "Patricia",
        "lastName": "Okafor",
        "email": "pokafor@techfirm.com",
        "classYear": "1996",
        "archetype": "IMPACT_INVESTOR",
        "journeyStage": "stewardship",
        "lastGiftAmount": 5000,
        "lastGiftCents": 500000,
        "totalGiving": 52000,
        "givingStreak": 10,
        "giftCount": 10,
        "daysSinceLastGift": 45,
        "daysSinceLastContact": 45,
        "fundDesignation": "Patricia Okafor Named Scholarship for First-Generation Students",
        "interests": ["scholarship", "research", "workforce development"],
        "title": "VP of Technology, HealthTech Corp",
        "bequeathScore": 40,
        "sentiment": "positive",
        "upgradeReady": True,
        "wealthEstimate": 4500000,
        "conversationHistory": [
            {"role": "donor", "content": "I want to see data on how many students the scholarship has supported and what they went on to do."},
            {"role": "vso", "content": "I'll prepare a full scholarship impact report for you."},
        ],
    },

    # ── 3. Leadership Donor — Legacy Builder, reunion year (30th), upgrade ready ──
    {
        "id": "vso-003",
        "firstName": "Thomas",
        "lastName": "Whitmore",
        "email": "twhitmore@law.com",
        "classYear": "1996",   # 30-year reunion in 2026
        "archetype": "LEGACY_BUILDER",
        "journeyStage": "stewardship",
        "lastGiftAmount": 15000,
        "lastGiftCents": 1500000,
        "totalGiving": 95000,
        "givingStreak": 8,
        "giftCount": 9,
        "daysSinceLastGift": 180,
        "daysSinceLastContact": 60,
        "fundDesignation": "Whitmore Family Law Fellows Fund",
        "interests": ["faculty", "research", "alumni leadership"],
        "title": "Senior Partner, Whitmore & Associates",
        "bequeathScore": 72,
        "sentiment": "positive",
        "upgradeReady": True,
        "wealthEstimate": 12000000,
        "conversationHistory": [
            {"role": "donor", "content": "I care deeply about Greenfield's place in legal education. I want to see us ranked in the top 25."},
            {"role": "vso", "content": "The Law Fellows Fund is directly supporting that ambition."},
        ],
    },

    # ── 4. Lapsed Major Donor — needs winback, high value ───────────────────
    {
        "id": "vso-004",
        "firstName": "Sandra",
        "lastName": "Reinholt",
        "email": "srein@globalcorp.com",
        "classYear": "1989",
        "archetype": "PRAGMATIC_PARTNER",
        "journeyStage": "lapsed_outreach",
        "lastGiftAmount": 25000,
        "lastGiftCents": 2500000,
        "totalGiving": 87000,
        "givingStreak": 0,
        "giftCount": 5,
        "daysSinceLastGift": 540,
        "daysSinceLastContact": 540,
        "fundDesignation": "Business School Innovation Fund",
        "interests": ["entrepreneurship", "career services", "corporate partnerships"],
        "title": "CEO, Global Innovations Corp",
        "bequeathScore": 35,
        "sentiment": "neutral",
        "upgradeReady": False,
        "wealthEstimate": 8000000,
        "conversationHistory": [],
    },

    # ── 5. First-Time Donor — Young Alum, needs retention ───────────────────
    {
        "id": "vso-005",
        "firstName": "Zoe",
        "lastName": "Martinez",
        "email": "zmartinez@startup.io",
        "classYear": "2021",
        "archetype": "MISSION_ZEALOT",
        "journeyStage": "stewardship",
        "lastGiftAmount": 50,
        "lastGiftCents": 5000,
        "totalGiving": 50,
        "givingStreak": 1,
        "giftCount": 1,
        "daysSinceLastGift": 2,
        "daysSinceLastContact": 2,
        "fundDesignation": "Student Emergency Fund",
        "interests": ["student wellness", "mental health", "social justice"],
        "title": "Product Designer, TechStartup",
        "bequeathScore": 5,
        "sentiment": "positive",
        "upgradeReady": False,
        "conversationHistory": [
            {"role": "donor", "content": "I just gave to the student emergency fund. I remember how hard things got financially when I was there."},
        ],
    },

    # ── 6. Planned Giving Prospect — high bequest score, retirement ──────────
    {
        "id": "vso-006",
        "firstName": "Margaret",
        "lastName": "Holloway",
        "email": "mholloway@retired.net",
        "classYear": "1971",
        "archetype": "FAITH_DRIVEN",
        "journeyStage": "stewardship",
        "lastGiftAmount": 3000,
        "lastGiftCents": 300000,
        "totalGiving": 48500,
        "givingStreak": 15,
        "giftCount": 16,
        "daysSinceLastGift": 280,
        "daysSinceLastContact": 120,
        "fundDesignation": "Chapel Endowment and Campus Ministry Fund",
        "interests": ["faith", "community", "scholarship", "legacy"],
        "title": "Retired Teacher",
        "bequeathScore": 82,
        "sentiment": "positive",
        "upgradeReady": False,
        "wealthEstimate": 2200000,
        "conversationHistory": [
            {"role": "donor", "content": "I've been thinking about what I can leave behind. I want Greenfield to still be a place of faith and service."},
            {"role": "vso", "content": "We deeply share that vision, Margaret."},
        ],
    },

    # ── 7. Bereavement — needs hold + compassionate outreach ────────────────
    {
        "id": "vso-007",
        "firstName": "James",
        "lastName": "Kowalski",
        "email": "jkowalski@law.edu",
        "classYear": "1982",
        "archetype": "COMMUNITY_CHAMPION",
        "journeyStage": "stewardship",
        "lastGiftAmount": 10000,
        "lastGiftCents": 1000000,
        "totalGiving": 65000,
        "givingStreak": 5,
        "giftCount": 7,
        "daysSinceLastGift": 60,
        "daysSinceLastContact": 3,
        "fundDesignation": "Community Engagement and Public Service Fund",
        "interests": ["public service", "community", "scholarship"],
        "title": "Professor of Law",
        "bequeathScore": 60,
        "sentiment": "neutral",
        "upgradeReady": False,
        "conversationHistory": [
            {"role": "donor", "content": "Thank you for reaching out. My wife passed away last month. She loved Greenfield as much as I do."},
            {"role": "vso", "content": "James, we are so deeply sorry for your loss."},
        ],
    },

    # ── 8. Society Upgrade Crossing — $50K cumulative this gift ─────────────
    {
        "id": "vso-008",
        "firstName": "David",
        "lastName": "Okonkwo",
        "email": "dokonkwo@finance.com",
        "classYear": "2001",
        "archetype": "IMPACT_INVESTOR",
        "journeyStage": "stewardship",
        "lastGiftAmount": 7500,
        "lastGiftCents": 750000,
        "totalGiving": 51500,
        "givingStreak": 6,
        "giftCount": 7,
        "daysSinceLastGift": 5,
        "daysSinceLastContact": 5,
        "fundDesignation": "Economic Mobility Research Initiative",
        "interests": ["research", "economics", "financial literacy"],
        "title": "Managing Director, Capital Investments",
        "bequeathScore": 30,
        "sentiment": "positive",
        "upgradeReady": True,
        "wealthEstimate": 5500000,
        "conversationHistory": [
            {"role": "donor", "content": "I want my giving to drive real research outcomes, not just nice reports."},
        ],
    },

    # ── 9. Reunion Year — Class of 2001 (25th) — giving day prep ────────────
    {
        "id": "vso-009",
        "firstName": "Aisha",
        "lastName": "Patel",
        "email": "apatel@healthsystem.org",
        "classYear": "2001",
        "archetype": "COMMUNITY_CHAMPION",
        "journeyStage": "stewardship",
        "lastGiftAmount": 1200,
        "lastGiftCents": 120000,
        "totalGiving": 8400,
        "givingStreak": 7,
        "giftCount": 7,
        "daysSinceLastGift": 200,
        "daysSinceLastContact": 80,
        "fundDesignation": "Healthcare Access and Community Clinics Fund",
        "interests": ["healthcare", "community health", "scholarship"],
        "title": "Director of Community Health, Metro Health System",
        "bequeathScore": 20,
        "sentiment": "positive",
        "upgradeReady": True,
        "conversationHistory": [
            {"role": "donor", "content": "Can't believe our 25th is coming up. I'd love to do something meaningful for this reunion."},
        ],
    },

    # ── 10. Watch-List Donor — cooling engagement, upgrade needed ────────────
    {
        "id": "vso-010",
        "firstName": "Michael",
        "lastName": "Nguyen",
        "email": "mnguyen@tech.com",
        "classYear": "2009",
        "archetype": "SOCIAL_CONNECTOR",
        "journeyStage": "stewardship",
        "lastGiftAmount": 2500,
        "lastGiftCents": 250000,
        "totalGiving": 14500,
        "givingStreak": 3,
        "giftCount": 5,
        "daysSinceLastGift": 290,
        "daysSinceLastContact": 290,
        "fundDesignation": "Student Innovation Lab and Entrepreneurship Fund",
        "interests": ["entrepreneurship", "technology", "alumni networking"],
        "title": "Founder & CTO, DataFlow Inc.",
        "bequeathScore": 15,
        "sentiment": "neutral",
        "upgradeReady": False,
        "daysSinceLastEmailOpen": 200,
        "daysSinceLastClick": 250,
        "conversationHistory": [],
    },

    # ── 11. High Capacity Prospect — Wealth event, promotion signal ──────────
    {
        "id": "vso-011",
        "firstName": "Rachel",
        "lastName": "Kim",
        "email": "rkim@biotech.vc",
        "classYear": "2005",
        "archetype": "IMPACT_INVESTOR",
        "journeyStage": "stewardship",
        "lastGiftAmount": 10000,
        "lastGiftCents": 1000000,
        "totalGiving": 32000,
        "givingStreak": 4,
        "giftCount": 5,
        "daysSinceLastGift": 100,
        "daysSinceLastContact": 100,
        "fundDesignation": "Biomedical Research Fund",
        "interests": ["research", "biotechnology", "innovation"],
        "title": "General Partner, Frontier Biotech Ventures",
        "bequeathScore": 25,
        "sentiment": "positive",
        "upgradeReady": True,
        "wealthEstimate": 18000000,
        "conversationHistory": [
            {"role": "donor", "content": "Our fund just completed a Series C with a major biotech company. It's been a wild year."},
        ],
    },

    # ── 12. Loyal Annual Donor — 5-year streak milestone, giving day ─────────
    {
        "id": "vso-012",
        "firstName": "Marcus",
        "lastName": "Thompson",
        "email": "mthompson@edu.org",
        "classYear": "2016",
        "archetype": "MISSION_ZEALOT",
        "journeyStage": "stewardship",
        "lastGiftAmount": 250,
        "lastGiftCents": 25000,
        "totalGiving": 1250,
        "givingStreak": 5,
        "giftCount": 5,
        "daysSinceLastGift": 310,
        "daysSinceLastContact": 100,
        "fundDesignation": "Educational Equity and Access Initiative",
        "interests": ["education equity", "scholarship", "social impact"],
        "title": "High School Teacher & Mentor",
        "bequeathScore": 10,
        "sentiment": "positive",
        "upgradeReady": True,
        "conversationHistory": [
            {"role": "donor", "content": "Teaching really puts things in perspective. I give what I can. Every dollar matters."},
        ],
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# SYSTEM PROMPT BUILDER
# ─────────────────────────────────────────────────────────────────────────────

def build_vso_system_prompt(
    donor: dict,
    stew_decision,
    lapse_risk,
    impact_profile,
    recognition_events,
    calendar: list,
    life_events: list,
    signals,
) -> str:
    """Build the full VSO system prompt from all intelligence layers."""

    stew_context = format_decision_for_prompt(stew_decision)
    lapse_context = format_lapse_for_prompt(lapse_risk) if lapse_risk else "No lapse risk data."
    impact_context = format_impact_for_prompt(impact_profile) if impact_profile else "No impact profile."
    recog_context = format_recognition_for_prompt(recognition_events, donor)
    calendar_context = format_calendar_for_prompt(calendar, donor)
    life_context = format_events_for_prompt(life_events) if life_events else "No life events detected."
    signal_context = format_signals_for_prompt(signals) if signals else "No external signals."

    archetype = donor.get("archetype", "LOYAL_ALUMNI")
    tier_name = stew_decision.tier.value.replace("_", " ").title()
    streak = donor.get("givingStreak", 0)
    total = donor.get("totalGiving", 0)
    class_year = donor.get("classYear", "")

    return f"""You are the Virtual Stewardship Officer (VSO) for {ORG_NAME} — an elite, AI-native stewardship system that provides world-class donor relationship management at scale.

Your mission: Make every donor feel genuinely seen, deeply appreciated, and powerfully connected to the impact of their giving. Transform transactions into transformational relationships.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DONOR PROFILE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name: {donor['firstName']} {donor['lastName']}
Class Year: {class_year} | Archetype: {archetype.replace('_', ' ').title()}
Gift Tier: {tier_name} | Giving Streak: {streak} years
Total Lifetime Giving: ${total:,.0f}
Fund: {donor.get('fundDesignation', 'Annual Fund')}
Journey Stage: {donor.get('journeyStage', 'stewardship').replace('_', ' ').title()}
Title/Role: {donor.get('title', 'N/A')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEWARDSHIP INTELLIGENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{stew_context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LAPSE RISK ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{lapse_context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPACT INTELLIGENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{impact_context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RECOGNITION & GIVING SOCIETY STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{recog_context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEWARDSHIP CALENDAR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{calendar_context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LIFE EVENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{life_context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXTERNAL SIGNALS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{signal_context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Always disclose: "This message was prepared by Greenfield's AI stewardship system."
2. Never fabricate facts, statistics, or student stories — use [PLACEHOLDER] for real data
3. Never make a financial ask if ESCALATE_TO_HUMAN is flagged — refer to the gift officer
4. Acknowledge bereavement/distress with zero solicitation
5. Write as if you know this donor personally — their history, their motivations, their impact
6. Make specificity your superpower — "your gift" not "donations like yours"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESPONSE FORMAT (return as JSON only, no markdown)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return a JSON object with exactly these fields:
{{
  "action": "<action type from stewardship decision>",
  "channel": "<email|sms|phone|handwritten>",
  "escalate_to_human": <true|false>,
  "escalation_reason": "<reason if escalating, else null>",
  "vso_reasoning": "<2-3 sentences explaining why this action was chosen>",
  "subject": "<email subject line or null>",
  "message": "<full message body — personalized, archetype-tuned, impact-specific>",
  "staff_note": "<internal briefing note for gift officer — intelligence summary>",
  "follow_up_timing_days": <number>,
  "upgrade_ask_amount": <dollar amount or 0>,
  "predicted_response": "<brief prediction of likely donor reaction>"
}}"""


# ─────────────────────────────────────────────────────────────────────────────
# MAIN RUNNER
# ─────────────────────────────────────────────────────────────────────────────

def run_donor_vso(client: anthropic.Anthropic, donor: dict, index: int, governor: Optional[CostGovernor] = None) -> dict:
    """Run the full VSO pipeline for one donor."""

    print(f"\n{'═'*70}")
    print(f"  VSO RUN #{index+1}: {donor['firstName']} {donor['lastName']}")
    print(f"  Archetype: {donor['archetype']} | Stage: {donor['journeyStage']}")
    print(f"  Total Giving: ${donor.get('totalGiving',0):,.0f} | Streak: {donor.get('givingStreak',0)}yr")
    print(f"{'═'*70}")

    # ── Step 1: Life Event Detection ─────────────────────────────────────────
    print("  ⊕ Detecting life events...")
    life_events = detect_life_events(donor)
    if life_events:
        for e in life_events[:2]:
            print(f"    [{e.urgency.upper()}] {e.event_type.value}: {e.detail[:60]}...")

    # ── Step 2: Lapse Prediction ──────────────────────────────────────────────
    print("  ⊕ Predicting lapse risk...")
    lapse_risk = predict_lapse(donor, life_events)
    print(f"    Lapse tier: {lapse_risk.tier.value} (score: {lapse_risk.score:.0%})")

    # ── Step 3: External Signals ───────────────────────────────────────────────
    print("  ⊕ Fetching external signals...")
    signals = enrich_donor(donor)
    print(f"    iWave: {signals.wealth.iwave_capacity_rating}/10 capacity | DonorSearch: {signals.wealth.donor_search_philanthropy_score}/5")

    # ── Step 4: Impact Profile ────────────────────────────────────────────────
    print("  ⊕ Building impact profile...")
    impact_profile = build_impact_profile(donor)
    print(f"    Fund theme: {impact_profile.primary_theme.theme_name} | Depth: {impact_profile.tier_depth}")

    # ── Step 5: Recognition Events ────────────────────────────────────────────
    print("  ⊕ Detecting recognition milestones...")
    recognition_events = detect_recognition_events(donor)
    if recognition_events:
        for r in recognition_events[:2]:
            print(f"    [{r.urgency.upper()}] {r.event_type}: {r.description}")
    else:
        print("    No new milestones detected.")

    # ── Step 6: Stewardship Decision ──────────────────────────────────────────
    print("  ⊕ Computing stewardship action...")
    stew_decision = decide_stewardship_action(
        donor=donor,
        lapse_risk=lapse_risk,
        recognition_events=recognition_events,
        life_events=life_events,
        days_since_last_gift=donor.get("daysSinceLastGift", 365),
        days_since_last_contact=donor.get("daysSinceLastContact", 90),
    )
    print(f"    Action: {stew_decision.action.value} [{stew_decision.urgency.upper()}]")
    print(f"    Channel: {stew_decision.channel}")
    if stew_decision.escalate_to_human:
        print(f"    ⚠  ESCALATE TO HUMAN: {stew_decision.rationale[:70]}")

    # ── Step 7: Stewardship Calendar ──────────────────────────────────────────
    print("  ⊕ Building stewardship calendar...")
    tier_str = stew_decision.tier.value
    calendar = build_annual_calendar(donor, tier_str, recognition_events, lapse_risk)
    print(f"    {len(calendar)} touchpoints planned for the year")

    # ── Step 8: Budget Check ──────────────────────────────────────────────────
    if governor:
        budget_ok, budget_msg = governor.check_budget(MAX_TOKENS)
        if not budget_ok:
            print(f"  🚫 BUDGET BLOCKED: {budget_msg}")
            return {"donor_id": donor["id"], "blocked": True, "reason": budget_msg}

    # ── Step 9: Build System Prompt ───────────────────────────────────────────
    print("  ⊕ Calling Claude VSO agent...")
    system_prompt = build_vso_system_prompt(
        donor, stew_decision, lapse_risk, impact_profile,
        recognition_events, calendar, life_events, signals,
    )

    # ── Step 10: Claude API Call ──────────────────────────────────────────────
    user_message = (
        f"Generate the optimal stewardship action for {donor['firstName']} {donor['lastName']}. "
        f"This is a {stew_decision.action.value.replace('_', ' ')} touchpoint. "
        f"Use all intelligence provided to create a hyper-personalized, archetype-aligned message. "
        f"Return ONLY valid JSON with no markdown formatting."
    )

    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )

    raw = response.content[0].text.strip()
    usage = response.usage

    # ── Step 11: Record Usage ─────────────────────────────────────────────────
    if governor:
        governor.record_usage(
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            action_type="vso_stewardship_run",
            stage=donor.get("journeyStage", "stewardship"),
            donor_id=donor["id"],
        )

    print(f"  ✓ Claude responded ({usage.input_tokens:,} in / {usage.output_tokens:,} out tokens)")

    # ── Step 12: Parse JSON ───────────────────────────────────────────────────
    # Extract JSON block
    clean = re.sub(r"```(?:json)?\s*", "", raw)
    clean = re.sub(r"```\s*$", "", clean)
    clean = re.sub(r"\bundefined\b", "null", clean)
    # Remove trailing commas before } or ]
    clean = re.sub(r",\s*([}\]])", r"\1", clean)

    try:
        decision = json.loads(clean)
    except json.JSONDecodeError:
        # Try to extract JSON from response
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
        "action":           stew_decision.action.value,
        "tier":             stew_decision.tier.value,
        "lapse_tier":       lapse_risk.tier.value,
        "recognition_count": len(recognition_events),
        "escalated":        stew_decision.escalate_to_human,
        "tokens_in":        usage.input_tokens,
        "tokens_out":       usage.output_tokens,
        "decision":         decision,
    }


def print_result(result: dict):
    """Pretty-print a VSO decision result."""
    if result.get("blocked"):
        print(f"\n  🚫 BLOCKED: {result['reason']}")
        return

    decision = result.get("decision", {})
    if decision.get("parse_error"):
        print(f"\n  ⚠ Parse error — raw response preview:")
        print(f"  {decision.get('raw_response', '')[:300]}")
        return

    print(f"\n  {'─'*66}")
    print(f"  ACTION: {decision.get('action', result['action']).upper()}")
    print(f"  CHANNEL: {decision.get('channel', 'email')}")
    if decision.get("escalate_to_human"):
        print(f"  ⚠  ESCALATING TO HUMAN: {decision.get('escalation_reason', '')}")
    print(f"\n  VSO REASONING:")
    print(f"  {decision.get('vso_reasoning', '')}")

    subject = decision.get("subject")
    if subject:
        print(f"\n  SUBJECT: {subject}")

    message = decision.get("message", "")
    if message:
        print(f"\n  MESSAGE:")
        # Wrap at 65 chars
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
            print(f"  ... ({len(lines) - 20} more lines)")

    staff_note = decision.get("staff_note", "")
    if staff_note:
        print(f"\n  STAFF NOTE:")
        print(f"  {staff_note[:200]}{'...' if len(staff_note) > 200 else ''}")

    upgrade = decision.get("upgrade_ask_amount", 0)
    if upgrade and upgrade > 0:
        print(f"\n  UPGRADE ASK: ${upgrade:,}")

    follow_up = decision.get("follow_up_timing_days", 0)
    predicted = decision.get("predicted_response", "")
    if predicted:
        print(f"\n  PREDICTED RESPONSE: {predicted}")
    if follow_up:
        print(f"  FOLLOW-UP IN: {follow_up} days")


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Orbit VSO Demo — Virtual Stewardship Officer")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--all",    action="store_true", help="Run all demo donors")
    group.add_argument("--donor",  type=int, metavar="N", help="Run single donor by 1-based index")
    args = parser.parse_args()

    api_key = (
        os.environ.get("ANTHROPIC_API_KEY")
        or os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")
    )
    if not api_key:
        print("ERROR: Set ANTHROPIC_API_KEY environment variable")
        sys.exit(1)

    client   = anthropic.Anthropic(api_key=api_key)
    client_config = DEMO_CLIENTS.get(CLIENT_ID, DEMO_CLIENTS["greenfield"])
    governor = CostGovernor(client_config)

    print(f"\n{'='*70}")
    print(f"  ORBIT VIRTUAL STEWARDSHIP OFFICER (VSO) — Demo Session")
    print(f"  Institution: {ORG_NAME}")
    print(f"  Client: {CLIENT_ID} | Model: {MODEL}")
    print(f"{'='*70}")
    governor.print_live_status()

    # Select donors to process
    if args.all:
        donors = DEMO_DONORS
    elif args.donor:
        idx = args.donor - 1
        if idx < 0 or idx >= len(DEMO_DONORS):
            print(f"ERROR: Donor index must be 1–{len(DEMO_DONORS)}")
            sys.exit(1)
        donors = [DEMO_DONORS[idx]]
    else:
        # Default: 3 showcase donors (breadth of capabilities)
        donors = [DEMO_DONORS[0], DEMO_DONORS[2], DEMO_DONORS[5]]  # Robert, Thomas, Margaret

    results = []
    for i, donor in enumerate(donors):
        try:
            result = run_donor_vso(client, donor, i, governor)
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
    print(f"  VSO SESSION COMPLETE — {len(results)} donors processed")
    print(f"{'='*70}")
    if results:
        successful = [r for r in results if not r.get("blocked") and not r.get("decision", {}).get("parse_error")]
        escalated  = [r for r in successful if r.get("escalated")]
        total_in   = sum(r.get("tokens_in", 0) for r in results)
        total_out  = sum(r.get("tokens_out", 0) for r in results)
        print(f"  Successful: {len(successful)} | Escalated to human: {len(escalated)}")
        print(f"  Total tokens: {total_in:,} in / {total_out:,} out")

    report = governor.generate_report()
    print(f"\n  {'─'*66}")
    print(f"  BILLING SUMMARY ({CLIENT_ID})")
    print(f"  {'─'*66}")
    for line in report.to_invoice_lines():
        print(f"  {line}")

    print(f"\n  Session complete — {len(results)} VSO decisions generated")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    main()
