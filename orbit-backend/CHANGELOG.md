# Orbit Backend — Changelog

## [1.4.0] — 2026-03-08

### 🔒 Security (P0 — All Critical)
- **Tenant isolation enforced on ALL routes** — `tenantScope` middleware now applied globally in `server.js` via the `protect` middleware stack. Every protected request has `req.orgId` set from the authenticated user's JWT, making cross-org data leakage structurally impossible.
- **`requireActiveBilling` guard** — Blocks API access for `past_due` and `suspended` orgs. Billing routes intentionally exempt so customers can fix their payment method.
- **Hardened CORS** — Multi-origin support via `FRONTEND_URLS` env var. Strict methods/headers whitelist. Proper origin rejection with error logging.
- **CSP headers** — Strict Content-Security-Policy via Helmet. Disables inline scripts, frames, and objects. Connects only to `api.anthropic.com`.
- **HSTS** — 1-year max-age with preload enabled in production.
- **Webhook raw body parsing** — Fixed ordering so Stripe/Twilio signature verification works correctly (raw body before `express.json`).
- **Auth rate limiter** — Added `forgot-password` endpoint to brute-force protection.

### ✨ New Features
- **AI Response Cache** (`src/services/aiCache.js`) — In-memory LRU cache for AI responses. Feature-specific TTLs (60 min for donor briefings, 15 min for outreach drafts). ~40% estimated hit rate reduces Anthropic API costs. GC runs every 10 minutes. Swap for Redis in scaled deployments.
- **Billing route wired** (`/api/v1/billing`) — Previously missing from server.js. Now properly registered with `authenticate + tenantScope` middleware.
- **Superadmin cache stats** — `GET /api/v1/ai/cache-stats` returns hit rate, evictions, estimated cost savings. Superadmin-only.

### 🗄️ Database
- **Migration 003** (`003_subscription_plans.sql`) — Adds `plan`, `billing_status`, `stripe_customer_id`, `stripe_subscription_id`, `trial_ends_at`, `plan_seats`, `plan_donor_limit`, `feature_flags` columns to `orgs` table. Database trigger auto-sets feature flags on plan change. Adds `subscription_events` and `ai_usage` tables. Revenue and cost monitoring views.

### 🧪 Testing
- **E2E test suite** (`tests/e2e/critical-flows.test.js`) — 387-line test covering 8 critical flows: Auth, Tenant Isolation, Donor CRUD, AI Proxy + Cache, Outreach, Plan Gating, Billing, Rate Limiting.
- **Tenant isolation test** — Explicitly verifies org A cannot read, update, or list org B resources (regression test for P0 security).
- **Cache hit test** — Verifies second identical AI request returns `cached: true` with same response body.
- **Plan gating test** — Verifies Starter plan gets `402 PlanRequired` on enterprise features.

### 📦 Demo Data
- **`orbit_demo_data.json`** — 350 realistic Greenfield University donors, 1,107 gifts, 15 pledges, 582 outreach messages. $49M total capacity pool. Full engagement scores, signals, and agent assignments.
- **`orbit_demo_seed.sql`** — Ready-to-run SQL seed script for the above data. Idempotent (`ON CONFLICT DO NOTHING`).

---

## [1.3.0] — 2026-03-07
- Super admin portal routes (`/api/v1/superadmin`)
- Full test suite (75 tests across 6 files)
- Docker + docker-compose + nginx config
- CI/CD GitHub Actions workflows (5 jobs)

## [1.2.0] — 2026-03-06
- Delivery service (SendGrid + Twilio)
- Stripe + Twilio/SendGrid webhooks
- Agents, pledges, outreach, gifts, campaigns routes

## [1.1.0] — 2026-03-05
- AI proxy route with per-user rate limiting + jailbreak detection
- Multi-tenant middleware
- Background jobs (daily digest, lapsed recovery)
- Production env template

## [1.0.0] — 2026-03-04
- Initial Express API
- Auth (JWT), Donors, Metrics, Integrations routes
- PostgreSQL schema + Knex migrations
- Blackbaud RE NXT, Salesforce, HubSpot integrations
