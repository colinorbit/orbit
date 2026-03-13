# CLAUDE.md — Orbit Platform: Extended Project Constitution

> **This document is the governing authority for all design, architecture, and development decisions on the Orbit platform. No implementation may violate the rules defined here. All engineers, agents, and AI tools operating on this codebase must treat this document as law.**

**Version:** 2.0 (Extended with Predictive Intelligence Layer)  
**Previous version:** 1.0 (Sections 1–14 preserved; Sections 3b, 11a, and updates to 13 and 14–16 are NEW)  
**Last updated:** March 2026

---

## ⚠️ Architecture Update Notice

This extended CLAUDE.md preserves all decisions from v1.0 and adds a comprehensive Predictive Intelligence Architecture (Section 3b) and corresponding implementation roadmap updates. The 10 predictive models defined in Section 3b are the platform's competitive moat and must be built with the same rigor as core infrastructure.

---

## Sections 1–10: Core Architecture (Preserved from v1.0)

**Sections 1–10 of the original CLAUDE.md remain unchanged.** They define:

- System purpose: AI-native fundraising orchestration for advancement offices
- Core architecture: Express API + PostgreSQL + Redis + Bull workers + Claude API
- Four virtual AI officers: VEO, VSO, VPGO, VCO
- Python intelligence layer (veo_intelligence, vso_intelligence, vpgo_intelligence, vco_intelligence)
- External integrations: Salesforce, Stripe, DocuSign, SendGrid, Twilio
- Technology decisions, security, observability, and user personas

*See original CLAUDE.md v1.0 for full details on Sections 1–10.*

---

## Section 3b: Predictive Intelligence Architecture (NEW)

### Overview

The **Predictive Intelligence Layer** is the core competitive moat of Orbit. It consists of 10 specialized, measurable predictive models that work in concert to inform and guide the four virtual AI officers' decisions. Unlike legacy CRM vendors (Blackbaud, Ellucian) who claim "5 moves," Orbit exposes 10 explicit, transparent, agent-integrated predictive signals.

### Architectural Role

```
┌─────────────────────────────────────────────────────────┐
│         DONOR PROFILE + INTERACTION DATA                │
│  (gift history, engagement, notes, wealth API scores)   │
└──────────────────┬──────────────────────────────────────┘
                   │
        ┌──────────▼─────────────────┐
        │  PREDICTIVE HEADS (10 Models)
        │  (Python + Rules + Claude)
        └──────────┬──────────────────┘
                   │
    ┌──────────────┼──────────────────┬───────────────────┐
    ▼              ▼                  ▼                   ▼
  [VEO]          [VSO]             [VPGO]              [VCO]
  Engagement     Stewardship       Planned Giving      Campaign
  Officer        Officer           Officer             Officer
    │              │                  │                   │
    └──────────┬───┴──────────────────┴───────────────────┘
               │
         ┌─────▼──────────────────────────────────┐
         │  AGENT DECISIONS + OUTREACH ORCHESTRATION
         │  (timing, channel, message, escalation)
         └────────────────────────────────────────┘
```

### The 10 Predictive Models

#### Model 1: Response Likelihood

**Purpose:** Will this donor respond to outreach in the next 30 days?

**Output:** Probability 0–100 (single score)

**Inputs:** Email opens (last 90 days), recency (days since response), engagement score, life events, historical response rate by donor type

**Launch Phase:** Phase 1 (MVP)

**Update Frequency:** Real-time (after every interaction)

**Algorithm:** Hybrid (rules + Claude API)

```
Base score from rules:
  - Recent response (≤7 days):    +40
  - Email opens (last 30 days):   +20
  - Recency ≤30 days:             +20
  - Life event detected:          +15
  - Historical response rate:     +5

If score < 50: → Claude API evaluates donor notes + context
Output: 0–100, refreshed real-time
```

**VEO Use:** Decides whether to send outreach; if low score, tries alternative channel or defers

---

#### Model 2: Channel Preference

