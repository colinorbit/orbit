# CLAUDE.md — Orbit Platform: Project Constitution

> **This document is the governing authority for all design, architecture, and development decisions on the Orbit platform. No implementation may violate the rules defined here. All engineers, agents, and AI tools operating on this codebase must treat this document as law.**

---

## 1. System Purpose

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

## 2. Architecture Understanding Report

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

## 3. Core Architecture

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

## 3a. Python Agent Intelligence Layer

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

### Rules for This Layer

1. **Each module is independently testable** — run `python3 *_demo.py` to validate any agent
2. **No side effects** — modules are pure functions; they read donor data, return decisions, never mutate state
3. **JSON in, JSON out** — all inputs are donor dict objects; all outputs are dataclass instances serializable to JSON
4. **Cost governance required** — all Claude API calls routed through `cost_governor.py`
5. **The JS ports must stay in sync** — when Python logic changes, update the corresponding `backend/services/*.js` port

---

## 4. Repository Structure

```
orbit/
├── CLAUDE.md                          ← THIS FILE (Project Constitution)
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
    ├── API.md
    ├── AGENTS.md
    └── DEPLOYMENT.md
```

---

## 5. Data Model

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

### Critical Schema Rules

1. **Every table has `org_id`** — FK to organizations; never query without it
2. **Monetary values in cents** — INTEGER, never FLOAT; columns end in `_cents`
3. **All IDs are UUIDs** — `uuid_generate_v4()`; no integer sequences
4. **Scores are 0–100 integers** — propensity_score, bequeath_score, etc.
5. **Timestamps on every table** — `created_at` + `updated_at` always
6. **Soft deletes** — never hard-delete donors/gifts; use `status: 'archived'`
7. **Consent timestamps** — `ai_opted_in_at` required when `ai_opted_in` set to true

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

## 6. Integration Layers

### Salesforce NPSP
- Bidirectional sync; Orbit writes opportunities, reads contacts
- OAuth 2.0 JWT Bearer Flow (server-to-server)
- Failure: log to audit_logs, retry 3x exponential, alert on 3rd failure

### Stripe
- Payment intents for online gifts; subscriptions for pledge autopay
- Webhooks: `payment_intent.succeeded`, `invoice.payment_failed`
- PCI scope: Stripe Elements frontend only; never handle raw card data server-side

### DocuSign
- Gift agreements: single gifts > $500, all pledges, all planned gifts
- JWT Bearer Grant (service account)
- Webhooks: `envelope-completed`, `envelope-declined`, `envelope-voided`

### SendGrid
- All transactional email; templates managed in SendGrid dashboard
- Webhooks: bounce/unsubscribe → `email_opted_in: false`
- Max 100 emails/second; batch through worker queue

### Twilio
- SMS outreach + inbound reply processing
- Honor STOP immediately → `sms_opted_in: false`
- Verify `X-Twilio-Signature` on every inbound request

### Wealth APIs (Planned)
- DonorSearch (philanthropic history 35%) + iWave (propensity 35%) + affinity (30%)
- Quarterly batch re-screen; triggered on major gift signals
- Results → `donors.wealth_capacity_cents` + `donors.propensity_score`

---

## 7. AI Agent System

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

### Agent Absolute Rules (Non-Negotiable)

1. **Never contact donor without `ai_opted_in: true`** — enforced in parseDecision()
2. **Always disclose AI identity** — never claim to be human
3. **Immediate opt-out on request** — any STOP triggers `opt_out_acknowledged`
4. **Escalate gifts > $25,000** — always route to human gift officer
5. **Escalate estate/legacy discussions** — VPGO plants seeds only
6. **Never fabricate facts** — no invented statistics or institutional claims
7. **Conversation history limit** — last 10 turns only

---

## 8. Security Guidelines

### Authentication
- JWT access tokens: 15-minute expiry
- Refresh tokens: 30-day expiry, stored as bcrypt hash
- Token rotation: new refresh token on every use
- Logout: delete refresh token; add access token to Redis denylist

### Authorization (RBAC)

| Role | Permissions |
|---|---|
| `admin` | Full org access; manage users, integrations, billing |
| `manager` | All donor/agent/campaign operations; view analytics |
| `staff` | Own assigned donors; create touchpoints; view own analytics |

### Tenant Isolation — ABSOLUTE RULE

Every DB query touching tenant data MUST include `.where({ org_id: req.user.orgId })`.

