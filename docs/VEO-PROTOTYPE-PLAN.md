# Virtual Engagement Officer (VEO) — Working Prototype Plan

## Implementation Roadmap for MVP & Beyond

**Version:** 1.0
**Date:** March 2026
**Platform:** Orbit

---

## Table of Contents

1. [MVP Strategy](#1-mvp-strategy)
2. [Technology Stack](#2-technology-stack)
3. [Phase 1: MVP (Weeks 1-8)](#3-phase-1-mvp-weeks-1-8)
4. [Phase 2: CRM Integration + Analytics (Weeks 9-16)](#4-phase-2-crm-integration--analytics-weeks-9-16)
5. [Phase 3: Omnichannel Expansion (Weeks 17-24)](#5-phase-3-omnichannel-expansion-weeks-17-24)
6. [Phase 4: Advanced Intelligence (Months 7-12)](#6-phase-4-advanced-intelligence-months-7-12)
7. [Directory Structure](#7-directory-structure)
8. [Testing Strategy](#8-testing-strategy)
9. [Deployment Plan](#9-deployment-plan)
10. [Success Metrics](#10-success-metrics)
11. [Risk Mitigation](#11-risk-mitigation)

---

## 1. MVP Strategy

### 1.1 What to Build First

The MVP focuses on the highest-impact, lowest-complexity scenario:

**Email-based annual fund donor cultivation for a single institution using Salesforce NPSP.**

**Why this scope:**
- Email is the most forgiving channel (no TCPA risk, no real-time expectations)
- Annual fund donors are the largest segment and lowest risk to manage with AI
- Salesforce NPSP has the most mature adapter (`salesforceService.ts` + `salesforce.js`)
- The full agent decision loop already exists in `agentService.ts` + `workers/index.ts`
- Measuring email engagement (opens, clicks, replies) is straightforward

### 1.2 What Already Exists

The Orbit platform provides a substantial foundation:

| Component | File | Status |
|-----------|------|--------|
| Agent engine (VEO/VSO/VPGO/VCO) | `services/agentService.ts` | Complete |
| Worker fleet (scheduler, agent-runs, outreach) | `workers/index.ts` | Complete |
| Email delivery | `services/emailService.ts` | Complete |
| SMS delivery | `services/smsService.ts` | Complete |
| Stripe payments | `services/stripeService.ts` | Complete |
| DocuSign eSignature | `services/docusignService.ts` | Complete |
| Salesforce NPSP adapter | `services/salesforceService.ts` + `integrations/salesforce.js` | Complete |
| Blackbaud RE NXT adapter | `integrations/blackbaud.js` | Complete |
| HubSpot adapter | `integrations/hubspot.js` | Complete |
| CRM sync orchestrator | `services/sync.js` | Complete |
| Predictive scoring engine | `services/predictiveEngine.js` | Complete |
| Donor intelligence (archetypes, motivation) | `services/donorIntelligence.js` | Complete |
| Signal ingestion (SEC, news, wealth) | `services/signalIngestion.js` | Complete |
| VSO stewardship engine | `services/vsoEngine.js` | Complete |
| Database schema | `migrations/001_initial_schema.ts` | Complete |
| Database config | `config/database.ts` | Complete |
| Redis config | `config/redis.ts` | Complete |
| Logger | `config/logger.ts` | Complete |
| Agent routes | `routes/agents.ts` | Complete |
| Webhook routes | `routes/webhooks.ts` | Complete |
| Frontend prototype | `orbit-dashboard.html` | Complete (HTML) |

### 1.3 What Needs to Be Built

| Component | Files | Priority |
|-----------|-------|----------|
| Auth routes (login, refresh, logout) | `routes/auth.ts` | Phase 1 |
| Donor CRUD routes | `routes/donors.ts` | Phase 1 |
| Analytics routes (basic) | `routes/analytics.ts` | Phase 1 |
| Integration setup routes | `routes/integrations.ts` | Phase 1 |
| JWT authentication middleware | `middleware/authenticate.ts` | Phase 1 |
| RBAC authorization middleware | `middleware/authorize.ts` | Phase 1 |
| Global error handler | `middleware/errorHandler.ts` | Phase 1 |
| Rate limiter | `middleware/rateLimiter.ts` | Phase 1 |
| Audit logger | `middleware/auditLog.ts` | Phase 1 |
| Request validator | `middleware/validateRequest.ts` | Phase 1 |
| Persona engine | `services/personaEngine.ts` | Phase 1 |
| Consent service | `services/consentService.ts` | Phase 1 |
| CRM adapter interface | `integrations/adapter.interface.ts` | Phase 1 |
| New DB migration | `migrations/002_veo_enhancement.ts` | Phase 1 |
| Knex config | `knexfile.ts` | Phase 1 |
| React frontend (dashboard) | `frontend/src/` | Phase 1 |
| Channel router | `services/channelRouter.ts` | Phase 3 |
| Donor portal routes | `routes/portal.ts` | Phase 3 |
| Campaign routes | `routes/campaigns.ts` | Phase 2 |
| Ellucian adapter | `integrations/ellucian.ts` | Phase 4 |

---

## 2. Technology Stack

100% leveraging existing Orbit infrastructure:

| Layer | Technology | Status | Notes |
|-------|-----------|--------|-------|
| Runtime | Node.js 20+ | Existing | |
| API Framework | Express + TypeScript | Existing | |
| Database | PostgreSQL 15+ | Existing | + Knex query builder |
| Queue | Bull + Redis | Existing | |
| AI | Anthropic Claude API | Existing | Opus 4.5 model |
| Email | SendGrid v3 | Existing | |
| SMS | Twilio | Existing | |
| CRM | Multi-adapter | Existing | SF, BB, HS |
| eSignature | DocuSign | Existing | |
| Payments | Stripe | Existing | |
| Frontend | React + TypeScript | **New** | Migrating from HTML prototype |
| CSS | Tailwind CSS | **New** | Rapid UI development |
| Deployment | Docker + Railway | Existing | |
| CI/CD | GitHub Actions | **New** | lint, type-check, test |

---

## 3. Phase 1: MVP (Weeks 1-8)

### Week 1-2: Infrastructure Foundation

**Goal**: Complete missing middleware and auth system

**Tasks**:

1. **`middleware/authenticate.ts`** — JWT verification
   ```typescript
   // Verify access token, extract user payload
   // On invalid/expired: return 401
   // On valid: attach req.user = { userId, orgId, role }
   ```

2. **`middleware/authorize.ts`** — RBAC enforcement
   ```typescript
   // Check req.user.role against required permission
   // Roles: admin, manager, staff
   // Staff: can only access own assigned donors
   ```

3. **`middleware/errorHandler.ts`** — Global error handler
   ```typescript
   // Catch all unhandled errors
   // Log with Winston (no PII)
   // Return standardized error envelope
   ```

4. **`middleware/rateLimiter.ts`** — Rate limiting per CLAUDE.md spec
   - Login: 5 req / 15min / IP
   - Refresh: 10 req / 15min / IP
   - API: 1000 req / 15min / user
   - Webhooks: 500 req / min / IP

5. **`middleware/auditLog.ts`** — Immutable event logging
   ```typescript
   // Required events: login/logout/failed auth, donor CRUD,
   // agent operations, gifts/pledges, integration changes
   ```

6. **`middleware/validateRequest.ts`** — express-validator chains
   - UUIDs validated with `.isUUID()`
   - Monetary amounts as positive integers (cents)
   - Emails normalized to lowercase

7. **`knexfile.ts`** — Database connection config for dev/staging/prod

8. **`routes/auth.ts`** — Authentication endpoints
   - `POST /auth/login` — Email + password -> JWT access + refresh
   - `POST /auth/refresh` — Refresh token -> new access + refresh
   - `POST /auth/logout` — Invalidate tokens
   - `POST /auth/forgot-password` — Password reset flow

### Week 3-4: Core Routes + Persona Engine

**Goal**: Donor CRUD, integration setup, persona configuration

**Tasks**:

9. **`routes/donors.ts`** — Donor management
   - `GET /donors` — List with pagination, search, filter by stage
   - `GET /donors/:id` — Full donor profile with touchpoints
   - `POST /donors` — Create donor (manual entry)
   - `PATCH /donors/:id` — Update donor fields
   - `POST /donors/import` — CSV bulk import
   - `GET /donors/:id/touchpoints` — Interaction history
   - `GET /donors/:id/decisions` — Agent decision history

10. **`routes/integrations.ts`** — CRM connection management
    - `GET /integrations` — List configured integrations
    - `POST /integrations` — Connect new CRM (store encrypted credentials)
    - `POST /integrations/:id/test` — Test CRM connection
    - `POST /integrations/:id/sync` — Trigger manual sync
    - `DELETE /integrations/:id` — Disconnect CRM

11. **`routes/analytics.ts`** — Basic metrics (Phase 1 scope)
    - `GET /analytics/overview` — Donor count by stage, total giving, agent activity
    - `GET /analytics/agent-activity` — Recent decisions, outreach volume
    - `GET /analytics/retention` — Basic retention metrics

12. **`services/personaEngine.ts`** — Persona management
    ```typescript
    export class PersonaEngine {
      // Load persona config from agents.config JSONB
      getPersonaConfig(orgId: string): Promise<VEOPersonaConfig>;

      // Build system prompt preamble from persona config
      buildPersonaPrompt(config: VEOPersonaConfig): string;

      // Merge persona + archetype into full system prompt
      buildEnrichedPrompt(
        config: VEOPersonaConfig,
        archetype: ArchetypeProfile,
        commDNA: CommDNA
      ): string;

      // Update persona config
      updatePersonaConfig(orgId: string, config: Partial<VEOPersonaConfig>): Promise<void>;
    }
    ```

13. **`services/consentService.ts`** — Opt-in/opt-out management
    ```typescript
    export class ConsentService {
      // Record opt-in event
      recordOptIn(orgId: string, donorId: string, source: string, metadata?: object): Promise<void>;

      // Record opt-out event (immediate processing)
      recordOptOut(orgId: string, donorId: string, channel: string, source: string): Promise<void>;

      // Check if donor can be contacted
      canContact(orgId: string, donorId: string, channel: string): Promise<boolean>;

      // Get consent history
      getConsentHistory(orgId: string, donorId: string): Promise<ConsentEvent[]>;

      // Propagate opt-out to CRM
      propagateOptOut(orgId: string, donorId: string, crmAdapter: CRMAdapter): Promise<void>;
    }
    ```

14. **`integrations/adapter.interface.ts`** — Formal CRM adapter TypeScript interface

15. **`migrations/002_veo_enhancement.ts`** — New tables
    - `donor_intelligence_cache`
    - `donor_signals`
    - `consent_events`
    - `escalations`
    - New columns on `donors`: `archetype`, `comm_dna_style`, `channel_preference_learned`

### Week 5-6: Agent Enhancement + CRM Sync Activation

**Goal**: Wire predictive scoring into scheduler, activate Salesforce sync

**Tasks**:

16. **Enhance `agentService.ts`**:
    - Import and use `PersonaEngine.buildEnrichedPrompt()` in `buildSystemPrompt()`
    - Add archetype and commDNA to `DonorContext` passed to `decide()`
    - Enhance `buildUserMessage()` to include archetype profile and communication DNA
    - Add escalation creation in `parseDecision()` when escalation flags are set

17. **Enhance `workers/index.ts`**:
    - Replace simple `next_contact_at <= NOW` query with `predictiveEngine.scorePortfolio()`
    - Filter by `contactUrgency in ['immediate', 'this_week']`
    - Add `donorIntelligence.buildDonorProfile()` call in agent-run job
    - Add `crm-sync` queue with daily schedule per integration
    - Add `intelligence-refresh` queue for `donor_intelligence_cache` refresh

18. **Activate CRM Sync**:
    - Wire `sync.js` `triggerSync()` to a scheduled Bull job (configurable per org, default daily)
    - Create integration setup UI flow (credentials input, test, initial sync)
    - Handle sync errors gracefully (retry, alert, audit log)

19. **Build Opt-In Flow**:
    - SendGrid template for opt-in email (with unique opt-in link)
    - API endpoint: `POST /portal/opt-in/:token` — sets `ai_opted_in: true` + consent event
    - API endpoint: `POST /portal/opt-out` — processes opt-out + consent event + CRM propagation
    - Webhook handler: SendGrid unsubscribe -> `email_opted_in: false`
    - Webhook handler: Twilio STOP -> `sms_opted_in: false`

### Week 7-8: React Dashboard

**Goal**: Staff can monitor all VEO activity

**Tasks**:

20. **React scaffold** (`frontend/src/`):
    - Vite + React + TypeScript + Tailwind CSS
    - React Router for navigation
    - Axios for API calls with JWT interceptor
    - Context for auth state

21. **Dashboard page** (`pages/Dashboard.tsx`):
    - Metric cards: total donors, donors by stage, outreach sent today, pending escalations
    - Stage funnel visualization
    - Recent agent activity feed (last 20 decisions)

22. **Donor list page** (`pages/Donors.tsx`):
    - Searchable, filterable table
    - Filter by: journey stage, segment, propensity score range, archetype
    - Sort by: name, last gift, propensity score, last contact
    - Quick actions: view profile, pause VEO, assign to officer

23. **Donor detail page** (`pages/DonorDetail.tsx`):
    - Profile header (name, class year, lifetime giving, stage, archetype)
    - Touchpoint timeline (chronological interaction history)
    - Agent decision log (why the VEO did what it did)
    - Giving history chart
    - Signal feed (recent signals detected)
    - Manual actions: send email, update stage, assign to officer, add note

24. **Agent console page** (`pages/AgentConsole.tsx`):
    - Active VEO instances with status
    - Real-time decision feed
    - Pause/resume controls
    - Persona configuration UI
    - Queue health (Bull queue status)

25. **Integration setup page** (`pages/Integrations.tsx`):
    - CRM connection wizard (select provider, enter credentials, test, sync)
    - Sync status and history
    - Field mapping configuration

---

## 4. Phase 2: CRM Integration + Analytics (Weeks 9-16)

### Goals
- Activate Blackbaud and HubSpot adapters
- Build comprehensive analytics dashboard
- Activate VSO for stewardship
- Launch first VCO campaign

### Key Tasks

26. **Multi-CRM activation**:
    - Blackbaud adapter: already built (`integrations/blackbaud.js`), wire into sync scheduler
    - HubSpot adapter: already built (`integrations/hubspot.js`), wire into sync scheduler
    - Adapter selection in integration setup UI based on provider choice

27. **Analytics dashboard** (`pages/Analytics.tsx`):
    - Retention cohort curves (monthly, by segment)
    - Upgrade funnel (annual -> mid-level -> major)
    - Agent performance: open rates, reply rates, conversion rates by archetype
    - A/B comparison: VEO-managed vs. control group
    - Campaign performance attribution

28. **VSO activation**:
    - Wire `vsoEngine.js` into worker fleet
    - Auto-trigger: gift received -> VSO acknowledgment within 24 hours
    - Auto-trigger: quarterly impact reports for stewardship-stage donors
    - Auto-trigger: milestone recognition (consecutive giving years, total giving thresholds)

29. **Campaign module** (`routes/campaigns.ts` + `pages/Campaigns.tsx`):
    - Campaign CRUD (create, manage, close)
    - Donor assignment to campaigns
    - VCO activation for campaign-specific outreach
    - Progress tracking: goal, raised, participation %

30. **`routes/gifts.ts`** + **`routes/pledges.ts`**:
    - Gift recording and management
    - Pledge schedule creation and installment tracking
    - Payment integration (Stripe webhook processing)

---

## 5. Phase 3: Omnichannel Expansion (Weeks 17-24)

### Goals
- Activate SMS channel
- Build donor portal with chat
- Implement channel preference learning
- Activate DocuSign for pledge agreements

### Key Tasks

31. **SMS channel activation**:
    - SMS already built (`smsService.ts`), activate in outreach worker
    - TCPA compliance verification (opt-in check before every SMS)
    - A2P 10DLC brand and campaign registration
    - SMS template library (shorter, more conversational)

32. **`services/channelRouter.ts`** — Cross-channel coordination:
    ```typescript
    export class ChannelRouter {
      // Determine optimal channel for this donor + message type
      selectChannel(donorId: string, messageType: string): Promise<Channel>;

      // Check if donor was recently contacted (48-hour window)
      checkCooldown(donorId: string, topic: string): Promise<boolean>;

      // Update channel preference based on engagement
      recordEngagement(donorId: string, channel: string, event: string): Promise<void>;
    }
    ```

33. **Donor portal** (`routes/portal.ts` + frontend):
    - Public-facing pages: opt-in confirmation, preference management, giving page
    - Chat widget: WebSocket connection to VEO for real-time conversations
    - Giving page: Stripe Elements for one-click giving
    - Profile update: donor can update contact preferences

34. **DocuSign activation**:
    - Already built (`docusignService.ts`)
    - Auto-trigger: pledge agreement for committed gifts > $500
    - Auto-trigger: planned giving document preparation
    - Webhook processing: envelope-completed, declined, voided

35. **Stripe giving page**:
    - Already built (`stripeService.ts`)
    - Embed Stripe Elements in donor portal
    - Support one-time and recurring gifts
    - Support pledge autopay

---

## 6. Phase 4: Advanced Intelligence (Months 7-12)

### Goals
- Activate wealth screening
- Full predictive scoring
- AI-generated officer briefings
- VPGO activation
- Ellucian Advance adapter

### Key Tasks

36. **Wealth screening integration**:
    - Activate `signalIngestion.js` for iWave and DonorSearch
    - Quarterly batch re-screening for entire portfolio
    - Real-time screening on major gift signal detection
    - Results -> `donors.wealth_capacity_cents` + `donors.propensity_score`

37. **Full predictive scoring**:
    - Activate all 5 layers of `predictiveEngine.js`
    - Daily portfolio scoring (batch job)
    - Real-time re-scoring on significant events (gift, signal, engagement)
    - Scoring results feed into agent decision loop

38. **AI-generated officer briefings**:
    - Use `donorIntelligence.js` `generateAIBrief()` for MGO meeting prep
    - Include: donor profile, giving history, motivation matrix, talking points, recommended ask
    - Accessible from dashboard: "Prepare briefing" button on donor detail page
    - Export as PDF for offline use

39. **VPGO activation**:
    - Planned giving agent for donors with `bequeath_score >= 60`
    - Educational content about giving vehicles (QCD, CGA, CRT, bequest)
    - 45-day minimum cadence
    - All estate planning conversations escalated to human PGFO immediately

40. **Ellucian Advance adapter** (`integrations/ellucian.ts`):
    - OAuth 2.0 Client Credentials authentication
    - Map Person, Gift, Designation, Campaign objects
    - Handle institution-specific field mapping via configuration
    - Support both cloud and on-premise deployments

41. **Multi-institution benchmarking**:
    - Anonymous aggregate metrics across institutions
    - Retention benchmarks by institution type and size
    - AI performance benchmarks (open rates, conversion rates)
    - Opt-out for institutions that don't want to participate

---

## 7. Directory Structure

```
orbit/
+-- backend/
|   +-- package.json
|   +-- tsconfig.json
|   +-- knexfile.ts                          # Phase 1: BUILD
|   +-- docker-compose.yml                   # Existing
|   +-- Dockerfile                           # Existing
|   +-- src/
|   |   +-- index.ts                         # Existing (server entry)
|   |   +-- config/
|   |   |   +-- database.ts                  # Existing
|   |   |   +-- redis.ts                     # Existing
|   |   |   +-- logger.ts                    # Existing
|   |   +-- middleware/
|   |   |   +-- authenticate.ts              # Phase 1: BUILD
|   |   |   +-- authorize.ts                 # Phase 1: BUILD
|   |   |   +-- rateLimiter.ts               # Phase 1: BUILD
|   |   |   +-- auditLog.ts                  # Phase 1: BUILD
|   |   |   +-- errorHandler.ts              # Phase 1: BUILD
|   |   |   +-- validateRequest.ts           # Phase 1: BUILD
|   |   +-- routes/
|   |   |   +-- auth.ts                      # Phase 1: BUILD
|   |   |   +-- donors.ts                    # Phase 1: BUILD
|   |   |   +-- agents.ts                    # Existing
|   |   |   +-- analytics.ts                 # Phase 1: basic; Phase 2: full
|   |   |   +-- integrations.ts              # Phase 1: BUILD
|   |   |   +-- webhooks.ts                  # Existing
|   |   |   +-- campaigns.ts                 # Phase 2: BUILD
|   |   |   +-- gifts.ts                     # Phase 2: BUILD
|   |   |   +-- pledges.ts                   # Phase 2: BUILD
|   |   |   +-- portal.ts                    # Phase 3: BUILD
|   |   +-- services/
|   |   |   +-- agentService.ts              # Existing -> ENHANCE (archetype)
|   |   |   +-- emailService.ts              # Existing
|   |   |   +-- smsService.ts                # Existing
|   |   |   +-- stripeService.ts             # Existing
|   |   |   +-- docusignService.ts           # Existing
|   |   |   +-- salesforceService.ts         # Existing
|   |   |   +-- predictiveEngine.js          # Existing -> ACTIVATE
|   |   |   +-- donorIntelligence.js         # Existing -> INTEGRATE
|   |   |   +-- signalIngestion.js           # Existing -> Phase 4 ACTIVATE
|   |   |   +-- vsoEngine.js                 # Existing -> Phase 2 ACTIVATE
|   |   |   +-- sync.js                      # Existing -> ACTIVATE
|   |   |   +-- personaEngine.ts             # Phase 1: NEW
|   |   |   +-- consentService.ts            # Phase 1: NEW
|   |   |   +-- channelRouter.ts             # Phase 3: NEW
|   |   +-- integrations/
|   |   |   +-- salesforce.js                # Existing
|   |   |   +-- blackbaud.js                 # Existing
|   |   |   +-- hubspot.js                   # Existing
|   |   |   +-- adapter.interface.ts         # Phase 1: NEW
|   |   |   +-- ellucian.ts                  # Phase 4: NEW
|   |   +-- workers/
|   |   |   +-- index.ts                     # Existing -> ENHANCE
|   |   +-- migrations/
|   |   |   +-- 001_initial_schema.ts        # Existing
|   |   |   +-- 002_veo_enhancement.ts       # Phase 1: NEW
|   |   +-- __tests__/
|   |       +-- unit/
|   |       |   +-- agentService.test.ts
|   |       |   +-- predictiveEngine.test.ts
|   |       |   +-- donorIntelligence.test.ts
|   |       |   +-- personaEngine.test.ts
|   |       |   +-- consentService.test.ts
|   |       |   +-- middleware.test.ts
|   |       +-- integration/
|   |       |   +-- agentLoop.test.ts
|   |       |   +-- crmSync.test.ts
|   |       |   +-- webhooks.test.ts
|   |       |   +-- tenantIsolation.test.ts
|   |       +-- e2e/
|   |           +-- login.test.ts
|   |           +-- veoRun.test.ts
|   |           +-- optInOut.test.ts
|
+-- frontend/
|   +-- package.json
|   +-- tsconfig.json
|   +-- vite.config.ts
|   +-- tailwind.config.ts
|   +-- src/
|   |   +-- App.tsx
|   |   +-- main.tsx
|   |   +-- api/
|   |   |   +-- client.ts                    # Axios with JWT interceptor
|   |   |   +-- donors.ts                    # Donor API calls
|   |   |   +-- agents.ts                    # Agent API calls
|   |   |   +-- analytics.ts                 # Analytics API calls
|   |   |   +-- integrations.ts              # Integration API calls
|   |   +-- contexts/
|   |   |   +-- AuthContext.tsx              # JWT auth state
|   |   +-- pages/
|   |   |   +-- Login.tsx
|   |   |   +-- Dashboard.tsx
|   |   |   +-- Donors.tsx
|   |   |   +-- DonorDetail.tsx
|   |   |   +-- AgentConsole.tsx
|   |   |   +-- Integrations.tsx
|   |   |   +-- Analytics.tsx               # Phase 2
|   |   |   +-- Campaigns.tsx               # Phase 2
|   |   +-- components/
|   |       +-- DonorTable.tsx
|   |       +-- AgentActivityFeed.tsx
|   |       +-- TouchpointTimeline.tsx
|   |       +-- MetricCard.tsx
|   |       +-- StageFunnel.tsx
|   |       +-- SignalFeed.tsx
|   |       +-- PersonaConfig.tsx
|   |       +-- QueueHealth.tsx
```

---

## 8. Testing Strategy

Following CLAUDE.md section 11: 60% unit / 30% integration / 10% E2E.

### 8.1 Unit Tests (Jest)

| Module | Test Focus |
|--------|-----------|
| `agentService.ts` | Decision parsing, fallback behavior, opt-in guard, archetype injection, escalation detection |
| `predictiveEngine.js` | Score computation with known inputs, fiscal boost, recency decay, channel recommendation |
| `donorIntelligence.js` | Archetype detection, motivation scoring, PG readiness, communication DNA |
| `personaEngine.ts` | Prompt construction, persona config validation, archetype merging |
| `consentService.ts` | Opt-in/opt-out recording, canContact logic, propagation |
| `channelRouter.ts` | Channel selection, cooldown check, preference learning |
| All middleware | Auth, validation, rate limiting, RBAC enforcement |

### 8.2 Integration Tests (Supertest + Test DB)

| Test | Validates |
|------|----------|
| Full agent decision loop | Mock Claude API -> verify DB state changes (stage, touchpoint, decision) |
| CRM sync | Mock adapter responses -> verify upsert logic, dedup, conflict resolution |
| Webhook handlers | Stripe, Twilio, DocuSign, SendGrid event processing |
| Multi-tenant isolation | Org A cannot access Org B data (test all routes) |
| Opt-in/opt-out flow | Full cycle: opt-in -> contact -> opt-out -> no contact |
| Auth flow | Login, refresh, logout, rate limiting |

### 8.3 E2E Tests (Playwright)

| Test | Flow |
|------|------|
| Staff login | Navigate to login page -> enter credentials -> see dashboard |
| Dashboard metrics | Login -> verify metric cards populated -> verify activity feed |
| Donor detail | Login -> navigate to donor -> verify profile, touchpoints, decisions |
| VEO trigger | Login -> trigger VEO run on test donor -> verify touchpoint created |
| Opt-in flow | Donor receives email -> clicks opt-in link -> verified in DB -> VEO can contact |
| Opt-out flow | Donor sends STOP (SMS) or unsubscribes (email) -> verified immediate suppression |

### 8.4 Test Infrastructure

- **Test DB**: Separate PostgreSQL database (`DATABASE_URL_TEST`)
- **Fixtures**: Seed data for 100 test donors with known archetypes and giving histories
- **Mocks**: Claude API (returns predictable decisions), SendGrid (captures sent emails), Twilio (captures sent SMS), CRM adapters (returns fixture data)
- **CI**: GitHub Actions runs all tests on every PR; merge blocked if tests fail

---

## 9. Deployment Plan

### 9.1 Infrastructure

| Component | Service | Configuration |
|-----------|---------|---------------|
| API Server | Railway | Docker container, auto-scaling |
| Workers | Railway | Separate container, scaled independently |
| PostgreSQL | Railway (dev) / AWS RDS (prod) | Connection pooling via PgBouncer |
| Redis | Railway Redis / AWS ElastiCache | Cluster mode for production |
| Frontend | Vercel or Netlify | Static SPA, CDN distribution |
| DNS | Cloudflare | SSL, DDoS protection |

### 9.2 Environment Setup

| Environment | Branch | Purpose | Database |
|-------------|--------|---------|----------|
| Development | `feature/*` | Local development | Docker Compose PostgreSQL |
| Staging | `develop` | Integration testing | Railway staging DB |
| Production | `main` | Live platform | AWS RDS (with replicas) |

### 9.3 CI/CD Pipeline (GitHub Actions)

```yaml
# On every PR:
- Lint (ESLint + Prettier)
- Type-check (tsc --noEmit)
- Unit tests (Jest)
- Integration tests (Supertest + test DB)
- Security audit (npm audit)

# On merge to develop:
- All above +
- Auto-deploy to staging
- Run E2E tests against staging

# On merge to main:
- All above +
- Manual approval gate
- Deploy to production
- Smoke tests
```

### 9.4 Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/orbit
DATABASE_URL_TEST=postgresql://user:pass@host:5432/orbit_test
REDIS_URL=redis://host:6379

# Auth
JWT_SECRET=<64+ char random string>
ENCRYPTION_KEY=<32 byte hex for AES-256-GCM>

# AI
ANTHROPIC_API_KEY=sk-ant-api...
ANTHROPIC_MODEL=claude-opus-4-5

# Email
SENDGRID_API_KEY=SG...

# SMS
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...

# Payments
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...

# eSignature
DOCUSIGN_INTEGRATION_KEY=...
DOCUSIGN_USER_ID=...
DOCUSIGN_ACCOUNT_ID=...

# CRM (per-org, stored encrypted in DB, not env vars)

# App
CLIENT_URL=https://app.orbitfundraising.com
NODE_ENV=production
PORT=3001
```

---

## 10. Success Metrics

### Phase 1 MVP (Weeks 1-8)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Donors synced from Salesforce | 500+ | DB count |
| Donors opted into AI outreach | 100+ | `ai_opted_in: true` count |
| VEO emails sent per week | 50+ | Touchpoint count |
| Email open rate | >40% | SendGrid analytics (vs. 20-25% baseline) |
| Inappropriate messages | Zero | 100% human review first 2 weeks |
| Cross-tenant data leaks | Zero | Integration test + manual audit |
| Staff can view all activity | Yes/No | Dashboard functional test |
| Opt-out processing time | <1 minute | Webhook -> DB update latency |

### Phase 2: CRM + Analytics (Weeks 9-16)

| Metric | Target | Measurement |
|--------|--------|-------------|
| CRM adapters functional | 3+ (SF, BB, HS) | Integration tests pass |
| Managed donor relationships | 5,000+ | Active `agent_assignments` count |
| Donor retention improvement | >5 point lift vs. control | Cohort analysis |
| VSO acknowledgment time | <24 hours | Gift-to-acknowledgment latency |
| Giving Day participation lift | >10% vs. prior year | Campaign metrics |
| Analytics dashboard accuracy | Validated against CRM reports | Manual reconciliation |

### Phase 3: Omnichannel (Weeks 17-24)

| Metric | Target | Measurement |
|--------|--------|-------------|
| SMS channel active | TCPA compliance verified | Legal review + technical test |
| Donor portal live | Chat widget functional | E2E test |
| Channel preference learning | Measurable engagement improvement | A/B test by channel |
| DocuSign agreements processed | End-to-end functional | Gift agreement flow test |
| Cross-channel coordination | No duplicate contacts within 48hr | Touchpoint audit |

### Phase 4: Intelligence (Months 7-12)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Wealth screening integrated | iWave + DonorSearch active | Signal count in DB |
| Predictive scoring accuracy | Correlation with actual giving | Score vs. gift regression |
| Officer briefing adoption | 80% of MGOs use before meetings | Usage tracking |
| VPGO planned giving prospects | 50+ identified per year | PG pipeline count |
| Ellucian Advance adapter | Operational for 1+ institution | Integration test |

---

## 11. Risk Mitigation

### Development Risks

| Risk | Mitigation |
|------|-----------|
| Claude API changes or pricing | Abstract API calls through agentService; swap models if needed |
| CRM API breaking changes | Adapter pattern isolates changes; version-pin API clients |
| Feature creep | Strict MVP scope; Phase 1 = email + annual fund + Salesforce only |
| Performance under load | Load test with 10K simulated donors before Phase 2 |
| Data migration errors | Dry-run syncs in staging; manual verification of first 100 records |

### Operational Risks

| Risk | Mitigation |
|------|-----------|
| AI sends wrong message | Structured JSON parsing; template constraints; human review sampling |
| Staff don't trust the system | 100% review for first 2 weeks; gradual autonomy; show time savings |
| Donor complaints about AI | Transparent disclosure; easy opt-out; immediate escalation on negative sentiment |
| Integration downtime | Graceful degradation (queue messages, retry later); alerting on failures |
| Cost overrun (Claude API) | Budget monitoring; per-org usage caps; batch scoring to reduce API calls |

### Security Risks

| Risk | Mitigation |
|------|-----------|
| Credential exposure | AES-256-GCM encryption; env vars for secrets; no PII in logs |
| Unauthorized access | JWT with 15-min expiry; RBAC; tenant isolation; audit logging |
| Data breach | Encryption at rest and in transit; regular security audits; SOC 2 readiness |
| Prompt injection in donor replies | Sanitize all inbound text before inclusion in Claude prompts |

---

## Implementation Start Checklist

Before writing code:

- [ ] Set up local development environment (Docker Compose for PG + Redis)
- [ ] Create feature branch: `feature/veo-mvp-phase1`
- [ ] Verify all existing services compile and pass existing tests
- [ ] Set up Salesforce sandbox for testing (or use existing test data)
- [ ] Obtain SendGrid sandbox credentials
- [ ] Configure Anthropic API key for development
- [ ] Create GitHub Actions CI pipeline (lint + type-check + test)
- [ ] Set up staging environment on Railway

---

*End of Working Prototype Plan v1.0*

*References: Orbit CLAUDE.md (Project Constitution), VEO-STRATEGIC-BLUEPRINT.md, VEO-TECHNICAL-ARCHITECTURE.md*
