"""
VEO Life Event Detector
=======================
Scans donor conversation history, signals, and profile data to detect
life events that should immediately change engagement strategy.

In production, this would also consume:
  - LinkedIn API (job changes, promotions)
  - Google News API (company IPOs, funding rounds, awards)
  - Public records APIs (home sales, marriages, obituaries)
  - Email engagement signals (sudden drop in opens = life disruption)

For now: pattern-match conversation history + profile attributes.
"""

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

# ─── EVENT TYPES ─────────────────────────────────────────────────────────────

class LifeEventType(str, Enum):
    JOB_CHANGE       = "job_change"
    PROMOTION        = "promotion"
    RETIREMENT       = "retirement"
    COMPANY_IPO      = "company_ipo"
    COMPANY_FUNDING  = "company_funding"
    HOME_SALE        = "home_sale"
    BEREAVEMENT      = "bereavement"
    DIVORCE          = "divorce"
    MARRIAGE         = "marriage"
    CHILD_ENROLLED   = "child_enrolled"
    REUNION_YEAR     = "reunion_year"
    GIVING_MILESTONE = "giving_milestone"
    DISTRESS         = "distress"       # generic distress signal (illness, crisis)
    OPT_OUT_REQUEST  = "opt_out_request"


@dataclass
class LifeEvent:
    event_type: LifeEventType
    confidence: float               # 0.0–1.0
    source: str                     # "conversation", "profile", "external_signal"
    detail: str                     # human-readable description
    engagement_implication: str     # what to do
    urgency: str                    # "immediate", "high", "medium", "low"
    escalate_to_human: bool = False
    pause_outreach_days: int = 0    # 0 = no pause


# ─── DETECTION PATTERNS ──────────────────────────────────────────────────────

# Bereavement signals
_BEREAVEMENT_PATTERNS = [
    r"\bpassed\b", r"\bpassing\b", r"\bpassed away\b", r"\blost (my|my wife|my husband|my father|my mother|my son|my daughter|my brother|my sister)\b",
    r"\bin memory of\b", r"\bfuneral\b", r"\bgrieving\b", r"\bgrief\b",
    r"\bwidow\b", r"\bwidower\b", r"\bdeceased\b", r"\bpassed last\b",
    r"\bnot with us\b", r"\bno longer with us\b", r"\breadjusting without\b",
]

# Divorce / relationship distress
_DIVORCE_PATTERNS = [
    r"\bdivorce\b", r"\bseparation\b", r"\bseparating\b", r"\bsplit\s?up\b",
    r"\bex[- ]wife\b", r"\bex[- ]husband\b", r"\bending (my|our) marriage\b",
    r"\bcustody\b", r"\balimony\b",
]

# Financial distress / job loss
_DISTRESS_PATTERNS = [
    r"\blaid off\b", r"\bjob loss\b", r"\bunemployed\b", r"\bout of work\b",
    r"\bmedical bills\b", r"\bhealth (crisis|scare|issues|problem)\b",
    r"\bfinancial (difficulty|difficulties|hardship|trouble|crisis)\b",
    r"\bthings are (difficult|hard|tough|rough|not good)\b",
    r"\bgoing through a (lot|difficult|hard|tough)\b",
    r"\bplease stop\b", r"\bstop (emailing|contacting|sending)\b",
    r"\bdon't (email|contact|reach out|send)\b", r"\bnot a good time\b",
    r"\bneed (some|a little) (space|time)\b",
    r"\bcan't (give|donate|contribute) right now\b",
]

# Opt-out
_OPT_OUT_PATTERNS = [
    r"\bplease (stop|remove|unsubscribe|opt.?out)\b",
    r"\bstop (emailing|contacting|messaging)\b",
    r"\bdon't (want|wish) to (hear|receive|get)\b",
    r"\bremove me\b", r"\bunsubscribe\b", r"\bno (more|longer) (emails|messages|contact)\b",
    r"\bdo not (email|contact|send)\b",
    r"\bleave me alone\b",
]