```typescript
// ❌ FORBIDDEN
const donor = await db('donors').where({ id: req.params.id }).first();

// ✅ REQUIRED
const donor = await db('donors')
  .where({ id: req.params.id, org_id: req.user.orgId })
  .first();
```

### Input Validation
- All routes use express-validator chains
- UUIDs validated with `.isUUID()`
- Monetary amounts validated as positive integers (cents)
- Emails normalized to lowercase before storage

### Secrets Management
- All secrets in environment variables — never hardcoded
- Integration credentials encrypted with AES-256-GCM before DB storage
- Never log secrets, tokens, or PII

### Webhook Security
- Stripe: verify `stripe-signature` header
- Twilio: verify `X-Twilio-Signature`
- DocuSign: verify HMAC signature
- All webhook routes use raw body parsing

### Audit Logging
Required for: login/logout/failed auth, donor CRUD, agent operations, gifts/pledges, integration changes, user management

### Rate Limiting

| Endpoint | Limit |
|---|---|
| `POST /auth/login` | 5 req / 15min / IP |
| `POST /auth/refresh` | 10 req / 15min / IP |
| Authenticated API routes | 1000 req / 15min / user |
| Webhook endpoints | 500 req / min / IP |

---

## 9. API Conventions

### Base URL: `/api/v1/`

### Response Envelope

```json
// Success
{ "data": { ... }, "pagination": { "page": 1, "limit": 20, "total": 847 } }

// Error
{ "error": "Human-readable message", "code": "VALIDATION_ERROR", "details": [] }
```

### HTTP Status Codes
- 200: Successful GET/PATCH
- 201: Successful POST (created)
- 401: Unauthorized
- 403: Forbidden
- 404: Not found
- 422: Validation error
- 429: Rate limited
- 500: Server error

### Pagination
```
GET /api/v1/donors?page=1&limit=20&sort=last_name&order=asc&search=smith
```

### Versioning
- Current: `v1`; breaking changes require `v2`
- 90-day deprecation notice minimum before removing endpoints

---

## 10. Coding Standards

### TypeScript Rules
- Strict mode enabled (`strict: true`)
- No `any` — use `unknown` and narrow, or proper interfaces
- Explicit return types on all exported functions
- Interface over type for object shapes

### Naming Conventions

| Context | Convention | Example |
|---|---|---|
| Files | kebab-case | `agent-service.ts` |
| Classes | PascalCase | `AgentService` |
| Functions | camelCase | `buildDonorContext()` |
| DB columns | snake_case | `total_giving_cents` |
| API JSON | camelCase | `totalGivingCents` |
| Env vars | SCREAMING_SNAKE | `ANTHROPIC_API_KEY` |

### Forbidden Patterns

```typescript
// ❌ Raw SQL string concatenation (SQL injection risk)
db.raw("SELECT * FROM donors WHERE id = '" + id + "'")

// ❌ Missing org_id (cross-tenant leakage)
db('donors').where({ id: req.params.id })

// ❌ Floating point money
amount_dollars: 1250.50

// ❌ Logging PII
logger.info(`Processing donor ${donor.email}`)

// ❌ Hardcoded secrets
const apiKey = 'sk-ant-api...'

// ❌ Silent error swallowing
try { ... } catch (e) {}
```

---

## 11. Testing Strategy

### Test Pyramid
- 60% Unit tests (Jest) — services, utilities, middleware
- 30% Integration tests (Supertest + test DB) — all route handlers
- 10% E2E tests (Playwright) — critical user flows

### Rules
- Never use production API keys in tests — all external services mocked
- Never test against production DB — use `DATABASE_URL_TEST`
- Reset state between tests — truncate tables in `beforeEach`
- CI must pass before merge — no exceptions

### Required Coverage
- agentService: decision parsing, fallback behavior, opt-in guard
- All middleware: auth, validation, rate limiting
- All route handlers: happy path + 401/403/404/422
- Multi-tenant isolation: org A cannot access org B data

---

## 12. Infrastructure & Deployment

