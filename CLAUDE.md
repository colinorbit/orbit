# CLAUDE.md: Orbit Platform Constitution

> This file governs all development on the Orbit platform. All engineers and AI
> tools must treat these rules as binding. Update this file before writing code.

---

## Quick Commands

```bash
# Start backend
cd backend && npm run dev

# Run tests
cd backend && npm test

# Type check (run after every backend change)
cd backend && npx tsc --noEmit

# Run migrations
cd backend && npx knex migrate:latest

# Lint
cd backend && npm run lint

# Validate a Python agent module
python3 veo_intelligence/*_demo.py
```

---

## What This System Is

Orbit is a multi-tenant B2B SaaS platform that deploys AI agents (VEO, VSO, VPGO,
VCO, VAFO) to manage donor relationships at scale for university advancement offices.
Backend is Express + TypeScript on PostgreSQL + Redis. Agents are powered by the
Anthropic Claude API. All donor data is isolated by `org_id` at every layer.

---

## IMPORTANT: Critical Rules

These three rules are non-negotiable. Violations cause data leakage or legal exposure.

### YOU MUST: Tenant Isolation on Every Query

Every DB query touching tenant data MUST include `.where({ org_id: req.user.orgId })`.

```typescript
// ❌ FORBIDDEN — cross-tenant data leakage
const donor = await db('donors').where({ id: req.params.id }).first();

// ✅ REQUIRED
const donor = await db('donors')
  .where({ id: req.params.id, org_id: req.user.orgId })
  .first();
```

### YOU MUST: Agent Opt-In Before Any Contact

Never contact a donor unless `ai_opted_in: true`. Enforced in `parseDecision()`.
This check must never be bypassed, commented out, or skipped.

### YOU MUST: Monetary Values as Integer Cents

All monetary values stored as INTEGER cents, never floats. Columns end in `_cents`.

```typescript
// ❌ FORBIDDEN
amount_dollars: 1250.50

// ✅ REQUIRED
gift_amount_cents: 125050
```

---

## TypeScript Standards

- Strict mode enabled (`strict: true`) — no exceptions
- No `any` — use `unknown` and narrow, or define proper interfaces
- Explicit return types on all exported functions
- Interface over type for object shapes

See @.claude/rules/backend.md for naming conventions and full forbidden patterns.

---

## Database Rules

1. Every table has `org_id` — FK to organizations; never query without it
2. Monetary values in cents — INTEGER, never FLOAT; columns end in `_cents`
3. All IDs are UUIDs — `uuid_generate_v4()`; no integer sequences
4. Scores are 0–100 integers — propensity_score, bequeath_score, etc.
5. Timestamps on every table — `created_at` + `updated_at` always
6. Soft deletes — never hard-delete donors/gifts; use `status: 'archived'`
7. Consent timestamps — `ai_opted_in_at` required when `ai_opted_in` set to true

---

## Agent Rules

These rules are absolute. No agent decision may violate them.

1. **Never contact donor without `ai_opted_in: true`** — enforced in parseDecision()
2. **Always disclose AI identity** — never claim to be human
3. **Immediate opt-out on request** — any STOP triggers `opt_out_acknowledged`
4. **Escalate gifts > $25,000** — always route to human gift officer
5. **Escalate estate/legacy discussions** — VPGO plants seeds only
6. **Never fabricate facts** — no invented statistics or institutional claims
7. **Conversation history limit** — last 10 turns only

### Python Intelligence Layer Rules

1. Each module is independently testable — run `python3 *_demo.py` to validate
2. No side effects — pure functions; read donor data, return decisions, never mutate
3. JSON in, JSON out — donor dict inputs; dataclass outputs serializable to JSON
4. Cost governance required — all Claude API calls routed through `cost_governor.py`
5. JS ports must stay in sync — when Python logic changes, update `backend/services/*.js`

---

## Security Rules

- All secrets in environment variables — never hardcoded
- Never log secrets, tokens, or PII
- Verify webhook signatures on every inbound request (Stripe, Twilio, DocuSign)
- Audit logging required for: auth events, donor CRUD, agent operations, gifts/pledges

See @.claude/rules/security.md for full auth spec, RBAC table, and rate limit rules.
See @docs/ENV.md for all required environment variables.

---

## Testing Requirements

- Never use production API keys in tests — all external services mocked
- Never test against production DB — use `DATABASE_URL_TEST`
- Reset state between tests — truncate tables in `beforeEach`
- CI must pass before merge — no exceptions

**YOU MUST: After writing any backend code, run `npx tsc --noEmit` and `npm test`
before considering the task complete.**

Required coverage:
- agentService: decision parsing, fallback behavior, opt-in guard
- All middleware: auth, validation, rate limiting
- All route handlers: happy path + 401/403/404/422
- Multi-tenant isolation: org A cannot access org B data

---

## Reference Imports

All content extracted from this file lives here — nothing was deleted:

- Architecture, diagrams, data model, repo structure: @docs/ARCHITECTURE.md
- Integration layers (Salesforce, Stripe, DocuSign, SendGrid, Twilio): @docs/API.md
- Environment variables, observability, scaling: @docs/ENV.md
- Implementation roadmap and phase checklist: @docs/ROADMAP.md
- User research and personas: @docs/PERSONAS.md
- API conventions, naming conventions, forbidden patterns: @.claude/rules/backend.md
- Auth, RBAC, tenant isolation detail, rate limits: @.claude/rules/security.md
- Em dash prohibition and copy standards: @.claude/rules/content.md

---

*Orbit Platform Constitution*
*Rule: Update this document before writing code. Design decisions are documented here first.*
