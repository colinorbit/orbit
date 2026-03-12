"""
VCO Intelligence Package
========================
Virtual Campaign Officer brain — world-class Giving Day management,
annual appeal segmentation, matching gift optimization, challenge grant
orchestration, and multi-channel campaign execution intelligence.

VCO operates on campaign calendars defined per institution. It handles
ALL time-bound fundraising: Giving Day, year-end, spring appeals, and
special purpose campaigns. Unlike VEO (continuous cultivation), VCO
is sprint-mode — high intensity, deadline-driven, urgency-first.

Key competitive advantage:
  - Real-time Giving Day orchestration: countdown, milestone, challenge tracking
  - Ruthless segmentation: LYBUNT / SYBUNT / loyal / new / mid-level / parents
  - Upgrade-ask science: personalized upgrade amounts based on giving history
  - A/B subject line engine: generates testable variants per segment
  - Match engine: employer match, challenge grants, board matches optimized
  - Channel coordination: email → SMS → social → push without fatigue

Modules:
  campaign_engine          — Core campaign strategy object, segment mapping
  giving_day_orchestrator  — Giving Day countdown, milestones, challenge tracking
  appeal_sequencer         — Multi-touch email series, A/B variants, timing
  segment_profiler         — LYBUNT/SYBUNT/loyal/new/mid-level segmentation
  match_engine             — Matching gift and challenge grant optimization
"""

from .campaign_engine         import (
    CampaignType, CampaignStage, CampaignConfig,
    build_campaign_strategy, format_campaign_for_prompt,
)
from .giving_day_orchestrator import (
    GDStage, ChallengeGrant, GivingDayStatus,
    orchestrate_giving_day, format_gd_for_prompt,
)
from .appeal_sequencer        import (
    AppealTouchpoint, AppealSeries,
    sequence_appeal, format_series_for_prompt,
)
from .segment_profiler        import (
    DonorSegment, SegmentProfile,
    classify_donor_segment, format_segment_for_prompt,
)
from .match_engine            import (
    MatchOpportunity, MatchType,
    detect_match_opportunities, format_match_for_prompt,
)

__all__ = [
    "CampaignType", "CampaignStage", "CampaignConfig",
    "build_campaign_strategy", "format_campaign_for_prompt",

    "GDStage", "ChallengeGrant", "GivingDayStatus",
    "orchestrate_giving_day", "format_gd_for_prompt",

    "AppealTouchpoint", "AppealSeries",
    "sequence_appeal", "format_series_for_prompt",

    "DonorSegment", "SegmentProfile",
    "classify_donor_segment", "format_segment_for_prompt",

    "MatchOpportunity", "MatchType",
    "detect_match_opportunities", "format_match_for_prompt",
]