### Environments
- `development`: Local (feature/* branches)
- `staging`: Integration testing (develop branch)
- `production`: Live platform (main branch)

### Required Environment Variables

```bash
DATABASE_URL=postgresql://user:pass@host:5432/orbit
REDIS_URL=redis://host:6379
JWT_SECRET=<64+ char random string>
ENCRYPTION_KEY=<32 byte hex>
ANTHROPIC_API_KEY=sk-ant-api...
ANTHROPIC_MODEL=claude-opus-4-5
SENDGRID_API_KEY=SG...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
DOCUSIGN_INTEGRATION_KEY=...
DOCUSIGN_USER_ID=...
DOCUSIGN_ACCOUNT_ID=...
SALESFORCE_CLIENT_ID=...
SALESFORCE_CLIENT_SECRET=...
SALESFORCE_INSTANCE_URL=https://org.salesforce.com
CLIENT_URL=https://app.orbitfundraising.com
NODE_ENV=production
PORT=3001
```

### Observability
- Structured logging: Winston JSON → CloudWatch/Datadog
- Error tracking: Sentry (API + Worker)
- Health: `GET /health` — service status + DB/Redis connectivity
- Queue: Bull Board at `/admin/queues` (admin-only)

### Scaling
- API: Horizontal (stateless; all state in DB/Redis)
- Workers: Scale independently from API
- DB: Read replicas for analytics; PgBouncer connection pooling
- Agent API: Rate limiting + exponential backoff on 429s

---

## 13. Implementation Roadmap

### Completed ✅
- Full database schema (001_initial_schema.ts)
- Server entry point with security middleware
- Agent engine (VEO/VSO/VPGO/VCO with Claude)
- Worker fleet (scheduler + agent-runs + outreach + gifts)
- All service integrations (SendGrid, Twilio, Stripe, DocuSign, Salesforce)
- Agent routes + webhook routes
- Frontend prototype dashboard

### Phase 2 — Missing Routes (In Progress)
- [ ] routes/auth.ts — Login, refresh, logout, password reset
- [ ] routes/donors.ts — CRUD + search + segments + CSV import
- [ ] routes/campaigns.ts — Campaign management + donor assignment
- [ ] routes/analytics.ts — Dashboard metrics + cohort reports
- [ ] routes/integrations.ts — CRM/payment integration setup
- [ ] routes/organizations.ts — Tenant management
- [ ] routes/gifts.ts — Gift records
- [ ] routes/pledges.ts — Pledge schedules + installments

### Phase 3 — Infrastructure
- [ ] middleware/errorHandler.ts
- [ ] middleware/rateLimiter.ts
- [ ] middleware/auditLog.ts
- [ ] middleware/authenticate.ts
- [ ] knexfile.ts
- [ ] docker-compose.yml
- [ ] GitHub Actions CI/CD

### Phase 4 — Wealth Engine
- [ ] services/wealthService.ts (DonorSearch + iWave composite scoring)
- [ ] Batch re-screening worker
- [ ] Wealth score display in dashboard

### Phase 5 — React Frontend
- [ ] React + TypeScript scaffold
- [ ] Orbit design system components
- [ ] Dashboard, donor table, agent console, analytics views

---

## 14. User Research & Personas

### Research Basis
Synthesized from: CASE benchmarking studies, AFP Fundraising Effectiveness Project, Blackbaud Institute Charitable Giving Report (2022–2024), Giving USA, APRA body of knowledge, Veritus Group methodology, practitioner blogs, and 50+ advancement office job description analyses.

---

### Operator Personas

#### Persona 1: The Major Gift Officer (MGO)
**Archetype**: Sarah, Senior MGO, mid-size research university

- Manages 125–175 prospects; compensation tied to dollars raised
- Travels 30–40% for visits; 15+ min/donor for CRM research before each contact
- **Primary pain**: "I have 165 prospects but only meaningful relationships with 40 of them."
- **Orbit use**: AI-prepared donor briefings; escalation alerts when $25K threshold crossed; VEO handles annual fund while she focuses on major gifts

#### Persona 2: The Annual Giving Director
**Archetype**: Marcus, Director of Annual Giving, liberal arts college

- Manages $2–5M annual fund; owns participation rates (board-watched metric)
- **Primary pain**: LYBUNT/SYBUNT management — thousands of lapsed donors, staff can't reach them all
- **Orbit use**: Automated lapse reactivation sequences; AI-generated personalized campaign messages; escalation to calling team for high-propensity non-responders

#### Persona 3: The CRM Administrator
**Archetype**: Dani, Advancement Database Administrator

- Controls data integrity; highly skeptical of new integrations
- **Primary concerns**: "Will this break our CRM data? Who's responsible when AI sends the wrong message? I need a full audit trail."
- **What makes them a champion**: Clean CRM integration, exportable audit logs, documented data flows, easy override of AI actions

#### Persona 4: The Stewardship Officer
**Archetype**: Priya, Director of Donor Relations

- Manages acknowledgment and impact reporting for 2,000+ donors alone
- **Primary pain**: "I know I should send a mid-year impact update to every $1,000+ donor. I physically cannot do it for 3,000 people."
- **Orbit use**: VSO handles routine touchpoints < $25K lifetime; she reviews AI-drafted impact reports; alerts when high-value donor sentiment goes negative

---

### End User Personas

#### Persona 5: The Loyal Annual Donor
**Archetype**: Robert, Class of 1987, 22 consecutive years giving

- Motivated by: habit, identity, sense of obligation
- **Lapse risk**: excessive email volume; transactional feeling; connection feels one-way
- **Orbit experience**: Quarterly stewardship emails referencing his specific history; personalized Giving Day message; warm reactivation (not guilt) if he misses a year

#### Persona 6: The Major Gift Prospect
**Archetype**: Linda, Class of 1992, CEO, $8M+ estimated capacity

- Values personal relationships; has DAF; may have estate planning interest
- **Trust signals**: Gift officer knows her history without being told; institution demonstrates stewardship before asking for more
- **Orbit experience**: VEO surfaces interest signals → escalation to human MGO → AI-prepared briefing; VPGO initiates legacy conversation after estate planning mention

#### Persona 7: The Lapsed Donor
**Archetype**: James, Class of 2004, 5 gifts, last gift 3 years ago

- Lapsed due to life change; institution never followed up meaningfully
- **Reactivation triggers**: Reunion year, matching gift opportunity, peer pressure, relevant program news
- **Orbit experience**: VSO detects 12-month lapse → `lapsed_outreach` stage → VEO soft sequence (reconnect before ask) → 4-touchpoint limit before moving to `closed`

#### Persona 8: The Young Alumni First-Time Donor
**Archetype**: Zoe, Class of 2021, 1 gift ($25, Giving Day)

- Gave via social proof + FOMO; mobile-first; not ready for calls
- **Long-term value**: Pipeline for mid-level and major donors in 20–30 years; year 2–3 retention is critical intervention point
- **Orbit experience**: VSO personal thank-you + impact video within 24hrs; lightweight quarterly touchpoints; gentle year-2 Giving Day ask with class challenge stats

---

### Jobs-To-Be-Done

#### Advancement Staff

| Job | Current State | Orbit Solution |
|---|---|---|
| Know every donor's history before outreach | Manual CRM research (15 min/donor) | AI-prepared donor briefings |
| Maintain relationships with 1,000s of donors | Impossible — only top 150 get attention | Agent fleet manages 10,000+ relationships |
| Detect lapsed donors before they're gone | Quarterly reports; 12+ months late | Real-time lapse detection + automated reactivation |
| Personalize campaign messages at scale | Segments of 500+ get generic copy | 1:1 personalization for every donor |
| Ensure every gift is acknowledged within 48hrs | Manual batch; often weeks late | VSO automated acknowledgment within 24 hours |
| Identify major gift prospects from annual fund | Expensive prospect research; low hit rate | Continuous wealth signal monitoring + escalation |

#### Alumni & Donors

| Job | Current State | Orbit Solution |
|---|---|---|
| Feel my gift made a difference | Generic annual report PDF | Specific impact story tied to their fund |
| Be recognized for loyalty | Form letter acknowledgment | Personalized milestone recognition |
| Give easily when inspired | Clunky giving portal, desktop-only | Mobile-optimized, one-click recurring giving |
| Stay connected to my institution | Mass email newsletter | Relevant content based on interests |
| Explore planned giving options | Cold call from PGFO | VPGO nurtures interest over time, no pressure |

---

## 15. Content & Copy Rules

### Em Dash Prohibition (Universal, Non-Negotiable)

**Never use the em dash character (—) in any user-facing content.**

This applies to:
- Website copy (donororbit.com or any Orbit-branded page)
- Virtual Officer outputs (VEO, VSO, VPGO, VCO, VAFO generated messages)
- Chat messages and in-app text
- Email and SMS content generated by agents
- UI labels, tooltips, headers, and any text a human reads

**Code comments are the only exception.** Inline comments in source code may retain em dashes.

**Alternatives to use instead:**
- Replace ` — ` (spaced em dash) with a comma, colon, or restructured sentence
- Replace title/header em dashes (e.g., `Layer — Section`) with a colon (`Layer: Section`)
- Break one sentence into two where appropriate

**Rationale:** Em dashes render inconsistently across email clients, SMS, and older browsers. They also feel typographically informal in a B2B SaaS context. Clean punctuation signals professionalism.

---

*End of CLAUDE.md — Project Constitution v1.0*

*Maintained by: Lead Software Architect, Orbit Platform*
*Rule: Update this document before writing code. Design decisions are documented here first.*
