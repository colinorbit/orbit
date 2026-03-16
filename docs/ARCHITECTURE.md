# Orbit Platform: Architecture Reference

> Extracted from CLAUDE.md. This document is the architectural reference for the Orbit platform.
> For binding development rules, see CLAUDE.md and .claude/rules/.

---

## System Purpose

**Orbit** is an autonomous, AI-native fundraising intelligence platform for university advancement offices and nonprofits. It replaces or augments legacy CRM outreach workflows with a coordinated fleet of AI agents that manage donor relationships at scale — across the full giving lifecycle from first contact through planned giving.

### Problem Statement

University advancement offices are chronically understaffed relative to their donor portfolio size. A typical major gift officer can meaningfully manage 150–200 relationships. But an advancement office at a mid-size university may have 50,000+ alumni and 5,000+ active donors. The result: the vast majority of donors receive generic mass communications, no relationship management, and ultimately lapse.

Orbit solves this by deploying AI agents that:
- Maintain individualized, contextually-aware outreach for every donor
- Surface major gift signals and escalate to human gift officers
- Automate stewardship, acknowledgment, and pledge management
- Generate campaign communications personalized at 1:1 scale
- Integrate with CRM, payment, document signing, and communication systems

### Core Value Proposition

| Legacy State | Orbit State |
|---|---|
| 1 gift officer : 150 donors | 1 gift officer : 1,500+ donors (agent-assisted) |
| Batch/blast email communications | 1:1 personalized outreach at scale |
| Manual moves management in spreadsheets | Autonomous stage progression with human oversight |
| Donor lapse goes undetected for 12+ months | Real-time lapse detection and reactivation |
| Gift agreements via paper/PDF email chains | Automated DocuSign gift agreement workflows |
| Siloed giving data in legacy CRM | Unified donor intelligence with wealth screening |

---

## Architecture Understanding Report

### System Summary
Orbit is a B2B SaaS multi-tenant platform. Primary users are advancement office professionals. End users are alumni, donors, and prospects who interact with the institution through AI-orchestrated touchpoints.

### Core Architecture
- **Multi-tenant SaaS** with row-level security (org_id isolation on every table)
- **Event-driven backend** with Bull/Redis queue workers for async agent execution
- **AI orchestration layer** using Anthropic Claude API for agent reasoning
- **RESTful API** (Express/TypeScript) consumed by React frontend
- **PostgreSQL** as system of record; Redis for queue/cache
- **External integrations**: Salesforce NPSP, Stripe, DocuSign, SendGrid, Twilio

### Major Components
1. **API Server** (`backend/src/index.ts`) — Express + TypeScript, JWT auth, rate limiting
2. **Agent Engine** (`backend/src/services/agentService.ts`) — Claude-powered decision system
3. **Worker Fleet** (`backend/src/workers/index.ts`) — Bull queues for async processing
4. **Database Layer** (`backend/src/config/database.ts`) — Knex query builder on PostgreSQL
5. **Migration System** (`backend/src/migrations/`) — Knex migrations for schema management
6. **Frontend** (`frontend/`) — HTML/CSS prototype; React migration planned

---

## Core Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│                     CLIENT LAYER                         │
│  React SPA (advancement staff dashboard)                 │
│  Public donor-facing pages (giving portal, opt-in)       │
└──────────────────────┬───────────────────────────────────┘
                       │ HTTPS / REST
┌──────────────────────▼───────────────────────────────────┐
│                    API SERVER                            │
│  Express + TypeScript                                    │
│  Auth: JWT (access 15m) + Refresh tokens (30d)           │
│  Middleware: helmet, cors, rate-limit, validate, audit   │
│  Routes: /auth /donors /agents /gifts /pledges           │
│          /campaigns /analytics /integrations /webhooks   │
└──────────┬───────────────────────────┬────────────────────┘
           │                           │
┌──────────▼──────┐           ┌────────▼───────────────────┐
│   PostgreSQL    │           │         REDIS              │
│  (primary DB)   │           │  Bull Queue backend        │
│  Multi-tenant   │           │  Session cache             │
│  Row-level sec  │           │  Rate limit store          │
└──────────┬──────┘           └────────┬────────────────────┘
           │                           │
           │                 ┌─────────▼──────────────────┐
           │                 │      WORKER FLEET          │
           │                 │  agent-scheduler (15min)   │
           │                 │  agent-runs (x10)          │
           │                 │  outreach (x20)            │
           │                 │  agent-replies (x10)       │
           │                 │  gifts (x5)                │
           │                 └─────────┬──────────────────┘
           │                           │
           │                 ┌─────────▼──────────────────┐
           │                 │   ANTHROPIC CLAUDE API     │
           │                 │  VEO / VSO / VPGO / VCO   │
           │                 │  claude-opus-4-5           │
           │                 └────────────────────────────┘
           │