**Purpose:** Which communication channel maximizes engagement for this donor?

**Output:** Ranked list: [Primary, Secondary, Tertiary, Avoid]

**Inputs:** Historical response by channel, demographics, explicit opt-ins/opt-outs, engagement patterns

**Launch Phase:** Phase 1 (MVP)

**Update Frequency:** Weekly batch

**Algorithm:** Rules-based (compliance-first)

```
Step 1: Filter by compliance (honor all opt-outs)
Step 2: Score by historical response rate
Step 3: Rank channels 1–4
Step 4: Apply demographic insights (age, alumni class)
Output: ["Email", "Phone", "SMS"] with scores
```

**VEO/VSO Use:** Determines which channels to use; ensures compliance

---

#### Model 3: Ask Timing

**Purpose:** When should we solicit this donor next?

**Output:** Recommended window (e.g., "March 1–31, 2026") + confidence

**Inputs:** Time since last gift, historical giving calendar, life events, engagement velocity, seasonal patterns, prior ask cadence

**Launch Phase:** Phase 1 (MVP)

**Update Frequency:** Weekly batch

**Algorithm:** Rules + Claude API

```
Base timing from gift recency:
  If days_since_gift < 30:   return "Wait 30 days"
  If days_since_gift < 90:   return "Optimal window (next 30 days)"
  If days_since_gift < 180:  return "Good window"
  If days_since_gift > 360:  return "Critical: overdue for ask"

Overlay seasonal factors (reunion, Giving Day, fiscal year-end)
Apply Claude API for edge cases (conflicting signals)
Output: {start_date, end_date, confidence, reasoning}
```

**VEO/VSO Use:** Determines when to solicit; if timing poor, sends stewardship instead of ask

---

#### Model 4: Ask Amount Band

**Purpose:** What gift size should we solicit from this donor?

**Output:** Categorical tier with midpoint ask

| Band | Midpoint Ask | Example Scenario |
|------|--------------|------------------|
| $1K–$5K | $2.5K | Young alumni, annual giving |
| $5K–$10K | $7.5K | Established donor, modest capacity |
| $10K–$25K | $17.5K | Upgrading donor, major potential |
| $25K–$50K | $37.5K | Major donor, strong wealth signal |
| $50K–$100K | $75K | Principal gift, significant capacity |
| $100K+ | Negotiated | Major capital campaign |

**Launch Phase:** Phase 2 (requires wealth APIs)

**Update Frequency:** Monthly

**Algorithm:** Rules + wealth data + Claude API

```
Base from giving history + inflation adjustment
Apply wealth capacity escalation (1.1x to 3.0x depending on score)
Map to giving bands
Claude API final check for edge cases (first-time major donors, endowment campaigns)
Output: {band, ask, confidence, rationale}
```

**VPGO/VCO Use:** Sizes solicitation request appropriately; avoids insulting or under-asking

---

#### Model 5: Upgrade Propensity

**Purpose:** Will this donor increase their gift size on next solicitation?

**Output:** Probability 0–100

**Inputs:** Historical upgrade pattern, engagement trend, wealth capacity improvement, giving trajectory, life events

**Launch Phase:** Phase 2

**Update Frequency:** Monthly

**Algorithm:** Rules + trend analysis

```
Historical baseline (has donor upgraded before?)
Engagement velocity bonus/penalty
Wealth capacity signal
Trajectory analysis (3-year avg vs. 1-year avg)
Life event adjustments
Normalize to 0–100
Output: {score, confidence, key_drivers}
```

**VCO Use:** Identifies candidates for upgrade messaging; tailors stewardship accordingly

---

#### Model 6: Lapse Risk

**Purpose:** What's the probability this donor will stop giving in the next 12 months?

**Output:** Risk tier (LOW/MEDIUM/HIGH/CRITICAL) + probability 0–100

**Inputs:** Time since last gift (strongest signal), engagement decline, giving pattern, life events, institutional connection

