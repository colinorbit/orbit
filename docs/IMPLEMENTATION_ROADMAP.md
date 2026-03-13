# Orbit Phase 1 Implementation Roadmap

**Duration:** 8 weeks  
**Primary Owner:** Senior Backend Engineer  
**Contributors:** Frontend Engineer, DevOps, Security Engineer, Code Reviewer  
**Status:** Ready for team review and Week 1 kickoff

---

## Table of Contents

1. [Overview](#overview)
2. [Module Breakdown](#module-breakdown)
3. [Risk Register](#risk-register)
4. [Success Metrics](#success-metrics)
5. [Timeline & Milestones](#timeline--milestones)
6. [Dependencies & Blockers](#dependencies--blockers)

---

## Overview

### What We're Building

**Phase 1:** The foundation of Orbit's Predictive Intelligence Layer — 6 core models that enable the 4 virtual AI officers (VEO, VSO, VPGO, VCO) to make intelligent decisions about donor outreach, stewardship, and major gift identification.

**Why Phase 1 First:**
- 6 models require minimal external data (only gift history + notes)
- Hybrid approach (rules + Claude API) avoids ML training delays
- Value appears in Week 1: advancement officers see live donor scores
- Foundation for Phase 2 (wealth-integrated models) and Phase 3 (ML maturation)

### Core Principles

1. **Hybrid Intelligence**: Rules + Claude API + eventual ML, not pure ML
2. **Real-time + Batch**: Response Likelihood real-time; others daily/weekly
3. **Explainable**: Every score shows its formula + reasoning
4. **Graceful Degradation**: Fallback predictions when data is sparse
5. **Privacy-First**: Scores internal only; audit trail for compliance
6. **Modular**: Each model is independent; can be built/tested in parallel

---

## Module Breakdown

### Module 1.1: Base Predictor Class & Framework

**Owner:** Senior Backend Engineer  
**Duration:** Week 1  
**Deliverable:** `backend/src/services/predictive_heads/base.py`

**Purpose:**  
Abstract base class + interface that all 10 models inherit from. Ensures consistent I/O, logging, error handling, and monitoring.

**What It Provides:**

```python
class BasePredictor(ABC):
    """Abstract base for all predictive models."""
    
    @abstractmethod
    def predict(self, donor_profile: Dict) -> PredictionOutput:
        """Core prediction logic. Subclasses implement this."""
        pass
    
    def predict_safe(self, donor_profile: Dict) -> PredictionOutput:
        """Wrapper with error handling, logging, monitoring."""
        pass
    
    def _log_prediction(self, output: PredictionOutput):
        """Structured logging for audit trail."""
        pass
    
    def _emit_metric(self, output: PredictionOutput):
        """Send metric to monitoring system."""
        pass
    
    def _fallback_prediction(self, donor_profile, error: str):
        """Graceful degradation: return neutral score + error note."""
        pass

@dataclass
class PredictionOutput:
    """Standard output for all models."""
    model_name: str
    score: float  # 0–100 or 0–1 probability
    confidence: float  # 0–1
    reasoning: str
    signals: List[PredictionSignal]
    next_update: datetime
    metadata: Dict[str, Any]
    error: Optional[str] = None

@dataclass
class PredictionSignal:
    """A single input factor contributing to a prediction."""
    name: str
    value: Any
    weight: float
    rationale: str
```

**Dependencies:**
- Python 3.10+
- dataclasses (stdlib)
- Logging module (stdlib)

**Tests:**
- Instantiation with required params
- Error handling for bad input
- Fallback prediction generation
- Metric emission

**Deliverables:**
- ✅ `base.py` with `BasePredictor` + `PredictionOutput` + `PredictionSignal`
- ✅ Error handling + logging framework
- ✅ Monitoring hooks (metrics emission)
- ✅ Unit tests for base class

**Risk:** None (foundational, low complexity)

---

### Module 1.2: Response Likelihood Model

**Owner:** Senior Backend Engineer  
**Duration:** Week 1–2  
**Deliverable:** `backend/src/services/predictive_heads/models/response_likelihood.py`

**Purpose:**  
Predict: "Will this donor respond to outreach in the next 30 days?"

**Inputs:**
```python
{
    "donor_id": "uuid",
    "email_opens_90d": 4,  # Count of opens last 90 days
    "days_since_response": 14,  # Days since last email open, call answer, etc.
    "engagement_score": 72,  # 0–100
    "life_event_flags": ["promotion_detected"],  # List
    "historical_response_rate": 0.35,  # Lifetime response rate (0–1)
    "donor_type": "annual_fund",  # Donor segment
    "recent_notes": "..."  # Text notes for Claude API
}
```

**Output:**
```python
{
    "score": 78,  # 0–100
    "confidence": 0.82,  # 0–1
    "reasoning": "Predicted 78% likelihood of response...",
    "signals": [
        {"name": "recent_response", "value": 14, "weight": 0.40, "rationale": "..."},
        {"name": "email_opens", "value": 4, "weight": 0.20, "rationale": "..."},
        ...
    ],
    "next_update": "2026-03-12T14:30:00Z"
}
```

**Algorithm:**

```
Rule-based scoring (0 → 100):
  - Recent response (≤7 days):     +40
  - Email opens (last 30 days):    +20
  - Recency ≤30 days:              +20
  - Life event detected:           +15
  - Historical response rate:      +5

If score < 50:
  → Claude API evaluates donor notes + context
  → Returns adjusted score + additional signals

Update frequency: Real-time (after every interaction)
```

**Claude API Use Case:**

When base score < 50 and we have uncertain data:

```
Prompt to Claude:
  "Donor profile: [sparse data]
   Recent notes: [unstructured text]
   What's the likelihood this donor responds in 30 days?
   Return: score (0–100), confidence (0–1), key factors"

Response:
  "Based on [reasoning], I estimate 62% likelihood.
   Confidence: 0.70
   Factors: [list]"
```

**Dependencies:**
- `base.py` (Module 1.1)
- Claude API client (already configured in codebase)
- Donor profile data (from database)

**Tests:**
- Mock donor with high engagement → score >70
- Mock donor with recent response → score >70
- Mock donor with sparse data → Claude API fallback
- Timeout handling (2-second Claude API timeout)
- Error cases (malformed input, API failure)

**Deliverables:**
- ✅ `response_likelihood.py` with full algorithm
- ✅ Claude API integration for <50 score cases
- ✅ Unit tests (10+ scenarios)
- ✅ Integration test with worker process

**Risk:** **Claude API latency** for low-confidence cases
- **Mitigation:** 2-second timeout; fall back to rule-only if API slow; cache results

---

### Module 1.3: Channel Preference Model

**Owner:** Senior Backend Engineer  
**Duration:** Week 2  
**Deliverable:** `backend/src/services/predictive_heads/models/channel_preference.py`

**Purpose:**  
Predict: "Which channel (Email / SMS / Phone / LinkedIn) is best?"

**Inputs:**
```python
{
    "donor_id": "uuid",
    "email_optout": False,
    "sms_optout": False,
    "do_not_call": False,
    "linkedin_optout": False,
    "response_rate_email": 0.35,  # Lifetime response rate by channel
    "response_rate_sms": 0.12,
    "response_rate_phone": 0.45,
    "response_rate_linkedin": 0.08,
    "last_contact_email_days": 14,
    "last_contact_phone_days": 90,
    "age": 68,  # For demographic adjustment
}
```

**Output:**
```python
{
    "channels": ["Phone", "Email", "SMS"],  # Ranked
    "confidence": 0.85,
    "reasoning": "Recommended channel order: Phone, Email, SMS"
}
```

**Algorithm:**

```
Step 1: Compliance filter (honor all opt-outs)
  - Remove any opted-out channels
  → allowable_channels = ["Email", "Phone", "SMS", "LinkedIn"]

Step 2: Score by historical response rate
  For each allowed channel:
    response_rate = (responses / sends) over last 12 months
    recency_boost = 1.15 if last_contact < 30 days else 1.0
    channel_score = response_rate × recency_boost

Step 3: Rank channels 1–4
  primary = highest score
  secondary = 2nd highest
  tertiary = 3rd highest

Step 4: Apply demographic insights
  If age > 70:
    → Boost Phone by 15%
    → De-boost SMS by 10%

Output: {channels: [ranked], confidence, reasoning}
```

**No Claude API needed** — pure rules.

**Dependencies:**
- `base.py` (Module 1.1)
- Donor engagement data (email opens, calls answered, SMS reads, etc.)

**Tests:**
- Donor with email_optout=True → Email not in output
- All channels opted out → error output with helpful message
- Elderly donor (age > 70) → Phone ranked higher
- High phone response rate → Phone primary
- Recency boost working (recent channel ranked higher)

**Deliverables:**
- ✅ `channel_preference.py` with full algorithm
- ✅ Compliance filter logic
- ✅ Demographic boosting
- ✅ Tests (10+ scenarios)

**Risk:** None (straightforward rules)

---

### Module 1.4: Ask Timing Model

**Owner:** Senior Backend Engineer  
**Duration:** Week 2–3  
**Deliverable:** `backend/src/services/predictive_heads/models/ask_timing.py`

**Purpose:**  
Predict: "When should we solicit this donor?"

**Inputs:**
```python
{
    "donor_id": "uuid",
    "days_since_last_gift": 120,
    "class_year": 1990,  # For reunion detection
    "engagement_score": 65,
    "touches_last_60d": 2,  # Recent engagement level
    "recent_notes": "..."
}
```

**Output:**
```python
{
    "recommendation": "optimal_window",  # or "wait_30_days", "good_window", "critical_overdue", "stewardship_first"
    "start_window": "2026-03-15",
    "end_window": "2026-04-15",
    "confidence": 0.78,
    "reasoning": "90-day gift cycle: optimal ask window"
}
```

**Algorithm:**

```
Step 1: Base timing from gift recency
  If days_since_gift < 30:   → "wait_30_days" (30–60 day window)
  If days_since_gift < 90:   → "optimal_window" (next 30 days)
  If days_since_gift < 180:  → "good_window" (next 60 days)
  If days_since_gift > 360:  → "critical_overdue" (immediate)

Step 2: Overlay seasonal factors
  Reunion year? (class_year % 5 == 0) → boost by 30%
  October–December (year-end)? → boost by 20%
  June (fiscal year-end)? → boost by 15%
  
Step 3: Suppress if engagement declining
  If touches_last_60d == 0 AND engagement_score < 40:
    → "stewardship_first" (send stewardship, revisit in 60 days)

Step 4: Claude API for edge cases
  If recommendation in ["critical_overdue", "stewardship_first"]:
    → Claude evaluates: "Does it make sense to ask now? Any notes?"
    → Returns adjusted window + confidence

Output: {recommendation, start_window, end_window, confidence, reasoning}
```

**Dependencies:**
- `base.py` (Module 1.1)
- Claude API client (for edge cases)
- Donor gift + engagement data

**Tests:**
- Recent gift (30 days) → "wait_30_days"
- 90-day-old gift → "optimal_window"
- 18-month-old gift + low engagement → "stewardship_first" + Claude evaluation
- Reunion year → window boosted
- Year-end season → confidence boosted
- Declining engagement → stewardship_first recommended

**Deliverables:**
- ✅ `ask_timing.py` with full algorithm
- ✅ Gift recency logic
- ✅ Seasonal overlay
- ✅ Claude API edge case handling
- ✅ Tests

**Risk:** **Seasonal patterns may be institution-specific**
- **Mitigation:** Make seasonality configurable per institution; track actual patterns; allow staff override

---

### Module 1.5: Lapse Risk Model

**Owner:** Senior Backend Engineer  
**Duration:** Week 3–4  
**Deliverable:** `backend/src/services/predictive_heads/models/lapse_risk.py`

**Purpose:**  
Predict: "Will this donor stop giving in the next 12 months?"

**Inputs:**
```python
{
    "donor_id": "uuid",
    "days_since_last_gift": 400,
    "lifetime_gifts": 12,
    "years_giving": 8,
    "avg_gift_amount": 3500,
    "engagement_score": 45,
    "avg_gift_3yr": 3200,
    "avg_gift_1yr": 2800,  # Declining
    "touches_last_180d": 1,
    "life_event_flags": ["health_decline"],
    "mgr_changed_recently": False
}
```

**Output:**
```python
{
    "score": 68,  # 0–100
    "tier": "HIGH",  # LOW, MEDIUM, HIGH, CRITICAL
    "confidence": 0.82,
    "reasoning": "Long-term donor; 13+ months since gift; declining trajectory"
}
```

**Algorithm:**

**Segment A: Long-Term Annual Donors** (5+ years, 5+ gifts)
```
Base risk = 10
+35 if no gift in 12 months
+50 if no gift in 18 months
+20 if no engagement in 6 months
+15 if declining trajectory (avg_1yr < avg_3yr × 0.9)
Result: 0–100, clamped
```

**Segment B: Major Donors** (5+ years, avg > $10K)
```
Base risk = 15
+40 if no gift in 18 months
+25 if relationship manager changed
+30 if no stewardship in 6 months
+20 if declining trajectory
Result: 0–100, clamped
```

**Segment C: Young Alumni** (1–3 years, <3 gifts)
```
Base risk = 40  # Higher baseline; normal churn
+20 if no gift in 12 months
+15 if weak engagement
-25 if year-2 retention achieved (CRITICAL MILESTONE)
Result: 0–100, clamped
```

**Segment D: Prospects/Lapsed** (>18 months no gift)
```
Base risk = 70  # Already churned
+20 if no engagement in 12 months
-20 if recent life event (reactivation opportunity)
Result: 0–100, clamped
```

**Cross-Segment:**
```
Life events:
  Positive (promotion, IPO, inheritance): -10
  Negative (health decline, retirement): +15
```

**Risk Tiers:**
- LOW: 0–25
- MEDIUM: 26–50
- HIGH: 51–75
- CRITICAL: 76–100

**Dependencies:**
- `base.py` (Module 1.1)
- Donor gift history + engagement data
- Life event detection (may come from external API or CRM)

**Tests:**
- Annual donor, 8 gifts in 8 years, 6-month gap → LOW risk
- Annual donor, no gift in 18 months → HIGH/CRITICAL risk
- Major donor, 4-month gap, strong stewardship → LOW risk
- Young alumni, 1 gift, 12+ months no gift, year 1 → MEDIUM/HIGH (normal)
- Young alumni, 2 gifts, year 2, engagement stable → LOW (milestone reward)
- Prospect, 24 months no gift, recent promotion → MEDIUM (reactivation signal)

**Deliverables:**
- ✅ `lapse_risk.py` with 4 segment logic
- ✅ Threshold configurations per segment
- ✅ Life event detection
- ✅ Tests (15+ scenarios, per-segment)

**Risk:** **Segment boundaries may be fuzzy**
- **Mitigation:** Make thresholds configurable; track accuracy per segment; regular review

---

### Module 1.6: Story Sentiment & Values Extraction

**Owner:** Senior Backend Engineer  
**Duration:** Week 4–5  
**Deliverable:** `backend/src/services/predictive_heads/models/story_sentiment_values.py`

**Purpose:**  
Extract: donor values, emotional drivers, interests, storytelling hooks.

**Inputs:**
```python
{
    "donor_id": "uuid",
    "gift_funds": ["STEM Scholarship", "Engineering Research", "Graduate Fellowship"],
    "recent_notes": "John mentioned his passion for first-generation students...",
    "recent_communications": [
        "Email from donor: 'My scholarship changed my life'",
        "Call note: Enthusiastic about impact stories"
    ],
    "wealth_data": {"interests": ["education", "innovation"], ...}
}
```

**Output:**
```python
{
    "core_values": ["Education", "STEM", "Equity"],
    "emotional_drivers": ["Gratitude", "Legacy", "Impact"],
    "interests": ["Diversity scholarships", "First-generation student support"],
    "storytelling_hooks": [
        "Overcame family financial hardship; values access",
        "Multiple generations attended university"
    ],
    "sentiment": "positive",
    "sentiment_trend": "stable",
    "confidence": 0.85
}
```

**Algorithm:**

```
Step 1: Extract explicit values from gift history
  gift_funds = ["STEM Scholarship", "Engineering Research", ...]
  Map fund names to value tags:
    "STEM Scholarship" → "STEM", "Scholarships", "Education"
    "Research" → "Research"
    ...
  → explicit_values = ["STEM", "Education", "Research"]

Step 2: Claude API for deep extraction from unstructured data
  Prompt Claude with:
    - Last 10 donor notes
    - Recent communications
    - Gift fund choices
    - Wealth API behavioral data
  
  Task:
    1. Identify 3–5 core values
    2. What emotional drivers motivate them?
    3. Specific interests/programs?
    4. Storytelling hooks (personal connections)?
    5. Current sentiment? (positive/neutral/at_risk)
    6. Sentiment trend? (improving/stable/cooling)

Step 3: Merge explicit + inferred values
  Explicit: ["STEM", "Education"]
  Inferred from Claude: ["Equity", "Mentorship"]
  Merged: ["STEM", "Education", "Equity", "Mentorship"]

Step 4: Confidence scoring (based on data richness)
  Data richness = 0
  +0.25 if explicit values found
  +0.25 if donor notes present
  +0.25 if communications found
  +0.25 if 3+ gifts
  confidence = data_richness

Output: {core_values, emotional_drivers, interests, hooks, sentiment, trend, confidence}
```

**Dependencies:**
- `base.py` (Module 1.1)
- Claude API client
- Donor notes + communication history
- Wealth API data

**Tests:**
- Rich donor profile (many notes, many gifts) → confidence >0.75
- Sparse profile (1 gift, no notes) → confidence <0.50
- Positive sentiment in notes → sentiment = "positive"
- No mentions of giving → sentiment = "neutral"
- Declining touches + negative notes → sentiment_trend = "cooling"
- Claude API timeout → fallback to explicit values only

**Deliverables:**
- ✅ `story_sentiment_values.py`
- ✅ Fund-to-value mapping
- ✅ Claude API integration for unstructured text
- ✅ Sentiment + trend detection
- ✅ Tests

**Risk:** **Claude API cost & latency for 50K+ donors**
- **Mitigation:** Batch processing; cache results for 30 days; process only on new notes/communication; cost monitoring

---

### Module 1.7: Stewardship Need Model

**Owner:** Senior Backend Engineer  
**Duration:** Week 5  
**Deliverable:** `backend/src/services/predictive_heads/models/stewardship_need.py`

**Purpose:**  
Predict: "How much stewardship/relationship work does this donor need?"

**Inputs:**
```python
{
    "donor_id": "uuid",
    "lifetime_gift_total": 18500,
    "major_donor_flag": False,
    "is_first_time_donor": False,
    "engagement_trend": "stable"  # or "improving", "declining"
}
```

**Output:**
```python
{
    "level": "Standard",  # Light, Moderate, Standard, Enhanced, Premium
    "cadence": "Bi-monthly",
    "max_days_between_touches": 60,
    "priority": "normal",
    "examples": ["Bi-monthly impact report", "Annual event invite"]
}
```

**Algorithm:**

```
Step 1: Base level from gift size
  < $1K:        Light (2–3 touches/year, 180 days max)
  $1K–$5K:      Moderate (quarterly, 90 days max)
  $5K–$25K:     Standard (bi-monthly, 60 days max)
  $25K–$100K:   Enhanced (monthly, 30 days max)
  > $100K:      Premium (bi-weekly+, 14 days max)

Step 2: Escalate if major donor
  If major_donor_flag = True:
    → Move up one level

Step 3: Escalate if first-time donor
  If is_first_time_donor = True:
    → Move up one level (onboarding)

Step 4: Escalate if engagement declining
  If engagement_trend = "declining":
    → Move up one level (intervention)

Step 5: De-escalate if engagement improving
  If engagement_trend = "improving":
    → No change; monitor (confirmation)

Output: {level, cadence, max_days, priority}
```

**No Claude API needed** — pure rules.

**Dependencies:**
- `base.py` (Module 1.1)
- Donor gift + engagement data

**Tests:**
- $500 gift, no flags → "Light"
- $500 gift, first-time → "Moderate" (escalated)
- $500 gift, first-time, declining engagement → "Standard" (escalated 2x)
- $50K gift → "Enhanced"
- $50K major donor → "Premium"
- Cadence matches level (Standard = "Bi-monthly", max 60 days)

**Deliverables:**
- ✅ `stewardship_need.py` with 5-level framework
- ✅ Escalation logic
- ✅ Tests

**Risk:** None (deterministic rules)

---

### Module 1.8: Prediction Service Orchestrator

**Owner:** Senior Backend Engineer  
**Duration:** Week 5–6  
**Deliverable:** `backend/src/services/predictive_heads/services/prediction_service.py`

**Purpose:**  
Orchestrate all 6 Phase 1 models. Run in worker process. Store results in database.

**Interface:**

```python
class PredictionService:
    def compute_all_scores(self, donor_id: str) -> Dict[str, PredictionOutput]:
        """
        Run all 6 models for a single donor.
        Return: {model_name: PredictionOutput, ...}
        """
        pass
```

**Workflow:**

```
1. Load donor profile from DB
   - Gift history
   - Engagement data
   - Notes
   - Wealth API scores (if available)
   
2. Instantiate all 6 predictors
   
3. Run in parallel (or sequential, depends on latency)
   For each predictor:
     - Call predict_safe()
     - Catch exceptions
     - Store result
   
4. Store all scores in donor_scores table
   - One row per donor (upsert)
   - JSON columns for complex outputs
   
5. Audit log
   - Record: donor_id, action="computed", scores_snapshot, timestamp
   
6. Return aggregated scores
```

**Database Schema:**

```sql
INSERT INTO donor_scores (
  id, organization_id, donor_id,
  response_likelihood,
  channel_preference,
  ask_timing,
  lapse_risk,
  lapse_risk_tier,
  sentiment_values,
  stewardship_need,
  computed_at,
  computed_by,
  confidence
) VALUES (...)
ON CONFLICT (organization_id, donor_id) DO UPDATE SET
  response_likelihood = EXCLUDED.response_likelihood,
  ...
  computed_at = NOW()
```

**Dependencies:**
- All 6 predictors (Modules 1.2–1.7)
- Database connection pool
- Claude API client
- Logger

**Tests:**
- Mock all 6 predictors; verify each called once
- Mock DB; verify upsert logic
- Mock Claude API; verify fallback on timeout
- Parallel vs. sequential execution
- Error handling (one predictor fails, others succeed)

**Deliverables:**
- ✅ `prediction_service.py`
- ✅ Parallel/sequential model execution
- ✅ Database storage + audit logging
- ✅ Error handling + graceful degradation
- ✅ Tests

**Risk:** **Database write latency for 50K+ donors**
- **Mitigation:** Batch inserts; UPSERT not INSERT; index on (donor_id, organization_id); connection pooling

---

### Module 1.9: Worker Process Integration

**Owner:** Senior Backend Engineer + DevOps  
**Duration:** Week 6  
**Deliverable:** Updates to `backend/src/workers/index.ts`

**Purpose:**  
Add a new Bull worker queue: `prediction-refresh`. Runs the prediction service on a schedule and on-demand.

**Queue Configuration:**

```javascript
const predictionQueue = new Queue('prediction-refresh', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true
  }
});
```

**Worker Process:**

```javascript
predictionQueue.process(async (job) => {
  const { donor_id, organization_id } = job.data;
  
  const predictionService = new PredictionService(db, claudeClient, logger);
  const scores = await predictionService.compute_all_scores(donor_id);
  
  logger.info(`Computed scores for donor ${donor_id}`, { scores });
  
  return { success: true, scores };
});
```

**Scheduled Refresh (Cron):**

```javascript
scheduleRecurringJob('refresh-predictions', '*/15 * * * *', async () => {
  const activeDonors = await db.query(`
    SELECT id, organization_id FROM donors
    WHERE last_interaction > NOW() - INTERVAL '90 days'
    LIMIT 5000  -- Batch size
  `);
  
  for (const donor of activeDonors) {
    await predictionQueue.add(
      { donor_id: donor.id, organization_id: donor.organization_id },
      { jobId: `${donor.id}-${Date.now()}`, delay: Math.random() * 30000 }
    );
  }
});
```

**On-Demand API (imperative refresh):**

```javascript
app.post('/api/predictions/compute/:donor_id', authenticate, async (req, res) => {
  const job = await predictionQueue.add(
    { donor_id: req.params.donor_id, organization_id: req.user.organization_id },
    { priority: 10 }  // High priority
  );
  
  res.json({ job_id: job.id, status: 'queued' });
});

app.get('/api/predictions/status/:job_id', authenticate, async (req, res) => {
  const job = await predictionQueue.getJob(req.params.job_id);
  res.json({
    id: job.id,
    state: await job.getState(),
    progress: job.progress(),
    result: job.returnvalue
  });
});
```

**Configuration:**

- Queue concurrency: 2 workers (start), scale to 10 if needed
- Batch size: 5,000 active donors per cron run
- Retry: 3 attempts with exponential backoff
- Job timeout: 60 seconds per donor (should be <10s normally)

**Dependencies:**
- Bull queue (already in codebase)
- Redis (already running)
- PredictionService (Module 1.8)

**Tests:**
- Mock queue add/process
- Verify job added to queue
- Verify worker executes
- Verify on-demand API returns job_id
- Verify status endpoint returns state

**Deliverables:**
- ✅ `prediction-refresh` Bull queue
- ✅ Worker process logic
- ✅ Cron job for batch refresh
- ✅ API endpoints (compute, status)
- ✅ Tests

**Risk:** **Scaling for 50K+ donors**
- **Mitigation:** Batch in chunks of 1,000; scale to 10 workers; monitor queue depth; use connection pooling

---

### Module 1.10: API Routes for Scores

**Owner:** Senior Backend Engineer  
**Duration:** Week 6–7  
**Deliverable:** `backend/src/routes/predictions.ts`

**Purpose:**  
Expose prediction scores to frontend (staff only, never public).

**Endpoints:**

**GET `/api/donors/:donor_id/predictions`**

Returns all scores for a single donor.

```
Query:
  /api/donors/abc123/predictions

Response (200):
{
  "donor_id": "abc123",
  "computed_at": "2026-03-12T10:30:00Z",
  "models": {
    "response_likelihood": 78,
    "channel_preference": ["Email", "Phone", "SMS"],
    "ask_timing": {
      "recommendation": "optimal_window",
      "start_window": "2026-03-15",
      "end_window": "2026-04-15"
    },
    "lapse_risk": {
      "score": 32,
      "tier": "MEDIUM"
    },
    "sentiment_values": {
      "core_values": ["Education", "STEM"],
      "emotional_drivers": ["Gratitude", "Legacy"]
    },
    "stewardship_need": {
      "level": "Standard",
      "cadence": "Bi-monthly",
      "max_days_between_touches": 60
    }
  }
}
```

**GET `/api/predictions/cohort`**

Bulk scores for filtering/segmentation (for dashboards, reporting).

```
Query:
  /api/predictions/cohort?lapse_risk_min=50&response_likelihood_min=70&limit=1000

Response (200):
{
  "count": 234,
  "donors": [
    {"donor_id": "xyz", "response_likelihood": 78, "lapse_risk": 32, "lapse_risk_tier": "MEDIUM"},
    ...
  ]
}
```

**POST `/api/predictions/refresh/:donor_id`**

Manually trigger score refresh for a single donor.

```
Request:
  POST /api/predictions/refresh/abc123

Response (202):
{
  "job_id": "job-1234",
  "status": "queued"
}
```

**GET `/api/predictions/:donor_id/reasoning`**

Detailed reasoning + audit trail for a specific donor.

```
Response (200):
{
  "current_scores": { ... },
  "audit_trail": [
    {
      "timestamp": "2026-03-12T10:30:00Z",
      "action": "computed",
      "scores_snapshot": { ... }
    },
    ...
  ],
  "reasoning": {
    "response_likelihood": "Based on 4 email opens in last 90 days; recent engagement 14 days ago",
    "lapse_risk": "Long-term annual donor; 9+ month gap since last gift; declining trajectory",
    ...
  }
}
```

**Authorization:**

- All endpoints require `authenticate` middleware (JWT token)
- All endpoints require `authorize(['staff'])` (advancement office staff only)
- Row-level security: staff can only see donors in their organization
- Cohort endpoint requires `authorize(['staff', 'leadership'])`

**Dependencies:**
- Express.js
- Authentication middleware
- Database queries
- PredictionService

**Tests:**
- Unauthenticated request → 401
- Staff user from different org → 403 (org_id mismatch)
- Valid staff user → 200
- Non-existent donor_id → 404
- Cohort filtering works (lapse_risk_min, response_likelihood_min)
- Reasoning includes audit trail

**Deliverables:**
- ✅ `predictions.ts` with 4 endpoints
- ✅ Single donor endpoint
- ✅ Cohort/filtering endpoint
- ✅ Manual refresh endpoint
- ✅ Reasoning/audit endpoint
- ✅ Authorization checks (staff only)
- ✅ Tests

**Risk:** None (standard REST endpoints)

---

### Module 1.11: Dashboard Visualization (Frontend)

**Owner:** Senior Frontend Engineer  
**Duration:** Week 7  
**Deliverable:** React components in `frontend/src/components/Predictions/`

**Purpose:**  
Display scores to advancement staff in the UI.

**Main Component: PredictionScoreCard**

```typescript
export const PredictionScoreCard: React.FC<{ donor_id: string }> = ({ donor_id }) => {
  const [scores, setScores] = useState<PredictionOutput | null>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    fetch(`/api/donors/${donor_id}/predictions`)
      .then(r => r.json())
      .then(data => setScores(data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [donor_id]);
  
  if (loading) return <Spinner />;
  if (!scores) return <div>No predictions available</div>;
  
  return (
    <div className="predictions-card">
      <h3>AI Insights</h3>
      
      {/* Response Likelihood: 0–100 gauge */}
      <ScoreWidget
        label="Response Likelihood"
        score={scores.models.response_likelihood}
        color={scores.models.response_likelihood > 70 ? 'green' : 'amber'}
      />
      
      {/* Channel Preference: ranked list */}
      <ChannelWidget
        channels={scores.models.channel_preference}
      />
      
      {/* Lapse Risk: tier + score */}
      <RiskWidget
        score={scores.models.lapse_risk.score}
        tier={scores.models.lapse_risk.tier}
        color={tierToColor(scores.models.lapse_risk.tier)}
      />
      
      {/* Stewardship Need: level + cadence */}
      <StewardshipWidget
        level={scores.models.stewardship_need.level}
        cadence={scores.models.stewardship_need.cadence}
      />
      
      {/* Values & Drivers */}
      <ValuesWidget
        values={scores.models.sentiment_values.core_values}
        drivers={scores.models.sentiment_values.emotional_drivers}
        sentiment={scores.models.sentiment_values.sentiment}
      />
      
      {/* Expand for detailed reasoning */}
      <button onClick={() => showDetailedReasoning(donor_id)}>
        See Detailed Reasoning
      </button>
    </div>
  );
};
```

**Sub-Components:**

- `ScoreWidget` — Displays 0–100 score with color coding
- `ChannelWidget` — Ranked list of channels (primary, secondary, tertiary)
- `RiskWidget` — Lapse risk tier + score + suggested action
- `StewardshipWidget` — Level badge + cadence explanation
- `ValuesWidget` — Values tags + emotional drivers + sentiment indicator
- `ReasoningModal` — Expandable details (algorithm explanation, audit trail)

**Styling:**

- Use Orbit design system (dark sidebar, teal accent, cream background)
- Cards with light background, subtle borders
- Color coding: green (low risk), yellow (medium), orange (high), red (critical)
- Responsive layout (mobile-friendly)

**Dependencies:**
- React 18+
- Axios or fetch
- Orbit design system components
- TypeScript

**Tests:**
- Component loads and renders scores
- Color coding matches risk tier
- Clicking "See Detailed Reasoning" opens modal
- Responsive on mobile
- Handles loading state
- Handles error state

**Deliverables:**
- ✅ `PredictionScoreCard.tsx` (main dashboard card)
- ✅ Individual score widgets
- ✅ Color coding + styling
- ✅ Reasoning modal (expandable)
- ✅ Tests

**Risk:** None (straightforward React components)

---

### Module 1.12: Database Schema Updates

**Owner:** Senior Backend Engineer  
**Duration:** Week 1 (parallel with other modules)  
**Deliverable:** `backend/src/migrations/002_donor_scores_schema.ts`

**Purpose:**  
Create `donor_scores` and `donor_scores_audit` tables.

**Schema:**

```sql
CREATE TABLE donor_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  donor_id UUID NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
  
  -- Phase 1 Model Outputs
  response_likelihood SMALLINT CHECK (response_likelihood >= 0 AND response_likelihood <= 100),
  channel_preference JSONB,
  ask_timing JSONB,
  lapse_risk SMALLINT CHECK (lapse_risk >= 0 AND lapse_risk <= 100),
  lapse_risk_tier VARCHAR(20),
  sentiment_values JSONB,
  stewardship_need JSONB,
  
  -- Phase 2 (placeholders)
  ask_amount_band JSONB,
  upgrade_propensity SMALLINT,
  planned_giving_likelihood JSONB,
  handoff_readiness JSONB,
  
  -- Metadata
  computed_at TIMESTAMP DEFAULT NOW(),
  computed_by VARCHAR(50) DEFAULT 'rule_engine',
  confidence SMALLINT CHECK (confidence >= 0 AND confidence <= 100),
  
  UNIQUE (organization_id, donor_id),
  INDEX idx_org_lapse (organization_id, lapse_risk),
  INDEX idx_org_response (organization_id, response_likelihood),
  INDEX idx_computed_at (computed_at)
);

CREATE TABLE donor_scores_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  donor_id UUID NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
  
  action VARCHAR(50),
  scores_snapshot JSONB,
  agent_decision JSONB,
  agent_name VARCHAR(50),
  staff_override_reason TEXT,
  staff_user_id UUID REFERENCES users(id),
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_donor (organization_id, donor_id, created_at),
  INDEX idx_action (action)
);
```

**Knex Migration:**

```typescript
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema
    .createTable('donor_scores', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('organization_id').notNullable().references('organizations.id');
      table.uuid('donor_id').notNullable().references('donors.id');
      table.smallint('response_likelihood').checkBetween(0, 100);
      table.jsonb('channel_preference');
      table.jsonb('ask_timing');
      table.smallint('lapse_risk').checkBetween(0, 100);
      table.string('lapse_risk_tier', 20);
      table.jsonb('sentiment_values');
      table.jsonb('stewardship_need');
      table.jsonb('ask_amount_band');
      table.smallint('upgrade_propensity');
      table.jsonb('planned_giving_likelihood');
      table.jsonb('handoff_readiness');
      table.timestamp('computed_at').defaultTo(knex.fn.now());
      table.string('computed_by', 50).defaultTo('rule_engine');
      table.smallint('confidence').checkBetween(0, 100);
      
      table.unique(['organization_id', 'donor_id']);
      table.index(['organization_id', 'lapse_risk']);
      table.index(['organization_id', 'response_likelihood']);
      table.index('computed_at');
    })
    .createTable('donor_scores_audit', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('organization_id').notNullable().references('organizations.id');
      table.uuid('donor_id').notNullable().references('donors.id');
      table.string('action', 50);
      table.jsonb('scores_snapshot');
      table.jsonb('agent_decision');
      table.string('agent_name', 50);
      table.text('staff_override_reason');
      table.uuid('staff_user_id').references('users.id');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      
      table.index(['organization_id', 'donor_id', 'created_at']);
      table.index('action');
    });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('donor_scores_audit');
  await knex.schema.dropTableIfExists('donor_scores');
}
```

**Deliverables:**
- ✅ Migration file
- ✅ Table definitions + constraints
- ✅ Indexes for performance
- ✅ Rollback function

**Risk:** None (standard migration)

---

### Module 1.13: Testing Suite

**Owner:** Code Reviewer  
**Duration:** Weeks 1–7 (continuous)  
**Deliverable:** `backend/src/services/predictive_heads/__tests__/`

**Purpose:**  
Unit + integration tests for all modules. Target: >90% code coverage.

**Test Structure:**

```
__tests__/
├── test_base_predictor.ts
├── test_response_likelihood.ts
├── test_channel_preference.ts
├── test_ask_timing.ts
├── test_lapse_risk.ts
│   ├── test_segment_annual.ts
│   ├── test_segment_major.ts
│   ├── test_segment_young_alumni.ts
│   └── test_segment_lapsed.ts
├── test_sentiment_values.ts
├── test_stewardship_need.ts
├── test_prediction_service.ts
├── test_worker_integration.ts
├── test_api_routes.ts
└── fixtures/
    ├── donor_annual.ts
    ├── donor_major.ts
    ├── donor_young_alumni.ts
    └── donor_lapsed.ts
```

**Example Test Suite (LapseRisk):**

```typescript
describe('LapseRiskPredictor', () => {
  let predictor: LapseRiskPredictor;
  
  beforeEach(() => {
    predictor = new LapseRiskPredictor('lapse_risk', mockLogger);
  });
  
  describe('Segment: Long-term Annual Donor', () => {
    it('returns LOW risk if gift in last 6 months', () => {
      const donor = fixtures.donor_annual_stable();
      const output = predictor.predict(donor);
      expect(output.score).toBeLessThan(25);
      expect(output.metadata.risk_tier).toBe('LOW');
    });
    
    it('returns MEDIUM risk if 9-month gap', () => {
      const donor = { ...fixtures.donor_annual_stable(), days_since_last_gift: 270 };
      const output = predictor.predict(donor);
      expect(output.score).toBeGreaterThan(25);
      expect(output.score).toBeLessThan(50);
      expect(output.metadata.risk_tier).toBe('MEDIUM');
    });
    
    it('returns HIGH risk if 12+ month gap', () => {
      const donor = { ...fixtures.donor_annual_stable(), days_since_last_gift: 365 };
      const output = predictor.predict(donor);
      expect(output.score).toBeGreaterThan(50);
      expect(output.metadata.risk_tier).toBe('HIGH');
    });
    
    it('returns CRITICAL risk if 18+ month gap + declining engagement', () => {
      const donor = {
        ...fixtures.donor_annual_stable(),
        days_since_last_gift: 540,
        engagement_score: 20
      };
      const output = predictor.predict(donor);
      expect(output.score).toBeGreaterThan(75);
      expect(output.metadata.risk_tier).toBe('CRITICAL');
    });
  });
  
  describe('Segment: Young Alumni', () => {
    it('accounts for normal churn (base 40)', () => {
      const donor = fixtures.donor_young_alumni();
      const output = predictor.predict(donor);
      expect(output.score).toBeGreaterThanOrEqual(40);
    });
    
    it('rewards year-2 retention milestone', () => {
      const donor_year1 = fixtures.donor_young_alumni();
      const donor_year2 = { ...donor_year1, years_giving: 2, lifetime_gifts: 2 };
      
      const score1 = predictor.predict(donor_year1).score;
      const score2 = predictor.predict(donor_year2).score;
      
      expect(score2).toBeLessThan(score1);
    });
  });
  
  describe('Life Events', () => {
    it('decreases risk on promotion', () => {
      const donor_before = fixtures.donor_annual_stable();
      const donor_after = { ...donor_before, life_event_flags: ['promotion'] };
      
      const score_before = predictor.predict(donor_before).score;
      const score_after = predictor.predict(donor_after).score;
      
      expect(score_after).toBeLessThan(score_before);
    });
    
    it('increases risk on health decline', () => {
      const donor_before = fixtures.donor_annual_stable();
      const donor_after = { ...donor_before, life_event_flags: ['health_decline'] };
      
      const score_before = predictor.predict(donor_before).score;
      const score_after = predictor.predict(donor_after).score;
      
      expect(score_after).toBeGreaterThan(score_before);
    });
  });
});
```

**Coverage Targets:**

- BasePredictor: 100%
- ResponseLikelihood: 95%+
- ChannelPreference: 95%+
- AskTiming: 90%+
- LapseRisk: 95%+ (4 segment paths)
- SentimentValues: 85%+ (Claude API mocking)
- StewardshipNeed: 95%+
- PredictionService: 90%+
- API Routes: 90%+

**Testing Tools:**

- Jest (unit + integration)
- Supertest (HTTP endpoint testing)
- Mock Claude API responses
- Mock database

**Deliverables:**
- ✅ Unit tests (all 6 models)
- ✅ Integration tests (prediction service + database)
- ✅ API endpoint tests
- ✅ Mock donor fixtures
- ✅ >90% code coverage
- ✅ CI/CD pipeline test runs

**Risk:** None (standard testing)

---

## Risk Register

### Risk 1: Claude API Latency

**Probability:** Medium  
**Impact:** High (affects response time for low-confidence predictions)

**Mitigation:**
- Set 2-second timeout on Claude API calls
- Fall back to rule-only predictions on timeout
- Cache results for 24 hours
- Batch API calls for efficiency
- Use `claude-sonnet-4` (faster than Opus) for latency-sensitive operations
- Monitor API latency; alert if >1 second

### Risk 2: Database Scaling (50K+ donors)

**Probability:** Medium  
**Impact:** Medium (batch refreshes slow down)

**Mitigation:**
- Batch inserts in chunks of 1,000
- Use UPSERT to avoid conflicts
- Index on (organization_id, donor_id)
- Connection pooling (PgBouncer)
- Read replicas for analytics queries
- Plan for horizontal scaling to 10+ worker processes
- Monitor query times; alert if >100ms

### Risk 3: Seasonal Pattern Assumptions

**Probability:** Medium  
**Impact:** Low (affects Ask Timing accuracy)

**Mitigation:**
- Make seasonality configurable per institution
- Track actual giving patterns for each institution
- Allow staff to override seasonal logic
- A/B test different seasonal assumptions
- Quarterly review of Ask Timing success metrics

### Risk 4: Data Quality (Missing/Incomplete Donor Data)

**Probability:** High  
**Impact:** Medium (some predictions unreliable)

**Mitigation:**
- Design fallback predictions for sparse data (e.g., neutral score)
- Log data quality warnings
- Provide confidence scores (lower if sparse data)
- Require minimum data thresholds for certain models
- Data quality dashboard (% of donors with complete records)

### Risk 5: Privacy/Compliance (FERPA, Consent)

**Probability:** Low  
**Impact:** High (legal risk)

**Mitigation:**
- Scores are internal staff guidance only (never exposed to donors)
- Full audit trail in `donor_scores_audit`
- Staff can override any score
- Institutional configuration for consent/opt-out
- Regular compliance review (quarterly)
- Legal review before Phase 2 launch

---

## Success Metrics

### Model Success Metrics

| Model | Target | How to Measure |
|-------|--------|---|
| Response Likelihood | 70%+ response rate for 80+ score | Actual responses vs. prediction |
| Channel Preference | 65%+ opens from preferred channel | Opens by channel vs. model |
| Ask Timing | 50%+ response in recommended window | Aggregate response rates |
| Ask Amount Band | 45%+ acceptance for banded asks | Yes/no/decline by band |
| Stewardship Need | +5–10% retention vs. baseline | Cohort retention analysis |
| Sentiment & Values | +15% open rate with values-aligned messaging | A/B test: generic vs. aligned |

### Platform Success Metrics

- **Week 1:** Live scores visible in dashboard (VEO/VSO can view)
- **Week 2:** First agent uses response likelihood score to decide outreach
- **Week 4:** Stewardship calendar auto-generated from stewardship need model
- **Week 8:** 80%+ of active donors have current scores; <5% errors

---

## Timeline & Milestones

| Week | Modules | Deliverable | Status |
|------|---------|-------------|--------|
| 1 | 1.1, 1.2, 1.12 | Base class, Response Likelihood, DB schema | Not Started |
| 2 | 1.3, 1.4 | Channel Preference, Ask Timing | Not Started |
| 3 | 1.5 | Lapse Risk | Not Started |
| 4 | 1.6 | Sentiment & Values | Not Started |
| 5 | 1.7, 1.8 | Stewardship Need, Prediction Service | Not Started |
| 6 | 1.9, 1.10 | Worker Integration, API Routes | Not Started |
| 7 | 1.11 | Dashboard Components | Not Started |
| 8 | 1.13 | Full Test Suite, E2E testing, Polish | Not Started |

---

## Dependencies & Blockers

### Inter-Module Dependencies

```
Module 1.1 (Base)
  ├── 1.2 (Response Likelihood)
  ├── 1.3 (Channel Preference)
  ├── 1.4 (Ask Timing)
  ├── 1.5 (Lapse Risk)
  ├── 1.6 (Sentiment & Values)
  └── 1.7 (Stewardship Need)
       ↓
  1.8 (Prediction Service) — depends on all 6 above
       ↓
  1.9 (Worker) — depends on 1.8
  1.10 (API Routes) — depends on 1.8
       ↓
  1.11 (Frontend) — depends on 1.10
       ↓
  1.13 (Tests) — continuous throughout
```

**Critical Path:** 1.1 → {1.2, 1.3, 1.4, 1.5, 1.6, 1.7} → 1.8 → 1.9 → 1.10 → 1.11

### External Blockers

- **Claude API availability:** If Anthropic API is down, Models 1.2, 1.4, 1.6 cannot compute Claude reasoning. **Mitigation:** Fallback to rule-only predictions.
- **Database connectivity:** If PostgreSQL unavailable, no scores can be stored. **Mitigation:** Implement connection retry logic; queue jobs until DB is back.
- **Redis availability:** If Redis down, Bull queue cannot function. **Mitigation:** Implement connection retry; fall back to synchronous execution if needed.

---

## Team Sign-Off

Before Week 1 kickoff, the following must approve:

- **Lead Software Architect:** ✅ Sign off on architecture
- **Senior Backend Engineer:** ✅ Sign off on module specs + estimates
- **Senior Frontend Engineer:** ✅ Sign off on Dashboard design + API contract
- **Security Engineer:** ✅ Sign off on privacy + compliance approach
- **DevOps Engineer:** ✅ Sign off on worker scaling + database performance
- **Code Reviewer:** ✅ Sign off on testing strategy

---

**End of IMPLEMENTATION_ROADMAP.md**

Ready for team review. Questions or blockers? Escalate before Week 1.
