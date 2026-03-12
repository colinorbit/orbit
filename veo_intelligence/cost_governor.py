"""
VEO Cost Governor
=================
Controls spend per client, enforces hard/soft limits, applies markup,
and produces billing reports.

Architecture:
  - Each client (university) has a ClientConfig with limits + markup tier
  - CostGovernor.check_budget() is called BEFORE each Claude API call
  - CostGovernor.record_usage() is called AFTER each call
  - Usage is accumulated in-memory (→ Redis/DB in production)
  - BillingReport shows raw cost, markup, and invoice-ready totals

Markup tiers (your margins):
  ┌─────────────┬──────────────┬──────────┬──────────────────────────────┐
  │ Tier        │ Markup       │ List     │ Target Client                │
  ├─────────────┼──────────────┼──────────┼──────────────────────────────┤
  │ STARTER     │ 5x           │ $0.07/   │ Small liberal arts (<5K alum)│
  │             │              │ contact  │                              │
  │ GROWTH      │ 4x           │ $0.056/  │ Mid-size (5K–25K alum)       │
  │             │              │ contact  │                              │
  │ ENTERPRISE  │ 3x           │ $0.042/  │ Large research univ (>25K)   │
  │             │              │ contact  │                              │
  │ PARTNER     │ 2x           │ $0.028/  │ Reseller / consortium        │
  │             │              │ contact  │                              │
  └─────────────┴──────────────┴──────────┴──────────────────────────────┘

All raw costs based on Sonnet 4 pricing: $3/MTok in, $15/MTok out.
"""

from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime, date
from enum import Enum


# ─── PRICING CONSTANTS ────────────────────────────────────────────────────────

# Anthropic Sonnet 4 pricing ($/million tokens)
COST_PER_M_INPUT_TOKENS  = 3.00
COST_PER_M_OUTPUT_TOKENS = 15.00

# Minimum cost floor per contact (never bill less than this)
MIN_COST_PER_CONTACT = 0.005  # $0.005


# ─── MARKUP TIERS ─────────────────────────────────────────────────────────────

class MarkupTier(str, Enum):
    STARTER    = "starter"      # 5x markup — small schools
    GROWTH     = "growth"       # 4x markup — mid-size
    ENTERPRISE = "enterprise"   # 3x markup — large universities
    PARTNER    = "partner"      # 2x markup — resellers/consortia
    INTERNAL   = "internal"     # 1x (no markup) — internal/demo use

MARKUP_MULTIPLIERS = {
    MarkupTier.STARTER:    5.0,
    MarkupTier.GROWTH:     4.0,
    MarkupTier.ENTERPRISE: 3.0,
    MarkupTier.PARTNER:    2.0,
    MarkupTier.INTERNAL:   1.0,
}


# ─── CLIENT CONFIG ────────────────────────────────────────────────────────────

@dataclass
class ClientConfig:
    """
    Configuration for a single client (university/institution).
    Stored in DB in production; loaded at session start.
    """
    client_id: str
    client_name: str
    markup_tier: MarkupTier

    # Hard limits — requests that would exceed these are BLOCKED
    monthly_token_budget: int = 50_000_000    # 50M tokens/month (≈ 3,500 contacts)
    daily_token_budget: int   = 2_000_000     # 2M tokens/day (≈ 140 contacts)
    max_tokens_per_call: int  = 5_000         # Cap per single API call

    # Soft limits — generate warnings but don't block
    monthly_warning_threshold: float = 0.80  # warn at 80% of monthly budget
    daily_warning_threshold: float   = 0.90  # warn at 90% of daily budget

    # Feature flags
    intelligence_pipeline_enabled: bool = True   # Life events + signals + predictive
    planned_giving_module_enabled: bool  = True
    max_donors_per_batch: int            = 500   # cap batch run size

    # Contact metadata
    contact_email: str = ""
    notes: str = ""