**Launch Phase:** Phase 1 (MVP)

**Update Frequency:** Weekly batch

**Algorithm:** Segment-specific rules

**Segment A (Long-term Annual Donors):**
```
Base risk = 10
+35 if no gift in 12 months
+50 if no gift in 18 months
+20 if no engagement in 6 months
+15 if declining giving trajectory
Result normalized to 0–100
```

**Segment B (Multi-year Major Donors):**
```
Base risk = 15
+40 if no gift in 18 months
+25 if relationship manager changed
+30 if no stewardship in 6 months
+20 if declining trajectory
```

**Segment C (Young Alumni / First-Time Donors):**
```
Base risk = 40 (higher baseline; normal churn)
+20 if no gift in 12 months
+15 if weak engagement
-25 if year-2 retention achieved (critical milestone)
```

**Segment D (Prospects / Already Lapsed):**
```
Base risk = 70
+20 if no engagement in 12 months
-20 if recent life event detected (reactivation opportunity)
```

**Risk Tiers:** 0–25 (LOW), 26–50 (MEDIUM), 51–75 (HIGH), 76–100 (CRITICAL)

**VSO Use:** Triggers reactivation sequences for MEDIUM+ risk; flags CRITICAL for human review

---

#### Model 7: Planned Giving Likelihood

**Purpose:** Will this donor explore or enter a planned gift arrangement?

**Output:** Probability 0–100 + recommended vehicle type (Bequest / CGA / Charitable Trust / DAF)

**Inputs:** Age/life stage, wealth level, estate planning signals, expressed interest, giving pattern, endowment history

**Launch Phase:** Phase 2

**Update Frequency:** Monthly

**Algorithm:** Hybrid (rules + Claude API)

```
Age/Life Stage Filter:
  <50:    base = 15
  50–64:  base = 35
  65+:    base = 60

Wealth & Capacity: +25 if >$750K capacity
Interest Signals: +30 if estate/legacy mentioned
Giving Pattern: +10 if lifetime >$50K; +15 if multi-year
Life Events: +15 if promotion/inheritance detected

Claude API: Reads donor notes, recommends specific vehicle type
Output: {likelihood, vehicle_type, readiness, rationale}
```

**VPGO Use:** Initiates planned giving sequences for 70%+ donors; tailors conversation to vehicle type

---

#### Model 8: Stewardship Need

**Purpose:** How much relationship work does this donor require to stay engaged?

**Output:** Stewardship level (Light / Moderate / Standard / Enhanced / Premium) + cadence

**Inputs:** Gift size, donor type, relationship age, giving frequency, engagement trend, wealth capacity

**Launch Phase:** Phase 1 (MVP)

**Update Frequency:** Monthly

**Algorithm:** Rules-based

```
Base level from gift size:
  <$1K:        Light (2–3 touches/year)
  $1K–$5K:     Moderate (quarterly)
  $5K–$25K:    Standard (bi-monthly)
  $25K–$100K:  Enhanced (monthly)
  >$100K:      Premium (2× monthly)

Escalate if: major donor flag, first-time donor, engagement declining
De-escalate if: engagement improving, stable annual

Output: {level, cadence, max_days_between_touches, priority}
```

**VSO Use:** Generates stewardship calendar automatically; prioritizes workload

---

#### Model 9: Handoff Readiness

**Purpose:** Is this donor ready to escalate from VSO (annual/stewardship) to human MGO (major gifts)?

**Output:** Readiness tier (NOT_READY / MAYBE / READY_SOON / READY_NOW) + briefing checklist

**Inputs:** Wealth capacity, engagement level, response pattern, gift trajectory, relationship foundation, life events

**Launch Phase:** Phase 2

**Update Frequency:** Monthly

**Algorithm:** Gated rules

