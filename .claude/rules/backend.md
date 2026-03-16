---
paths:
  - "orbit-backend/src/**"
  - "backend/src/**"
---

# Backend Development Rules

## API Conventions

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

## Naming Conventions

| Context | Convention | Example |
|---|---|---|
| Files | kebab-case | `agent-service.ts` |
| Classes | PascalCase | `AgentService` |
| Functions | camelCase | `buildDonorContext()` |
| DB columns | snake_case | `total_giving_cents` |
| API JSON | camelCase | `totalGivingCents` |
| Env vars | SCREAMING_SNAKE | `ANTHROPIC_API_KEY` |

---

## Forbidden Patterns

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
