"""
VCO Match Engine
================
Matching gift, challenge grant, and employer match optimization.

Matching gifts are the highest-response-rate tool in the annual fund.
"Your gift is matched" outperforms every other message in A/B tests.
This engine detects, frames, and maximizes every match opportunity.

Match types:
  EMPLOYER_MATCH    — Employer doubles/triples employee gift
  BOARD_MATCH       — Board member match for Giving Day or campaign
  CHALLENGE_GRANT   — Unlock a grant by reaching a donor count or dollar threshold
  ALUMNI_MATCH      — Alumni challenge: "match for the next 24 hours"
  FAMILY_MATCH      — Named family foundation match
  LEADERSHIP_MATCH  — Institutional priority match (restricted to specific fund)

Optimization rules:
  1. Always lead with the match in subject line and first paragraph
  2. Show the math: "$100 → $200" or "$250 → $750"
  3. Show the cap: "up to $50,000" — creates urgency
  4. Show the deadline: most matches expire; deadline drives action
  5. Unlock language: challenge thresholds are powerful participation drivers
  6. Employer match: remind donors their HR system has a matching gift form
"""

from __future__ import annotations
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class MatchType(str, Enum):
    EMPLOYER_MATCH   = "employer_match"
    BOARD_MATCH      = "board_match"
    CHALLENGE_GRANT  = "challenge_grant"
    ALUMNI_MATCH     = "alumni_match"
    FAMILY_MATCH     = "family_match"
    LEADERSHIP_MATCH = "leadership_match"


@dataclass
class MatchOpportunity:
    match_type:         MatchType
    donor_name:         str           # "Anonymous Board Member" | "The Smith Family" | "Your Employer"
    ratio_label:        str           # "1:1" | "2:1" | "3:1"
    multiplier:         int           # 2 = 1:1, 3 = 2:1, 4 = 3:1
    cap_cents:          int           # Maximum match amount (0 = unlimited)
    deadline_str:       Optional[str] # "December 31" | "midnight tonight" | None
    fund_restriction:   Optional[str] # None = any fund; or specific fund name
    trigger_type:       Optional[str] # "always" | "donor_count" | "dollar_milestone"
    trigger_value:      Optional[int] # Donor count or cents needed to activate
    activated:          bool          # Is the match currently live?
    employer_portal:    Optional[str] # URL or "Contact your HR department"
    urgency_language:   str           # Ready-to-use urgency line
    math_example:       str           # "$100 gift → $200 impact"
    cta_modifier:       str           # "Double My Gift" | "Activate the Match" etc.


# ── Employer match library ────────────────────────────────────────────────────

# Top employer match programs for reference (for framing donor conversations)
TOP_MATCHING_EMPLOYERS = {
    "microsoft":    {"ratio": "1:1", "cap": 15000, "program": "Microsoft Matching Gifts"},
    "google":       {"ratio": "1:1", "cap": 50000, "program": "Google.org Employee Matching"},
    "apple":        {"ratio": "1:1", "cap": 25000, "program": "Apple Matching Gifts"},
    "meta":         {"ratio": "1:1", "cap": 25000, "program": "Meta Matching Gifts"},
    "amazon":       {"ratio": "1:1", "cap": 25000, "program": "Amazon AmazonCares"},
    "salesforce":   {"ratio": "1:1", "cap": 5000,  "program": "Salesforce.org Matching"},
    "jpmorgan":     {"ratio": "1:1", "cap": 30000, "program": "JPMorgan Chase Matching Gifts"},
    "goldman sachs":{"ratio": "1:1", "cap": 20000, "program": "Goldman Sachs Matching Gifts"},
    "cisco":        {"ratio": "1:1", "cap": 25000, "program": "Cisco Foundation Matching"},
    "general electric":{"ratio":"1:1","cap": 10000,"program":"GE Foundation Matching"},
    "ibm":          {"ratio": "1:1", "cap": 10000, "program": "IBM Matching Grants"},
    "boeing":       {"ratio": "1:1", "cap": 10000, "program": "Boeing Matching Gifts"},
    "deloitte":     {"ratio": "1:1", "cap": 2500,  "program": "Deloitte Foundation Matching"},
    "pwc":          {"ratio": "1:1", "cap": 5000,  "program": "PwC Employee Matching"},
    "kpmg":         {"ratio": "1:1", "cap": 5000,  "program": "KPMG Matching Gifts"},
    "ey":           {"ratio": "1:1", "cap": 5000,  "program": "EY Foundation Matching"},
}