```
Gate 1 (Wealth): If capacity <$50K → NOT_READY
Gate 2 (Engagement): If <1 response in 90 days → NOT_READY
Gate 3 (Giving Level): If lifetime <$25K → NOT_READY
Gate 4 (Stability): If declining trajectory → NOT_READY
Gate 5 (Life Event/Opportunity): If major event detected → READY_NOW

Output: {readiness_tier, confidence, rationale, recommended_mgos, briefing_items}
```

**VSO/VCO Use:** Automatically routes ready donors to MGO; generates MGO briefing package

---

#### Model 10: Story Sentiment & Values Extraction

**Purpose:** What are this donor's core values, interests, and emotional drivers?

**Output:** Structured profile for personalization

**Inputs:** Donor notes, communication history, gift fund choices, survey responses, wealth API data, event attendance

**Launch Phase:** Phase 1 (MVP)

**Update Frequency:** Real-time on new notes; monthly batch enrichment

**Algorithm:** Claude API + rules

```
Step 1: Extract explicit values from gift history
  gift_funds → categories (STEM, Arts, Scholarships, etc.)

Step 2: Claude API processes unstructured data
  Input: Last 10 donor notes, gift funds, communications, wealth data
  Output:
    - Core values (top 3–5)
    - Emotional drivers (gratitude, legacy, impact, etc.)
    - Key interests (specific programs they care about)
    - Storytelling hooks (personal connection points)
    - Sentiment (positive/neutral/at_risk) + trend

Step 3: Confidence scoring (HIGH/MEDIUM/LOW based on data richness)
Step 4: Map to institution value tag library
Output: {core_values, emotional_drivers, interests, hooks, sentiment, confidence}
```

**VEO/VSO/VCO Use:** Drives 1:1 personalization; guides messaging tone + fund selection; detects value misalignment

---

### Integration: How the 10 Models Feed the 4 Officers

| Officer | Primary Models | Decision Output |
|---------|---|---|
| **VEO** (Engagement) | Response Likelihood, Channel Preference, Ask Timing, Ask Amount, Upgrade Propensity, Values, Sentiment | Engagement sequences: when to reach out, which channel, what tone, opening message |
| **VSO** (Stewardship) | Stewardship Need, Lapse Risk, Values, Sentiment Trend, Handoff Readiness | Stewardship calendar, reactivation triggers, escalation alerts |
| **VPGO** (Planned Giving) | Planned Giving Likelihood, Values, Wealth, Ask Amount, Stewardship Need | Legacy cultivation sequences, vehicle-specific conversations |
| **VCO** (Campaign) | All 10 (holistic donor picture) | Campaign targeting, personalized messaging, gift planning, prioritization |

---

### Data Model: Storing Predictive Scores

**New table:** `donor_scores`

```sql
CREATE TABLE donor_scores (
  id UUID PRIMARY KEY,
  organization_id UUID (row-level security),
  donor_id UUID,
  
  -- Phase 1 Scores
  response_likelihood SMALLINT (0–100),
  channel_preference JSONB, -- ["Email", "Phone", "SMS"]
  ask_timing JSONB, -- {start, end, confidence, reasoning}
  lapse_risk SMALLINT (0–100),
  lapse_risk_tier VARCHAR, -- LOW/MEDIUM/HIGH/CRITICAL
  sentiment_values JSONB, -- {values, drivers, hooks, sentiment}
  stewardship_need JSONB, -- {level, cadence, priority}
  
  -- Phase 2 Scores
  ask_amount_band JSONB, -- {band, ask, confidence}
  upgrade_propensity SMALLINT (0–100),
  planned_giving_likelihood JSONB, -- {probability, vehicle, readiness}
  handoff_readiness JSONB, -- {tier, confidence, briefing_items}
  
  -- Metadata
  computed_at TIMESTAMP,
  computed_by VARCHAR, -- 'rule_engine' / 'claude_api' / 'ml_model'
  confidence SMALLINT,
  
  FOREIGN KEY (donor_id) REFERENCES donors(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

-- Audit table (for compliance)
CREATE TABLE donor_scores_audit (
  id UUID PRIMARY KEY,
  donor_id UUID,
  organization_id UUID,
  action VARCHAR, -- 'computed' / 'used_by_agent' / 'overridden_by_staff'
  scores_snapshot JSONB,
  agent_decision JSONB, -- what agent did with the scores
  staff_override_reason TEXT,
  created_at TIMESTAMP
);
```

