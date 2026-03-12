"""
VPGO Gift Vehicle Advisor
=========================
Matches donors to the optimal planned giving vehicle(s) based on:
  - Age / estimated age from class year
  - Asset type (cash, securities, real estate, IRA, life insurance)
  - Income needs (do they need income from the gift?)
  - Tax situation (capital gains, estate tax concern)
  - Gift size expectations
  - Giving motivation (estate reduction, income, simplicity, impact)

Vehicles covered:
  1. BEQUEST              — Will / trust designation (revocable)
  2. CGA                  — Charitable Gift Annuity (irrevocable, fixed income)
  3. CRUT                 — Charitable Remainder Unitrust (variable income)
  4. CRAT                 — Charitable Remainder Annuity Trust (fixed income)
  5. CLT                  — Charitable Lead Trust (family wealth transfer)
  6. DAF                  — Donor Advised Fund (flexibility + bunching)
  7. IRA_ROLLOVER         — Qualified Charitable Distribution (age 70.5+)
  8. APPRECIATED_STOCK    — Gifts of appreciated securities
  9. RETAINED_LIFE_ESTATE — Real property with retained right to occupy
 10. LIFE_INSURANCE        — Premium payment or existing policy assignment
 11. POOLED_INCOME_FUND   — Pooled fund for smaller gifts with income

DISCLAIMER: All vehicle information is educational. Donors must consult
independent legal and financial advisors. Not legal or tax advice.

ACGA RATES (effective July 1, 2024 — verify current rates at acga.org):
Age 60: 5.3% | Age 65: 5.7% | Age 70: 6.3% | Age 75: 7.0%
Age 80: 7.8% | Age 85: 8.5% | Age 90+: 9.0%
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ─── GIFT VEHICLES ───────────────────────────────────────────────────────────

class GiftVehicle(str, Enum):
    BEQUEST              = "bequest"
    CGA                  = "cga"                  # Charitable Gift Annuity
    CRUT                 = "crut"                  # Charitable Remainder Unitrust
    CRAT                 = "crat"                  # Charitable Remainder Annuity Trust
    CLT                  = "clt"                   # Charitable Lead Trust
    DAF                  = "daf"                   # Donor Advised Fund
    IRA_ROLLOVER         = "ira_rollover"           # QCD / IRA Charitable Rollover
    APPRECIATED_STOCK    = "appreciated_stock"
    RETAINED_LIFE_ESTATE = "retained_life_estate"
    LIFE_INSURANCE       = "life_insurance"
    POOLED_INCOME_FUND   = "pooled_income_fund"


# ─── VEHICLE DEFINITIONS ─────────────────────────────────────────────────────

@dataclass
class VehicleDefinition:
    vehicle:            GiftVehicle
    name:               str
    plain_english:      str             # One-sentence description
    best_for_age_min:   int             # Minimum recommended age
    best_for_age_max:   int             # Maximum recommended age (99 = no max)
    income_producing:   bool            # Does donor receive income?
    revocable:          bool            # Can donor change their mind?
    best_assets:        list[str]       # Ideal asset types
    tax_benefits:       list[str]       # Key tax advantages
    min_gift:           int             # Minimum gift size (dollars)
    complexity:         str             # "low" | "medium" | "high"
    ideal_motivation:   list[str]       # Donor motivations this serves
    donor_profile:      str             # One-sentence ideal donor description
    key_objection:      str             # Most common objection
    objection_response: str             # How to handle it
    disclaimer:         str             # Required disclaimer


VEHICLE_DEFINITIONS: dict[GiftVehicle, VehicleDefinition] = {

    GiftVehicle.BEQUEST: VehicleDefinition(
        vehicle=GiftVehicle.BEQUEST,
        name="Bequest (Will / Trust Designation)",
        plain_english="A gift to the institution included in the donor's will or living trust.",
        best_for_age_min=45,
        best_for_age_max=99,
        income_producing=False,
        revocable=True,
        best_assets=["cash", "securities", "real estate", "any asset", "residual estate"],
        tax_benefits=["Reduces taxable estate", "No income tax on unrealized gains at death", "Charitable estate tax deduction"],
        min_gift=0,
        complexity="low",
        ideal_motivation=["legacy", "simplicity", "maintains control", "flexibility", "low commitment"],
        donor_profile="Any donor who values leaving a legacy but wants to maintain control during their lifetime.",
        key_objection="I'm not sure what my estate will look like when I die.",
        objection_response="That's exactly why a bequest is so flexible — it can be a specific dollar amount, a percentage of your estate, or whatever remains after other obligations. You can change it at any time.",
        disclaimer="A bequest is a revocable gift intention and does not represent a binding legal commitment until the estate is settled. Donors should consult with an estate planning attorney.",
    ),

    GiftVehicle.CGA: VehicleDefinition(
        vehicle=GiftVehicle.CGA,
        name="Charitable Gift Annuity (CGA)",
        plain_english="A simple agreement where the donor gives assets to the institution in exchange for fixed income payments for life, plus a charitable deduction.",
        best_for_age_min=65,
        best_for_age_max=99,
        income_producing=True,
        revocable=False,
        best_assets=["cash", "appreciated securities", "mutual funds"],
        tax_benefits=[
            "Immediate partial charitable income tax deduction",
            "Avoid capital gains tax on appreciated assets (spread over life expectancy)",
            "Portion of annuity income is tax-free return of principal",
            "Removes asset from taxable estate",
        ],
        min_gift=10_000,
        complexity="low",
        ideal_motivation=["income needs", "simplicity", "charitable deduction", "asset simplification", "capital gains avoidance"],
        donor_profile="A donor age 65+ with cash or appreciated securities who wants fixed, guaranteed income for life and values simplicity.",
        key_objection="I need my savings for retirement income.",
        objection_response="A CGA actually solves that — you convert assets into guaranteed income for life, get an immediate tax deduction, and make a lasting impact. At age [X], the current ACGA rate is [RATE]% — often higher than CD rates.",
        disclaimer="Charitable gift annuities are irrevocable. The CGA rate is based on age at the time of the gift. ACGA rates effective July 2024; verify current rates at acga.org. CGAs are regulated at the state level — please consult your financial advisor and our planned giving office.",
    ),

    GiftVehicle.CRUT: VehicleDefinition(
        vehicle=GiftVehicle.CRUT,
        name="Charitable Remainder Unitrust (CRUT)",
        plain_english="A trust that pays the donor (and spouse) a variable annual percentage of trust assets for life, with the remainder going to the institution.",
        best_for_age_min=55,
        best_for_age_max=85,
        income_producing=True,
        revocable=False,
        best_assets=["highly appreciated stock", "real estate", "business interests", "large securities portfolios"],
        tax_benefits=[
            "Immediate partial charitable income tax deduction",
            "Avoid immediate capital gains on donated appreciated assets",
            "Estate tax reduction",
            "Income stream for life",
        ],
        min_gift=100_000,
        complexity="high",
        ideal_motivation=["capital gains avoidance", "income needs", "asset diversification", "estate planning", "legacy"],
        donor_profile="A donor age 55–80 with highly appreciated assets (low-basis stock, real estate) who wants income for life and to avoid capital gains tax.",
        key_objection="I don't want to lose control of my assets.",
        objection_response="With a CRUT, you retain a lifetime income stream from those assets. It's a way to convert illiquid or low-yielding appreciated assets into a diversified, income-producing portfolio — and make a major legacy gift in the process.",
        disclaimer="Charitable remainder trusts are irrevocable. Tax benefits depend on individual circumstances and trust terms. Donors must consult with independent legal and tax advisors before establishing a CRT.",
    ),

    GiftVehicle.CRAT: VehicleDefinition(
        vehicle=GiftVehicle.CRAT,
        name="Charitable Remainder Annuity Trust (CRAT)",
        plain_english="A trust that pays the donor a fixed dollar amount annually for life, with the remainder going to the institution.",
        best_for_age_min=65,
        best_for_age_max=99,
        income_producing=True,
        revocable=False,
        best_assets=["cash", "stable securities", "bonds"],
        tax_benefits=["Immediate partial charitable deduction", "Estate tax reduction", "Fixed predictable income", "Capital gains deferral"],
        min_gift=100_000,
        complexity="high",
        ideal_motivation=["predictability", "income security", "simplicity over CRUT", "estate planning"],
        donor_profile="A donor who wants guaranteed fixed income (unlike the variable CRUT) and prioritizes income certainty over potential growth.",
        key_objection="The variable income of a CRUT makes me uncomfortable.",
        objection_response="Then a CRAT is designed for you — your annual payment is fixed, guaranteed, and never varies regardless of market performance.",
        disclaimer="CRATs are irrevocable. Payout rates, deduction amounts, and suitability depend on individual circumstances. Consult independent legal and tax advisors.",
    ),

    GiftVehicle.CLT: VehicleDefinition(
        vehicle=GiftVehicle.CLT,
        name="Charitable Lead Trust (CLT)",
        plain_english="A trust that pays the institution annually for a set term, with the remaining assets passing to the donor's family — often with significant estate and gift tax savings.",
        best_for_age_min=45,
        best_for_age_max=80,
        income_producing=False,  # Income goes to charity, not donor
        revocable=False,
        best_assets=["large securities portfolios", "business interests", "real estate"],
        tax_benefits=[
            "Transfer wealth to heirs at reduced estate and gift tax cost",
            "Charitable gift/estate tax deduction for present value of income stream",
            "Assets grow outside donor's estate during trust term",
        ],
        min_gift=250_000,
        complexity="high",
        ideal_motivation=["estate planning", "wealth transfer", "family legacy", "reduce estate taxes"],
        donor_profile="A high-net-worth donor (estate >$5M) who wants to transfer wealth to children/grandchildren at reduced tax cost while benefiting the institution.",
        key_objection="I want my children to inherit my assets.",
        objection_response="A CLT doesn't prevent inheritance — it delays it while the institution benefits, and often results in significantly more passing to heirs after estate and gift taxes are reduced.",
        disclaimer="Charitable lead trusts are complex irrevocable instruments with significant tax implications. Donors must work with an estate planning attorney and CPA. Not appropriate for all donors.",
    ),

    GiftVehicle.DAF: VehicleDefinition(
        vehicle=GiftVehicle.DAF,
        name="Donor Advised Fund (DAF)",
        plain_english="A charitable giving account where the donor makes a tax-deductible contribution, then recommends grants to charities (including the institution) over time.",
        best_for_age_min=40,
        best_for_age_max=99,
        income_producing=False,
        revocable=False,   # Contribution irrevocable; grant recommendations are advisory
        best_assets=["appreciated securities", "cash", "mutual funds", "crypto"],
        tax_benefits=[
            "Immediate charitable deduction in year of contribution",
            "Avoid capital gains on appreciated assets contributed",
            "Account grows tax-free",
            "Successor advisors can continue giving after donor's death",
        ],
        min_gift=5_000,
        complexity="low",
        ideal_motivation=["flexibility", "bunching deductions", "simplicity", "multi-charity giving", "appreciated assets"],
        donor_profile="A donor with appreciated assets or variable income who wants to maximize tax efficiency while maintaining flexibility about which charities to support and when.",
        key_objection="I give to many charities, not just Greenfield.",
        objection_response="A DAF is perfect for that — you contribute once, get the full deduction immediately, and then recommend grants to any qualifying charity at any time. Many of our donors use their DAF to support us and several other causes they love.",
        disclaimer="Grants from DAFs are advisory, not binding. Donors should consult their DAF sponsor and financial advisor. We are delighted to accept DAF grants — please notify us in advance so we can properly acknowledge your gift.",
    ),

    GiftVehicle.IRA_ROLLOVER: VehicleDefinition(
        vehicle=GiftVehicle.IRA_ROLLOVER,
        name="IRA Charitable Rollover / Qualified Charitable Distribution (QCD)",
        plain_english="Donors age 70½ or older can transfer up to $105,000 directly from an IRA to a qualifying charity, satisfying Required Minimum Distributions without paying income tax.",
        best_for_age_min=70,
        best_for_age_max=99,
        income_producing=False,
        revocable=False,
        best_assets=["traditional IRA", "SEP-IRA", "SIMPLE IRA"],
        tax_benefits=[
            "Excluded from taxable income (unlike regular IRA withdrawal)",
            "Counts toward Required Minimum Distribution (RMD)",
            "Reduces AGI — may lower Medicare premiums and Social Security taxes",
            "Simpler than itemizing for donors who take standard deduction",
        ],
        min_gift=1_000,
        complexity="low",
        ideal_motivation=["RMD management", "tax efficiency", "simplicity", "retirement income", "reduce taxable income"],
        donor_profile="A donor age 70½+ with IRA assets who wants to make charitable gifts with pre-tax dollars, avoid paying income tax on RMDs, and simplify their giving.",
        key_objection="I already take the standard deduction, so charitable gifts don't help my taxes.",
        objection_response="That's exactly why a QCD is so valuable for you — because it reduces your taxable income directly, you get the tax benefit whether or not you itemize. It's the most tax-efficient way to give from your IRA.",
        disclaimer="QCDs apply only to traditional IRAs for donors age 70½+. The $105,000 annual limit applies (indexed for inflation). Please contact your IRA custodian to arrange a direct transfer. Consult your tax advisor.",
    ),

    GiftVehicle.APPRECIATED_STOCK: VehicleDefinition(
        vehicle=GiftVehicle.APPRECIATED_STOCK,
        name="Gift of Appreciated Securities",
        plain_english="Donating appreciated stocks or mutual funds directly to the institution — avoiding capital gains tax and getting a deduction for full fair market value.",
        best_for_age_min=40,
        best_for_age_max=99,
        income_producing=False,
        revocable=False,
        best_assets=["appreciated stock", "mutual funds", "ETFs", "restricted stock (with planning)"],
        tax_benefits=[
            "Deduction for full fair market value (not just cost basis)",
            "Avoid capital gains tax on appreciation",
            "Annual deduction limit: 30% of AGI for appreciated property (5-year carryforward)",
        ],
        min_gift=500,
        complexity="low",
        ideal_motivation=["capital gains avoidance", "tax efficiency", "no-cash giving", "portfolio rebalancing"],
        donor_profile="A donor with low-basis appreciated securities who wants to maximize their charitable deduction and avoid capital gains tax.",
        key_objection="I want cash for retirement, not to give away my stock.",
        objection_response="Give the appreciated stock to us, then use the cash equivalent you would have used (that now has no capital gains hit) for whatever you need. You're in exactly the same cash position, but you avoided the gains tax entirely.",
        disclaimer="Tax deductibility subject to AGI limitations. Consult your tax advisor regarding basis, holding periods, and transfer procedures.",
    ),

    GiftVehicle.RETAINED_LIFE_ESTATE: VehicleDefinition(
        vehicle=GiftVehicle.RETAINED_LIFE_ESTATE,
        name="Retained Life Estate",
        plain_english="A donor gives their home or farm to the institution now, but retains the right to live there for the rest of their life. They get an immediate tax deduction.",
        best_for_age_min=65,
        best_for_age_max=99,
        income_producing=False,
        revocable=False,
        best_assets=["personal residence", "vacation home", "farm", "undeveloped land"],
        tax_benefits=[
            "Immediate partial charitable deduction for present value of remainder interest",
            "Continues to live in home while making a major legacy gift",
            "Removes value of property from taxable estate",
        ],
        min_gift=100_000,
        complexity="medium",
        ideal_motivation=["home ownership", "legacy without life disruption", "estate simplification", "no cash needed"],
        donor_profile="An older donor who owns a home outright, has no plans to sell, and wants to make a significant legacy gift without disrupting their lifestyle.",
        key_objection="I can't give away my house — I live in it.",
        objection_response="A retained life estate solves exactly that — you give us the legal title now, get the tax deduction now, but continue to live in your home for the rest of your life. Nothing changes for you day-to-day.",
        disclaimer="Retained life estates are irrevocable. The donor retains the right to occupy the property and is responsible for maintenance, insurance, and property taxes. Consult legal counsel.",
    ),
}


# ─── RECOMMENDATION ──────────────────────────────────────────────────────────

@dataclass
class VehicleRecommendation:
    primary:            VehicleDefinition
    secondary:          Optional[VehicleDefinition]
    tertiary:           Optional[VehicleDefinition]
    rationale:          str
    conversation_opener:str     # Natural way to introduce this vehicle
    estimated_gift_size:str     # E.g., "$10,000–$50,000 CGA"
    example_scenario:   str     # Hypothetical illustrative example
    acga_rate:          Optional[str]   # Current rate if CGA recommended
    advisor_note:       str     # Note for human gift officer or VPGO


def _get_acga_rate(estimated_age: Optional[int]) -> Optional[str]:
    """Return approximate ACGA rate for the estimated age. Verify at acga.org."""
    if not estimated_age:
        return None
    # ACGA suggested maximum rates effective July 1, 2024
    # Source: acga.org — verify current rates before quoting
    if estimated_age >= 90:
        return "9.0% (verify current rate at acga.org)"
    if estimated_age >= 85:
        return "8.5% (verify current rate at acga.org)"
    if estimated_age >= 80:
        return "7.8% (verify current rate at acga.org)"
    if estimated_age >= 75:
        return "7.0% (verify current rate at acga.org)"
    if estimated_age >= 70:
        return "6.3% (verify current rate at acga.org)"
    if estimated_age >= 65:
        return "5.7% (verify current rate at acga.org)"
    if estimated_age >= 60:
        return "5.3% (verify current rate at acga.org)"
    return None


def advise_gift_vehicles(donor: dict, bequest_profile=None, signals=None) -> VehicleRecommendation:
    """
    Recommend the best planned giving vehicle(s) for this donor.
    Considers age, assets, giving history, psychographic, income needs, and wealth signals.
    """
    from .bequest_propensity import _estimate_age
    class_year    = donor.get("classYear")
    archetype     = donor.get("archetype", "LOYAL_ALUMNI")
    estimated_age = _estimate_age(class_year) if class_year else None
    total_giving  = donor.get("totalGiving", 0)
    interests     = [i.lower() for i in donor.get("interests", [])]
    conversation  = " ".join(m.get("content", "") for m in donor.get("conversationHistory", []) if m.get("role") == "donor").lower()

    # ── Detect donor signals ─────────────────────────────────────────────────
    has_ira_signal      = any(kw in conversation for kw in ["ira", "retirement account", "401k", "rmd", "required minimum"])
    has_real_estate     = signals and signals.wealth.real_estate_value >= 50_000_00
    has_appreciated_stock = any(kw in conversation for kw in ["stock", "securities", "shares", "capital gains", "appreciated"])
    wants_income        = any(kw in conversation for kw in ["income", "annuity", "monthly", "payments"])
    estate_planning     = any(kw in conversation for kw in ["estate", "will", "trust", "attorney", "plan"])
    family_wealth       = signals and signals.wealth.estimated_net_worth >= 5_000_000_00
    wants_simplicity    = archetype in ("LOYAL_ALUMNI", "FAITH_DRIVEN", "PRAGMATIC_PARTNER")

    # ── Primary vehicle selection ────────────────────────────────────────────
    primary = VEHICLE_DEFINITIONS[GiftVehicle.BEQUEST]  # Default

    if estimated_age and estimated_age >= 70 and has_ira_signal:
        primary = VEHICLE_DEFINITIONS[GiftVehicle.IRA_ROLLOVER]
    elif estimated_age and estimated_age >= 65 and wants_income and wants_simplicity:
        primary = VEHICLE_DEFINITIONS[GiftVehicle.CGA]
    elif has_appreciated_stock and total_giving >= 5_000:
        primary = VEHICLE_DEFINITIONS[GiftVehicle.APPRECIATED_STOCK]
    elif has_real_estate and estimated_age and estimated_age >= 70:
        primary = VEHICLE_DEFINITIONS[GiftVehicle.RETAINED_LIFE_ESTATE]
    elif family_wealth and estate_planning:
        primary = VEHICLE_DEFINITIONS[GiftVehicle.CLT]
    elif signals and signals.wealth.estimated_net_worth >= 1_000_000_00 and wants_income:
        primary = VEHICLE_DEFINITIONS[GiftVehicle.CRUT]
    elif estimated_age and estimated_age >= 65 and wants_income:
        primary = VEHICLE_DEFINITIONS[GiftVehicle.CGA]
    else:
        primary = VEHICLE_DEFINITIONS[GiftVehicle.BEQUEST]

    # ── Secondary vehicle ────────────────────────────────────────────────────
    secondary_vehicle = None
    if primary.vehicle != GiftVehicle.BEQUEST:
        secondary_vehicle = VEHICLE_DEFINITIONS[GiftVehicle.BEQUEST]
    elif estimated_age and estimated_age >= 70 and not has_ira_signal:
        secondary_vehicle = VEHICLE_DEFINITIONS[GiftVehicle.IRA_ROLLOVER]
    elif estimated_age and estimated_age >= 65:
        secondary_vehicle = VEHICLE_DEFINITIONS[GiftVehicle.CGA]
    elif has_appreciated_stock:
        secondary_vehicle = VEHICLE_DEFINITIONS[GiftVehicle.APPRECIATED_STOCK]

    # ── Tertiary vehicle ─────────────────────────────────────────────────────
    tertiary_vehicle = None
    if primary.vehicle != GiftVehicle.DAF and secondary_vehicle and secondary_vehicle.vehicle != GiftVehicle.DAF:
        if total_giving >= 5_000 or (signals and signals.wealth.estimated_net_worth >= 500_000_00):
            tertiary_vehicle = VEHICLE_DEFINITIONS[GiftVehicle.DAF]

    # ── ACGA rate ─────────────────────────────────────────────────────────────
    acga_rate = _get_acga_rate(estimated_age) if primary.vehicle == GiftVehicle.CGA else None

    # ── Build recommendation ─────────────────────────────────────────────────
    age_str = f"age {estimated_age}" if estimated_age else "estimated age"
    rationale = (
        f"Primary recommendation: {primary.name}. "
        f"Rationale: {primary.donor_profile} "
        f"This donor ({age_str}, {archetype.replace('_', ' ').title()} archetype, "
        f"${total_giving:,.0f} lifetime giving) fits this vehicle's ideal profile. "
        + (f"IRA signal detected — QCD is the most tax-efficient path. " if has_ira_signal else "")
        + (f"Appreciated asset signal detected — securities gift avoids capital gains. " if has_appreciated_stock else "")
        + (f"Income need detected — {primary.name} addresses this directly. " if wants_income else "")
    )

    # ── Conversation opener ─────────────────────────────────────────────────
    openers = {
        GiftVehicle.BEQUEST:    f"Many donors find that including {donor.get('orgName', 'Greenfield')} in their will is the simplest and most flexible way to make a lasting impact — it maintains complete control during your lifetime.",
        GiftVehicle.CGA:        f"At your stage of life, a charitable gift annuity might be worth exploring — it provides guaranteed income for life, an immediate tax deduction, and becomes a permanent endowment for programs you care about.",
        GiftVehicle.IRA_ROLLOVER: f"Many donors don't realize they can direct their Required Minimum Distributions directly to charity, completely avoiding income tax on those withdrawals. It's one of the most tax-efficient ways to give.",
        GiftVehicle.CRUT:       f"If you have appreciated assets — especially stock or real estate — a charitable remainder trust could convert those into lifetime income, eliminate the capital gains tax, and make a transformational gift.",
        GiftVehicle.APPRECIATED_STOCK: f"If you have any appreciated stock, gifting shares directly to us is almost always more tax-efficient than selling first — you avoid the capital gains entirely and deduct the full market value.",
        GiftVehicle.DAF:        f"Many donors find a donor advised fund enormously helpful for managing their charitable giving — contribute appreciated assets, get the deduction now, and recommend grants to us (and other charities) on your own timeline.",
        GiftVehicle.RETAINED_LIFE_ESTATE: f"Some donors who own their home outright find a retained life estate creates a meaningful legacy gift while changing absolutely nothing about their daily life.",
        GiftVehicle.CLT:        f"For donors thinking about transferring wealth to the next generation, a charitable lead trust can be extraordinarily tax-efficient — assets pass to your heirs at a significantly reduced gift or estate tax cost.",
    }

    # ── Example scenario ────────────────────────────────────────────────────
    examples = {
        GiftVehicle.BEQUEST:    f"'I leave 10% of my residual estate to Greenfield University for the benefit of [Fund].' One sentence. No lawyers needed beyond the estate update.",
        GiftVehicle.CGA:        f"Example: A donor, age {estimated_age or 75}, transfers $50,000 in cash. They receive a guaranteed annuity payment of ${int(50000 * 0.063 * (1 if (estimated_age or 75) >= 70 else 0.057 / 0.063)):,}/year for life, an immediate partial tax deduction of approximately $[DEDUCTION], and the remaining value endows [Fund] permanently.",
        GiftVehicle.IRA_ROLLOVER: f"Example: A donor, age {estimated_age or 74}, transfers $25,000 directly from their IRA to Greenfield. This counts toward their $[RMD] RMD and is completely excluded from taxable income — saving approximately $[TAX_SAVINGS] in federal income tax.",
        GiftVehicle.APPRECIATED_STOCK: f"Example: Donor gives $20,000 of stock purchased for $5,000. They deduct $20,000 (full FMV), avoid $2,250 in capital gains tax (15% federal on $15,000 gain), and the institution receives the full $20,000 value.",
        GiftVehicle.CRUT:       f"Example: Donor transfers $200,000 of low-basis stock to a 6% CRUT. The trust sells and diversifies with no capital gains. Donor receives $12,000/year (variable), gets immediate partial deduction, avoids capital gains, and the remainder endows [Fund].",
        GiftVehicle.CLT:        f"Example: Donor transfers $500,000 to a 5% CLT for 15 years. Greenfield receives $25,000/year for 15 years ($375,000 total). At term end, assets pass to children with minimal estate and gift tax.",
    }

    return VehicleRecommendation(
        primary=primary,
        secondary=secondary_vehicle,
        tertiary=tertiary_vehicle,
        rationale=rationale,
        conversation_opener=openers.get(primary.vehicle, openers[GiftVehicle.BEQUEST]),
        estimated_gift_size=_estimate_gift_size(donor, primary.vehicle),
        example_scenario=examples.get(primary.vehicle, "Custom scenario based on donor's specific assets."),
        acga_rate=acga_rate,
        advisor_note=f"Always recommend donor consult with independent estate planning attorney and CPA. {primary.disclaimer}",
    )


def _estimate_gift_size(donor: dict, vehicle: GiftVehicle) -> str:
    """Estimate likely gift size range based on total giving history."""
    total = donor.get("totalGiving", 0)
    if vehicle == GiftVehicle.BEQUEST:
        if total >= 100_000:
            return "$500,000–$2M+ estate gift (major bequest candidate)"
        if total >= 25_000:
            return "$100,000–$500,000 estate gift"
        return "$10,000–$100,000 estate gift"
    if vehicle == GiftVehicle.CGA:
        if total >= 25_000:
            return "$50,000–$200,000 CGA"
        return "$10,000–$50,000 CGA"
    if vehicle == GiftVehicle.IRA_ROLLOVER:
        return "$10,000–$105,000 QCD (annual maximum $105,000)"
    if vehicle == GiftVehicle.CRUT:
        return "$100,000–$1M+ CRUT"
    return "Size to be determined in conversation"


# ─── PROMPT FORMATTER ────────────────────────────────────────────────────────

def format_vehicles_for_prompt(rec: VehicleRecommendation) -> str:
    """Format vehicle recommendation for VPGO prompt injection."""
    lines = [
        f"PRIMARY VEHICLE: {rec.primary.name}",
        f"  Plain English: {rec.primary.plain_english}",
        f"  Best Assets: {', '.join(rec.primary.best_assets[:3])}",
        f"  Tax Benefits: {' | '.join(rec.primary.tax_benefits[:2])}",
        f"  Estimated Gift: {rec.estimated_gift_size}",
    ]
    if rec.acga_rate:
        lines.append(f"  ACGA Rate (current — verify at acga.org): {rec.acga_rate}")
    lines.append(f"\n  CONVERSATION OPENER:")
    lines.append(f"  \"{rec.conversation_opener}\"")
    lines.append(f"\n  EXAMPLE SCENARIO:")
    lines.append(f"  {rec.example_scenario}")
    lines.append(f"\n  HANDLING OBJECTION: \"{rec.primary.key_objection}\"")
    lines.append(f"  Response: {rec.primary.objection_response}")

    if rec.secondary:
        lines.append(f"\nSECONDARY VEHICLE: {rec.secondary.name}")
        lines.append(f"  {rec.secondary.plain_english}")
    if rec.tertiary:
        lines.append(f"\nTERTIARY VEHICLE: {rec.tertiary.name}")
        lines.append(f"  {rec.tertiary.plain_english}")

    lines.append(f"\n⚠ DISCLAIMER: {rec.advisor_note}")
    lines.append(f"\nADVISOR NOTE: {rec.advisor_note}")
    return "\n".join(lines)
