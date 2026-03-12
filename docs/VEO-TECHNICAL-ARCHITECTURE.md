# Virtual Engagement Officer (VEO) — Technical Architecture Document

## For Engineering & Implementation Teams

**Version:** 1.0
**Date:** March 2026
**Platform:** Orbit

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [VEO Intelligence Core](#2-veo-intelligence-core)
3. [CRM Adapter Layer](#3-crm-adapter-layer)
4. [Omnichannel Communication Layer](#4-omnichannel-communication-layer)
5. [Data Architecture](#5-data-architecture)
6. [Analytics & Intelligence Layer](#6-analytics--intelligence-layer)
7. [Security & Compliance](#7-security--compliance)
8. [Scalability & Performance](#8-scalability--performance)
9. [Integration Specifications](#9-integration-specifications)

---

## 1. System Overview

### 1.1 Architecture Diagram

```
+-----------------------------------------------------------------------+
|                        CLIENT LAYER                                     |
|  React SPA (advancement staff dashboard)                               |
|  Public donor portal (opt-in, giving, preferences)                     |
|  Mobile-responsive donor-facing touchpoints                            |
+-----------------------------------+-----------------------------------+
                                    | HTTPS / REST / WebSocket
+-----------------------------------v-----------------------------------+
|                         API SERVER                                      |
|  Express + TypeScript                                                   |
|  Auth: JWT (15m access) + Refresh (30d)                                |
|  Middleware: helmet, cors, rate-limit, validate, audit                  |
|  Routes: /auth /donors /agents /gifts /pledges /campaigns              |
|          /analytics /integrations /webhooks /portal                     |
+--------+------------------+------------------+------------------------+
         |                  |                  |
+--------v------+  +--------v--------+  +------v------------------------+
|  PostgreSQL   |  |     REDIS       |  |     WORKER FLEET              |
|  Primary DB   |  |  Bull queues    |  |  agent-scheduler (15min cron) |
|  Multi-tenant |  |  Session cache  |  |  agent-runs (x10 concurrency) |
|  Row-level    |  |  Rate limiting  |  |  outreach (x20 concurrency)   |
|  security     |  |  PubSub         |  |  agent-replies (x10)          |
|  (org_id)     |  |                 |  |  gifts (x5)                   |
+--------+------+  +--------+--------+  |  signal-ingestion (x3)       |
         |                  |            |  crm-sync (x3)               |
         |                  |            +------+------------------------+
         |                  |                   |
         |                  |           +-------v-----------------------+
         |                  |           |   VEO INTELLIGENCE CORE       |
         |                  |           |                                |
         |                  |           |  +- Persona Engine ----------+|
         |                  |           |  |  Institutional voice       ||
         |                  |           |  |  Donor-adaptive tone       ||
         |                  |           |  +---------------------------+||
         |                  |           |                                |
         |                  |           |  +- Decision Engine ---------+|
         |                  |           |  |  Predictive contact score  ||
         |                  |           |  |  Stage progression logic   ||
         |                  |           |  |  Ask readiness assessment  ||
         |                  |           |  +---------------------------+||
         |                  |           |                                |
         |                  |           |  +- Content Engine ----------+|
         |                  |           |  |  Claude API               ||
         |                  |           |  |  Archetype-adapted copy    ||
         |                  |           |  |  Template selection        ||
         |                  |           |  +---------------------------+||
         |                  |           |                                |
         |                  |           |  +- Signal Engine -----------+|
         |                  |           |  |  SEC, News, iWave, DS     ||
         |                  |           |  |  Email engagement tracking ||
         |                  |           |  |  Web activity monitoring   ||
         |                  |           |  +---------------------------+||
         |                  |           |                                |
         |                  |           |  +- Memory System -----------+|
         |                  |           |  |  Conversation history      ||
         |                  |           |  |  Decision audit trail      ||
         |                  |           |  |  Donor intelligence cache  ||
         |                  |           |  +---------------------------+||
         |                  |           +------+------------------------+
         |                  |                  |
         |                  |           +------v------------------------+
         |                  |           |  ANTHROPIC CLAUDE API          |
         |                  |           |  claude-opus-4-5               |
         |                  |           +-------------------------------+
         |
+--------v---------------------------------------------------------+
|                    CRM ADAPTER LAYER                              |
|  +------------------+  +------------------+  +-----------------+ |
|  | Salesforce NPSP  |  | Blackbaud RE NXT |  | Ellucian Advance| |
|  | (jsforce REST)   |  | (SKY API v1)     |  | (REST API)      | |
|  +------------------+  +------------------+  +-----------------+ |
|  +------------------+  +------------------+                      |
|  | HubSpot CRM      |  | Generic Adapter  |  (future CRMs)     |
|  | (API v3)         |  | (interface only) |                      |
|  +------------------+  +------------------+                      |
+------------------------------------------------------------------+
|                    COMMUNICATION LAYER                             |
|  +----------+  +--------+  +----------+  +---------+  +--------+ |
|  | SendGrid |  | Twilio |  | DocuSign |  | Portal  |  | Social | |
|  | (Email)  |  | (SMS)  |  | (eSig)   |  | (Chat)  |  | (API)  | |
|  +----------+  +--------+  +----------+  +---------+  +--------+ |
+------------------------------------------------------------------+
|                    PAYMENT LAYER                                   |
|  +---------+                                                      |
|  | Stripe  |  Payment intents, subscriptions, webhooks            |
|  +---------+                                                      |
+------------------------------------------------------------------+
```

### 1.2 Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| API Server | Express + TypeScript | Proven ecosystem, strong typing for safety |
| Database | PostgreSQL + Knex | ACID compliance, JSONB flexibility, RLS |
| Queue | Bull + Redis | Battle-tested job queues, retry/backoff, cron |
| AI | Anthropic Claude (Opus 4.5) | Superior instruction following, JSON reliability |
| Email | SendGrid v3 | Delivery reputation, dynamic templates, webhooks |
| SMS | Twilio Programmable Messaging | Industry standard, opt-out compliance tools |
| Payments | Stripe | PCI-DSS compliance, subscription management |
| eSignature | DocuSign | Legal enforceability, nonprofit pricing |
| CRM | Multi-adapter (SF, BB, Ellucian, HS) | Platform-agnostic by design |
| Frontend | React + TypeScript | Component-based, strong typing |
| Deployment | Docker + Railway | Containerized, scalable, managed infrastructure |

---

## 2. VEO Intelligence Core

The Intelligence Core is the brain of the VEO system. It consists of five engines that work together to produce contextually appropriate, strategically motivated donor engagement.

### 2.1 Persona Engine

**Purpose**: Ensures every VEO message sounds like it comes from the institution, not from a generic AI.

**Architecture**: Per-organization configuration with per-donor tone adaptation.

```typescript
// Persona configuration — stored in agents.config JSONB column
interface VEOPersonaConfig {
  name: string;                              // "Alex" — persona name shown to donors
  institutionName: string;                   // "Greenfield University"
  institutionMission: string;                // One paragraph mission statement
  voiceTone: 'warm_collegial' | 'formal_prestigious' | 'approachable_modern' | 'warm_faith_based';
  signatureBlock: string;                    // How the agent signs off
  disclosureText: string;                    // AI transparency disclosure
  forbiddenTopics: string[];                 // Topics the VEO must never discuss
  fundPriorities: string[];                  // Funds to emphasize
  impactStatements: Record<string, string>;  // Fund -> impact statement mapping
  institutionalFacts: Record<string, string>;// Verified facts the VEO may reference
  campusHighlights: string[];               // Recent news/events to mention
  reunionYears: number[];                   // Active reunion class years
}
```

**Tone Adaptation Layer**: The persona is per-organization, but the tone adapts per-donor using the archetype system:

```typescript
// 8 donor archetypes from donorIntelligence.js
type DonorArchetype =
  | 'LEGACY_BUILDER'      // Motivated by institutional continuity
  | 'COMMUNITY_CHAMPION'  // Motivated by community impact
  | 'IMPACT_INVESTOR'     // Wants measurable outcomes
  | 'LOYAL_ALUMNI'        // Driven by nostalgia and school spirit
  | 'MISSION_ZEALOT'      // Deeply aligned with specific cause
  | 'SOCIAL_CONNECTOR'    // Gives for social/peer reasons
  | 'PRAGMATIC_PARTNER'   // Wants efficiency and tax benefits
  | 'FAITH_DRIVEN';       // Motivated by values and stewardship

interface ArchetypeProfile {
  label: string;
  description: string;
  tone: string;        // e.g., "warm, legacy-focused, forward-looking"
  triggers: string[];  // Words/concepts that resonate
  avoids: string[];    // Words/concepts to never use
}
```

**How it works**: The persona engine injects the organization's persona config as a system prompt preamble, then appends the donor's archetype profile and communication DNA to the user message. This means Claude generates content that is institutionally consistent but donor-adapted.

### 2.2 Decision Engine

**Purpose**: Determines what to do next for each donor — when to contact, through which channel, with what message type, and whether to escalate.

**Two-Stage Architecture**:

**Stage 1: Predictive Scoring** (`predictiveEngine.js`)

Computes a composite Contact Readiness Score (0-100) across 5 layers:

| Layer | Weight | Components |
|-------|--------|------------|
| Capacity | 25% | Wealth screening, giving history, upgrade potential |
| Propensity | 25% | Recency/frequency/monetary analysis, engagement signals |
| Timing | 30% | Days since last contact, fiscal year position, reunion proximity, campaign windows |
| Relationship Health | 20% | Sentiment trend, response rate, opt-in status |
| Institutional Priority | 10% bonus | Active campaign, matching gift eligibility, reunion year |

Output:
```typescript
interface ContactReadinessResult {
  contactReadinessScore: number;   // 0-100
  contactUrgency: 'immediate' | 'this_week' | 'this_month' | 'not_ready';
  recommendedChannel: 'email' | 'sms' | 'phone' | 'portal';
  askReadiness: 'too_early' | 'soft_ask' | 'direct_ask' | 'hard_ask';
  estimatedAskAmount: number;      // In cents
  reasoning: string;
}
```

**Stage 2: AI Reasoning** (`agentService.ts`)

Uses Claude to make the actual decision given full donor context:

```typescript
interface AgentDecision {
  action: 'send_email' | 'send_sms' | 'escalate' | 'wait' | 'update_stage';
  email_subject?: string;
  email_body?: string;
  sms_body?: string;
  internal_notes?: string;
  escalation_reason?: string;
  suggested_stage?: string;
  next_contact_days?: number;
  reasoning: string;
}
```

**Enhanced Decision Flow**:
```
Cron every 15min
  -> predictiveEngine.scorePortfolio(donors, signals, orgConfig)
  -> Filter: contactUrgency in ['immediate', 'this_week']
  -> For each: enqueue agent-run job
  -> agent-run:
       1. Load donor context (profile + giving history + touchpoints)
       2. Run donorIntelligence.buildDonorProfile() for archetype + comm DNA
       3. Build enriched Claude prompt (persona + context + archetype)
       4. Call agentService.decide(agentType, enrichedContext)
       5. Parse decision (structured JSON)
       6. Safety guard: check ai_opted_in, check channel consent
       7. If escalation: create escalation record, notify assigned MGO
       8. If outreach: enqueue outreach job
       9. Record agent_decision (immutable)
       10. Update donor stage + next_contact_at
```

### 2.3 Content Generation Engine

**Purpose**: Generates personalized messaging constrained by institutional facts, donor archetype, and communication style preferences.

**Constraints** (content guardrails):
- SendGrid templates define HTML layout — AI generates dynamic content only
- Institutional facts come from pre-configured persona (never fabricated)
- Archetype language adapts tone, word choice, and framing
- Communication DNA controls length, formality, and structure

**Content Types by Template**:

| Template | Use Case | AI-Generated Content |
|----------|----------|---------------------|
| `welcome` | First contact after opt-in | Warm introduction, institutional connection |
| `impactUpdate` | Quarterly stewardship | Specific fund impact tied to donor's giving |
| `giftAsk` | Solicitation | Personalized ask with amount, fund, and reason |
| `pledgeConfirm` | Pledge acknowledgment | Thank you + pledge schedule details |
| `pledgeReminder` | Upcoming installment | Gentle reminder with impact framing |
| `stewardship` | Ongoing engagement | Milestone recognition, relevant news |
| `campaignLaunch` | Giving Day / campaign | Personalized invitation with social proof |
| `legacyIntro` | Planned giving education | Vehicle overview, mission continuity |
| `giftReceipt` | Tax receipt | Required fields + personal thank you |

**Archetype Injection in Claude Prompt**:
```typescript
// Added to buildUserMessage() in agentService.ts
parts.push(
  `\n## Donor Communication Profile`,
  `Archetype: ${archetype.label} — ${archetype.description}`,
  `Communication style: ${commDNA.style.desc}`,
  `Preferred salutation: ${commDNA.salutation}`,
  `Tone triggers (words that resonate): ${archetype.triggers.join(', ')}`,
  `AVOID these words/approaches: ${archetype.avoids.join(', ')}`,
  `\nIMPORTANT: Adapt your message to match this donor's communication profile.`
);
```

### 2.4 Signal Detection Engine

**Purpose**: Ingests signals from multiple sources to detect giving propensity, lapse risk, upgrade potential, and life events.

**Signal Sources**:

| Tier | Source | Signal Types | Update Frequency |
|------|--------|-------------|-----------------|
| 1 | SEC EDGAR | Insider trades (Form 4) — wealth indicator | Daily |
| 1 | iWave | Propensity, capacity, affinity scores | Quarterly batch |
| 1 | DonorSearch | Philanthropic history, real estate, SEC filings | Quarterly batch |
| 2 | Google News API | Press mentions, career events | Weekly |
| 2 | LinkedIn (planned) | Job changes, company events | Weekly |
| 3 | Email engagement | Opens, clicks, bounces, unsubscribes | Real-time (webhooks) |
| 3 | Web analytics | Giving page visits, event page views | Real-time |
| 3 | CRM data | Gift history, event attendance, volunteering | Daily sync |
| 3 | Double the Donation (planned) | Matching gift eligibility | On-demand |

**Signal Normalization**:
```typescript
interface DonorSignal {
  type: 'WEALTH' | 'CAREER' | 'LIFE' | 'CAUSE' | 'NETWORK' | 'RISK';
  source: string;
  score: number;        // Positive = favorable, Negative = risk
  freshness: 'immediate' | 'week' | 'month' | 'stale';
  raw_data: object;     // Original API response
  detected_at: Date;
  expires_at: Date;
}
```

### 2.5 Memory System

**Purpose**: Maintains relationship context across all interactions, enabling truly personalized engagement.

**Three-Tier Architecture**:

| Tier | Scope | Storage | TTL |
|------|-------|---------|-----|
| Short-term | Last 10-20 conversation turns | `touchpoints` table | Permanent (but only recent turns used in prompt) |
| Medium-term | Full donor profile + computed fields | `donors` table + `donor_intelligence_cache` | Cache refreshed every 24h or on significant events |
| Long-term | Every AI decision ever made | `agent_decisions` table | 7+ years (IRS compliance) |

**Donor Intelligence Cache** (new table):
```sql
CREATE TABLE donor_intelligence_cache (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  donor_id        UUID NOT NULL REFERENCES donors(id),
  archetype       TEXT,
  motivation_matrix JSONB,    -- Ranked motivations with scores
  comm_dna        JSONB,      -- Communication style preferences
  relationship_health JSONB,  -- Health score with decay model
  pg_readiness    JSONB,      -- Planned giving readiness assessment
  upgrade_path    JSONB,      -- Recommended upgrade strategy
  red_flags       JSONB,      -- Risk factors and warnings
  engagement_calendar JSONB,  -- Optimal contact schedule
  ai_brief        TEXT,       -- Pre-generated briefing for MGOs
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  UNIQUE(org_id, donor_id)
);
```

---

## 3. CRM Adapter Layer

### 3.1 Abstract Interface

```typescript
interface CRMAdapter {
  // Connection lifecycle
  testConnection(creds: CRMCredentials): Promise<ConnectionTestResult>;
  refreshToken(creds: CRMCredentials): Promise<string | null>;

  // Bidirectional sync
  pull(creds: CRMCredentials, config: SyncConfig, orgId: string): Promise<PullResult>;
  push(creds: CRMCredentials, config: SyncConfig, donors: OrbitDonor[]): Promise<PushResult>;

  // Real-time operations
  writeDonor(creds: CRMCredentials, donor: DonorWritePayload): Promise<string>;
  writeGift(creds: CRMCredentials, gift: GiftWritePayload): Promise<string>;
  writeActivity(creds: CRMCredentials, activity: ActivityPayload): Promise<string>;

  // Compliance
  writeOptOut(creds: CRMCredentials, donorExternalId: string, reason: string): Promise<void>;
}

interface PullResult {
  donors: NormalizedDonor[];
  gifts: NormalizedGift[];
  events?: NormalizedEvent[];
  errors: SyncError[];
  stats: { pulled: number; skipped: number; errors: number };
}

interface PushResult {
  updated: number;
  created: number;
  errors: SyncError[];
}
```

### 3.2 Adapter Specifications

| CRM | Auth Method | Key Objects | Rate Limit | Custom Fields |
|-----|------------|-------------|-----------|---------------|
| **Salesforce NPSP** | OAuth 2.0 JWT Bearer | Contact, Account (Household), Opportunity, npe01__OppPayment__c, npsp__Allocation__c | 100K API calls/24h | 12 Orbit fields on Contact |
| **Blackbaud RE NXT** | SKY API OAuth 2.0 PKCE + Subscription Key | Constituent, Gift, Fund, Campaign, Appeal, Attribute | 100 calls/min | 12 Orbit Attribute Types |
| **HubSpot** | Private App Token | Contact, Deal, Company | 100-150 req/10s | 16 Orbit properties |
| **Ellucian Advance** | OAuth 2.0 Client Credentials | Person, Gift, Designation, Campaign | Varies by hosting | UDFs (User Defined Fields) |

### 3.3 Bidirectional Sync Protocol

```
1. Acquire PostgreSQL advisory lock (prevents concurrent syncs per org+provider)
2. Decrypt stored credentials (AES-256-GCM)
3. Test connection; refresh token if needed (write-back new token)
4. PULL from CRM:
   a. Fetch donors (contacts/constituents) with modified_since filter
   b. Fetch gifts (opportunities/gifts) with modified_since filter
   c. Normalize to Orbit schema
5. UPSERT to Orbit DB:
   a. Match by external_id or email (dedup)
   b. Update existing records, create new ones
   c. Merge giving summaries
6. PUSH to CRM:
   a. Write Orbit scores back (propensity, engagement, stage)
   b. Write custom fields/attributes
7. Update integration status (last_sync_at, next_sync_at, sync_stats)
8. Release advisory lock
```

### 3.4 Conflict Resolution Strategy

| Data Domain | Source of Truth | Rationale |
|-------------|----------------|-----------|
| Donor identity (name, email, address) | CRM | Staff may update directly in CRM |
| Giving history (gifts, pledges, amounts) | CRM | Gift entry is always in CRM first |
| Opt-out flags | CRM (with VEO propagation) | Legal compliance requires CRM accuracy |
| AI scores (propensity, engagement, sentiment) | Orbit | Only Orbit computes these |
| Journey stage | Orbit | AI manages stage progression |
| Conversation history | Orbit | CRM doesn't capture VEO conversations |
| Agent assignments | Orbit | AI manages agent assignments |

---

## 4. Omnichannel Communication Layer

### 4.1 Email (SendGrid v3)

**Status**: Existing implementation in `emailService.ts`

| Config | Value |
|--------|-------|
| Provider | SendGrid v3 |
| Templates | 9 types (welcome, impactUpdate, giftAsk, pledgeConfirm, pledgeReminder, stewardship, campaignLaunch, legacyIntro, giftReceipt) |
| Tracking | Open, click, bounce, unsubscribe (via webhooks) |
| Compliance | Unsubscribe module in every template; CAN-SPAM compliant |
| Rate | 100 emails/second (batched through Bull queue) |
| Webhooks | Bounce/unsubscribe -> set `email_opted_in: false` |

### 4.2 SMS (Twilio Programmable Messaging)

**Status**: Existing implementation in `smsService.ts`

| Config | Value |
|--------|-------|
| Provider | Twilio Programmable Messaging |
| Compliance | TCPA opt-in required; Messaging Service handles STOP/HELP |
| Registration | A2P 10DLC brand + campaign registration required |
| Limits | 160 chars per segment; auto-truncated |
| Tracking | statusCallback webhook for delivery tracking |
| Opt-out | STOP keyword -> immediate `sms_opted_in: false` |

### 4.3 Voice (AI-Assisted Call Preparation)

**Status**: New capability — not a robot call

**Approach**: VEO prepares a call brief for the human gift officer, including:
- 2-3 sentence memo summarizing the donor's current context
- Suggested opening line
- Key talking points based on recent signals
- "What to avoid" based on archetype profile
- Recommended ask (if ask-ready)

**Future Enhancement**: Twilio Flex integration for warm transfer from VEO-managed conversation to human officer.

### 4.4 Portal/Chat (New — Phase 3)

**Approach**: Donor-facing web portal with:
- Opt-in/opt-out preference management
- Giving page (Stripe Elements integration)
- Chat widget powered by VEO for real-time donor questions
- WebSocket connection for live messaging
- All messages include AI disclosure

### 4.5 Social (Signal Detection Only)

**Approach**: Social channels used for signal ingestion, not outbound messaging.
- LinkedIn: Career changes, company events (wealth/capacity signals)
- Twitter/X: Cause alignment signal detection
- Social platforms restrict automated DMs — no outbound messaging planned

### 4.6 Channel Preference Learning

```typescript
interface ChannelPreference {
  email: { engagement_score: number; events_count: number };
  sms: { engagement_score: number; events_count: number };
  phone: { engagement_score: number; events_count: number };
  portal: { engagement_score: number; events_count: number };
  preferred: 'email' | 'sms' | 'phone' | 'portal';
  confidence: number; // 0-1, based on data points
}

// Learning algorithm
function updateChannelPreference(donorId: string, event: EngagementEvent): void {
  // Track engagement by channel: email_open, email_click, sms_reply,
  // call_connected, event_attended, portal_visit
  // After 5+ data points, update donor.preferred_channel
  // Weight recent events more heavily (exponential decay, half-life = 90 days)
}
```

### 4.7 Cross-Channel Coordination

**Rule**: Never contact a donor through multiple channels about the same topic within 48 hours.

```sql
-- Check before executing outreach
SELECT COUNT(*) FROM touchpoints
WHERE donor_id = $1
  AND org_id = $2
  AND created_at > NOW() - INTERVAL '48 hours'
  AND subject ILIKE '%' || $3 || '%';
-- If count > 0, skip this outreach
```

---

## 5. Data Architecture

### 5.1 Core Schema (Existing Tables)

**organizations** — Multi-tenant root

**donors** — Unified donor profile
- Core identity: id, org_id, first_name, last_name, email, phone, address fields
- Giving summary: total_giving_cents, last_gift_cents, last_gift_date, consecutive_giving_years, lapsed_years
- AI scores: propensity_score (0-100), bequeath_score (0-100), wealth_capacity_cents
- Preferences: communication_pref, email_opted_in, sms_opted_in, ai_opted_in, ai_opted_in_at
- Journey: journey_stage (FSM), sentiment, touchpoint_count, last_contact_at
- CRM links: salesforce_contact_id, external_ids (JSONB)
- **New fields**: archetype (TEXT), comm_dna_style (TEXT), channel_preference_learned (TEXT)

**touchpoints** — Complete interaction history
- direction (inbound/outbound), channel, subject, body, email/sms status

**agent_decisions** — Immutable AI audit trail
- decision_payload (JSONB), stage transitions, escalation flags

**gifts** — Gift records with amount_cents, fund, campaign linkage

**pledges** / **pledge_installments** — Multi-year pledge tracking

**campaigns** / **campaign_donors** — Campaign management

**agent_assignments** — Which agent manages which donor

### 5.2 New Tables (VEO Enhancement)

```sql
-- Migration: 002_veo_enhancement.ts

-- Pre-computed donor intelligence (refreshed every 24h)
CREATE TABLE donor_intelligence_cache (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  donor_id        UUID NOT NULL REFERENCES donors(id),
  archetype       TEXT,
  motivation_matrix JSONB,
  comm_dna        JSONB,
  relationship_health JSONB,
  pg_readiness    JSONB,
  upgrade_path    JSONB,
  red_flags       JSONB,
  engagement_calendar JSONB,
  ai_brief        TEXT,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  UNIQUE(org_id, donor_id)
);

-- External signal ingestion
CREATE TABLE donor_signals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  donor_id        UUID NOT NULL REFERENCES donors(id),
  signal_type     TEXT NOT NULL CHECK (signal_type IN (
    'WEALTH','CAREER','LIFE','CAUSE','NETWORK','RISK'
  )),
  source          TEXT NOT NULL,
  score           INTEGER NOT NULL,
  freshness       TEXT NOT NULL CHECK (freshness IN (
    'immediate','week','month','stale'
  )),
  raw_data        JSONB,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_donor_signals_donor ON donor_signals(org_id, donor_id);
CREATE INDEX idx_donor_signals_type ON donor_signals(org_id, signal_type, freshness);

-- Immutable consent audit log
CREATE TABLE consent_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  donor_id        UUID NOT NULL REFERENCES donors(id),
  event_type      TEXT NOT NULL CHECK (event_type IN (
    'opt_in','opt_out','preference_change'
  )),
  channel         TEXT,          -- email, sms, ai, all
  source          TEXT,          -- web_portal, sms_stop, email_unsubscribe, manual
  ip_address      TEXT,
  user_agent      TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_consent_events_donor ON consent_events(org_id, donor_id);

-- Escalation tracking
CREATE TABLE escalations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  donor_id        UUID NOT NULL REFERENCES donors(id),
  agent_decision_id UUID REFERENCES agent_decisions(id),
  assigned_to     UUID REFERENCES users(id),
  reason          TEXT NOT NULL,
  priority        TEXT NOT NULL CHECK (priority IN ('low','medium','high','critical')),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open','acknowledged','in_progress','resolved','dismissed'
  )),
  resolved_at     TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_escalations_status ON escalations(org_id, status, priority);
```

### 5.3 Entity Relationship Diagram

```
organizations (tenants)
    +-- users (staff)
    +-- donors
    |   +-- touchpoints (interaction history)
    |   +-- gifts
    |   +-- pledges -> pledge_installments
    |   +-- gift_agreements
    |   +-- agent_assignments -> agents
    |   +-- donor_intelligence_cache (computed profiles)
    |   +-- donor_signals (external signals)
    |   +-- consent_events (opt-in/opt-out audit)
    |   +-- escalations (human handoff tracking)
    +-- agents (VEO/VSO/VPGO/VCO)
    |   +-- agent_decisions (immutable audit trail)
    |   +-- agent_assignments -> donors
    +-- campaigns -> campaign_donors
    +-- integrations (encrypted CRM credentials)
    +-- audit_logs (immutable system events)
```

### 5.4 Critical Schema Rules

1. **Every table has `org_id`** — FK to organizations; never query without it
2. **Monetary values in cents** — INTEGER, never FLOAT; columns end in `_cents`
3. **All IDs are UUIDs** — `uuid_generate_v4()`; no integer sequences
4. **Scores are 0-100 integers** — propensity_score, bequeath_score, etc.
5. **Timestamps on every table** — `created_at` + `updated_at`
6. **Soft deletes** — never hard-delete donors/gifts; use `status: 'archived'`
7. **Consent timestamps** — `ai_opted_in_at` required when `ai_opted_in` set to true
8. **Immutable audit tables** — `agent_decisions`, `consent_events`, `audit_logs` are INSERT-only

---

## 6. Analytics & Intelligence Layer

### 6.1 Real-Time Dashboards

| Dashboard | Key Metrics | Data Source |
|-----------|------------|-------------|
| **Pipeline Overview** | Donor count by stage (funnel), stage velocity, conversion rates | `donors.journey_stage` |
| **Agent Activity Feed** | Recent decisions, outreach sent, escalations, opt-outs | `agent_decisions`, `touchpoints` |
| **Campaign Progress** | Participation %, dollars raised, goal vs. actual | `campaigns`, `campaign_donors` |
| **Lapse Risk** | Donors trending toward lapse, risk scores, reactivation success | `donors`, `donor_signals` |
| **Donor Health** | Portfolio health distribution, sentiment trends | `donor_intelligence_cache` |

### 6.2 Donor Health Scoring

Composite health score from `vsoEngine.js`:
- Relationship Health (0-100) with time-decay model
- Email engagement score (opens, clicks in last 90 days)
- Giving trend (increasing, stable, declining, lapsed)
- Sentiment trend (rising, stable, cooling) from reply analysis

### 6.3 AI Performance Metrics

| Metric | Measurement | Target |
|--------|-------------|--------|
| Message open rate | By archetype and tone | >40% (vs. 20-25% baseline) |
| Reply rate | Donor responses to VEO messages | >8% |
| Escalation accuracy | % of escalated donors that give at major level | >30% |
| False positive rate | Unnecessary escalations | <15% |
| Opt-out rate | VEO-managed vs. control group | Lower than control |
| Gift conversion | Touchpoints that preceded a gift | Attribution tracking |
| Retention lift | VEO cohort vs. control cohort | +5-9 points |

### 6.4 A/B Testing Framework

Built into the agent scheduler:
- Random assignment of donors to VEO or control group (per campaign or globally)
- Control group receives standard mass communications
- VEO group receives AI-personalized engagement
- Metrics compared: retention rate, average gift, upgrade rate, engagement score

---

## 7. Security & Compliance

### 7.1 Authentication & Authorization

| Mechanism | Implementation |
|-----------|---------------|
| Access tokens | JWT, 15-minute expiry |
| Refresh tokens | 30-day expiry, bcrypt-hashed, rotated on every use |
| Logout | Delete refresh token + Redis denylist for access token |
| RBAC | admin (full org), manager (all operations), staff (own assigned donors) |
| API keys | For webhook endpoints (Stripe, Twilio, DocuSign, SendGrid) |

### 7.2 Tenant Isolation (Absolute Rule)

Every database query on tenant data MUST include `org_id`:
```typescript
// REQUIRED pattern
const donor = await db('donors')
  .where({ id: req.params.id, org_id: req.user.orgId })
  .first();
```

### 7.3 Encryption

| Data | Method |
|------|--------|
| Data at rest (DB) | PostgreSQL TDE or application-level for sensitive fields |
| Data in transit | TLS 1.3 |
| Integration credentials | AES-256-GCM before DB storage |
| Secrets | Environment variables, never hardcoded |

### 7.4 Compliance Requirements

| Regulation | Applicability | Implementation |
|-----------|---------------|----------------|
| **FERPA** | Student records in donor data | Only directory information (class year, degree, major); never grades, financial aid, employment |
| **CAN-SPAM** | All email communications | Unsubscribe link in every email; honor within 10 days; physical address in footer |
| **TCPA** | SMS communications | Explicit opt-in required; honor STOP immediately; Messaging Service compliance |
| **GDPR** | EU-based donors | Right to erasure, data portability, consent management (if applicable) |
| **State privacy laws** | Varies by state | Configurable consent requirements per organization |
| **IRS** | Gift acknowledgments | Required fields in tax receipts; 7-year record retention |

### 7.5 AI-Specific Compliance

- **Disclosure**: Every AI-generated message includes transparency disclosure
- **Audit Trail**: Every `AgentDecision` persisted with full JSON (INSERT-only, never UPDATE)
- **Retention**: 7+ years for decision records (IRS charitable gift requirements)
- **Bias Prevention**: No protected characteristics in scoring models; regular bias audits
- **Content Safety**: Structured JSON output parsing prevents prompt injection in outbound messages

### 7.6 Webhook Security

| Provider | Verification Method |
|----------|-------------------|
| Stripe | Verify `stripe-signature` header (HMAC) |
| Twilio | Verify `X-Twilio-Signature` (HMAC-SHA1) |
| DocuSign | Verify HMAC signature |
| SendGrid | IP whitelist + Event Webhook signing |

---

## 8. Scalability & Performance

### 8.1 Horizontal Scaling Strategy

| Component | Scaling Method | Bottleneck |
|-----------|---------------|-----------|
| API Server | Horizontal (stateless; all state in DB/Redis) | CPU per request |
| Worker Fleet | Scale independently from API (separate containers) | Claude API rate limits |
| Database | Read replicas for analytics; PgBouncer connection pooling | Write throughput |
| Redis | Cluster mode for queue distribution | Memory per queue |

### 8.2 Queue Concurrency Configuration

| Queue | Concurrency | Rate | Purpose |
|-------|------------|------|---------|
| agent-scheduler | 1 | Every 15 min (cron) | Batch scoring + job creation |
| agent-runs | 10 | As queued | Claude API decision calls |
| outreach | 20 | As queued | SendGrid/Twilio delivery |
| agent-replies | 10 | As received | Inbound message processing |
| gifts | 5 | As received | Payment webhook processing |
| signal-ingestion | 3 | Hourly | External signal collection |
| crm-sync | 3 | Daily per org | CRM bidirectional sync |

### 8.3 Rate Limiting

| External API | Limit | Strategy |
|-------------|-------|----------|
| Anthropic Claude | Per-plan limits | Exponential backoff on 429s (3 retries via Bull) |
| SendGrid | 100 emails/second | Batched through outreach queue |
| Twilio | Messaging Service rate distribution | Managed by Twilio |
| Salesforce | 100K calls/24h | Batch operations, bulk API for large syncs |
| Blackbaud RE NXT | 100 calls/min | `sleep(50)` between calls in adapter |
| HubSpot | 100-150 req/10s | Rate-aware request batching |

### 8.4 Performance Targets

| Metric | Target |
|--------|--------|
| API response time (p95) | <200ms |
| Agent decision time (including Claude API) | <5 seconds |
| Email delivery (queue to send) | <30 seconds |
| CRM sync (per 1,000 donors) | <5 minutes |
| Dashboard load time | <2 seconds |
| Signal ingestion batch | <10 minutes per source |

---

## 9. Integration Specifications

### 9.1 Salesforce NPSP

**Auth**: OAuth 2.0 JWT Bearer Flow (server-to-server, no user interaction)

**Object Mapping**:
| Salesforce Object | Orbit Table | Sync Direction |
|------------------|-------------|----------------|
| Contact | donors | Bidirectional |
| Account (Household) | donors (address fields) | Pull |
| Opportunity (Closed Won) | gifts | Pull |
| npe01__OppPayment__c | pledge_installments | Pull |
| npsp__Allocation__c | gifts (fund field) | Pull |
| Task (VEO Activity) | touchpoints | Push |

**Custom Fields on Contact** (12 fields):
- Orbit__PropensityScore__c, Orbit__EngagementScore__c, Orbit__BequestScore__c
- Orbit__JourneyStage__c, Orbit__LastAIContact__c, Orbit__Archetype__c
- Orbit__SentimentTrend__c, Orbit__UpgradePotential__c, Orbit__ChannelPref__c
- Orbit__AgentAssigned__c, Orbit__AIOptedIn__c, Orbit__WealthCapacity__c

### 9.2 Blackbaud RE NXT

**Auth**: SKY API OAuth 2.0 PKCE + Subscription Key (bb-api-subscription-key header)

**Object Mapping**:
| RE NXT Object | Orbit Table | Sync Direction |
|--------------|-------------|----------------|
| Constituent | donors | Bidirectional |
| Gift | gifts | Pull |
| Fund | campaigns (reference) | Pull |
| Appeal | campaigns (reference) | Pull |
| Constituent Attribute | donors (Orbit scores) | Push |

**Custom Attribute Types** (12 attributes under ORBIT_INTEGRATION category):
- Same 12 fields as Salesforce, mapped as Attribute Types

### 9.3 API Conventions

**Base URL**: `/api/v1/`

**Response Envelope**:
```json
// Success
{ "data": { ... }, "pagination": { "page": 1, "limit": 20, "total": 847 } }

// Error
{ "error": "Human-readable message", "code": "VALIDATION_ERROR", "details": [] }
```

**HTTP Status Codes**: 200 (GET/PATCH), 201 (POST), 401 (Unauthorized), 403 (Forbidden), 404 (Not Found), 422 (Validation), 429 (Rate Limited), 500 (Server Error)

**Rate Limiting**:
| Endpoint | Limit |
|----------|-------|
| POST /auth/login | 5 req / 15min / IP |
| POST /auth/refresh | 10 req / 15min / IP |
| Authenticated API routes | 1000 req / 15min / user |
| Webhook endpoints | 500 req / min / IP |

---

*End of Technical Architecture Document v1.0*

*References: Orbit CLAUDE.md (Project Constitution), agentService.ts, predictiveEngine.js, donorIntelligence.js, signalIngestion.js, sync.js, vsoEngine.js*