### Privacy & Governance

- **Scores are internal staff guidance only.** Never exposed to donors.
- **FERPA compliance:** Scores stay inside institutional firewall.
- **Audit trail:** Every score usage logged (for transparency review).
- **Staff review:** Before any high-consequence action (handoff, lapse intervention).
- **Consent/privacy:** Institutions configure whether donors can opt out of scoring.

### Success Metrics (Per Model)

| Model | Success Metric | Target | Measurement |
|-------|---|---|---|
| Response Likelihood | Precision (high-score donors respond) | 70%+ response rate for 80+ score | Actual responses vs. prediction |
| Channel Preference | Correct channel recommendation | 65%+ opens from preferred channel | Opens by channel vs. model |
| Ask Timing | Optimal window hit rate | 50%+ response in recommended window | Aggregate response rates |
| Ask Amount Band | Right-sizing (acceptance rate) | 45%+ acceptance for banded asks | Yes/no/decline by band |
| Upgrade Propensity | Identify upgrading donors | 70%+ of predicted upgraders do upgrade | 12-month follow-up |
| Lapse Risk | Early churn detection | 75% sensitivity (catch before lapse) | Sensitivity/specificity curve |
| Planned Giving Likelihood | Conversation conversion | 30%+ of 70+ score enter PG conversation | VPGO conversation outcomes |
| Stewardship Need | Retention improvement | +5–10% retention vs. baseline | Cohort retention analysis |
| Handoff Readiness | MGO allocation efficiency | 80%+ of escalated close major gift within 24mo | Handoff success rate |
| Story Sentiment & Values | Personalization effectiveness | +15% open rate with values-aligned messaging | A/B test: generic vs. aligned |

---

## Section 11a: Predictive Heads Implementation (NEW)

### Python Module Architecture

```
backend/src/services/predictive_heads/
├── __init__.py
├── base.py                    # BasePredictor class
├── models/
│   ├── response_likelihood.py
│   ├── channel_preference.py
│   ├── ask_timing.py
│   ├── ask_amount_band.py
│   ├── upgrade_propensity.py
│   ├── lapse_risk.py
│   ├── planned_giving_likelihood.py
│   ├── stewardship_need.py
│   ├── handoff_readiness.py
│   └── story_sentiment_values.py
├── services/
│   ├── prediction_service.py  # Orchestrates all 10 models
│   ├── claude_service.py      # Claude API integration
│   └── wealth_service.py      # iWave/DonorSearch integration
├── rules/
│   ├── lapse_rules.py
│   ├── stewardship_rules.py
│   └── timing_rules.py
└── tests/
    └── test_predictions.py
```

### Each Model Output: Standard Format

```python
@dataclass
class PredictionOutput:
    score: float  # 0–100 or probability
    confidence: float  # 0–1
    reasoning: str  # Human-readable explanation
    signals: List[str]  # Key factors driving score
    next_update: datetime
```

---

## Section 13: Implementation Roadmap (Updated)

### Completed ✅

- Full database schema (001_initial_schema.ts)
- Server entry point with security middleware
- Agent engine (VEO/VSO/VPGO/VCO with Claude)
- Worker fleet (scheduler + agent-runs + outreach + gifts)
- All service integrations (SendGrid, Twilio, Stripe, DocuSign, Salesforce)
- Agent routes + webhook routes
- Frontend prototype dashboard

### Phase 1 — MVP Predictive Heads (Weeks 1–8)

**6 foundational models with hybrid rules + Claude approach**

