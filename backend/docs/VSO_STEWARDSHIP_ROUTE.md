# VSO Stewardship Route — POST /api/agents/vso/run

## Overview

The new `POST /api/agents/vso/run` endpoint executes the Virtual Stewardship Officer (VSO) stewardship decision engine on a donor JSON object. It determines the optimal stewardship action, channel, timing, and messaging strategy without requiring a database lookup.

**Key Features:**
- ✅ Accepts donor JSON object directly (no database required)
- ✅ Implements Python stewardship_engine.py logic in JavaScript
- ✅ Returns structured decision with formatted prompt for Claude AI
- ✅ Handles all 9 decision priorities (life events → relationship warmth)
- ✅ Classifies donors into 6 gift tiers (micro → principal)
- ✅ Archetype-specific tone recommendations

---

## Endpoint

```
POST /api/agents/vso/run
```

**No authentication required** — This is a stateless decision engine for testing/development.

---

## Request Body

Send a JSON object with the donor's profile:

```json
{
  "id": "vso-001",
  "firstName": "Robert",
  "lastName": "Chen",
  "email": "rchen@email.com",
  "archetype": "LOYAL_ALUMNI",
  "journeyStage": "stewardship",
  "lastGiftCents": 50000,
  "totalGiving": 11200,
  "givingStreak": 22,
  "daysSinceLastGift": 340,
  "daysSinceLastContact": 95,
  "bequeathScore": 55,
  "upgradeReady": false,
  "pledgeInstallmentDueSoon": false
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `firstName` | string | Donor's first name |
| `lastName` | string | Donor's last name |

### Optional Fields (Donor Profile)

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `id` | string | Donor ID | "N/A" |
| `email` | string | Email address | — |
| `archetype` | string | Donor psychographic (see below) | "LOYAL_ALUMNI" |
| `journeyStage` | string | Donor lifecycle stage | "stewardship" |
| `lastGiftCents` | number | Most recent gift amount (in cents) | 0 |
| `lastGiftAmount` | number | Most recent gift (in dollars) — used if lastGiftCents absent | — |
| `totalGiving` | number | Lifetime giving amount (in dollars or cents, auto-detected) | 0 |
| `givingStreak` | number | Years of consecutive giving | 0 |
| `bequeathScore` | number | Planned giving propensity (0–100) | 0 |
| `upgradeReady` | boolean | Is donor ready for upgrade ask? | false |
| `pledgeInstallmentDueSoon` | boolean | Is pledge payment due soon? | false |

### Optional Fields (Algorithm Control)

You can override the default decision parameters by passing these in the request body:

```json
{
  ...donor profile...,
  "daysSinceLastGift": 340,
  "daysSinceLastContact": 95,
  "lapse_risk": {
    "tier": "high",
    "score": 0.75,
    "days_since_last_gift": 340
  },
  "recognition_events": [
    {
      "event_type": "MILESTONE_GIVING_LEVEL",
      "description": "Crossing $50K lifetime giving",
      "urgency": "high",
      "society_upgrade": true
    }
  ],
  "life_events": [
    {
      "event_type": "BEREAVEMENT",
      "urgency": "high",
      "detail": "Spouse passed away"
    }
  ]
}
```

### Supported Archetypes

```
LEGACY_BUILDER       — Long-term institution builder, values legacy
COMMUNITY_CHAMPION   — Mission-driven, wants community impact
IMPACT_INVESTOR      — Data-focused, ROI-oriented, outcomes-driven
LOYAL_ALUMNI         — Identity-based, nostalgic, consistent giver
MISSION_ZEALOT       — Passionate about cause, urgent mindset
SOCIAL_CONNECTOR     — Peer-influenced, social proof motivated
PRAGMATIC_PARTNER    — Direct, efficient, value-exchange focused
FAITH_DRIVEN         — Values-anchored, purposeful, service-oriented
```

---

## Response Body

```json
{
  "donor": {
    "id": "vso-001",
    "name": "Robert Chen",
    "archetype": "LOYAL_ALUMNI",
    "stage": "stewardship",
    "totalGiving": 11200,
    "givingStreak": 22
  },
  "decision": {
    "action": "renewal_nudge",
    "tier": "annual",
    "urgency": "medium",
    "channel": "email",
    "tone": "nostalgic, identity-affirming, belonging",
    "content_themes": [
      "Proactive renewal before lapse occurs",
      "Reference their giving streak / loyalty",
      "Show concrete impact from their previous gift",
      "Make renewal feel like the natural continuation of their story"
    ],
    "cta": "Renew your $500 gift",
    "ask_amount_cents": 50000,
    "escalate_to_human": false,
    "hold_days": 0,
    "rationale": "High lapse risk: 340 days since last gift."
  },
  "prompt_formatted": "ACTION: RENEWAL NUDGE\nTIER: ANNUAL\nURGENCY: MEDIUM\nCHANNEL: email\nTONE ANCHOR: nostalgic, identity-affirming, belonging\n\nCONTENT DIRECTIVES:\n  • Proactive renewal before lapse occurs\n  • Reference their giving streak / loyalty\n  • Show concrete impact from their previous gift\n  • Make renewal feel like the natural continuation of their story\n\nCTA: Renew your $500 gift\nASK AMOUNT: $500\n\nRATIONALE: High lapse risk: 340 days since last gift."
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `donor.id` | string | Donor ID from request |
| `donor.name` | string | Full name |
| `donor.archetype` | string | Psychographic archetype |
| `donor.stage` | string | Journey stage |
| `donor.totalGiving` | number | Lifetime giving (dollars) |
| `donor.givingStreak` | number | Years of consecutive giving |
| **decision** | object | **The stewardship decision** |
| `decision.action` | string | Recommended action (see Actions table below) |
| `decision.tier` | string | Gift tier: micro, annual, mid_level, leadership, major, principal |
| `decision.urgency` | string | immediate, high, medium, low |
| `decision.channel` | string | email, email+phone, phone, handwritten, none |
| `decision.tone` | string | Recommended tone for messaging |
| `decision.content_themes` | array[string] | Content directives for message generation |
| `decision.cta` | string | Recommended call-to-action |
| `decision.ask_amount_cents` | number | Suggested ask amount (0 = no ask) |
| `decision.escalate_to_human` | boolean | Should this be escalated to gift officer? |
| `decision.hold_days` | number | Days to wait before contacting (0 = contact now) |
| `decision.rationale` | string | Why this action was chosen |
| `prompt_formatted` | string | Formatted decision for injection into Claude system prompt |

---

## Stewardship Actions

The engine returns one of these actions:

| Action | Trigger | Example |
|--------|---------|---------|
| `gift_acknowledgment` | Gift received within 24 hours | Thank donor for $500 gift |
| `impact_report` | Scheduled update (90+ days since contact) | Quarterly fund impact story |
| `renewal_nudge` | High lapse risk | "Renew your annual gift" |
| `upgrade_ask` | Strong engagement + ready for upgrade | "Deepen your impact" |
| `milestone_recognition` | Anniversary or society crossing | "20-year giving streak!" |
| `soft_solicitation` | Cultivation → readiness | Gentle ask after engagement |
| `estate_seed` | High bequest score (≥65) + leadership tier | Legacy giving education |
| `lapse_warm_outreach` | Critical lapse (12+ months) | Reconnect, no ask |
| `lapse_soft_ask` | High lapse risk | "We miss you" + soft ask |
| `relationship_checkup` | Default / maintenance | "How are you?" |
| `giving_day_prep` | Pre-Giving Day period | Giving Day motivation |
| `society_welcome` | Newly crossed giving level | Welcome to society |
| `matching_gift_alert` | Unclaimed match available | Employer match opportunity |
| `pledge_reminder` | Pledge installment due | Payment reminder + warmth |
| `event_invitation` | Stewardship event | Recognition event invite |
| `named_fund_update` | Named/scholarship donor | "Your scholarship impact" |
| `escalate_to_mgo` | Estate event / major capacity signal | Hand off to gift officer |

---

## Decision Priority (Evaluated in Order)

The engine follows this decision hierarchy:

1. **Life Event Overrides** — Bereavement, opt-out request, estate planning event → escalate/hold
2. **Post-Gift Acknowledgment** — Within 24 hours of gift → immediate thank you
3. **Pledge Reminder** — Upcoming pledge installment → payment reminder
4. **Recognition Milestones** — Anniversary, giving level crossed → celebration
5. **Lapse Risk Intervention** — Days since gift indicates lapse risk → reactivation
6. **Upgrade Pathway** — Strong streak + engagement → upgrade ask
7. **Estate/Planned Giving Seed** — High bequest score (≥65) → legacy conversation
8. **Impact Report** — Scheduled update (90+ days) → impact story
9. **Relationship Warmth** — Default → relationship maintenance

---

## Gift Tier Classification

Donors are classified by their **most recent gift** or **average gift**:

| Tier | Amount | Annual Touchpoints | Channel |
|------|--------|-------------------|---------|
| Micro | <$100 | 2 | Email |
| Annual | $100–$999 | 4 | Email |
| Mid-Level | $1,000–$9,999 | 6 | Email |
| Leadership | $10,000–$24,999 | 10 | Email + Phone |
| Major | $25,000–$99,999 | 14 | Phone |
| Principal | $100,000+ | 0 (human-managed) | Handwritten |

---

## Examples

### Example 1: Recent Donor (Post-Gift)

**Request:**
```json
{
  "firstName": "Zoe",
  "lastName": "Martinez",
  "archetype": "MISSION_ZEALOT",
  "lastGiftCents": 5000,
  "totalGiving": 50,
  "givingStreak": 1,
  "daysSinceLastGift": 2
}
```

**Response:**
```json
{
  "decision": {
    "action": "gift_acknowledgment",
    "urgency": "immediate",
    "channel": "email",
    "cta": "No ask — this is pure gratitude",
    "rationale": "Post-gift acknowledgment within 24 hours for $50 gift."
  }
}
```

---

### Example 2: Upgrade-Ready Donor

**Request:**
```json
{
  "firstName": "Patricia",
  "lastName": "Okafor",
  "archetype": "IMPACT_INVESTOR",
  "lastGiftCents": 500000,
  "totalGiving": 52000,
  "givingStreak": 10,
  "daysSinceLastGift": 45,
  "daysSinceLastContact": 45,
  "upgradeReady": true
}
```

**Response:**
```json
{
  "decision": {
    "action": "upgrade_ask",
    "tier": "mid_level",
    "urgency": "medium",
    "channel": "email",
    "ask_amount_cents": 675000,
    "cta": "Deepen your impact with a $6,750 gift this year",
    "rationale": "Upgrade-ready: 10-year streak, strong engagement."
  }
}
```

---

### Example 3: Planned Giving Prospect

**Request:**
```json
{
  "firstName": "Margaret",
  "lastName": "Holloway",
  "archetype": "FAITH_DRIVEN",
  "lastGiftCents": 300000,
  "totalGiving": 48500,
  "givingStreak": 15,
  "daysSinceLastGift": 280,
  "bequeathScore": 82
}
```

**Response:**
```json
{
  "decision": {
    "action": "estate_seed",
    "urgency": "low",
    "channel": "email+phone",
    "escalate_to_human": true,
    "cta": "Download Legacy Giving Guide (soft CTA)",
    "rationale": "Bequest score 82 ≥ 65 — planned giving seed conversation appropriate."
  }
}
```

---

### Example 4: Lapsed Donor

**Request:**
```json
{
  "firstName": "Sandra",
  "lastName": "Reinholt",
  "archetype": "PRAGMATIC_PARTNER",
  "journeyStage": "lapsed_outreach",
  "lastGiftCents": 2500000,
  "totalGiving": 87000,
  "givingStreak": 0,
  "daysSinceLastGift": 540,
  "lapse_risk": {
    "tier": "critical",
    "days_since_last_gift": 540
  }
}
```

**Response:**
```json
{
  "decision": {
    "action": "lapse_warm_outreach",
    "tier": "major",
    "urgency": "high",
    "channel": "phone",
    "cta": "Reply or click — conversational engagement",
    "ask_amount_cents": 0,
    "rationale": "Critical lapse risk: 540 days since last gift."
  }
}
```

---

## Testing

Run the included test suite:

```bash
cd /path/to/orbit-backend
node tests/vso-stewardship.test.js
```

This will:
- Test all 5 demo donors against the stewardship engine
- Show example request/response JSON format
- Validate decision logic across all action types

---

## Implementation Details

### Files

- **Service**: `services/stewardship-engine.js` — Core decision logic (ported from Python)
- **Route**: `src/routes/agents.js` — Endpoint handler (new POST /api/agents/vso/run)
- **Tests**: `tests/vso-stewardship.test.js` — Demo donors and test cases

### Key Functions

```javascript
// Classify donor by gift amount
classifyTier(lastGiftCents, totalGivingCents) → GiftTier

// Main decision engine
decideStewAction(donor, { lapse_risk, recognition_events, life_events, days_since_last_gift, days_since_last_contact }) → StewDecision

// Format decision for Claude system prompt
formatDecisionForPrompt(decision) → string

// Calculate upgrade ask amount
calculateUpgradeAsk(lastGiftCents, tier) → cents
```

---

## Next Steps

1. **Integrate with Claude API** — Use `prompt_formatted` as system context for VSO message generation
2. **Add lapse predictor** — Compute lapse_risk from historical data
3. **Add recognition engine** — Detect giving milestones, anniversaries
4. **Add life event detector** — Parse emails/signals for life events
5. **Production authentication** — Add org_id tenant scope + JWT auth

---

## Notes

- **No database required** — Completely stateless decision engine
- **Python compatibility** — Logic ported from Python stewardship_engine.py
- **Claude-ready** — Output includes formatted prompt for Claude API injection
- **Extensible** — Easy to add new actions or decision paths
- **Testing-friendly** — Pass test donors as request body

---

*Created: March 12, 2026*
*Part of Orbit Fundraising Intelligence Platform*