┌──────────▼─────────────────────────────────────────────┐
│            EXTERNAL INTEGRATION LAYER                  │
│  Salesforce NPSP  — CRM sync, opportunity mgmt         │
│  Stripe           — Payment processing                 │
│  DocuSign         — Gift agreement eSignature          │
│  SendGrid         — Transactional email                │
│  Twilio           — SMS send/receive                   │
│  Wealth APIs      — DonorSearch, iWave (planned)       │
└────────────────────────────────────────────────────────┘
```

### Technology Decisions

| Layer | Technology | Rationale |
|---|---|---|
| API Server | Express + TypeScript | Proven ecosystem, strong typing for safety |
| Database | PostgreSQL + Knex | ACID compliance, JSONB flexibility, RLS |
| Queue | Bull + Redis | Battle-tested job queues, retry/backoff, cron |
| AI | Anthropic Claude | Superior instruction following, JSON reliability |
| Email | SendGrid | Delivery reputation, dynamic templates, webhooks |
| SMS | Twilio | Industry standard, opt-out compliance tools |
| Payments | Stripe | PCI-DSS compliance, subscription management |
| eSignature | DocuSign | Legal enforceability, nonprofit pricing |
| CRM | Salesforce NPSP | Most common in higher ed advancement |
| Agent Intelligence | Python 3.10+ | Rapid ML iteration, rich data-science ecosystem |

---

## Python Agent Intelligence Layer

The four Python intelligence modules are a recognized, first-class architectural layer. They are **not** throw-away scripts — they are the cognitive core of each AI agent, responsible for all pre-Claude reasoning before prompts are assembled and sent to the API.

### Architecture Role

```
┌────────────────────────────────────────────────────────────┐
│              PYTHON AGENT INTELLIGENCE LAYER               │
│                                                            │
│  veo_intelligence/   — VEO cognitive modules               │
│  vso_intelligence/   — VSO cognitive modules               │
│  vpgo_intelligence/  — VPGO cognitive modules              │
│  vco_intelligence/   — VCO cognitive modules               │
│                                                            │
│  Inputs:  Donor JSON profile from API or queue             │
│  Outputs: Structured decision object + formatted prompt    │
│  Called by: Worker fleet (Bull jobs) or REST route         │
└──────────────────────────┬─────────────────────────────────┘
                           │ Structured prompt context
                           ▼
              ANTHROPIC CLAUDE API (message generation)
