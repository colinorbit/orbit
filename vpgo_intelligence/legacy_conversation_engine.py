"""
VPGO Legacy Conversation Engine
================================
Designs the optimal legacy giving conversation strategy for each donor.
Outputs conversation stage, archetype-tuned opener, discovery questions,
objection handling scripts, and gift officer coaching notes.

Conversation stages (VPGO-specific):
  AWARENESS      — Donor doesn't know planned giving is an option
  EXPLORATION    — Donor has heard about it; open to learning more
  CONSIDERATION  — Donor is actively thinking about a legacy gift
  INTENTION      — Donor has expressed intent; documentation needed
  COMMITTED      — Bequest/life income gift confirmed; steward for life

Key principle: VPGO NEVER makes the ask — it educates, seeds, and warms.
The PGFO (human) closes the conversation and documents the intention.

All outreach is governed by the 45-day VPGO cadence.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ─── CONVERSATION STAGES ────────────────────────────────────────────────────

class ConvStage(str, Enum):
    AWARENESS     = "awareness"
    EXPLORATION   = "exploration"
    CONSIDERATION = "consideration"
    INTENTION     = "intention"
    COMMITTED     = "committed"


# ─── CONVERSATION STRATEGY ──────────────────────────────────────────────────

@dataclass
class ConvStrategy:
    stage:                  ConvStage
    tone:                   str
    primary_objective:      str
    opening_hook:           str         # First sentence to open the legacy topic
    discovery_questions:    list[str]   # Questions to surface intent
    content_pillars:        list[str]   # What to include in this message
    things_to_avoid:        list[str]   # What NOT to say
    cta:                    str         # Call to action for this stage
    follow_up_days:         int         # Cadence for next touch
    requires_human:         bool        # Does this stage require a human PGFO?
    officer_coaching_notes: str         # Guidance for the human gift officer


# ─── ARCHETYPE-SPECIFIC LEGACY LANGUAGE ─────────────────────────────────────

ARCHETYPE_LEGACY_LANGUAGE = {
    "LEGACY_BUILDER": {
        "hook":      "Your name is already part of Greenfield's story. A legacy gift makes it permanent.",
        "frame":     "enduring institutional impact, named recognition, permanent connection",
        "verb":      "build", "noun": "legacy", "metaphor": "architecture that outlasts any single gift",
        "fear":      "being forgotten",
        "aspiration":"being remembered as a founder-level contributor to institutional excellence",
    },
    "FAITH_DRIVEN": {
        "hook":      "Your faith has shaped your generosity. A planned gift is the final chapter of that testimony.",
        "frame":     "values alignment, stewardship, intergenerational faithfulness",
        "verb":      "steward", "noun": "calling", "metaphor": "seeds planted that future generations will harvest",
        "fear":      "not leaving the world better than they found it",
        "aspiration":"ensuring the institution continues its faith-rooted mission for generations",
    },
    "COMMUNITY_CHAMPION": {
        "hook":      "You've spent your career building community. A planned gift ensures Greenfield continues that work forever.",
        "frame":     "community continuity, collective impact, access and equity",
        "verb":      "ensure", "noun": "community", "metaphor": "a bridge you build for the next generation to cross",
        "fear":      "the institution losing its community mission after they're gone",
        "aspiration":"knowing the community they helped build will continue thriving",
    },
    "IMPACT_INVESTOR": {
        "hook":      "Your lifetime giving has generated measurable outcomes. A planned gift scales that impact permanently.",
        "frame":     "ROI of legacy gifts, long-term compounding, endowment mechanics",
        "verb":      "maximize", "noun": "impact", "metaphor": "an endowment is compound interest on your mission investment",
        "fear":      "their resources not being deployed efficiently",
        "aspiration":"a permanently funded program that demonstrates the ROI of their philanthropic investment",
    },
    "LOYAL_ALUMNI": {
        "hook":      "You've shown up for Greenfield every year. A planned gift is the ultimate expression of that loyalty.",
        "frame":     "belonging, identity, continuity of relationship",
        "verb":      "continue", "noun": "loyalty", "metaphor": "your relationship with Greenfield has no end date",
        "fear":      "being disconnected from the institution after death",
        "aspiration":"being permanently listed among those who gave the most significant gift of all — their legacy",
    },
    "MISSION_ZEALOT": {
        "hook":      "The work isn't finished. A planned gift ensures the mission you care about survives beyond your lifetime.",
        "frame":     "mission urgency, institutional sustainability, movement continuity",
        "verb":      "sustain", "noun": "mission", "metaphor": "a gift that keeps fighting long after you've passed the baton",
        "fear":      "the mission failing after they're gone",
        "aspiration":"leaving behind a resource that ensures the institution can continue its most important work",
    },
    "PRAGMATIC_PARTNER": {
        "hook":      "A planned gift is the most tax-efficient charitable contribution you can make. Let me show you how.",
        "frame":     "tax efficiency, financial planning, no-pressure flexibility",
        "verb":      "optimize", "noun": "strategy", "metaphor": "the last tax planning move that helps your heirs AND Greenfield",
        "fear":      "paying unnecessary taxes on their estate",
        "aspiration":"an estate plan that simultaneously helps heirs, reduces tax burden, and makes a lasting institutional impact",
    },
    "SOCIAL_CONNECTOR": {
        "hook":      "Joining the Legacy Society connects you with a community of Greenfield's most devoted donors — for life.",
        "frame":     "community, recognition, exclusivity, peer legacy",
        "verb":      "join", "noun": "community", "metaphor": "a VIP table of donors whose names endure together",
        "fear":      "not being recognized for their contributions",
        "aspiration":"permanent, exclusive recognition among Greenfield's most honored community members",
    },
}


# ─── STAGE DETECTOR ──────────────────────────────────────────────────────────

def _detect_conversation_stage(donor: dict) -> ConvStage:
    """Determine where the donor is in the legacy conversation lifecycle."""
    conversation = donor.get("conversationHistory", [])
    stage = donor.get("journeyStage", "stewardship")
    bequeath_score = donor.get("bequeathScore", 0)

    donor_msgs = " ".join(
        m.get("content", "").lower()
        for m in conversation
        if m.get("role") == "donor"
    )

    # Explicit commitment signals
    if any(kw in donor_msgs for kw in ["included greenfield in my will", "my estate plan includes", "already set up", "notified my attorney", "bequest is final"]):
        return ConvStage.COMMITTED

    # Intention signals
    if any(kw in donor_msgs for kw in ["plan to include", "thinking about putting", "want to leave", "intend to", "looking into", "my attorney is"]):
        return ConvStage.INTENTION

    # Consideration signals
    if any(kw in donor_msgs for kw in ["considering", "thinking about", "estate plan", "what are my options", "how does this work", "tell me more"]):
        return ConvStage.CONSIDERATION

    # Exploration signals
    if any(kw in donor_msgs for kw in ["i've heard", "someone told me", "i'm curious", "what is a bequest", "what's planned giving"]):
        return ConvStage.EXPLORATION

    # If high bequest score but no explicit mention → move to exploration
    if bequeath_score >= 65:
        return ConvStage.EXPLORATION

    return ConvStage.AWARENESS


# ─── STRATEGY BUILDER ────────────────────────────────────────────────────────

def plan_conversation_strategy(
    donor: dict,
    bequest_profile = None,
    vehicle_rec = None,
) -> ConvStrategy:
    """
    Design the optimal legacy conversation strategy for this donor.
    Returns a ConvStrategy with all VPGO content directives.
    """
    archetype  = donor.get("archetype", "LOYAL_ALUMNI")
    stage      = _detect_conversation_stage(donor)
    lang       = ARCHETYPE_LEGACY_LANGUAGE.get(archetype, ARCHETYPE_LEGACY_LANGUAGE["LOYAL_ALUMNI"])
    first_name = donor.get("firstName", "Friend")
    streak     = donor.get("givingStreak", 0)
    total      = donor.get("totalGiving", 0)
    fund       = donor.get("fundDesignation", "Greenfield's most important work")
    class_year = donor.get("classYear", "")

    # ── Stage-specific strategy ──────────────────────────────────────────────

    if stage == ConvStage.AWARENESS:
        return ConvStrategy(
            stage=stage,
            tone="curious, gentle, non-pressuring",
            primary_objective="Plant the seed of legacy giving awareness without any ask or urgency",
            opening_hook=lang["hook"],
            discovery_questions=[
                "What originally inspired you to start supporting Greenfield?",
                "When you think about Greenfield in 30 years, what do you hope it looks like?",
                "Have you ever thought about how your connection to Greenfield might continue beyond your lifetime?",
            ],
            content_pillars=[
                "Share a story about an existing legacy donor and the impact their planned gift has had",
                f"Connect to their archetype: '{lang['frame']}'",
                "Introduce the concept of a Legacy Society — recognition community for planned gift donors",
                "No vehicle discussion at this stage — only concept introduction",
                "End with an invitation to learn more — download a guide or reply with questions",
            ],
            things_to_avoid=[
                "Any mention of death, dying, or mortality",
                "Any specific gift amount",
                "Technical vehicle names (bequest, CGA, etc.) at this stage",
                "Urgency language — this must feel unhurried",
                "Asking them to make any decision",
            ],
            cta="Would you like me to send our brief Legacy Society guide? It's two pages and has inspired many donors to think about their long-term connection to Greenfield.",
            follow_up_days=45,
            requires_human=False,
            officer_coaching_notes=(
                f"{first_name} has not been introduced to planned giving. Begin with soft storytelling. "
                f"Lead with 'How did you first start giving to Greenfield?' to open the narrative. "
                f"Do not mention death, estates, or specific vehicles at this stage. "
                f"Goal is curiosity, not commitment."
            ),
        )

    if stage == ConvStage.EXPLORATION:
        vehicle_name = vehicle_rec.primary.name if vehicle_rec else "a bequest"
        return ConvStrategy(
            stage=stage,
            tone="educational, warm, knowledgeable, patient",
            primary_objective="Educate on planned giving vehicles; identify which resonates; invite PGFO conversation",
            opening_hook=f"I'd love to share more about how planned giving works — specifically {vehicle_name}, which might be a natural fit for someone at your stage.",
            discovery_questions=[
                "Have you worked with an estate planning attorney in the last few years?",
                "Do you have a sense of whether you'd want to support a specific program, or give where the need is greatest?",
                "Are there other charities in your estate plans alongside Greenfield?",
                "Is income during your lifetime important, or is this more about the long-term legacy?",
            ],
            content_pillars=[
                f"Introduce primary vehicle: {vehicle_rec.primary.name if vehicle_rec else 'bequest'} — plain English, no jargon",
                "Use the specific archetype framing: " + lang["frame"],
                "Include one inspiring legacy donor story relevant to their fund",
                "Provide a clear, one-page vehicle explanation (or link to one)",
                "Invite a no-pressure conversation with the planned giving team",
            ],
            things_to_avoid=[
                "Overwhelming with multiple vehicles at once",
                "Technical IRS or legal terminology without plain-English translation",
                "Implying they need to decide now",
                "Discussing gift amounts before relationship is deeper",
            ],
            cta="I'd welcome the chance to connect you with our planned giving officer for a 20-minute conversation — no commitment, just an informative chat about your options.",
            follow_up_days=45,
            requires_human=True,
            officer_coaching_notes=(
                f"{first_name} is exploring planned giving options. Primary vehicle recommendation: "
                f"{vehicle_rec.primary.name if vehicle_rec else 'bequest'}. "
                f"Key motivation: {lang['aspiration']}. "
                f"Key fear to address: {lang['fear']}. "
                f"Discovery questions to ask: {'; '.join(['Do they have an estate attorney?', 'Specific fund or unrestricted?', 'Income needs?'])}. "
                f"Do NOT push to commitment — PGFO meeting goal is education only."
            ),
        )

    if stage == ConvStage.CONSIDERATION:
        return ConvStrategy(
            stage=stage,
            tone="engaged, expert, personalized, forward-moving",
            primary_objective="Move from consideration to documented intention; provide specifics needed to act",
            opening_hook=f"I know you've been thinking about your legacy gift to Greenfield — I'd love to help make that as meaningful and straightforward as possible.",
            discovery_questions=[
                "Have you had a chance to speak with your estate planning attorney about including Greenfield?",
                "Do you know what type of gift you're considering — a bequest, annuity, or another vehicle?",
                "Would you prefer to designate the gift to a specific program, or leave it to the institution's greatest need?",
                "Is there anything about the process that would be helpful to clarify?",
            ],
            content_pillars=[
                f"Affirm their consideration — '{first_name}, this is exactly the kind of thoughtful planning that creates lasting impact'",
                f"Provide specifics: vehicle mechanics, tax benefit illustration, sample bequest language",
                "Share a named legacy — a donor who made a similar gift and the impact it had",
                f"Present the Legacy Society membership benefits and recognition they'd receive",
                "Offer clear next steps: attorney consultation, bequest notification form, PGFO call",
            ],
            things_to_avoid=[
                "Letting the conversation stall — provide a clear, easy next step",
                "Pressure or urgency (ever)",
                "Suggesting they change existing estate plans without full understanding",
                "Skipping the advisor referral — always say 'please share this with your attorney/CPA'",
            ],
            cta="When you're ready, our planned giving team can provide a sample bequest designation (one sentence you can share with your attorney) and answer any questions — no commitment until you choose.",
            follow_up_days=30,
            requires_human=True,
            officer_coaching_notes=(
                f"{first_name} is actively considering a planned gift. CRITICAL: Schedule a personal "
                f"conversation — VPGO has warmed this relationship; your job is to move it to documented intention. "
                f"Bring: sample bequest language, Legacy Society brochure, personalized impact report for their fund. "
                f"Ask: 'Have you updated your estate plan recently?' and 'Would it be helpful if I sent our sample "
                f"bequest language directly to your attorney?' "
                f"Total lifetime giving: ${total:,.0f}. "
                f"This donor is {'at ' + str(streak) + '-year streak.' if streak else 'a strong loyalty signal.'}"
            ),
        )

    if stage == ConvStage.INTENTION:
        return ConvStrategy(
            stage=stage,
            tone="grateful, celebratory, practical",
            primary_objective="Acknowledge the intention warmly; obtain bequest notification form; welcome to Legacy Society",
            opening_hook=f"{first_name}, the fact that you've included Greenfield in your estate plans is one of the most meaningful gifts imaginable.",
            discovery_questions=[
                "Would you be willing to share the nature of your gift so we can honor your intentions properly?",
                "Would you like to be recognized in the Legacy Society during your lifetime?",
                "Is there a specific fund or purpose you'd like your gift designated to?",
                "Would you like to meet the students or program staff who would be directly impacted?",
            ],
            content_pillars=[
                "Deep, personal gratitude — this is not transactional",
                "Legacy Society welcome and benefits summary",
                "Request completion of bequest notification form (for institution's records only)",
                "Impact story specific to the fund they're supporting",
                "Invitation to campus or virtual event as a Legacy Society member",
            ],
            things_to_avoid=[
                "Any suggestion that the gift should be larger",
                "Asking about the dollar amount of the estate gift",
                "Making the documentation feel like a legal burden",
                "Treating this as 'done' — ongoing stewardship is essential",
            ],
            cta="Welcome to the Greenfield Legacy Society. We'd love to formally welcome you — would you be open to a call with our President to express our personal gratitude?",
            follow_up_days=14,
            requires_human=True,
            officer_coaching_notes=(
                f"INTENTION CONFIRMED: {first_name} has indicated they plan to include Greenfield in their estate. "
                f"URGENT: Complete bequest notification form and enter in CRM under 'expectancy.' "
                f"PGFO must call within 7 days to personally thank. "
                f"President's office should send a handwritten note. "
                f"Enroll in Legacy Society immediately. "
                f"Do NOT discuss amounts — simply acknowledge and celebrate. "
                f"Schedule annual stewardship touchpoints for the rest of their lifetime."
            ),
        )

    # ── COMMITTED ────────────────────────────────────────────────────────────
    return ConvStrategy(
        stage=ConvStage.COMMITTED,
        tone="deeply personal, celebratory, relationship-for-life",
        primary_objective="Steward this legacy donor as the institution's most important relationship class",
        opening_hook=f"{first_name}, you've already changed Greenfield's future — permanently. This message is simply to keep our relationship alive and strong.",
        discovery_questions=[
            "Is there someone you'd like to introduce to Greenfield — a family member, a colleague?",
            "As you think about your own legacy, is there a specific student or faculty member you'd like to meet?",
            "Are there any updates to your estate plans we should be aware of?",
        ],
        content_pillars=[
            "Deep, personal stewardship — this donor has given the ultimate gift",
            "Annual personal call from President or CDO",
            "Invitation to exclusive Legacy Society events",
            "Regular impact updates on their designated fund",
            "Family engagement — introduce family to the institution so they honor the gift",
            "Named recognition at campus if at that threshold",
        ],
        things_to_avoid=[
            "Any solicitation — this donor has given the most significant gift possible",
            "Treating them as a prospect — they are a partner and a member of the institution",
            "Impersonal digital outreach — all touchpoints should feel personally curated",
        ],
        cta="We'd love to have you visit campus — as our guest, to see the impact of your lifetime of giving.",
        follow_up_days=30,
        requires_human=True,
        officer_coaching_notes=(
            f"{first_name} is a committed legacy donor. This relationship is managed by the CDO/President. "
            f"VPGO role: prepare personalized briefing notes for every human touchpoint. "
            f"Annual Legacy Society dinner invitation. Quarterly impact updates on designated fund. "
            f"Family engagement recommended — if children or heirs can be connected to Greenfield, "
            f"the bequest likelihood increases significantly."
        ),
    )


# ─── PROMPT FORMATTER ────────────────────────────────────────────────────────

def format_strategy_for_prompt(strategy: ConvStrategy) -> str:
    """Format legacy conversation strategy for VPGO system prompt injection."""
    lines = [
        f"Legacy Conversation Stage: {strategy.stage.value.title()}",
        f"Tone: {strategy.tone}",
        f"Objective: {strategy.primary_objective}",
        f"Opening Hook: \"{strategy.opening_hook}\"",
        "",
        "Content Pillars:",
    ]
    for p in strategy.content_pillars:
        lines.append(f"  • {p}")
    lines.append("\nDiscovery Questions (weave naturally, don't quiz):")
    for q in strategy.discovery_questions[:3]:
        lines.append(f"  • {q}")
    lines.append("\nThings to AVOID in this message:")
    for a in strategy.things_to_avoid[:3]:
        lines.append(f"  ✗ {a}")
    lines.append(f"\nCTA: {strategy.cta}")
    lines.append(f"Follow-up in: {strategy.follow_up_days} days")
    if strategy.requires_human:
        lines.append("⚠ HUMAN PGFO REQUIRED for this stage — VPGO prepares; human closes")
    lines.append(f"\nGIFT OFFICER COACHING NOTE:")
    lines.append(f"  {strategy.officer_coaching_notes}")
    return "\n".join(lines)
