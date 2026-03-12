"""
VSO Impact Reporter
===================
Hyper-personalized impact content engine for the Virtual Stewardship Officer.

The #1 reason donors lapse is "I didn't feel like my gift made a difference."
This module solves that by building personalized impact narratives matched to:
  - Fund designation / restricted giving area
  - Donor archetype (what resonates with THEIR identity)
  - Giving tier (depth of detail scales with gift size)
  - Institutional priorities (link donor giving to institutional goals)
  - Named fund specifics (scholarship, endowment, annual, restricted)

Beats GiveCampus / Givezly by:
  - Named fund intelligence: not just "your gift to the annual fund" but specific
    scholarship recipient stories, research outcomes, lab equipment purchased
  - Archetype-tuned framing: Impact Investors get data; Legacy Builders get
    institutional narrative; Mission Zealots get urgency framing
  - Automated impact narrative generation (not template fill-in)
  - Upgrade-foreshadowing built into every impact story
  - Student/faculty story hooks seeded in prompt for Claude to develop
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional


# ─── IMPACT THEMES ──────────────────────────────────────────────────────────

# Maps fund keyword → impact theme configuration
FUND_THEME_MAP = {
    # Scholarship / student support
    "scholarship":      "scholarship",
    "financial aid":    "scholarship",
    "student support":  "scholarship",
    "student fund":     "scholarship",
    "need-based":       "scholarship",
    "merit":            "scholarship",
    # Research / innovation
    "research":         "research",
    "innovation":       "research",
    "lab":              "research",
    "science":          "research",
    "technology":       "research",
    "stem":             "research",
    # Faculty / academic excellence
    "faculty":          "faculty",
    "endowed chair":    "faculty",
    "professorship":    "faculty",
    "academic":         "faculty",
    "curriculum":       "faculty",
    # Athletics
    "athletic":         "athletics",
    "sports":           "athletics",
    "varsity":          "athletics",
    "stadium":          "athletics",
    # Arts / humanities
    "arts":             "arts",
    "music":            "arts",
    "theater":          "arts",
    "humanities":       "arts",
    "gallery":          "arts",
    # Sustainability
    "sustainability":   "sustainability",
    "environment":      "sustainability",
    "green":            "sustainability",
    "climate":          "sustainability",
    # Student life
    "student life":     "student_life",
    "wellness":         "student_life",
    "mental health":    "student_life",
    "housing":          "student_life",
    "career":           "student_life",
    # Annual fund / unrestricted
    "annual fund":      "annual_fund",
    "unrestricted":     "annual_fund",
    "greatest need":    "annual_fund",
    "general":          "annual_fund",
}


@dataclass
class ImpactTheme:
    theme_key:              str
    theme_name:             str
    data_point_template:    str     # Fill in with real numbers
    story_hook_template:    str     # Claude will develop this into a full story
    archetype_framing: dict         # Per-archetype framing instructions
    upgrade_bridge:         str     # Sentence that bridges to upgrade conversation
    named_fund_suffix:      str     # Appended when named fund is detected


IMPACT_THEMES: dict[str, ImpactTheme] = {
    "scholarship": ImpactTheme(
        theme_key="scholarship",
        theme_name="Student Scholarships & Financial Access",
        data_point_template="{gift_count} students supported by the {fund_name} in {year}, covering an average of ${per_student_amount:,} in demonstrated need",
        story_hook_template="A first-generation student from {hometown} is currently enrolled because of the {fund_name} — share their academic journey and the moment they learned they could attend",
        archetype_framing={
            "LEGACY_BUILDER":     "Frame as building an enduring pipeline of future leaders who will carry the institution's legacy forward",
            "COMMUNITY_CHAMPION": "Emphasize access and equity — this scholarship opens doors for students who would otherwise be excluded",
            "IMPACT_INVESTOR":    "Quantify: cost per student supported, retention rate of scholarship recipients vs. non-recipients, career outcomes",
            "LOYAL_ALUMNI":       "Connect to their own student experience — 'donors like you made my Greenfield experience possible for the next generation'",
            "MISSION_ZEALOT":     "Tie to institutional mission on access and excellence — this IS the mission in action",
            "SOCIAL_CONNECTOR":   "Share the student's social media or public profile (with permission) — make the beneficiary a real person",
            "PRAGMATIC_PARTNER":  "ROI framing: each scholarship dollar generates X in alumni lifetime value and institutional reputation",
            "FAITH_DRIVEN":       "Service and stewardship of opportunity — helping others achieve their God-given potential",
        },
        upgrade_bridge="Each additional dollar you commit at the next level adds another year of access for a student with demonstrated financial need.",
        named_fund_suffix=" — and because this is a named scholarship, the recipient knows exactly whose generosity made their education possible",
    ),
    "research": ImpactTheme(
        theme_key="research",
        theme_name="Research & Innovation",
        data_point_template="{publication_count} peer-reviewed publications from faculty supported by {fund_name} donors in the past 3 years, with {grant_leverage}x in external grants leveraged",
        story_hook_template="Professor {faculty_name}'s lab, supported in part by the {fund_name}, recently achieved {research_breakthrough} — describe the implications and the role private gifts played in making it possible",
        archetype_framing={
            "LEGACY_BUILDER":     "This research will outlast any single gift — name the breakthrough moments and the discovery pipeline",
            "COMMUNITY_CHAMPION": "Research that solves community problems: healthcare, education, environment, economic opportunity",
            "IMPACT_INVESTOR":    "Grant leverage ratio, tech transfer outcomes, startup spin-outs, IP filings — show the multiplier effect of research philanthropy",
            "LOYAL_ALUMNI":       "Institutional pride — 'Greenfield researchers are solving problems your industry cares about'",
            "MISSION_ZEALOT":     "Research as mission fulfillment — the institution exists to create new knowledge for the world",
            "SOCIAL_CONNECTOR":   "Profile the research team — the people and collaboration behind the discovery",
            "PRAGMATIC_PARTNER":  "Research pipeline = competitive differentiator for rankings and talent attraction",
            "FAITH_DRIVEN":       "Research as stewardship of intellect and knowledge for human flourishing",
        },
        upgrade_bridge="A leadership-level gift to the research fund would fully fund a graduate fellowship — the critical missing piece in this research pipeline.",
        named_fund_suffix=" — your named endowment is the reason this research program can plan long-term",
    ),
    "faculty": ImpactTheme(
        theme_key="faculty",
        theme_name="Faculty Excellence & Endowed Chairs",
        data_point_template="The {fund_name} has helped retain {retention_metric} top faculty and supported {student_count} students who took courses with endowed professors this year",
        story_hook_template="Professor {faculty_name}, supported by the {fund_name}, just {faculty_achievement} — share how private philanthropy made it possible to attract and retain this caliber of teacher-scholar",
        archetype_framing={
            "LEGACY_BUILDER":     "Endowed chairs are permanent — the faculty member will change, but the name on the chair and the impact on students is forever",
            "COMMUNITY_CHAMPION": "Great faculty transform community outcomes — their students go on to serve locally, nationally, globally",
            "IMPACT_INVESTOR":    "Faculty retention ROI: cost to replace a top professor vs. cost to retain; research grants attracted; student outcomes",
            "LOYAL_ALUMNI":       "Honor the professors who shaped them — 'give back to the kind of teacher you wish you had more of'",
            "MISSION_ZEALOT":     "Faculty are the institutional mission embodied — they ARE the reason Greenfield exists",
            "SOCIAL_CONNECTOR":   "Introduce the current chair holder personally — make the faculty member a real person in the donor's life",
            "PRAGMATIC_PARTNER":  "Faculty quality is the primary driver of rankings, which drive enrollment and reputation",
            "FAITH_DRIVEN":       "Teaching as vocation — honoring those who dedicate their lives to forming the next generation",
        },
        upgrade_bridge="An endowed chair fully funded at the $2M level creates a permanent legacy with your name attached — let's talk about what that looks like.",
        named_fund_suffix=" — your endowed position carries your name in every class roster, every published paper, and every memory of a Greenfield education",
    ),
    "athletics": ImpactTheme(
        theme_key="athletics",
        theme_name="Athletics & Student-Athlete Excellence",
        data_point_template="{athlete_count} student-athletes supported by the {fund_name} this year, maintaining a {gpa} team GPA — competitive excellence and academic achievement combined",
        story_hook_template="A student-athlete on scholarship through the {fund_name} recently {athlete_achievement} — share the balance of academic and athletic demands and how private support makes it possible",
        archetype_framing={
            "LEGACY_BUILDER":     "Athletic tradition is institutional identity — championships, championships, championships, remembered for generations",
            "COMMUNITY_CHAMPION": "Athletics unites the community — game day is the most visible moment of institutional pride and belonging",
            "IMPACT_INVESTOR":    "Athletic fund ROI: revenue from alumni engagement during athletics, brand value, enrollment correlation",
            "LOYAL_ALUMNI":       "The nostalgia play — their memories of game days, rivalries, and athletic culture are irreplaceable",
            "MISSION_ZEALOT":     "Whole-person development — athletics teaches discipline, teamwork, resilience alongside academic excellence",
            "SOCIAL_CONNECTOR":   "Exclusive donor access — private viewing areas, pre-game events, athlete meet-and-greets",
            "PRAGMATIC_PARTNER":  "Priority seating and priority access value clearly stated — tangible donor benefits",
            "FAITH_DRIVEN":       "Character development through sport — building young people of integrity and perseverance",
        },
        upgrade_bridge="Upgrading to the Varsity Society level unlocks access to exclusive donor events and priority seating across all sports.",
        named_fund_suffix=" — your named scholarship travels with every student-athlete who wears our colors",
    ),
    "arts": ImpactTheme(
        theme_key="arts",
        theme_name="Arts, Humanities & Creative Excellence",
        data_point_template="{performance_count} public performances, exhibitions, or publications from {fund_name}-supported programs this year, reaching {audience_count} community members",
        story_hook_template="A {art_discipline} student supported by the {fund_name} recently {arts_achievement} — describe the creative journey and how private philanthropy makes artistic development possible beyond tuition",
        archetype_framing={
            "LEGACY_BUILDER":     "Arts endure — performances, publications, and creative works that outlast any single year of giving",
            "COMMUNITY_CHAMPION": "Arts are the community's soul — public performances, exhibitions, and programming that enrich everyone's lives",
            "IMPACT_INVESTOR":    "Arts as economic driver: cultural tourism, creative economy, soft power of institutional reputation",
            "LOYAL_ALUMNI":       "Memories of concerts, performances, gallery openings — the cultural dimension of their Greenfield experience",
            "MISSION_ZEALOT":     "Human flourishing requires beauty and creativity — arts are not 'extra,' they are essential",
            "SOCIAL_CONNECTOR":   "VIP event access — opening night receptions, artist studio visits, curator talks",
            "PRAGMATIC_PARTNER":  "Differentiation strategy — arts excellence is a competitive advantage in enrollment and brand",
            "FAITH_DRIVEN":       "Arts as worship and wonder — creativity as divine gift to be nurtured and shared",
        },
        upgrade_bridge="A naming gift to the {fund_name} at the next level would endow a full scholarship for one performing arts student permanently.",
        named_fund_suffix=" — every program, every performance, every standing ovation carries the weight of your generosity",
    ),
    "sustainability": ImpactTheme(
        theme_key="sustainability",
        theme_name="Sustainability & Environmental Impact",
        data_point_template="{carbon_reduction}% carbon reduction achieved through initiatives supported by {fund_name} donors, saving {cost_savings:,} annually and training {student_count} sustainability leaders",
        story_hook_template="The {fund_name} funded the installation of {sustainability_project} — share the measurable environmental impact and the student researchers who designed and monitor the system",
        archetype_framing={
            "LEGACY_BUILDER":     "The institution's sustainability leadership will be remembered when sea levels change — gifts today shape that legacy",
            "COMMUNITY_CHAMPION": "Environmental action is community action — campus as a model for sustainable living that inspires the region",
            "IMPACT_INVESTOR":    "Measurable outcomes: carbon offset, energy cost savings, student researcher training pipeline",
            "LOYAL_ALUMNI":       "Pride in an institution that leads on values they care about — 'my alma mater walks the talk'",
            "MISSION_ZEALOT":     "Environmental stewardship as institutional responsibility and moral imperative",
            "SOCIAL_CONNECTOR":   "Invitation to sustainability leadership events and donor recognition on campus installations",
            "PRAGMATIC_PARTNER":  "Cost savings, efficiency gains, competitive ranking advantage, student recruitment ROI",
            "FAITH_DRIVEN":       "Stewardship of creation — caring for the earth as sacred responsibility",
        },
        upgrade_bridge="A leadership gift to the sustainability fund would fully name the new solar installation and reduce campus carbon footprint by an additional 15%.",
        named_fund_suffix=" — your investment in campus sustainability will be measured in tons of carbon prevented and generations of environmental leaders trained",
    ),
    "student_life": ImpactTheme(
        theme_key="student_life",
        theme_name="Student Wellness, Career & Campus Life",
        data_point_template="{students_served} students accessed {fund_name}-supported services this year; students who used wellness support graduated at {graduation_lift}% higher rates",
        story_hook_template="A student who was struggling with {challenge} found critical support through the {fund_name} — share how access to counseling, career coaching, or emergency funds changed the trajectory of their education",
        archetype_framing={
            "LEGACY_BUILDER":     "Healthy, supported students become successful, loyal alumni who give back — this is the pipeline investment",
            "COMMUNITY_CHAMPION": "Equity of experience — every student deserves access to the support they need to thrive, not just those who can afford it",
            "IMPACT_INVESTOR":    "Graduation rate lift, career placement outcomes, alumni giving correlation for students who received support",
            "LOYAL_ALUMNI":       "Pay it forward — someone invested in their wellbeing; now they have the chance to do the same",
            "MISSION_ZEALOT":     "Whole-person education — intellectual, emotional, physical, career development together",
            "SOCIAL_CONNECTOR":   "Student stories with permission — real faces and journeys of students who benefited",
            "PRAGMATIC_PARTNER":  "Retention economics: cost of losing a student vs. cost of support services; completion rate ROI",
            "FAITH_DRIVEN":       "Care for the whole person — student wellbeing as a sacred institutional calling",
        },
        upgrade_bridge="An endowed wellness fund at the leadership level would permanently guarantee these services, removing annual fundraising pressure entirely.",
        named_fund_suffix=" — students in crisis will find your named fund as the lifeline they needed when they had nowhere else to turn",
    ),
    "annual_fund": ImpactTheme(
        theme_key="annual_fund",
        theme_name="Annual Fund & Unrestricted Support",
        data_point_template="{donor_count} donors to the {fund_name} this year made possible: {programs_funded} programs, ${unrestricted_deployed:,} deployed to highest-priority needs",
        story_hook_template="Because annual fund donors like {donor_first_name} give to the greatest need, the institution was able to {annual_fund_achievement} last year — a decision that required flexible funding no grant could have provided",
        archetype_framing={
            "LEGACY_BUILDER":     "The annual fund is the foundation under everything — every program, every scholarship, every initiative depends on this base",
            "COMMUNITY_CHAMPION": "Every dollar is pooled with hundreds of community members — collective impact that no single donor could achieve alone",
            "IMPACT_INVESTOR":    "Unrestricted dollars have the highest institutional ROI — they go exactly where the need is greatest",
            "LOYAL_ALUMNI":       "Giving to the annual fund IS loyalty — it's the simplest, most direct expression of belonging and commitment",
            "MISSION_ZEALOT":     "The mission requires operating support — no grant funds this work, only alumni who believe in it",
            "SOCIAL_CONNECTOR":   "Participation rate matters — join the X% of classmates who made their gift this year",
            "PRAGMATIC_PARTNER":  "Cost per dollar raised for annual fund is the lowest of any fundraising program — maximum efficiency",
            "FAITH_DRIVEN":       "Faithful giving — consistent annual support as a spiritual discipline and commitment to something beyond yourself",
        },
        upgrade_bridge="Moving from the Annual Fund to the {next_society} level would unlock named recognition and admission to exclusive donor briefings.",
        named_fund_suffix=" — unrestricted giving is the highest expression of trust in institutional leadership",
    ),
}


# ─── IMPACT PROFILE ──────────────────────────────────────────────────────────

@dataclass
class ImpactProfile:
    primary_theme:          ImpactTheme
    secondary_themes:       list[ImpactTheme]
    archetype:              str
    archetype_framing:      str     # The specific framing instruction for this archetype
    story_hook:             str     # Story hook for Claude to develop
    data_point_template:    str     # Fill-in data point
    upgrade_bridge:         str     # Sentence to bridge toward upgrade
    named_fund:             bool    # Whether this is a named/restricted fund
    fund_name:              str
    personalization_hooks:  list[str]   # Additional personalization instructions
    tier_depth:             str         # "light" | "standard" | "deep" | "immersive"


# ─── FUND MATCHER ────────────────────────────────────────────────────────────

def _match_fund_to_theme(fund_designation: str, interests: list[str]) -> str:
    """Match fund designation and interests to best impact theme."""
    text = (fund_designation + " " + " ".join(interests)).lower()
    for keyword, theme_key in FUND_THEME_MAP.items():
        if keyword in text:
            return theme_key
    return "annual_fund"


def _tier_depth(total_giving: float, last_gift: float) -> str:
    if last_gift >= 25_000 or total_giving >= 100_000:
        return "immersive"
    if last_gift >= 5_000 or total_giving >= 25_000:
        return "deep"
    if last_gift >= 500 or total_giving >= 2_500:
        return "standard"
    return "light"


# ─── MAIN BUILDER ────────────────────────────────────────────────────────────

def build_impact_profile(donor: dict) -> ImpactProfile:
    """
    Build a hyper-personalized impact profile for this donor.
    Drives the VSO's impact reporting, stewardship messaging, and renewal content.
    """
    fund_designation = donor.get("fundDesignation", "") or donor.get("giftDesignation", "") or "annual fund"
    interests        = donor.get("interests", []) or []
    archetype        = donor.get("archetype", "LOYAL_ALUMNI")
    first_name       = donor.get("firstName", "Friend")
    total_giving     = donor.get("totalGiving", 0)
    last_gift        = donor.get("lastGiftAmount", 0) or (donor.get("lastGiftCents", 0) / 100)
    is_named         = any(word in fund_designation.lower() for word in ["named", "endowed", "family", "memorial", "honor"])
    class_year       = donor.get("classYear", "")
    streak           = donor.get("givingStreak", 0)

    primary_theme_key = _match_fund_to_theme(fund_designation, interests)
    primary_theme = IMPACT_THEMES.get(primary_theme_key, IMPACT_THEMES["annual_fund"])

    # Secondary themes from interests
    secondary_themes = []
    for interest in interests[:2]:
        key = _match_fund_to_theme(interest, [])
        if key != primary_theme_key:
            secondary_themes.append(IMPACT_THEMES.get(key, IMPACT_THEMES["annual_fund"]))

    archetype_framing = primary_theme.archetype_framing.get(archetype,
        "Connect this impact story to the donor's core motivation and identity.")

    tier_depth = _tier_depth(total_giving, last_gift)

    # Build personalization hooks
    personalization_hooks = []
    if class_year:
        personalization_hooks.append(f"Reference their Class of {class_year} connection — peers and professors from their era")
    if streak >= 5:
        personalization_hooks.append(f"Honor their {streak}-year streak — they have been part of this impact story for {streak} consecutive years")
    if is_named:
        personalization_hooks.append(f"This is a NAMED FUND — students/beneficiaries know this donor's name. Mention that personal connection explicitly.")
        personalization_hooks.append(primary_theme.named_fund_suffix)
    if total_giving >= 10_000:
        personalization_hooks.append(f"Cumulative ${total_giving:,.0f} given — reference the compound impact over time, not just this year's gift")
    if len(donor.get("interests", [])) > 0:
        personalization_hooks.append(f"Align impact story to stated interests: {', '.join(interests[:3])}")

    return ImpactProfile(
        primary_theme=primary_theme,
        secondary_themes=secondary_themes,
        archetype=archetype,
        archetype_framing=archetype_framing,
        story_hook=primary_theme.story_hook_template,
        data_point_template=primary_theme.data_point_template,
        upgrade_bridge=primary_theme.upgrade_bridge,
        named_fund=is_named,
        fund_name=fund_designation or "Greenfield Annual Fund",
        personalization_hooks=personalization_hooks,
        tier_depth=tier_depth,
    )


# ─── PROMPT FORMATTER ────────────────────────────────────────────────────────

def format_impact_for_prompt(profile: ImpactProfile) -> str:
    """Format impact profile for injection into VSO system prompt."""
    depth_labels = {
        "light":     "brief (1 impact stat + 1 sentence story mention)",
        "standard":  "standard (1 data point + 2-3 sentence student story)",
        "deep":      "in-depth (2 data points + full paragraph personal story)",
        "immersive": "full stewardship report (comprehensive impact narrative with multiple data points and human stories)",
    }
    lines = [
        f"Fund: {profile.fund_name} | Theme: {profile.primary_theme.theme_name}",
        f"Impact Depth: {depth_labels.get(profile.tier_depth, profile.tier_depth)}",
        f"Named Fund: {'YES — donor name is on this fund; beneficiaries know them' if profile.named_fund else 'No'}",
        "",
        f"ARCHETYPE FRAMING ({profile.archetype}):",
        f"  {profile.archetype_framing}",
        "",
        f"STORY HOOK (develop this into the impact narrative):",
        f"  {profile.story_hook}",
        "",
        f"DATA POINT TEMPLATE:",
        f"  {profile.data_point_template}",
        "",
        f"UPGRADE BRIDGE:",
        f"  {profile.upgrade_bridge}",
    ]
    if profile.personalization_hooks:
        lines.append("\nPERSONALIZATION DIRECTIVES:")
        for hook in profile.personalization_hooks:
            lines.append(f"  • {hook}")
    if profile.secondary_themes:
        lines.append(f"\nSECONDARY IMPACT AREAS (weave in if space permits):")
        for t in profile.secondary_themes:
            lines.append(f"  • {t.theme_name}")
    return "\n".join(lines)