```

### Module Inventory

#### `veo_intelligence/` — Virtual Engagement Officer
| Module | Purpose |
|---|---|
| `life_event_detector.py` | Detects life events (bereavement, IPO, estate) from donor signals |
| `signal_processor.py` | Enriches donor with iWave / DonorSearch wealth data |
| `cost_governor.py` | Token budget enforcement; multi-client billing |

#### `vso_intelligence/` — Virtual Stewardship Officer
| Module | Purpose |
|---|---|
| `stewardship_engine.py` | Core decision engine: action, channel, tone, content themes |
| `lapse_predictor.py` | Predicts lapse tier (critical / high / medium / low) |
| `impact_reporter.py` | Builds fund-specific impact profiles for personalized messaging |
| `recognition_engine.py` | Detects giving milestones, streak events, society upgrades |
| `stewardship_calendar.py` | Annual touchpoint calendar by tier |

#### `vpgo_intelligence/` — Virtual Planned Giving Officer
Modules covering bequest score modeling, estate planning signal detection, and legacy gift cultivation sequencing.

#### `vco_intelligence/` — Virtual Campaign Officer
Modules covering campaign segmentation, Giving Day optimization, participation rate modeling, and campaign calendar management.

### Integration with Node.js Backend

The Python layer is consumed by the Express API in two ways:

1. **REST Route** — `POST /api/agents/vso/run` (and equivalents) call the decision logic via a JavaScript port (`backend/services/stewardship-engine.js`) for synchronous use
2. **Worker Fleet** — Bull queue workers invoke Python scripts via `child_process.spawn()` for async batch processing

---

## Repository Structure

```
orbit/
├── CLAUDE.md                          ← Project Constitution
├── README.md
├── .env.example
├── docker-compose.yml
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── deploy.yml
│
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── knexfile.ts
│   └── src/
│       ├── index.ts                   ← Server entry point ✅
│       ├── config/
│       │   ├── database.ts            ← Knex PostgreSQL ✅
│       │   ├── redis.ts               ← Redis ✅
│       │   └── logger.ts              ← Winston ✅
│       ├── middleware/
│       │   ├── authenticate.ts        ← JWT verification
│       │   ├── authorize.ts           ← RBAC
│       │   ├── validateRequest.ts     ← Validation errors
│       │   ├── rateLimiter.ts         ← Rate limiting
│       │   ├── auditLog.ts            ← Immutable events
│       │   └── errorHandler.ts        ← Global errors
│       ├── routes/
│       │   ├── auth.ts                ← Login/refresh/logout
│       │   ├── organizations.ts
│       │   ├── users.ts
│       │   ├── donors.ts
│       │   ├── agents.ts              ← ✅ Complete
│       │   ├── gifts.ts
│       │   ├── pledges.ts
│       │   ├── campaigns.ts
│       │   ├── outreach.ts
│       │   ├── analytics.ts
│       │   ├── integrations.ts
│       │   └── webhooks.ts            ← ✅ Complete
│       ├── services/
│       │   ├── agentService.ts        ← ✅ Complete
│       │   ├── emailService.ts        ← ✅ Complete
│       │   ├── smsService.ts          ← ✅ Complete
│       │   ├── stripeService.ts       ← ✅ Complete
│       │   ├── docusignService.ts     ← ✅ Complete
│       │   ├── salesforceService.ts   ← ✅ Complete
│       │   └── wealthService.ts       ← TODO
│       ├── workers/
│       │   └── index.ts               ← ✅ Complete
│       └── migrations/
│           └── 001_initial_schema.ts  ← ✅ Complete
│
├── frontend/
│   ├── orbit-v4.html                  ← Main app dashboard ✅
│   ├── orbit-platform.html            ← Marketing/sales prototype ✅
│   └── src/                           ← React migration TODO
│
├── veo_intelligence/                  ← VEO Python intelligence module ✅
├── vso_intelligence/                  ← VSO Python intelligence module ✅
├── vpgo_intelligence/                 ← VPGO Python intelligence module ✅
├── vco_intelligence/                  ← VCO Python intelligence module ✅
│
└── docs/
    ├── ARCHITECTURE.md                ← THIS FILE
    ├── API.md
    ├── ENV.md
    ├── PERSONAS.md
    └── ROADMAP.md
```

---

## Data Model

### Entity Relationships

```
organizations (tenants)
    ├── users (staff)
    ├── donors
    │   ├── touchpoints
    │   ├── gifts
    │   ├── pledges → pledge_installments
    │   ├── gift_agreements
    │   └── agent_assignments → agents
    ├── agents (VEO/VSO/VPGO/VCO)
    │   ├── agent_decisions
    │   └── agent_assignments → donors
    ├── campaigns → campaign_donors
    ├── payments
    ├── integrations (encrypted)
    └── audit_logs (immutable)
```

### Donor Journey FSM

```
uncontacted → opted_in → cultivation → discovery → solicitation
                                                         ↓
stewardship ← committed ←────────────────────────────────┘
     ↓
lapsed_outreach → legacy_cultivation
```

Stage transitions owned by agent engine; require an `agent_decision` record.

---

## AI Agent System

### Agent Types

| Agent | Code | Mission |
|---|---|---|
| Virtual Engagement Officer | VEO | Full cultivation: uncontacted → stewardship |
| Virtual Stewardship Officer | VSO | Retention, acknowledgment, impact reporting |
| Virtual Planned Giving Officer | VPGO | Legacy gift cultivation (bequeath_score ≥ 60) |
| Virtual Campaign Officer | VCO | Time-bound campaign participation + revenue |

### Agent Decision Loop

```
Cron every 15min:
  1. Query assignments WHERE next_contact_at <= NOW
  2. Enqueue agent-run jobs

Per agent-run:
  1. Load donor context (profile + history + org)
  2. Build Claude prompt
  3. Call Claude → parse AgentDecision JSON
  4. Persist agent_decision record
  5. Update donor stage + next_contact_at
  6. Enqueue outreach job

Per outreach job:
  1. Execute action (email / SMS / DocuSign / etc.)
  2. Record touchpoint
  3. Update donor touchpoint_count
```
