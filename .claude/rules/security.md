---
paths:
  - "orbit-backend/src/**"
  - "backend/src/**"
---

# Security Rules

## Authentication
- JWT access tokens: 15-minute expiry
- Refresh tokens: 30-day expiry, stored as bcrypt hash
- Token rotation: new refresh token on every use
- Logout: delete refresh token; add access token to Redis denylist

## Authorization (RBAC)

| Role | Permissions |
|---|---|
| `admin` | Full org access; manage users, integrations, billing |
| `manager` | All donor/agent/campaign operations; view analytics |
| `staff` | Own assigned donors; create touchpoints; view own analytics |

## Tenant Isolation — ABSOLUTE RULE

Every DB query touching tenant data MUST include `.where({ org_id: req.user.orgId })`.

```typescript
// ❌ FORBIDDEN
const donor = await db('donors').where({ id: req.params.id }).first();

// ✅ REQUIRED
const donor = await db('donors')
  .where({ id: req.params.id, org_id: req.user.orgId })
  .first();
```

## Input Validation
- All routes use express-validator chains
- UUIDs validated with `.isUUID()`
- Monetary amounts validated as positive integers (cents)
- Emails normalized to lowercase before storage

## Secrets Management
- All secrets in environment variables — never hardcoded
- Integration credentials encrypted with AES-256-GCM before DB storage
- Never log secrets, tokens, or PII

## Webhook Security
- Stripe: verify `stripe-signature` header
- Twilio: verify `X-Twilio-Signature`
- DocuSign: verify HMAC signature
- All webhook routes use raw body parsing

## Audit Logging
Required for: login/logout/failed auth, donor CRUD, agent operations, gifts/pledges, integration changes, user management

## Rate Limiting

| Endpoint | Limit |
|---|---|
| `POST /auth/login` | 5 req / 15min / IP |
| `POST /auth/refresh` | 10 req / 15min / IP |
| Authenticated API routes | 1000 req / 15min / user |
| Webhook endpoints | 500 req / min / IP |
