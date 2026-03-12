"""
VPGO Intelligence Package
=========================
Virtual Planned Giving Officer brain — world-class legacy cultivation,
bequest propensity scoring, gift vehicle matching, and estate planning
conversation intelligence.

VPGO operates on a 45-day cadence for high-propensity prospects (bequeath_score ≥ 60).
All VPGO outreach is educational only — never a hard ask. Seeds planted → MGO/PGFO closes.

Key competitive advantage:
  - Intelligent vehicle matching: right giving tool for each donor's age + assets + goals
  - Archetype-tuned legacy language: Legacy Builders hear different language than Impact Investors
  - Life stage signal tracking: retirement, estate mention, bereavement = escalation triggers
  - Conversation coaching: arm human gift officers with confidence to start the PG conversation
  - Disclaimer management: every communication legally compliant

Modules:
  bequest_propensity       — Multi-signal planned giving likelihood scoring
  gift_vehicle_advisor     — Match donors to CGA, CRT, Bequest, IRA, DAF, etc.
  legacy_conversation_engine — Archetype-tuned legacy cultivation messages
  legacy_society_manager   — Legacy society membership, benefits, recognition

IMPORTANT DISCLAIMER:
  All VPGO outputs are informational and educational only.
  They do not constitute legal, tax, or financial advice.
  Donors must always consult with independent legal and financial advisors.
"""

from .bequest_propensity       import BequestTier, BequestProfile, score_bequest_propensity, format_bequest_for_prompt
from .gift_vehicle_advisor     import GiftVehicle, VehicleRecommendation, advise_gift_vehicles, format_vehicles_for_prompt
from .legacy_conversation_engine import ConvStage, ConvStrategy, plan_conversation_strategy, format_strategy_for_prompt
from .legacy_society_manager   import LegacySociety, check_legacy_society_status, format_society_for_prompt

__all__ = [
    "BequestTier", "BequestProfile", "score_bequest_propensity", "format_bequest_for_prompt",
    "GiftVehicle", "VehicleRecommendation", "advise_gift_vehicles", "format_vehicles_for_prompt",
    "ConvStage", "ConvStrategy", "plan_conversation_strategy", "format_strategy_for_prompt",
    "LegacySociety", "check_legacy_society_status", "format_society_for_prompt",
]