- [ ] Module 1.1: Base Predictor class & framework
- [ ] Module 1.2: Response Likelihood model
- [ ] Module 1.3: Channel Preference model
- [ ] Module 1.4: Ask Timing model
- [ ] Module 1.5: Lapse Risk model
- [ ] Module 1.6: Story Sentiment & Values Extraction
- [ ] Module 1.7: Stewardship Need model
- [ ] Module 1.8: Prediction Service Orchestrator
- [ ] Module 1.9: Worker Process Integration
- [ ] Module 1.10: API Routes for Scores
- [ ] Module 1.11: Dashboard Visualization (Frontend)
- [ ] Module 1.12: Database Schema Updates
- [ ] Module 1.13: Testing Suite (>90% coverage)

**Deliverable:** Live donor prediction scores in dashboard; staff can view reasoning behind every score.

### Phase 2 — Wealth-Integrated Models (Weeks 9–16)

**4 models requiring wealth API data**

- [ ] Module 2.1: Ask Amount Band (integrate iWave + DonorSearch)
- [ ] Module 2.2: Upgrade Propensity (wealth signals + trends)
- [ ] Module 2.3: Planned Giving Likelihood (estate planning signals)
- [ ] Module 2.4: Handoff Readiness (all predictive signals + relationship strength)
- [ ] VPGO + MGO handoff workflows
- [ ] Wealth API contract management + caching

**Deliverable:** Major gift identification + automation; VPGO legacy conversations.

### Phase 3 — ML Maturation (Weeks 17+)

**Graduate models from rules → statistical ML**

- [ ] Historical data collection (6+ months Phase 1 scoring)
- [ ] Feature engineering + training pipelines
- [ ] Logistic regression / gradient boosted tree models
- [ ] Continuous retraining + monitoring
- [ ] A/B testing framework (rule-based vs. ML versions)
- [ ] Success metrics dashboard

---

## Section 14a: Competitive Advantage (NEW)

| Aspect | Legacy Vendors (Blackbaud, Ellucian) | Orbit |
|--------|---|---|
| **Predictive Models** | "5 Moves" (vague, proprietary, not transparent) | 10 explicit, measurable models |
| **Explainability** | Black-box recommendations; "trust us" | Every score shows the formula + reasoning |
| **Real-time Intelligence** | Overnight batch; stale by morning | Real-time for response likelihood; daily for others |
| **Agent Integration** | CRM is separate from outreach | Scores directly feed agent decisions (4 officers) |
| **Customization** | Configuration limited; hard to change | Full rule engine + Claude API + ML roadmap |
| **Compliance Auditing** | Limited audit trails | Every score + usage logged; override reason tracked |
| **Time to Value** | 6–12 months to ROI | Value in Week 1; measurable impact in Month 1 |

---

## Section 15: Glossary

- **Predictive Head:** A specialized model in the Predictive Intelligence Layer that produces a single, measurable score or output (e.g., Response Likelihood).
- **Hybrid Intelligence:** Combination of rules-based scoring, Claude API reasoning, and (eventually) ML models working together.
- **HITL (Human-in-the-Loop):** Agent decisions are subject to approval queues; staff can override with logged reasons.
- **MGO:** Major Gift Officer (human advancement staff member).
- **Wealth Capacity:** Estimated donor net worth or annual income, from third-party wealth APIs (iWave, DonorSearch, WealthEngine).
- **Lapse:** Donor who has not given for 12+ months (varies by institution definition).
- **Handoff:** Escalation of donor from automated AI management (VSO) to human major gift officer (MGO).

---

## Section 16: Maintenance & Evolution

**This document is living.** Update CLAUDE.md whenever:

- A new predictive model is added
- An algorithm changes materially
- Architecture decisions are revisited
- Security or privacy requirements evolve
- Success metrics shift

**Version control:** Track changes in git commit history. Major updates increment the version number (v2.0 → v2.1 → v3.0).

---

**End of CLAUDE.md — Extended Project Constitution v2.0**

Maintained by: Lead Software Architect, Orbit Platform  
Rule: Update this document before writing code. Design decisions are documented here first.  
Last updated: March 2026