# Pre-built configs for demo
DEMO_CLIENTS = {
    "greenfield": ClientConfig(
        client_id="greenfield",
        client_name="Greenfield University",
        markup_tier=MarkupTier.GROWTH,
        monthly_token_budget=100_000_000,
        daily_token_budget=5_000_000,
        contact_email="advancement@greenfield.edu",
    ),
    "demo_starter": ClientConfig(
        client_id="demo_starter",
        client_name="Small Liberal Arts College (Demo)",
        markup_tier=MarkupTier.STARTER,
        monthly_token_budget=20_000_000,
        daily_token_budget=1_000_000,
    ),
    "demo_enterprise": ClientConfig(
        client_id="demo_enterprise",
        client_name="State University System (Demo)",
        markup_tier=MarkupTier.ENTERPRISE,
        monthly_token_budget=500_000_000,
        daily_token_budget=20_000_000,
    ),
    "internal": ClientConfig(
        client_id="internal",
        client_name="Orbit Internal / Demo",
        markup_tier=MarkupTier.INTERNAL,
        monthly_token_budget=999_999_999,
        daily_token_budget=999_999_999,
    ),
}


# ─── USAGE RECORD ─────────────────────────────────────────────────────────────

@dataclass
class UsageRecord:
    """Single API call usage record."""
    timestamp: str
    donor_id: str
    input_tokens: int
    output_tokens: int
    raw_cost_usd: float
    billed_cost_usd: float
    markup_multiplier: float
    action_type: str = ""
    stage: str = ""
    escalated: bool = False


@dataclass
class BudgetStatus:
    """Current budget consumption for a client."""
    client_id: str
    date_str: str

    # Today
    daily_tokens_used: int = 0
    daily_cost_raw: float = 0.0
    daily_cost_billed: float = 0.0
    daily_contacts: int = 0

    # This month
    monthly_tokens_used: int = 0
    monthly_cost_raw: float = 0.0
    monthly_cost_billed: float = 0.0
    monthly_contacts: int = 0

    # Warnings / blocks
    daily_warning: bool = False
    monthly_warning: bool = False
    daily_blocked: bool = False
    monthly_blocked: bool = False
    block_reason: str = ""


# ─── BILLING REPORT ──────────────────────────────────────────────────────────

@dataclass
class BillingReport:
    """Invoice-ready billing summary for a client session or period."""
    client_id: str
    client_name: str
    markup_tier: str
    markup_multiplier: float
    period_start: str
    period_end: str

    total_contacts: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_tokens: int = 0

    raw_cost_usd: float = 0.0        # What you pay Anthropic
    billed_cost_usd: float = 0.0     # What you charge the client
    gross_margin_usd: float = 0.0    # Your profit
    gross_margin_pct: float = 0.0    # Margin %

    escalations: int = 0
    opt_outs: int = 0
    emails_sent: int = 0

    records: list = field(default_factory=list)

    def cost_per_contact(self) -> float:
        if self.total_contacts == 0:
            return 0.0
        return self.billed_cost_usd / self.total_contacts

    def raw_cost_per_contact(self) -> float:
        if self.total_contacts == 0:
            return 0.0
        return self.raw_cost_usd / self.total_contacts

    def to_invoice_lines(self) -> list[str]:
        """Returns formatted invoice line items."""
        lines = [
            f"{'─' * 65}",
            f"  ORBIT VEO — USAGE INVOICE",
            f"  Client:   {self.client_name}",
            f"  Period:   {self.period_start} → {self.period_end}",
            f"  Tier:     {self.markup_tier.upper()} ({self.markup_multiplier:.1f}x markup)",
            f"{'─' * 65}",
            f"",
            f"  SERVICE DETAILS",
            f"  {'Contacts processed:':<35} {self.total_contacts:>8,}",
            f"  {'AI decisions generated:':<35} {self.total_contacts:>8,}",
            f"  {'Emails drafted:':<35} {self.emails_sent:>8,}",
            f"  {'Human escalations:':<35} {self.escalations:>8,}",
            f"  {'Opt-outs processed:':<35} {self.opt_outs:>8,}",
            f"",
            f"  COMPUTE USAGE",
            f"  {'Input tokens:':<35} {self.total_input_tokens:>8,}",
            f"  {'Output tokens:':<35} {self.total_output_tokens:>8,}",
            f"  {'Total tokens:':<35} {self.total_tokens:>8,}",
            f"",
            f"  BILLING",
            f"  {'Raw AI cost (Anthropic):':<35} ${self.raw_cost_usd:>8.4f}",
            f"  {'Markup ({:.1f}x):':<35} ${(self.billed_cost_usd - self.raw_cost_usd):>8.4f}".format(self.markup_multiplier),
            f"  {'─' * 49}",
            f"  {'AMOUNT DUE:':<35} ${self.billed_cost_usd:>8.4f}",
            f"",
            f"  UNIT ECONOMICS",
            f"  {'Cost per contact (raw):':<35} ${self.raw_cost_per_contact():>8.4f}",
            f"  {'Cost per contact (billed):':<35} ${self.cost_per_contact():>8.4f}",
            f"  {'Your gross margin:':<35} ${self.gross_margin_usd:>8.4f}  ({self.gross_margin_pct:.0f}%)",
            f"{'─' * 65}",
        ]
        return lines


