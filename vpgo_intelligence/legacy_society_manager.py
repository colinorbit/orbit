"""
VPGO Legacy Society Manager
=============================
Manages legacy society membership, recognition tiers, and bequest expectancy tracking.

Handles:
  - Legacy society enrollment detection
  - Membership tier (documented intention vs. irrevocable commitment)
  - Annual recognition event eligibility
  - Bequest notification acknowledgment
  - Estate settlement pipeline tracking (expectancies)
  - Recognition wall / annual report inclusion
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ─── LEGACY SOCIETY TIERS ────────────────────────────────────────────────────

class LegacySocietyTier(str, Enum):
    NOT_ENROLLED   = "not_enrolled"
    AWARE          = "aware"           # VPGO seed planted; not yet declared
    PROSPECTIVE    = "prospective"     # Considering; PGFO conversation scheduled
    DECLARED       = "declared"        # Bequest intention confirmed (revocable)
    IRREVOCABLE    = "irrevocable"     # Life income gift established (CGA, CRT, etc.)
    ESTATE_SETTLED = "estate_settled"  # Gift received and acknowledged


@dataclass
class LegacySociety:
    tier:               LegacySocietyTier
    society_name:       str             # E.g., "Greenfield Legacy Society"
    member_since:       Optional[str]   # ISO date if enrolled
    gift_type:          Optional[str]   # Bequest, CGA, CRT, etc.
    gift_designation:   Optional[str]   # Fund the gift will support
    gift_amount_est:    Optional[str]   # Estimated value ("unknown" if not disclosed)
    recognition_level:  str             # Recognition tier for donor wall / events
    annual_event_invite:bool            # Should receive Legacy Society dinner invite
    president_call:     bool            # Warrants personal call from President
    stewardship_class:  str             # "lifetime_partner" | "active" | "prospective"
    next_action:        str
    recognition_benefits: list[str]


# ─── MEMBER BENEFITS BY TIER ─────────────────────────────────────────────────

BENEFITS_BY_TIER = {
    LegacySocietyTier.AWARE: [
        "Legacy Society brochure and guide",
        "Annual impact report with legacy giving context",
    ],
    LegacySocietyTier.PROSPECTIVE: [
        "Personal outreach from Planned Giving Officer",
        "Legacy Society invitation letter",
        "Gift vehicle guide tailored to their profile",
    ],
    LegacySocietyTier.DECLARED: [
        "Legacy Society membership certificate",
        "Named recognition in Annual Report",
        "Annual Legacy Society dinner invitation",
        "Personalized impact report for designated fund",
        "Personal call from Dean/President",
        "Recognition on Legacy Society donor wall (if consented)",
        "Life member of advisory council (for major bequest prospects)",
    ],
    LegacySocietyTier.IRREVOCABLE: [
        "All Declared benefits PLUS:",
        "Named recognition at institution (if threshold reached)",
        "Private campus event — meet program/students their gift supports",
        "Annual personal briefing from President and Board Chair",
        "Family invited to campus — connecting heirs to the institution",
        "Planned Giving Certificate (irrevocable commitment recognized)",
    ],
    LegacySocietyTier.ESTATE_SETTLED: [
        "Permanent recognition on Legacy Society honor roll",
        "Named fund establishment (if endowment threshold reached)",
        "Memorial event or recognition ceremony",
        "Impact statement published in Annual Report",
    ],
}


# ─── SOCIETY STATUS CHECKER ──────────────────────────────────────────────────

def check_legacy_society_status(donor: dict, bequest_profile=None) -> LegacySociety:
    """
    Determine donor's current legacy society status and next steps.
    """
    conversation = donor.get("conversationHistory", [])
    stage        = donor.get("journeyStage", "stewardship")
    first_name   = donor.get("firstName", "Friend")
    fund         = donor.get("fundDesignation", "Greenfield's greatest need")
    bequeath     = donor.get("bequeathScore", 0)

    donor_msgs = " ".join(
        m.get("content", "").lower()
        for m in conversation
        if m.get("role") == "donor"
    )

    # ── Determine tier from signals ─────────────────────────────────────────
    if any(kw in donor_msgs for kw in [
        "included greenfield in my will", "already in my estate plan",
        "attorney drafted", "estate plan is done", "my bequest is set",
        "i've set up a cga", "annuity is established",
    ]):
        if any(kw in donor_msgs for kw in ["cga", "annuity", "trust", "crt", "crut"]):
            tier = LegacySocietyTier.IRREVOCABLE
        else:
            tier = LegacySocietyTier.DECLARED

    elif any(kw in donor_msgs for kw in [
        "want to include", "planning to include", "looking into", "my attorney is",
        "thinking seriously", "intend to", "plan to put",
    ]):
        tier = LegacySocietyTier.PROSPECTIVE

    elif stage in ("legacy_cultivation",):
        tier = LegacySocietyTier.AWARE

    elif bequest_profile and bequest_profile.tier.value in ("platinum", "gold"):
        tier = LegacySocietyTier.PROSPECTIVE

    elif bequeath >= 65:
        tier = LegacySocietyTier.AWARE

    else:
        tier = LegacySocietyTier.NOT_ENROLLED

    # ── Gift type inference ─────────────────────────────────────────────────
    gift_type = None
    if "cga" in donor_msgs or "annuity" in donor_msgs:
        gift_type = "Charitable Gift Annuity"
    elif "crt" in donor_msgs or "trust" in donor_msgs:
        gift_type = "Charitable Remainder Trust"
    elif "will" in donor_msgs or "estate" in donor_msgs or "bequest" in donor_msgs:
        gift_type = "Bequest (Will/Trust)"
    elif "ira" in donor_msgs or "retirement" in donor_msgs:
        gift_type = "IRA/Retirement Account Beneficiary Designation"

    # ── Determine recognition level ─────────────────────────────────────────
    total = donor.get("totalGiving", 0)
    if tier in (LegacySocietyTier.IRREVOCABLE, LegacySocietyTier.ESTATE_SETTLED) and total >= 25_000:
        recognition = "Founders' Circle Legacy Member"
    elif tier == LegacySocietyTier.DECLARED and total >= 10_000:
        recognition = "Legacy Society — Declared Member"
    elif tier == LegacySocietyTier.DECLARED:
        recognition = "Legacy Society Member"
    elif tier == LegacySocietyTier.PROSPECTIVE:
        recognition = "Legacy Society — Prospective Member"
    elif tier == LegacySocietyTier.AWARE:
        recognition = "Legacy Society — Cultivation Pipeline"
    else:
        recognition = "Not yet in Legacy Society pipeline"

    # ── Benefits and next action ────────────────────────────────────────────
    benefits = BENEFITS_BY_TIER.get(tier, [])
    annual_event = tier in (LegacySocietyTier.DECLARED, LegacySocietyTier.IRREVOCABLE, LegacySocietyTier.ESTATE_SETTLED)
    president_call = tier in (LegacySocietyTier.IRREVOCABLE, LegacySocietyTier.ESTATE_SETTLED) or (tier == LegacySocietyTier.DECLARED and total >= 25_000)

    next_action_map = {
        LegacySocietyTier.NOT_ENROLLED:   "VPGO to begin awareness cultivation — 45-day seed sequence",
        LegacySocietyTier.AWARE:           "VPGO to move to exploration — introduce vehicle options, invite PGFO conversation",
        LegacySocietyTier.PROSPECTIVE:     "PGFO to schedule 20-minute discovery conversation. No commitment expected.",
        LegacySocietyTier.DECLARED:        "Acknowledge and celebrate. Send bequest notification form. Enroll in Legacy Society. Annual stewardship for life.",
        LegacySocietyTier.IRREVOCABLE:     "Document in CRM as gift expectancy. Annual personal call from CDO/President. Named recognition if applicable.",
        LegacySocietyTier.ESTATE_SETTLED:  "Estate receipt. Named fund establishment if at threshold. Permanent recognition installation.",
    }

    stewardship_class_map = {
        LegacySocietyTier.NOT_ENROLLED:   "prospective",
        LegacySocietyTier.AWARE:           "prospective",
        LegacySocietyTier.PROSPECTIVE:     "active",
        LegacySocietyTier.DECLARED:        "lifetime_partner",
        LegacySocietyTier.IRREVOCABLE:     "lifetime_partner",
        LegacySocietyTier.ESTATE_SETTLED:  "lifetime_partner",
    }

    return LegacySociety(
        tier=tier,
        society_name="Greenfield Legacy Society",
        member_since=None,  # Would be set from CRM
        gift_type=gift_type,
        gift_designation=fund,
        gift_amount_est="Not disclosed" if tier in (LegacySocietyTier.DECLARED, LegacySocietyTier.IRREVOCABLE) else None,
        recognition_level=recognition,
        annual_event_invite=annual_event,
        president_call=president_call,
        stewardship_class=stewardship_class_map.get(tier, "active"),
        next_action=next_action_map.get(tier, "Maintain relationship"),
        recognition_benefits=benefits,
    )


# ─── PROMPT FORMATTER ────────────────────────────────────────────────────────

def format_society_for_prompt(society: LegacySociety) -> str:
    """Format legacy society status for VPGO system prompt injection."""
    tier_labels = {
        LegacySocietyTier.NOT_ENROLLED:   "Not in Legacy Pipeline",
        LegacySocietyTier.AWARE:           "Legacy Awareness Stage",
        LegacySocietyTier.PROSPECTIVE:     "Prospective Legacy Donor — PGFO Conversation Scheduled",
        LegacySocietyTier.DECLARED:        "✅ DECLARED Legacy Donor — Documented Intention",
        LegacySocietyTier.IRREVOCABLE:     "⭐ IRREVOCABLE Legacy Donor — Life Income Gift Established",
        LegacySocietyTier.ESTATE_SETTLED:  "🏛️ ESTATE SETTLED — Gift Received",
    }
    lines = [
        f"Legacy Society Status: {tier_labels.get(society.tier, society.tier.value)}",
        f"Recognition: {society.recognition_level}",
    ]
    if society.gift_type:
        lines.append(f"Gift Vehicle: {society.gift_type}")
    if society.gift_designation:
        lines.append(f"Designated Fund: {society.gift_designation}")
    lines.append(f"Annual Event Eligible: {'Yes — invite to Legacy Society Dinner' if society.annual_event_invite else 'Not yet'}")
    if society.president_call:
        lines.append("⚠ President/CDO call required — this is a lifetime partner relationship")
    lines.append(f"\nNEXT ACTION: {society.next_action}")
    if society.recognition_benefits:
        lines.append("Recognition Benefits:")
        for b in society.recognition_benefits[:4]:
            lines.append(f"  • {b}")
    return "\n".join(lines)