# Retirement signals
_RETIREMENT_PATTERNS = [
    r"\bretir(ed|ing|ement|e)\b", r"\bstopped working\b", r"\bleaving (work|my job|the company)\b",
    r"\bmy last day\b", r"\bwrap(ping)? up my career\b",
]

# Estate / planned giving signals
_ESTATE_PATTERNS = [
    r"\bestate plan(ning|s)?\b", r"\bwill and testament\b", r"\bbequest\b",
    r"\bheritage\b.*\bgive\b", r"\bleave.*greenfield\b", r"\blegacy gift\b",
    r"\btrust(s|ee)?\b.*\bgivng\b", r"\bcharitable remainder\b",
    r"\blong[- ]haul\b.*\bgreenfield\b", r"\btake care of greenfield\b",
    r"\bmake sure greenfield\b",
]

# Promotion / career win signals
_PROMOTION_PATTERNS = [
    r"\bpromot(ed|ion)\b", r"\bnew (role|position|job|title)\b",
    r"\bnamed (ceo|cfo|coo|cto|vp|president|director|managing director|partner|principal)\b",
    r"\bjust joined\b", r"\bstarting at\b", r"\bnew chapter\b.*\bcareer\b",
    r"\bjust (became|got|was named)\b",
]

# Wealth event signals
_WEALTH_PATTERNS = [
    r"\bIPO\b", r"\bwent public\b", r"\bseries [abcde]\b", r"\bfunding round\b",
    r"\bacquisition\b", r"\bacquired\b", r"\bsold (my|our|the) company\b",
    r"\bbig (exit|win|deal)\b", r"\bbonus\b", r"\bwindfall\b",
]

# Marriage
_MARRIAGE_PATTERNS = [
    r"\bgetting married\b", r"\bwedding\b", r"\bengaged\b", r"\bjust married\b",
    r"\bnewlywed\b", r"\bmy (husband|wife)\b.*\bnew\b",
]

# Child enrolled at institution
_CHILD_ENROLLED_PATTERNS = [
    r"\bmy (son|daughter|child|kid)\b.*\b(at greenfield|enrolled|applying|accepted|starting)\b",
    r"\bstarting at greenfield\b", r"\bnow a (greenfield|student)\b",
]


def _scan_text(text: str, patterns: list[str]) -> bool:
    text_lower = text.lower()
    return any(re.search(p, text_lower) for p in patterns)


def _scan_conversation(conversation_history: list[dict], patterns: list[str]) -> tuple[bool, str]:
    """Returns (found, matching_text)"""
    for msg in conversation_history:
        if msg.get("role") == "donor":
            content = msg.get("content", "")
            if _scan_text(content, patterns):
                return True, content[:200]
    return False, ""


# ─── MAIN DETECTOR ───────────────────────────────────────────────────────────

