"""
VSO Intelligence Package
========================
Virtual Stewardship Officer brain — world-class donor retention, recognition,
and stewardship intelligence that competes with and exceeds GiveCampus,
Givezly, and EverTrue's stewardship capabilities.

Modules:
  stewardship_engine   — Core action decision engine
  lapse_predictor      — Multi-signal churn prediction
  impact_reporter      — Personalized fund-level impact content
  recognition_engine   — Giving societies, milestones, upgrade paths
  stewardship_calendar — Optimal annual touchpoint scheduling
"""

from .stewardship_engine import StewAction, StewDecision, decide_stewardship_action, format_decision_for_prompt
from .lapse_predictor import LapseTier, LapseRisk, predict_lapse, format_lapse_for_prompt
from .impact_reporter import ImpactProfile, build_impact_profile, format_impact_for_prompt
from .recognition_engine import RecognitionEvent, detect_recognition_events, format_recognition_for_prompt
from .stewardship_calendar import TouchpointSchedule, build_annual_calendar, get_next_touchpoint

__all__ = [
    # Stewardship engine
    "StewAction", "StewDecision", "decide_stewardship_action", "format_decision_for_prompt",
    # Lapse predictor
    "LapseTier", "LapseRisk", "predict_lapse", "format_lapse_for_prompt",
    # Impact reporter
    "ImpactProfile", "build_impact_profile", "format_impact_for_prompt",
    # Recognition engine
    "RecognitionEvent", "detect_recognition_events", "format_recognition_for_prompt",
    # Stewardship calendar
    "TouchpointSchedule", "build_annual_calendar", "get_next_touchpoint",
]
