"""
VCO Giving Day Orchestrator
============================
Real-time Giving Day campaign management: countdown urgency,
challenge grant tracking, milestone unlocks, leaderboard competition,
and donor ambassador activation.

Giving Day is the highest-intensity campaign in the annual fund calendar.
It runs 24 hours (or custom windows) with:
  - Pre-launch warm-up (T-14 through T-1)
  - 24-hour live campaign with real-time goal tracking
  - Challenge grant thresholds: unlock at donor count or dollar milestones
  - Leaderboard: school, class year, chapter, reunion year competitions
  - Hourly send windows: launch → midday push → final 6hr push → final hour
  - Post-GD thank-you + results within 24 hours

Giving Day intelligence:
  - Never send the same message twice
  - SMS triggers only for non-openers after email T+3hrs
  - Social proof updates every 2 hours during live window
  - Donor ambassador toolkits with sharable templates
  - Moonshot messaging: "we're X donors away from the record"
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
import datetime


class GDStage(str, Enum):
    """Giving Day specific stages (finer-grained than CampaignStage)."""
    PRE_LAUNCH_T14   = "pre_launch_t14"    # T-14: save the date
    PRE_LAUNCH_T7    = "pre_launch_t7"     # T-7: preview + goal reveal
    PRE_LAUNCH_T3    = "pre_launch_t3"     # T-3: challenge grant preview
    PRE_LAUNCH_T1    = "pre_launch_t1"     # T-1: tomorrow is the day
    LAUNCH           = "launch"            # T+0 to T+2h: go time
    MORNING_PUSH     = "morning_push"      # T+2h to T+6h: sustain
    MIDDAY_SURGE     = "midday_surge"      # T+6h to T+12h: challenge unlock milestone
    AFTERNOON_PUSH   = "afternoon_push"    # T+12h to T+18h: leaderboard
    FINAL_6_HOURS    = "final_6_hours"     # T+18h to T+23h: urgency climax
    FINAL_HOUR       = "final_hour"        # T+23h to T+24h: last call
    CLOSED           = "closed"            # Campaign over
    POST_GD_24H      = "post_gd_24h"       # T+1 to T+2 days: results + thanks
    POST_GD_72H      = "post_gd_72h"       # T+3 to T+7: impact follow-up


@dataclass
class ChallengeGrant:
    """A single challenge grant/matching offer."""
    donor_name:      str           # "The Smith Family" or "Anonymous Board Member"
    amount_cents:    int           # Total match amount
    trigger_type:    str           # "donor_count" | "dollar_milestone"
    trigger_value:   int           # Donor count or dollar amount (cents) to unlock
    time_window:     Optional[str] # "midnight to noon only" | None = all day
    unlocked:        bool          # Whether triggered yet
    description:     str           # Public-facing challenge description


@dataclass
class GivingDayStatus:
    """Real-time Giving Day campaign status snapshot."""
    stage:                GDStage
    donors_so_far:        int
    raised_cents:         int
    goal_cents:           int
    goal_donors:          Optional[int]
    hours_remaining:      float
    unlocked_challenges:  list[ChallengeGrant]
    pending_challenges:   list[ChallengeGrant]   # Not yet unlocked
    leaderboard_leaders:  dict                    # {"school": "Engineering", "class": "1995"}
    momentum_label:       str                     # "🔥 Fastest hour yet" | "⚡ 500 donors in 2hrs"
    pct_to_goal:          float                   # 0.0–1.0
    donors_to_record:     Optional[int]           # Donors needed to beat all-time record
    next_challenge_gap:   Optional[str]           # "18 donors to unlock the Smith $25K match"
    send_sms:             bool                    # Should we send SMS in this window?
    send_social_post:     bool                    # Generate social post for this window?
    urgent_copy_mode:     bool                    # Final 6 hrs: switch to maximum urgency
    ambassador_nudge:     bool                    # Activate donor ambassador sharing?
    next_send_window:     str                     # "12:00 PM — midday surge email"


# ── Stage detection ───────────────────────────────────────────────────────────

def _detect_gd_stage(
    start_dt: datetime.datetime, end_dt: datetime.datetime, now: datetime.datetime
) -> GDStage:
    """Determine current Giving Day stage based on clock."""
    delta_to_start = (start_dt - now).total_seconds()
    delta_to_end   = (end_dt - now).total_seconds()

    if delta_to_start > 14 * 86400:
        return GDStage.PRE_LAUNCH_T14
    if delta_to_start > 7 * 86400:
        return GDStage.PRE_LAUNCH_T7
    if delta_to_start > 3 * 86400:
        return GDStage.PRE_LAUNCH_T3
    if delta_to_start > 86400:
        return GDStage.PRE_LAUNCH_T1

    if delta_to_start > 0:
        return GDStage.PRE_LAUNCH_T1

    # During the day
    elapsed = (now - start_dt).total_seconds()
    total   = (end_dt - start_dt).total_seconds()

    if total <= 0 or elapsed >= total:
        if delta_to_end > -2 * 86400:
            return GDStage.POST_GD_24H
        return GDStage.CLOSED

    pct = elapsed / total
    if pct < 0.08:   return GDStage.LAUNCH
    if pct < 0.25:   return GDStage.MORNING_PUSH
    if pct < 0.50:   return GDStage.MIDDAY_SURGE
    if pct < 0.75:   return GDStage.AFTERNOON_PUSH
    if pct < 0.96:   return GDStage.FINAL_6_HOURS
    return GDStage.FINAL_HOUR


# ── Momentum label generator ──────────────────────────────────────────────────

def _compute_momentum(
    stage: GDStage, donors: int, raised_cents: int, goal_cents: int, record_donors: Optional[int]
) -> str:
    pct = raised_cents / goal_cents if goal_cents > 0 else 0
    labels = []

    if stage == GDStage.LAUNCH:
        labels.append(f"🚀 We're live! {donors:,} donors in the first hour")
    elif stage == GDStage.MORNING_PUSH:
        labels.append(f"⚡ {donors:,} donors and building momentum")
    elif stage == GDStage.MIDDAY_SURGE:
        labels.append(f"🔥 MIDDAY: {pct*100:.0f}% to goal — keep pushing!")
    elif stage == GDStage.AFTERNOON_PUSH:
        labels.append(f"📈 {pct*100:.0f}% there — we can do this together")
    elif stage == GDStage.FINAL_6_HOURS:
        labels.append(f"⏰ FINAL HOURS: {donors:,} donors strong — don't stop now!")
    elif stage == GDStage.FINAL_HOUR:
        labels.append(f"🔔 LAST CALL: {donors:,} donors. Final hour. Give NOW.")
    elif stage in (GDStage.POST_GD_24H, GDStage.POST_GD_72H):
        labels.append(f"🎉 We did it — {donors:,} donors raised ${raised_cents/100:,.0f}!")
    else:
        labels.append(f"Campaign in progress: {donors:,} donors")

    if record_donors and donors >= record_donors * 0.9:
        gap = max(0, record_donors - donors)
        if gap > 0:
            labels.append(f"Moonshot: {gap} donors from the all-time record!")
        else:
            labels.append(f"🏆 ALL-TIME RECORD BROKEN: {donors:,} donors!")

    return " | ".join(labels)


# ── Challenge grant analysis ──────────────────────────────────────────────────

def _analyze_challenges(
    challenges: list[ChallengeGrant], donors_so_far: int, raised_cents: int
) -> tuple[list[ChallengeGrant], list[ChallengeGrant], Optional[str]]:
    """Return (unlocked, pending, next_gap_str)."""
    unlocked = []
    pending  = []
    next_gap_str = None

    for c in challenges:
        # Check if should be unlocked
        auto_unlocked = c.unlocked
        if not auto_unlocked:
            if c.trigger_type == "donor_count" and donors_so_far >= c.trigger_value:
                auto_unlocked = True
            elif c.trigger_type == "dollar_milestone" and raised_cents >= c.trigger_value:
                auto_unlocked = True

        if auto_unlocked:
            unlocked.append(c)
        else:
            pending.append(c)
            # Compute gap for first pending challenge
            if next_gap_str is None:
                if c.trigger_type == "donor_count":
                    gap = c.trigger_value - donors_so_far
                    next_gap_str = (
                        f"{gap} more donors to unlock "
                        f"{c.donor_name}'s ${c.amount_cents/100:,.0f} challenge!"
                    )
                elif c.trigger_type == "dollar_milestone":
                    gap_cents = c.trigger_value - raised_cents
                    next_gap_str = (
                        f"${gap_cents/100:,.0f} more to unlock "
                        f"{c.donor_name}'s challenge match!"
                    )

    return unlocked, pending, next_gap_str


# ── Orchestrator ──────────────────────────────────────────────────────────────

def orchestrate_giving_day(
    campaign_config,         # CampaignConfig from campaign_engine
    challenges: list[ChallengeGrant],
    donors_so_far: int,
    raised_cents: int,
    leaderboard: Optional[dict] = None,
    record_donors: Optional[int] = None,
    now: Optional[datetime.datetime] = None,
) -> GivingDayStatus:
    """
    Generate real-time Giving Day status snapshot for VCO context injection.
    Determines stage, momentum, challenge progress, and activation flags.
    """
    now = now or datetime.datetime.now()

    stage = _detect_gd_stage(campaign_config.start_dt, campaign_config.end_dt, now)

    hours_remaining = max(0.0, (campaign_config.end_dt - now).total_seconds() / 3600)
    pct_to_goal     = min(1.0, raised_cents / campaign_config.goal_cents) if campaign_config.goal_cents > 0 else 0.0

    unlocked_challenges, pending_challenges, next_challenge_gap = _analyze_challenges(
        challenges, donors_so_far, raised_cents
    )

    momentum_label = _compute_momentum(
        stage, donors_so_far, raised_cents, campaign_config.goal_cents, record_donors
    )

    donors_to_record = None
    if record_donors and donors_so_far < record_donors:
        donors_to_record = record_donors - donors_so_far

    # Send flags
    send_sms      = stage in (GDStage.FINAL_6_HOURS, GDStage.FINAL_HOUR, GDStage.MIDDAY_SURGE)
    send_social   = stage in (GDStage.LAUNCH, GDStage.MIDDAY_SURGE, GDStage.FINAL_6_HOURS, GDStage.FINAL_HOUR)
    urgent_mode   = stage in (GDStage.FINAL_6_HOURS, GDStage.FINAL_HOUR)
    ambassador    = stage in (GDStage.LAUNCH, GDStage.MIDDAY_SURGE)

    # Next send window recommendation
    next_send_map = {
        GDStage.PRE_LAUNCH_T14: "Pre-launch save-the-date (T-7 or T-3 preferred)",
        GDStage.PRE_LAUNCH_T7:  "T-3: Challenge grant preview email",
        GDStage.PRE_LAUNCH_T3:  "T-1: Tomorrow announcement + early giving link",
        GDStage.PRE_LAUNCH_T1:  "Launch day: 8–9am opening email",
        GDStage.LAUNCH:         "11am SMS to non-openers | 12pm midday update",
        GDStage.MORNING_PUSH:   "12pm midday push with progress + challenge status",
        GDStage.MIDDAY_SURGE:   "3pm leaderboard update + afternoon push",
        GDStage.AFTERNOON_PUSH: "6pm final-hours alert email",
        GDStage.FINAL_6_HOURS:  "9pm urgent SMS to non-givers | 11pm final call",
        GDStage.FINAL_HOUR:     "IMMEDIATE — final call SMS + email NOW",
        GDStage.CLOSED:         "T+24h: Thank you + final results email",
        GDStage.POST_GD_24H:    "T+72h: Impact story follow-up",
        GDStage.POST_GD_72H:    "Stewardship mode — next touchpoint in 30 days",
    }

    return GivingDayStatus(
        stage=stage,
        donors_so_far=donors_so_far,
        raised_cents=raised_cents,
        goal_cents=campaign_config.goal_cents,
        goal_donors=campaign_config.goal_donors,
        hours_remaining=hours_remaining,
        unlocked_challenges=unlocked_challenges,
        pending_challenges=pending_challenges,
        leaderboard_leaders=leaderboard or {},
        momentum_label=momentum_label,
        pct_to_goal=pct_to_goal,
        donors_to_record=donors_to_record,
        next_challenge_gap=next_challenge_gap,
        send_sms=send_sms,
        send_social_post=send_social,
        urgent_copy_mode=urgent_mode,
        ambassador_nudge=ambassador,
        next_send_window=next_send_map.get(stage, "Follow campaign calendar"),
    )


# ── Donor ambassador toolkit ──────────────────────────────────────────────────

def build_ambassador_toolkit(campaign_config, gd_status: GivingDayStatus) -> dict:
    """Build shareable templates for donor ambassadors."""
    base = {
        "twitter": (
            f"I just gave to {campaign_config.institution_name} on #GivingDay! "
            f"Join me — {gd_status.donors_so_far:,} donors and counting. "
            f"{campaign_config.campaign_hashtag or '#GivingDay'}"
        ),
        "facebook": (
            f"I'm proud to support {campaign_config.institution_name} today! "
            f"It's #GivingDay and we're already at {gd_status.donors_so_far:,} donors. "
            f"Will you join me? [GIVING_LINK]"
        ),
        "text": (
            f"Hey! I just gave to {campaign_config.institution_name} for Giving Day. "
            f"They're at {gd_status.pct_to_goal*100:.0f}% of their goal. "
            f"Give any amount — it makes a difference: [GIVING_LINK]"
        ),
        "email_ps": (
            f"P.S. Want to help even more? Share this with one friend who loves "
            f"{campaign_config.institution_name}. Every new donor counts today!"
        ),
    }
    if gd_status.next_challenge_gap:
        base["challenge_share"] = (
            f"We're SO CLOSE: {gd_status.next_challenge_gap} "
            f"Can you help spread the word? {campaign_config.campaign_hashtag or ''}"
        )
    return base


# ── Prompt formatter ──────────────────────────────────────────────────────────

def format_gd_for_prompt(gd: GivingDayStatus, campaign_config) -> str:
    """Format Giving Day status for VCO system prompt injection."""
    lines = [
        f"GIVING DAY STATUS — Stage: {gd.stage.value.upper().replace('_', ' ')}",
        f"Progress: ${gd.raised_cents/100:,.0f} raised | {gd.donors_so_far:,} donors | {gd.pct_to_goal*100:.0f}% to goal",
        f"Hours Remaining: {gd.hours_remaining:.1f}",
        f"Momentum: {gd.momentum_label}",
    ]
    if gd.donors_to_record:
        lines.append(f"🏆 Moonshot: {gd.donors_to_record} donors from the all-time record!")
    if gd.next_challenge_gap:
        lines.append(f"⚡ CHALLENGE: {gd.next_challenge_gap}")
    if gd.unlocked_challenges:
        lines.append(f"✅ Unlocked matches: {', '.join(c.donor_name for c in gd.unlocked_challenges)}")
    if gd.leaderboard_leaders:
        leaders = " | ".join(f"{k}: {v}" for k, v in gd.leaderboard_leaders.items())
        lines.append(f"🏅 Leaderboard: {leaders}")
    lines.append(f"\nACTION FLAGS:")
    lines.append(f"  Send SMS: {'YES — trigger now' if gd.send_sms else 'No'}")
    lines.append(f"  Social post: {'YES — generate post' if gd.send_social_post else 'No'}")
    lines.append(f"  Urgent copy mode: {'YES — maximum urgency language' if gd.urgent_copy_mode else 'No'}")
    lines.append(f"  Ambassador nudge: {'YES — include P.S. share ask' if gd.ambassador_nudge else 'No'}")
    lines.append(f"\nNEXT SEND WINDOW: {gd.next_send_window}")
    return "\n".join(lines)