# ── Match detection ───────────────────────────────────────────────────────────

def detect_match_opportunities(
    donor: dict,
    campaign_config = None,
    challenges: list = None,
) -> list[MatchOpportunity]:
    """
    Detect all available matching opportunities for a donor.
    Returns list of MatchOpportunity objects, highest priority first.
    """
    opportunities = []

    # 1. Employer match detection
    employer = (donor.get("employer") or "").lower()
    for company, info in TOP_MATCHING_EMPLOYERS.items():
        if company in employer:
            ratio = info["ratio"]
            cap   = info["cap"] * 100  # to cents
            multiplier = {"1:1": 2, "2:1": 3, "3:1": 4}.get(ratio, 2)
            last_ask   = donor.get("lastGiftCents", 10000)  # $100 default
            math_ex    = f"${last_ask/100:,.0f} gift → ${(last_ask * multiplier)/100:,.0f} impact"
            opportunities.append(MatchOpportunity(
                match_type=MatchType.EMPLOYER_MATCH,
                donor_name=info["program"],
                ratio_label=ratio,
                multiplier=multiplier,
                cap_cents=cap,
                deadline_str="December 31 (most employer programs)",
                fund_restriction=None,
                trigger_type="always",
                trigger_value=None,
                activated=True,
                employer_portal="Contact your HR department or visit your company's giving portal",
                urgency_language=f"Your employer ({company.title()}) will match your gift {ratio}. Don't leave this benefit unused.",
                math_example=math_ex,
                cta_modifier="Request Employer Match",
            ))
            break

    # 2. Campaign challenge grants
    if challenges:
        for c in challenges:
            if hasattr(c, 'amount_cents'):  # ChallengeGrant object
                ratio = "1:1"
                multiplier = 2
                last_ask  = donor.get("lastGiftCents", 10000)
                math_ex   = f"${last_ask/100:,.0f} gift → ${(last_ask * multiplier)/100:,.0f} impact"
                opportunities.append(MatchOpportunity(
                    match_type=MatchType.CHALLENGE_GRANT,
                    donor_name=c.donor_name,
                    ratio_label=ratio,
                    multiplier=multiplier,
                    cap_cents=c.amount_cents,
                    deadline_str="midnight tonight" if not c.unlocked else None,
                    fund_restriction=None,
                    trigger_type=c.trigger_type,
                    trigger_value=c.trigger_value,
                    activated=c.unlocked,
                    employer_portal=None,
                    urgency_language=(
                        f"{c.donor_name} will match every gift — up to ${c.amount_cents/100:,.0f}."
                        if c.unlocked else
                        f"Help unlock {c.donor_name}'s ${c.amount_cents/100:,.0f} challenge!"
                    ),
                    math_example=math_ex,
                    cta_modifier="Unlock the Match" if not c.unlocked else "My Gift Is Matched!",
                ))

    # 3. Campaign-level board match
    if campaign_config and hasattr(campaign_config, 'matching_ratio'):
        if campaign_config.matching_ratio and campaign_config.matching_ratio != "none":
            ratio      = campaign_config.matching_ratio
            multiplier = {"1:1": 2, "2:1": 3, "3:1": 4}.get(ratio, 2)
            last_ask   = donor.get("lastGiftCents", 10000)
            math_ex    = f"${last_ask/100:,.0f} gift → ${(last_ask * multiplier)/100:,.0f} impact"
            cap        = campaign_config.matching_cap_cents
            cap_str    = f" up to ${cap/100:,.0f}" if cap > 0 else ""
            opportunities.append(MatchOpportunity(
                match_type=MatchType.BOARD_MATCH,
                donor_name="A generous board member",
                ratio_label=ratio,
                multiplier=multiplier,
                cap_cents=cap,
                deadline_str=campaign_config.end_dt.strftime("%B %d") if hasattr(campaign_config, 'end_dt') else None,
                fund_restriction=None,
                trigger_type="always",
                trigger_value=None,
                activated=True,
                employer_portal=None,
                urgency_language=f"A board member will match every gift {ratio}{cap_str}. Your gift does double the good.",
                math_example=math_ex,
                cta_modifier=f"Double My Gift ({ratio} Match)",
            ))

    return opportunities