# ─── COST GOVERNOR ────────────────────────────────────────────────────────────

class CostGovernor:
    """
    Central cost controller for VEO operations.

    Usage:
        governor = CostGovernor(client_config)

        # Before each API call:
        ok, reason = governor.check_budget(estimated_tokens=2500)
        if not ok:
            # handle block

        # After each API call:
        governor.record_usage(donor_id, input_tokens, output_tokens, ...)

        # At end of session:
        report = governor.generate_report()
        for line in report.to_invoice_lines():
            print(line)
    """

    def __init__(self, config: ClientConfig):
        self.config = config
        self.markup = MARKUP_MULTIPLIERS[config.markup_tier]
        self.records: list[UsageRecord] = []
        self.session_start = datetime.now().isoformat()
        self._today = date.today().isoformat()

        # In-memory accumulators (→ Redis in production)
        self._daily_tokens   = 0
        self._monthly_tokens = 0

    def _calc_raw_cost(self, input_tokens: int, output_tokens: int) -> float:
        return (
            (input_tokens  * COST_PER_M_INPUT_TOKENS  / 1_000_000) +
            (output_tokens * COST_PER_M_OUTPUT_TOKENS / 1_000_000)
        )

    def _calc_billed_cost(self, raw_cost: float) -> float:
        billed = raw_cost * self.markup
        return max(billed, MIN_COST_PER_CONTACT)

    def check_budget(self, estimated_tokens: int = 3000) -> tuple[bool, str]:
        """
        Check if a call is within budget BEFORE making it.
        Returns (allowed: bool, reason: str)
        """
        cfg = self.config

        # Per-call token cap
        if estimated_tokens > cfg.max_tokens_per_call:
            return False, (
                f"Call exceeds per-call token limit ({estimated_tokens:,} > {cfg.max_tokens_per_call:,}). "
                f"Reduce max_tokens in request."
            )

        # Daily hard limit
        projected_daily = self._daily_tokens + estimated_tokens
        if projected_daily > cfg.daily_token_budget:
            return False, (
                f"Daily token budget exceeded for {cfg.client_name}. "
                f"Used: {self._daily_tokens:,} / {cfg.daily_token_budget:,}. "
                f"Resets at midnight. Contact your Orbit admin to increase limits."
            )

        # Monthly hard limit
        projected_monthly = self._monthly_tokens + estimated_tokens
        if projected_monthly > cfg.monthly_token_budget:
            return False, (
                f"Monthly token budget exceeded for {cfg.client_name}. "
                f"Used: {self._monthly_tokens:,} / {cfg.monthly_token_budget:,}. "
                f"Contact your Orbit admin to increase limits or upgrade tier."
            )

        # Soft warnings (logged but not blocked)
        warnings = []
        if projected_daily / cfg.daily_token_budget >= cfg.daily_warning_threshold:
            warnings.append(
                f"WARN: Approaching daily limit ({projected_daily / cfg.daily_token_budget:.0%} used)"
            )
        if projected_monthly / cfg.monthly_token_budget >= cfg.monthly_warning_threshold:
            warnings.append(
                f"WARN: Approaching monthly limit ({projected_monthly / cfg.monthly_token_budget:.0%} used)"
            )

        warning_str = " | ".join(warnings) if warnings else "OK"
        return True, warning_str

    def record_usage(
        self,
        donor_id: str,
        input_tokens: int,
        output_tokens: int,
        action_type: str = "",
        stage: str = "",
        escalated: bool = False,
    ) -> UsageRecord:
        """Record actual usage after a successful API call."""
        raw_cost    = self._calc_raw_cost(input_tokens, output_tokens)
        billed_cost = self._calc_billed_cost(raw_cost)

        record = UsageRecord(
            timestamp=datetime.now().isoformat(),
            donor_id=donor_id,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            raw_cost_usd=raw_cost,
            billed_cost_usd=billed_cost,
            markup_multiplier=self.markup,
            action_type=action_type,
            stage=stage,
            escalated=escalated,
        )

        self.records.append(record)
        self._daily_tokens   += (input_tokens + output_tokens)
        self._monthly_tokens += (input_tokens + output_tokens)

        return record

    def get_budget_status(self) -> BudgetStatus:
        """Returns current budget consumption."""
        cfg = self.config
        daily_tokens   = self._daily_tokens
        monthly_tokens = self._monthly_tokens
        daily_raw      = sum(r.raw_cost_usd    for r in self.records)
        daily_billed   = sum(r.billed_cost_usd for r in self.records)

        return BudgetStatus(
            client_id=cfg.client_id,
            date_str=self._today,
            daily_tokens_used=daily_tokens,
            daily_cost_raw=daily_raw,
            daily_cost_billed=daily_billed,
            daily_contacts=len(self.records),
            monthly_tokens_used=monthly_tokens,
            monthly_cost_raw=daily_raw,      # same in demo (1 session = 1 day)
            monthly_cost_billed=daily_billed,
            monthly_contacts=len(self.records),
            daily_warning=(daily_tokens / cfg.daily_token_budget) >= cfg.daily_warning_threshold if daily_tokens > 0 else False,
            monthly_warning=(monthly_tokens / cfg.monthly_token_budget) >= cfg.monthly_warning_threshold if monthly_tokens > 0 else False,
        )

    def generate_report(self) -> BillingReport:
        """Generate a full billing report for the current session."""
        if not self.records:
            return BillingReport(
                client_id=self.config.client_id,
                client_name=self.config.client_name,
                markup_tier=self.config.markup_tier.value,
                markup_multiplier=self.markup,
                period_start=self.session_start,
                period_end=datetime.now().isoformat(),
            )

        total_input   = sum(r.input_tokens    for r in self.records)
        total_output  = sum(r.output_tokens   for r in self.records)
        raw_cost      = sum(r.raw_cost_usd    for r in self.records)
        billed_cost   = sum(r.billed_cost_usd for r in self.records)
        margin        = billed_cost - raw_cost
        margin_pct    = (margin / billed_cost * 100) if billed_cost > 0 else 0

        escalations   = sum(1 for r in self.records if r.escalated)
        opt_outs      = sum(1 for r in self.records if r.action_type == "opt_out_acknowledged")
        emails_sent   = sum(1 for r in self.records if r.action_type in ("send_email", "send_gift_ask"))

        return BillingReport(
            client_id=self.config.client_id,
            client_name=self.config.client_name,
            markup_tier=self.config.markup_tier.value,
            markup_multiplier=self.markup,
            period_start=self.session_start,
            period_end=datetime.now().isoformat(),
            total_contacts=len(self.records),
            total_input_tokens=total_input,
            total_output_tokens=total_output,
            total_tokens=total_input + total_output,
            raw_cost_usd=raw_cost,
            billed_cost_usd=billed_cost,
            gross_margin_usd=margin,
            gross_margin_pct=margin_pct,
            escalations=escalations,
            opt_outs=opt_outs,
            emails_sent=emails_sent,
            records=self.records,
        )

    def print_live_status(self):
        """Print a one-line live cost status (shown after each donor)."""
        status = self.get_budget_status()
        cfg = self.config
        daily_pct = status.daily_tokens_used / cfg.daily_token_budget * 100 if cfg.daily_token_budget > 0 else 0

        bar_len = 20
        filled = int(bar_len * daily_pct / 100)
        bar = "█" * filled + "░" * (bar_len - filled)

        print(
            f"  COST  Raw: ${status.daily_cost_raw:.4f}  "
            f"Billed ({cfg.markup_tier.value} {self.markup:.0f}x): ${status.daily_cost_billed:.4f}  "
            f"Margin: ${status.daily_cost_billed - status.daily_cost_raw:.4f}  "
            f"│ Daily budget [{bar}] {daily_pct:.1f}%"
        )
