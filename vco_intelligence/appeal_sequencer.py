"""
VCO Appeal Sequencer
=====================
Multi-touch email series design, A/B subject line generation,
touch timing, and cross-channel coordination.

An annual fund "series" is not a single email — it's a choreographed
multi-touch sequence timed around a campaign. The Appeal Sequencer
designs the full arc: warm-up → launch → urgency → close → thank you.

Sequence design principles:
  1. Each touch must be different — different hook, different story
  2. Escalating urgency: calm intro → building momentum → URGENT close
  3. Never send more than 4 emails per campaign per donor (LYBUNT/NLYBUNT)
  4. SYBUNT: 1–2 max. LAPSED_DEEP: 1 only.
  5. SMS is a supplement to email, never a replacement
  6. A/B test: subject line A/B should be decided by 11am day-of
  7. The P.S. is the second-most-read element — use it for upgrade or match
  8. Final-hours copy changes tone completely: COUNT DOWN, not cultivate
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class TouchType(str, Enum):
    EMAIL         = "email"
    SMS           = "sms"
    HANDWRITTEN   = "handwritten_note"
    PHONE_PREP    = "phone_call_prep_brief"
    SOCIAL_DM     = "social_dm"
    PUSH          = "push_notification"


@dataclass
class AppealTouchpoint:
    """A single touchpoint in the appeal sequence."""
    sequence_num:    int           # 1, 2, 3...
    touch_type:      TouchType
    timing_label:    str           # "T-7", "Launch Day 8am", "Final Hours 6pm", etc.
    timing_days:     int           # Days relative to campaign start (negative = pre-launch)
    purpose:         str           # "warm_up" | "launch" | "momentum" | "urgency" | "close" | "thanks"
    subject_lines:   list[str]     # 3–5 A/B options
    preview_texts:   list[str]     # Matching preview texts
    hook:            str           # Opening hook sentence/concept
    body_arc:        str           # 2–3 sentence description of message arc
    cta_primary:     str           # Primary CTA button label
    cta_secondary:   Optional[str] # Secondary CTA (social share, etc.)
    ps_content:      Optional[str] # P.S. (upgrade / match / social share)
    include_match:   bool          # Feature matching gift in this touch?
    ab_test_element: Optional[str] # What to A/B test: "subject" | "cta" | "ask_amount" | "tone"
    max_words:       int           # Target length
    notes:           str


@dataclass
class AppealSeries:
    """Complete multi-touch appeal series for one segment."""
    segment:         str
    campaign_name:   str
    total_touches:   int
    touchpoints:     list[AppealTouchpoint]
    channel_mix:     list[str]
    ab_test_plan:    str    # Which touchpoints have A/B tests and what element
    fatigue_guard:   str    # Rules to prevent donor fatigue
    optimization_notes: str


# ── Series templates per segment ─────────────────────────────────────────────

def sequence_appeal(
    segment,           # DonorSegment from segment_profiler
    campaign_config,   # CampaignConfig from campaign_engine
    match_opportunity = None,   # Optional MatchOpportunity
    donor: dict = None,
) -> AppealSeries:
    """
    Design the full multi-touch appeal series for a donor segment.
    Returns AppealSeries with all touchpoints, timing, and A/B plan.
    """
    from .segment_profiler import DonorSegment
    from .campaign_engine  import CampaignType

    donor = donor or {}
    seg   = segment.segment if hasattr(segment, 'segment') else segment
    ctype = campaign_config.campaign_type if campaign_config else CampaignType.GIVING_DAY
    name  = campaign_config.campaign_name if campaign_config else "Annual Campaign"
    institution = campaign_config.institution_name if campaign_config else "the institution"
    match_name  = match_opportunity.donor_name if match_opportunity else None
    match_ratio = match_opportunity.ratio_label if match_opportunity else "1:1"

    # Build touchpoints based on segment
    if seg == DonorSegment.NLYBUNT:
        tps = _build_nlybunt_series(name, institution, match_name, match_ratio, ctype)
    elif seg == DonorSegment.LYBUNT:
        tps = _build_lybunt_series(name, institution, match_name, match_ratio, ctype)
    elif seg == DonorSegment.SYBUNT:
        tps = _build_sybunt_series(name, institution, ctype)
    elif seg == DonorSegment.LAPSED_DEEP:
        tps = _build_lapsed_deep_series(name, institution)
    elif seg == DonorSegment.YOUNG_ALUMNI:
        tps = _build_young_alumni_series(name, institution, match_name, match_ratio, ctype)
    elif seg == DonorSegment.FIRST_TIME:
        tps = _build_first_time_series(name, institution)
    elif seg == DonorSegment.LOYAL_MID:
        tps = _build_loyal_mid_series(name, institution, match_name, match_ratio)
    elif seg == DonorSegment.MID_LEVEL:
        tps = _build_mid_level_series(name, institution)
    elif seg == DonorSegment.PARENT:
        tps = _build_parent_series(name, institution)
    else:
        tps = _build_generic_series(name, institution)

    channels   = list({tp.touch_type.value for tp in tps})
    ab_plan    = _build_ab_plan(tps)
    fatigue    = f"Maximum {len(tps)} touches per campaign. Stop all outreach after opt-out or gift received."
    notes      = f"Series for {seg.value.upper().replace('_', ' ')} segment — {name}."
    if match_name:
        notes += f" Feature {match_name} match ({match_ratio}) in touches 1 and {len(tps)-1}."

    return AppealSeries(
        segment=seg.value if hasattr(seg, 'value') else str(seg),
        campaign_name=name,
        total_touches=len(tps),
        touchpoints=tps,
        channel_mix=channels,
        ab_test_plan=ab_plan,
        fatigue_guard=fatigue,
        optimization_notes=notes,
    )


# ── Series builders ───────────────────────────────────────────────────────────

def _build_nlybunt_series(name, inst, match_name, match_ratio, ctype):
    m = match_name or "a generous donor"
    return [
        AppealTouchpoint(
            sequence_num=1, touch_type=TouchType.EMAIL,
            timing_label="T-7 (warm-up)", timing_days=-7,
            purpose="warm_up",
            subject_lines=[
                f"Something special is coming — are you in?",
                f"Your {inst} story continues on {name}",
                f"We've been saving the date — and saving it for you, {{name}}",
            ],
            preview_texts=["A preview of what's ahead.", "Good things are coming."],
            hook=f"Every year, you renew your commitment to {inst}. And every year, it means everything.",
            body_arc="Remind them of their streak/impact. Preview the upcoming campaign. No ask yet — pure gratitude.",
            cta_primary="Preview the Campaign",
            cta_secondary=None,
            ps_content=f"P.S. {m} is offering a match. More details on {name}.",
            include_match=bool(match_name),
            ab_test_element="subject",
            max_words=250,
            notes="Warm, gratitude-first. No ask. Set expectation for Day-of email.",
        ),
        AppealTouchpoint(
            sequence_num=2, touch_type=TouchType.EMAIL,
            timing_label="Launch Day 8am", timing_days=0,
            purpose="launch",
            subject_lines=[
                f"It's here — {name} is LIVE, {{name}}",
                f"{{name}}, your {{streak}}-year streak continues today",
                f"TODAY: your gift to {inst} is matched {match_ratio}",
                f"{{name}}, join {{donors_so_far}} classmates already giving",
            ],
            preview_texts=["Your gift does double the good today.", "The day is finally here."],
            hook=f"[CAMPAIGN NAME] is officially live — and your gift today is matched {match_ratio} by {m}.",
            body_arc="Open with match/excitement. Reference their streak. Specific ask amount. Simple CTA.",
            cta_primary="Renew My Gift",
            cta_secondary="Share with a Friend",
            ps_content=f"P.S. Your ${'{last_gift}'} gift becomes ${'{matched_gift}'} today. Don't wait — the match has a cap.",
            include_match=True,
            ab_test_element="subject",
            max_words=300,
            notes="This is the MOST IMPORTANT email. Highest open rate. Short. Match front-loaded.",
        ),
        AppealTouchpoint(
            sequence_num=3, touch_type=TouchType.SMS,
            timing_label="Launch Day 11am (non-openers)", timing_days=0,
            purpose="momentum",
            subject_lines=[
                f"[{inst}] 🔥 {'{pct}'}% to goal! Give today: [LINK]",
            ],
            preview_texts=[""],
            hook=f"[{inst}] We're at {{pct}}% of our goal for {name}. Your gift matters today: [LINK]",
            body_arc="SMS: 160 chars max. Progress + link. Urgency.",
            cta_primary="Give Now",
            cta_secondary=None,
            ps_content=None,
            include_match=True,
            ab_test_element=None,
            max_words=30,
            notes="Send ONLY to non-openers of email #2 by 11am. Stop if gift received.",
        ),
        AppealTouchpoint(
            sequence_num=4, touch_type=TouchType.EMAIL,
            timing_label="Final Hours 6pm", timing_days=0,
            purpose="close",
            subject_lines=[
                f"⏰ Final hours: {name} ends at midnight",
                f"{{name}}, 6 hours left — will you be counted?",
                f"Don't let the match expire — give before midnight",
                f"LAST CHANCE: {{donors_away}} donors from the record",
            ],
            preview_texts=["The clock is ticking.", "Don't let midnight close without you."],
            hook="Six hours. That's all that remains of {name}.",
            body_arc="Pure urgency. Progress update. Specific donor count. Countdown language. Hard deadline.",
            cta_primary="Give Before Midnight",
            cta_secondary=None,
            ps_content="P.S. Every minute you wait is a minute your matched gift could expire.",
            include_match=True,
            ab_test_element="cta",
            max_words=200,
            notes="FINAL HOURS tone: short, urgent, no fluff. Send only to non-givers.",
        ),
    ]


def _build_lybunt_series(name, inst, match_name, match_ratio, ctype):
    m = match_name or "a generous donor"
    return [
        AppealTouchpoint(
            sequence_num=1, touch_type=TouchType.EMAIL,
            timing_label="T-14 (reconnect)", timing_days=-14,
            purpose="warm_up",
            subject_lines=[
                f"We've been thinking about you, {{name}}",
                f"A lot has happened at {inst} since your last gift",
                f"{{name}}, we missed you — and we want you back",
            ],
            preview_texts=["Reconnect before we ask.", "Something happened while you were away."],
            hook=f"A year ago, you gave to {inst}. We've been thinking about what you made possible.",
            body_arc="Impact story from last year's gifts. No ask. Rebuild relationship. Show what happened.",
            cta_primary=f"See Your Impact",
            cta_secondary=None,
            ps_content=None,
            include_match=False,
            ab_test_element="subject",
            max_words=250,
            notes="RECONNECT FIRST. No ask. Impact + gratitude. Critical for LYBUNT retention.",
        ),
        AppealTouchpoint(
            sequence_num=2, touch_type=TouchType.EMAIL,
            timing_label="T-3 (preview + soft ask)", timing_days=-3,
            purpose="warm_up",
            subject_lines=[
                f"{name} is 3 days away — will you join us?",
                f"{{name}}, something special is happening Thursday",
                f"An exclusive preview: {name} and a {match_ratio} match opportunity",
            ],
            preview_texts=["We have something exciting to share.", "This is worth knowing about."],
            hook=f"{name} is days away — and this year, your gift can be matched {match_ratio}.",
            body_arc="Preview campaign. Introduce match. Early giving link if available. Soft ask.",
            cta_primary="Give Early",
            cta_secondary=None,
            ps_content=f"P.S. {m} has offered to match every gift on {name}. Details inside.",
            include_match=True,
            ab_test_element="subject",
            max_words=275,
            notes="Soft pre-ask. Introduce match. Creates anticipation.",
        ),
        AppealTouchpoint(
            sequence_num=3, touch_type=TouchType.EMAIL,
            timing_label="Launch Day 8am", timing_days=0,
            purpose="launch",
            subject_lines=[
                f"{{name}}, today is the day — come back to {inst}",
                f"You were with us before. We need you today.",
                f"{{name}}: {name} is live and your gift is matched",
            ],
            preview_texts=["We missed you.", "Today is your day to return."],
            hook=f"You gave to {inst} before. You know the difference it makes. Today, give again — and your gift goes twice as far.",
            body_arc="Personal reconnect. Acknowledge the lapse gently. Match opportunity. Specific ask.",
            cta_primary="Renew My Support",
            cta_secondary=None,
            ps_content="P.S. Your gift today — even a small one — restores your giving streak.",
            include_match=True,
            ab_test_element="subject",
            max_words=325,
            notes="Most important LYBUNT email. Emotional, personal. Streak restoration angle.",
        ),
        AppealTouchpoint(
            sequence_num=4, touch_type=TouchType.EMAIL,
            timing_label="Final Hours 6pm (if no gift)", timing_days=0,
            purpose="close",
            subject_lines=[
                f"{{name}}, last chance: 6 hours to come back",
                f"Final hours — will today be the day you return?",
                f"The match expires at midnight. Don't miss this.",
            ],
            preview_texts=["Last call.", "This is your moment."],
            hook="The day is almost over — and you still haven't been counted.",
            body_arc="Urgent but warm. Acknowledge non-response without guilt. Final call.",
            cta_primary="Give Before Midnight",
            cta_secondary=None,
            ps_content=None,
            include_match=True,
            ab_test_element=None,
            max_words=175,
            notes="Send only if no gift AND no opt-out by 5pm. Last touch.",
        ),
    ]


def _build_sybunt_series(name, inst, ctype):
    return [
        AppealTouchpoint(
            sequence_num=1, touch_type=TouchType.EMAIL,
            timing_label="T-7", timing_days=-7,
            purpose="warm_up",
            subject_lines=[
                f"A lot has changed at {inst} — are you curious?",
                f"{{name}}, we'd love to catch up",
                f"It's been a while. Here's what you've missed.",
            ],
            preview_texts=["No ask. Just an update.", "We're just catching up."],
            hook=f"We know it's been a few years. A lot has happened at {inst} — and we want to share it with you.",
            body_arc="Pure impact story. 2–3 things that changed since they last gave. Warm. No ask.",
            cta_primary="See What's Happened",
            cta_secondary=None,
            ps_content=None,
            include_match=False,
            ab_test_element="subject",
            max_words=250,
            notes="SYBUNT: warm before you ask. Single reconnect touch before the campaign ask.",
        ),
        AppealTouchpoint(
            sequence_num=2, touch_type=TouchType.EMAIL,
            timing_label="Launch Day 10am", timing_days=0,
            purpose="launch",
            subject_lines=[
                f"{{name}}, {name} is today — a gentle ask",
                f"No pressure — but today is {name}",
                f"Today only: {inst} Giving Day. Will you come back?",
            ],
            preview_texts=["A gentle ask.", "Today is the day — no pressure."],
            hook=f"Today is {name} at {inst}. We kept this email short because we know you've been away.",
            body_arc="Simple. Short. Low-barrier ask. One option: any amount. Easy giving link. Warm close.",
            cta_primary="Give Any Amount",
            cta_secondary=None,
            ps_content="P.S. Any gift — even $10 — means you're back. And that matters.",
            include_match=False,
            ab_test_element=None,
            max_words=200,
            notes="SYBUNT: maximum 2 touches. Keep it gentle. Accept any re-entry amount.",
        ),
    ]


def _build_lapsed_deep_series(name, inst):
    return [
        AppealTouchpoint(
            sequence_num=1, touch_type=TouchType.EMAIL,
            timing_label="Campaign launch week", timing_days=1,
            purpose="warm_up",
            subject_lines=[
                f"{{name}}, we haven't forgotten you",
                f"A note from {inst} — no strings attached",
                f"You were part of {inst} once. You still are.",
            ],
            preview_texts=["We remember.", "No pressure. Just hello."],
            hook=f"We know it's been a long time. But you were part of {inst} — and part of us.",
            body_arc="One story of impact. Warm acknowledgment of lapse without guilt. Lowest possible ask. Give any amount.",
            cta_primary="Give Any Amount",
            cta_secondary=None,
            ps_content=None,
            include_match=False,
            ab_test_element=None,
            max_words=200,
            notes="ONE TOUCH ONLY for 5+ year lapsed. No follow-up. Accept any re-entry.",
        ),
    ]


def _build_young_alumni_series(name, inst, match_name, match_ratio, ctype):
    m = match_name or "a generous alum"
    return [
        AppealTouchpoint(
            sequence_num=1, touch_type=TouchType.EMAIL,
            timing_label="T-3 (save the date)", timing_days=-3,
            purpose="warm_up",
            subject_lines=[
                f"Class of {{class_year}}: your class challenge starts {{launch_date}}",
                f"{{name}}, the Class of {{class_year}} is competing for the most donors",
                f"Only {{days_left}} days until {name} 🔥",
            ],
            preview_texts=["Your class vs. the others.", "Who will win?"],
            hook=f"The Class of {{class_year}} is in the running for the most donors on {name}. Are you in?",
            body_arc="Class challenge framing. Peer social proof. Low ask amount ($25 or any amount). Leaderboard teaser.",
            cta_primary="I'm In",
            cta_secondary="Share with Classmates",
            ps_content=None,
            include_match=bool(match_name),
            ab_test_element="subject",
            max_words=200,
            notes="Young alumni: peer competition + social proof is the primary hook. Low barrier.",
        ),
        AppealTouchpoint(
            sequence_num=2, touch_type=TouchType.EMAIL,
            timing_label="Launch Day 9am", timing_days=0,
            purpose="launch",
            subject_lines=[
                f"🔥 Class of {{class_year}}: WE'RE LIVE — {{donors_in_class}} classmates already gave",
                f"Give $25. Change everything. Class of {{class_year}} needs you NOW.",
                f"{{name}}: your class is {{pct_class}}% of the way there",
            ],
            preview_texts=["The competition is on.", "Let's do this."],
            hook=f"It's {name}. Your class is already on the board. Join them — $25 gets you in.",
            body_arc="Live class leaderboard update. Low ask. Quick link. Peer names if possible.",
            cta_primary="Join My Class",
            cta_secondary="Share the Link",
            ps_content=f"P.S. {m} is matching gifts {match_ratio} today. Your $25 becomes $50.",
            include_match=True,
            ab_test_element="subject",
            max_words=225,
            notes="Mobile-first copy. Very short. High-energy. SMS-ready if email not opened.",
        ),
        AppealTouchpoint(
            sequence_num=3, touch_type=TouchType.SMS,
            timing_label="Final Hours 8pm", timing_days=0,
            purpose="close",
            subject_lines=[
                f"[{inst}] Class of {{class_year}} needs you! {{donors_needed}} donors to win 🏆 Give now: [LINK]",
            ],
            preview_texts=[""],
            hook=f"[{inst}] Class of {{class_year}} is SO CLOSE to winning! {{donors_needed}} donors needed. Give in 30 sec: [LINK]",
            body_arc="SMS: 160 chars max. Class competition + count + link.",
            cta_primary="Give Now",
            cta_secondary=None,
            ps_content=None,
            include_match=False,
            ab_test_element=None,
            max_words=30,
            notes="SMS for young alumni is highly effective. Send to non-givers at 8pm only.",
        ),
    ]


def _build_first_time_series(name, inst):
    return [
        AppealTouchpoint(
            sequence_num=1, touch_type=TouchType.EMAIL,
            timing_label="Launch Day", timing_days=0,
            purpose="launch",
            subject_lines=[
                f"{{name}}, this is the moment to make your first gift to {inst}",
                f"Your first gift to {inst} starts here",
                f"Join thousands of {inst} alumni — make your mark today",
            ],
            preview_texts=["It starts with one gift.", "Your first step."],
            hook=f"There are thousands of {inst} alumni who've never given — until they did. Today, you can be one of them.",
            body_arc="Low barrier. Simplest possible ask ($25 or 'any amount'). One link. One CTA. Remove all friction.",
            cta_primary="Make My First Gift",
            cta_secondary=None,
            ps_content="P.S. Any amount counts. A $5 gift makes you a {inst} donor — forever.",
            include_match=False,
            ab_test_element="subject",
            max_words=225,
            notes="First-time: lowest possible barrier. Don't complicate it.",
        ),
        AppealTouchpoint(
            sequence_num=2, touch_type=TouchType.EMAIL,
            timing_label="Final Hours 7pm (if no gift)", timing_days=0,
            purpose="close",
            subject_lines=[
                f"{{name}}, last chance to make your first gift count",
                f"Tonight is the night, {{name}}",
            ],
            preview_texts=["Don't let it pass.", "One more chance."],
            hook="This is the last push. A simple ask: give anything, at any amount, before midnight.",
            body_arc="Shortest possible message. One sentence ask. One link.",
            cta_primary="Give Any Amount",
            cta_secondary=None,
            ps_content=None,
            include_match=False,
            ab_test_element=None,
            max_words=100,
            notes="Second touch only if no gift. Keep extremely short.",
        ),
    ]


def _build_loyal_mid_series(name, inst, match_name, match_ratio):
    m = match_name or "a generous donor"
    return [
        AppealTouchpoint(
            sequence_num=1, touch_type=TouchType.EMAIL,
            timing_label="T-7 (society invitation)", timing_days=-7,
            purpose="warm_up",
            subject_lines=[
                f"{{name}}, you've earned an invitation to {inst}'s leadership giving society",
                f"An exclusive invitation — just for donors like you, {{name}}",
                f"Your giving has earned you something special",
            ],
            preview_texts=["An invitation inside.", "You've earned this."],
            hook=f"After {{streak}} years of consistent giving to {inst}, you've earned an invitation to something special: the {{society_name}}.",
            body_arc="Named society benefits. Recognition. Exclusive access. Upgrade ask from current level to next tier.",
            cta_primary="Join the {society_name}",
            cta_secondary=None,
            ps_content=f"P.S. On {name}, your upgrade gift will be matched {match_ratio} by {m}.",
            include_match=True,
            ab_test_element="subject",
            max_words=350,
            notes="This is a society INVITATION, not a standard appeal. Treat it as exclusive.",
        ),
        AppealTouchpoint(
            sequence_num=2, touch_type=TouchType.EMAIL,
            timing_label="Launch Day 8am", timing_days=0,
            purpose="launch",
            subject_lines=[
                f"{{name}}: {name} is live — your society upgrade awaits",
                f"{{name}}, this is the day to step up — and your gift is matched",
                f"TODAY: Become a {{society_name}} member",
            ],
            preview_texts=["Today is the day.", "Your upgrade moment is here."],
            hook=f"Today is {name} — and today is the day you join the {{society_name}} at {inst}.",
            body_arc="Launch email with upgrade ask + match. Society benefits reminder. Specific upgrade amount.",
            cta_primary="Upgrade My Gift",
            cta_secondary=None,
            ps_content="P.S. Your matched gift today makes you a founding-year {society_name} member.",
            include_match=True,
            ab_test_element="subject",
            max_words=300,
            notes="Upgrade framing. Named society. Match prominently featured.",
        ),
        AppealTouchpoint(
            sequence_num=3, touch_type=TouchType.EMAIL,
            timing_label="Final Hours 5pm", timing_days=0,
            purpose="close",
            subject_lines=[
                f"{{name}}, a few hours to join the {{society_name}}",
                f"Last chance: your {match_ratio} match expires tonight",
            ],
            preview_texts=["The clock is ticking.", "Your matched upgrade expires at midnight."],
            hook="The match — and your invitation — expire at midnight.",
            body_arc="Urgency. Match expiry. Simple upgrade ask. One link.",
            cta_primary="Join Before Midnight",
            cta_secondary=None,
            ps_content=None,
            include_match=True,
            ab_test_element=None,
            max_words=200,
            notes="Final close for loyal mid-level. Match expiry drives urgency.",
        ),
    ]


def _build_mid_level_series(name, inst):
    return [
        AppealTouchpoint(
            sequence_num=1, touch_type=TouchType.EMAIL,
            timing_label="T-10 (impact briefing)", timing_days=-10,
            purpose="warm_up",
            subject_lines=[
                f"{{name}}, a personal update on your impact at {inst}",
                f"What your {{total_giving}} gift total has accomplished",
                f"An exclusive briefing for {inst}'s most committed donors",
            ],
            preview_texts=["A personal note for you.", "Your impact is significant."],
            hook=f"At your level of giving, you're among the most impactful supporters {inst} has.",
            body_arc="High-personalization impact briefing. Named fund update. Stewardship before ask. Upgrade preview.",
            cta_primary="Read the Full Impact Report",
            cta_secondary=None,
            ps_content=f"P.S. On {name}, you'll have an opportunity to increase your impact significantly.",
            include_match=False,
            ab_test_element="subject",
            max_words=400,
            notes="Mid-level: stewardship FIRST. They deserve impact detail before the next ask.",
        ),
        AppealTouchpoint(
            sequence_num=2, touch_type=TouchType.EMAIL,
            timing_label="Launch Day 8am", timing_days=0,
            purpose="launch",
            subject_lines=[
                f"{{name}}: your upgrade gift to {inst} unlocks something bigger",
                f"Today, your ${{upgrade_ask}} matters more than ever",
                f"Mid-level donors like you are transforming {inst} — this is how",
            ],
            preview_texts=["Your moment to go bigger.", "Upgrade your impact today."],
            hook=f"Today, a single upgrade gift from you could be the gift that unlocks a matching challenge.",
            body_arc="Specific upgrade ask. Named fund impact. Challenge unlock potential if applicable.",
            cta_primary="Increase My Impact",
            cta_secondary=None,
            ps_content="P.S. Your upgraded gift could unlock a donor challenge that benefits every student.",
            include_match=True,
            ab_test_element="subject",
            max_words=350,
            notes="Mid-level: specific upgrade ask is the play. Challenge unlock framing.",
        ),
        AppealTouchpoint(
            sequence_num=3, touch_type=TouchType.PHONE_PREP,
            timing_label="Day 2 (gift officer follow-up)", timing_days=1,
            purpose="momentum",
            subject_lines=["[Phone call prep brief — not an email]"],
            preview_texts=[""],
            hook="Gift officer personal call brief: donor's history, suggested upgrade, fund update, conversation opening.",
            body_arc="[GIFT OFFICER CALL BRIEF]: Reference their giving history, name the fund, suggest upgrade to {{upgrade_ask}}, mention match.",
            cta_primary="[Human call]",
            cta_secondary=None,
            ps_content=None,
            include_match=True,
            ab_test_element=None,
            max_words=200,
            notes="Mid-level donors deserve a personal call. Generate officer briefing, not an email.",
        ),
    ]


def _build_parent_series(name, inst):
    return [
        AppealTouchpoint(
            sequence_num=1, touch_type=TouchType.EMAIL,
            timing_label="T-7", timing_days=-7,
            purpose="warm_up",
            subject_lines=[
                f"{{name}}, your student's experience at {inst} depends on supporters like you",
                f"A personal note for {inst} families",
                f"What your family's support makes possible at {inst}",
            ],
            preview_texts=["Your family. Your legacy.", "A personal note for you."],
            hook=f"As a {inst} family, you see the difference our community makes every day.",
            body_arc="Student experience story. Direct connection between gift and experience. Family pride angle.",
            cta_primary="Support My Student",
            cta_secondary=None,
            ps_content=None,
            include_match=False,
            ab_test_element="subject",
            max_words=300,
            notes="Parent: student experience is the entire hook. Personal, emotional, specific.",
        ),
        AppealTouchpoint(
            sequence_num=2, touch_type=TouchType.EMAIL,
            timing_label="Launch Day 9am", timing_days=0,
            purpose="launch",
            subject_lines=[
                f"{{name}}: {name} is live — support {{student_name}}'s future today",
                f"Today is {name} — and your family is part of this story",
                f"{{parent_name}}: your gift to {inst} shapes everything",
            ],
            preview_texts=["Today is the day.", "Support your student today."],
            hook=f"Today is {name} — the day {inst} families rally together for the students they love.",
            body_arc="Launch. Student experience. Specific ask (upgrade if prior gift). Simple CTA.",
            cta_primary="Give for My Family",
            cta_secondary=None,
            ps_content="P.S. Your gift today supports every {inst} family — including yours.",
            include_match=False,
            ab_test_element="subject",
            max_words=300,
            notes="Parents are highly responsive. Keep it about the student.",
        ),
    ]


def _build_generic_series(name, inst):
    return [
        AppealTouchpoint(
            sequence_num=1, touch_type=TouchType.EMAIL,
            timing_label="Launch Day", timing_days=0,
            purpose="launch",
            subject_lines=[
                f"{name} is today — {{name}}, will you join us?",
                f"Today: {inst} needs your support",
                f"Your gift to {inst} matters today",
            ],
            preview_texts=["Today is the day.", "Join thousands of supporters."],
            hook=f"Today is {name} at {inst} — and your gift today makes a difference.",
            body_arc="Simple campaign email. Impact. Ask amount. CTA. No more than 300 words.",
            cta_primary="Give Today",
            cta_secondary=None,
            ps_content=None,
            include_match=False,
            ab_test_element="subject",
            max_words=300,
            notes="Generic: baseline email for unclassified segments.",
        ),
    ]


# ── A/B plan ──────────────────────────────────────────────────────────────────

def _build_ab_plan(touchpoints: list[AppealTouchpoint]) -> str:
    tests = [
        f"Touch {tp.sequence_num}: A/B test {tp.ab_test_element}"
        for tp in touchpoints
        if tp.ab_test_element
    ]
    if not tests:
        return "No A/B tests configured for this series."
    return " | ".join(tests) + ". Decision rule: use open rate at T+4h for subject test; click rate at T+24h for CTA/amount test."


# ── Prompt formatter ──────────────────────────────────────────────────────────

def format_series_for_prompt(series: AppealSeries) -> str:
    """Format appeal series for VCO system prompt injection."""
    lines = [
        f"Appeal Series: {series.campaign_name} — {series.segment.upper().replace('_', ' ')} Segment",
        f"Total Touches: {series.total_touches} | Channels: {', '.join(series.channel_mix)}",
        f"A/B Plan: {series.ab_test_plan}",
        f"Fatigue Guard: {series.fatigue_guard}",
        "",
        "TOUCHPOINT SEQUENCE:",
    ]
    for tp in series.touchpoints:
        lines.append(f"\n  [{tp.sequence_num}] {tp.touch_type.value.upper()} — {tp.timing_label} ({tp.purpose.upper()})")
        lines.append(f"      Hook: {tp.hook[:80]}..." if len(tp.hook) > 80 else f"      Hook: {tp.hook}")
        lines.append(f"      Body arc: {tp.body_arc}")
        lines.append(f"      CTA: \"{tp.cta_primary}\"")
        if tp.subject_lines:
            lines.append(f"      Subject options: {' | '.join(tp.subject_lines[:2])}")
        if tp.ps_content:
            lines.append(f"      P.S.: {tp.ps_content[:80]}...")
        lines.append(f"      Max {tp.max_words} words | A/B: {tp.ab_test_element or 'None'}")
    lines.append(f"\nOPTIMIZATION NOTES: {series.optimization_notes}")
    return "\n".join(lines)