# ── Match framing for each archetype ─────────────────────────────────────────

ARCHETYPE_MATCH_FRAMES = {
    "IMPACT_INVESTOR": "Your ${ask} produces ${matched} in institutional investment — a {ratio} return on your philanthropic capital.",
    "PRAGMATIC_PARTNER": "The math is simple: give ${ask}, {donor_name} adds ${match_add}, and your total impact is ${matched}. No cost to you.",
    "LEGACY_BUILDER": "Your gift — matched {ratio} — will be part of a permanent record. ${matched} toward a lasting legacy.",
    "MISSION_ZEALOT": "The mission advances further, faster: your ${ask} matched {ratio} means ${matched} working for what you believe in.",
    "LOYAL_ALUMNI": "Your loyalty, amplified: give ${ask} today and {donor_name}'s match makes it ${matched} for {institution}.",
    "COMMUNITY_CHAMPION": "Your gift is doubled — that's ${matched} supporting the entire {institution} community, not just ${ask}.",
    "FAITH_DRIVEN": "A generous donor has offered to multiply every gift: your ${ask} becomes ${matched}. Be the steward of this moment.",
    "SOCIAL_CONNECTOR": "Your friends are already giving — and their gifts are being matched! Join them: ${ask} → ${matched}.",
}


def get_archetype_match_frame(
    opp: MatchOpportunity, donor: dict, institution: str = "the institution"
) -> str:
    """Return archetype-tuned match framing."""
    archetype = donor.get("archetype", "LOYAL_ALUMNI")
    last_ask  = donor.get("lastGiftCents", 10000)
    ask_str   = f"{last_ask/100:,.0f}"
    matched   = last_ask * opp.multiplier
    match_add = matched - last_ask

    template = ARCHETYPE_MATCH_FRAMES.get(archetype, ARCHETYPE_MATCH_FRAMES["LOYAL_ALUMNI"])
    return template.format(
        ask=ask_str,
        matched=f"{matched/100:,.0f}",
        match_add=f"{match_add/100:,.0f}",
        ratio=opp.ratio_label,
        donor_name=opp.donor_name,
        institution=institution,
    )


# ── Prompt formatter ──────────────────────────────────────────────────────────

def format_match_for_prompt(opportunities: list[MatchOpportunity], donor: dict, institution: str = "") -> str:
    """Format match opportunities for VCO system prompt injection."""
    if not opportunities:
        return "Match Opportunities: None detected for this donor/campaign."

    lines = [f"MATCHING GIFT OPPORTUNITIES ({len(opportunities)} available):"]
    for i, opp in enumerate(opportunities, 1):
        lines.append(f"\n  [{i}] {opp.match_type.value.upper().replace('_', ' ')} — {opp.donor_name}")
        lines.append(f"      Ratio: {opp.ratio_label} | Cap: {'Unlimited' if opp.cap_cents == 0 else f'${opp.cap_cents/100:,.0f}'}")
        if opp.deadline_str:
            lines.append(f"      Deadline: {opp.deadline_str}")
        if opp.trigger_type and opp.trigger_type != "always":
            lines.append(f"      Trigger: {opp.trigger_type} = {opp.trigger_value}")
        lines.append(f"      Status: {'✅ ACTIVE' if opp.activated else '⏳ PENDING UNLOCK'}")
        lines.append(f"      Math: {opp.math_example}")
        lines.append(f"      Urgency: {opp.urgency_language}")
        lines.append(f"      CTA: \"{opp.cta_modifier}\"")

        if institution:
            frame = get_archetype_match_frame(opp, donor, institution)
            lines.append(f"      Archetype Frame: {frame}")

    lines.append(f"\nMATCH STRATEGY: Lead with the match in subject line AND first paragraph.")
    lines.append("Show the math explicitly. Show the cap for urgency. Show the deadline.")
    return "\n".join(lines)