def detect_life_events(donor: dict) -> list[LifeEvent]:
    """
    Analyze donor profile + conversation history to detect life events.
    Returns a list of LifeEvents sorted by urgency.
    """
    events: list[LifeEvent] = []
    history = donor.get("conversationHistory", [])
    streak = donor.get("givingStreak", 0)
    total = donor.get("totalGiving", 0)
    class_year = donor.get("classYear")

    # ── Opt-out (highest priority, check first) ────────────────────────────
    found, text = _scan_conversation(history, _OPT_OUT_PATTERNS)
    if found or donor.get("sentiment") == "negative":
        # Check if opt-out is explicit or just distress
        if found:
            events.append(LifeEvent(
                event_type=LifeEventType.OPT_OUT_REQUEST,
                confidence=0.97,
                source="conversation",
                detail=f"Donor explicitly requested to stop contact: \"{text[:100]}\"",
                engagement_implication="Immediately acknowledge opt-out. Remove from all AI outreach. Log in CRM.",
                urgency="immediate",
                escalate_to_human=False,
                pause_outreach_days=365,
            ))

    # ── Bereavement ────────────────────────────────────────────────────────
    found, text = _scan_conversation(history, _BEREAVEMENT_PATTERNS)
    if found:
        events.append(LifeEvent(
            event_type=LifeEventType.BEREAVEMENT,
            confidence=0.93,
            source="conversation",
            detail=f"Donor mentioned a loss or bereavement: \"{text[:100]}\"",
            engagement_implication=(
                "Escalate to human gift officer immediately. Send brief, warm sympathy acknowledgment. "
                "Pause all solicitation for 90 days minimum. Flag high bequest propensity if applicable."
            ),
            urgency="immediate",
            escalate_to_human=True,
            pause_outreach_days=90,
        ))

    # ── Divorce / relationship distress ────────────────────────────────────
    found, text = _scan_conversation(history, _DIVORCE_PATTERNS)
    if found:
        events.append(LifeEvent(
            event_type=LifeEventType.DIVORCE,
            confidence=0.91,
            source="conversation",
            detail=f"Donor indicated divorce or separation: \"{text[:100]}\"",
            engagement_implication=(
                "Escalate to human gift officer. Pause all solicitation for 60 days. "
                "Update capacity estimates — assets may be in flux. Handle with extreme sensitivity."
            ),
            urgency="immediate",
            escalate_to_human=True,
            pause_outreach_days=60,
        ))

    # ── General distress ───────────────────────────────────────────────────
    found, text = _scan_conversation(history, _DISTRESS_PATTERNS)
    if found and not any(e.event_type in (LifeEventType.OPT_OUT_REQUEST, LifeEventType.DIVORCE) for e in events):
        events.append(LifeEvent(
            event_type=LifeEventType.DISTRESS,
            confidence=0.82,
            source="conversation",
            detail=f"Donor signaled distress or difficult time: \"{text[:100]}\"",
            engagement_implication=(
                "Acknowledge empathetically. Pause solicitation for 30 days. "
                "Offer human contact if appropriate. Do not make any ask."
            ),
            urgency="high",
            escalate_to_human=True,
            pause_outreach_days=30,
        ))

    # ── Estate planning ────────────────────────────────────────────────────
    found, text = _scan_conversation(history, _ESTATE_PATTERNS)
    if found:
        events.append(LifeEvent(
            event_type=LifeEventType.BEREAVEMENT,   # reuse closest type; in production add ESTATE_PLANNING
            confidence=0.96,
            source="conversation",
            detail=f"Donor mentioned estate planning or legacy gift: \"{text[:100]}\"",
            engagement_implication=(
                "ESCALATE IMMEDIATELY to Planned Giving Officer. This is a major gift opportunity. "
                "Do not respond via AI. Human meeting required within 72 hours."
            ),
            urgency="immediate",
            escalate_to_human=True,
            pause_outreach_days=0,
        ))

    # ── Promotion / career win ──────────────────────────────────────────────
    found, text = _scan_conversation(history, _PROMOTION_PATTERNS)
    if not found:
        # Check interests/title fields for signals
        title = donor.get("title", "").lower()
        for kw in ["managing director", "partner", "ceo", "cfo", "president", "vp "]:
            if kw in title:
                found = True
                text = f"Title indicates senior position: {donor.get('title', '')}"
                break
    if found:
        events.append(LifeEvent(
            event_type=LifeEventType.PROMOTION,
            confidence=0.78,
            source="conversation",
            detail=f"Career advancement detected: \"{text[:100]}\"",
            engagement_implication=(
                "Acknowledge the achievement authentically. This is a capacity upgrade signal. "
                "Review ask amount — may warrant 2–3x upgrade. Lead with congratulations, not ask."
            ),
            urgency="medium",
            escalate_to_human=False,
            pause_outreach_days=0,
        ))

    # ── Retirement ─────────────────────────────────────────────────────────
    found, text = _scan_conversation(history, _RETIREMENT_PATTERNS)
    if not found and donor.get("classYear"):
        # Proxy: class year ≤ 1975 + high capacity = retirement likely
        try:
            if int(donor["classYear"]) <= 1975 and total > 100000_00:
                found = True
                text = f"Class of {donor['classYear']} + significant giving history suggests retirement age"
        except (ValueError, TypeError):
            pass
    if found:
        events.append(LifeEvent(
            event_type=LifeEventType.RETIREMENT,
            confidence=0.72,
            source="profile",
            detail=text[:200],
            engagement_implication=(
                "Retirement is a prime planned giving moment. Introduce legacy conversation naturally. "
                "Frame giving as 'final chapter of impact.' Connect to estate planning resources."
            ),
            urgency="medium",
            escalate_to_human=donor.get("bequeathScore", 0) > 70,
            pause_outreach_days=0,
        ))

    # ── Wealth event (IPO, funding, acquisition) ───────────────────────────
    found, text = _scan_conversation(history, _WEALTH_PATTERNS)
    if found:
        events.append(LifeEvent(
            event_type=LifeEventType.COMPANY_IPO,
            confidence=0.85,
            source="conversation",
            detail=f"Wealth event detected: \"{text[:100]}\"",
            engagement_implication=(
                "MAJOR CAPACITY SIGNAL. Escalate to major gifts team for manual review. "
                "Do not make an ask via AI — this requires a personal conversation. "
                "Update capacity estimate significantly."
            ),
            urgency="high",
            escalate_to_human=True,
            pause_outreach_days=0,
        ))

    # ── Reunion year ───────────────────────────────────────────────────────
    if class_year:
        try:
            grad_year = int(class_year)
            current_year = 2026
            years_since = current_year - grad_year
            if years_since % 5 == 0 and 5 <= years_since <= 60:
                events.append(LifeEvent(
                    event_type=LifeEventType.REUNION_YEAR,
                    confidence=1.0,
                    source="profile",
                    detail=f"Class of {class_year} — {years_since}th reunion year (2026)",
                    engagement_implication=(
                        f"This is a {years_since}-year reunion — giving peaks during reunion years. "
                        "Begin 18-month reunion giving ramp. Class challenge and peer comparison are "
                        "highly effective. Reconnect with class agents."
                    ),
                    urgency="medium",
                    escalate_to_human=False,
                    pause_outreach_days=0,
                ))
        except (ValueError, TypeError):
            pass

    # ── Giving milestones ──────────────────────────────────────────────────
    milestone_streaks = [5, 10, 15, 20, 25, 30, 40, 50]
    if streak in milestone_streaks:
        events.append(LifeEvent(
            event_type=LifeEventType.GIVING_MILESTONE,
            confidence=1.0,
            source="profile",
            detail=f"Donor has reached a {streak}-year consecutive giving streak",
            engagement_implication=(
                f"Recognize the {streak}-year milestone prominently. This is identity-reinforcing. "
                "Strong opportunity for upgrade ask framed around the milestone. "
                "Consider named recognition or exclusive invitation."
            ),
            urgency="medium",
            escalate_to_human=False,
            pause_outreach_days=0,
        ))

    # Sort: immediate first, then high, medium, low
    urgency_order = {"immediate": 0, "high": 1, "medium": 2, "low": 3}
    events.sort(key=lambda e: urgency_order.get(e.urgency, 99))

    return events


def format_events_for_prompt(events: list[LifeEvent]) -> str:
    """Format detected life events for injection into VEO system prompt."""
    if not events:
        return "No life events detected."

    lines = []
    for e in events:
        lines.append(
            f"  [{e.urgency.upper()}] {e.event_type.value} (confidence: {e.confidence:.0%})\n"
            f"    Detail: {e.detail}\n"
            f"    Action: {e.engagement_implication}\n"
            f"    Escalate: {'YES — DO NOT proceed via AI' if e.escalate_to_human else 'No'}"
            + (f"\n    Pause outreach: {e.pause_outreach_days} days" if e.pause_outreach_days else "")
        )
    return "\n\n".join(lines)
