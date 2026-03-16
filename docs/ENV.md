# Orbit Platform: Environment & Infrastructure Reference

> Extracted from CLAUDE.md. For binding development rules, see CLAUDE.md and .claude/rules/.

---

## Required Environment Variables

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

---

## Observability

- Structured logging: Winston JSON → CloudWatch/Datadog
- Error tracking: Sentry (API + Worker)
- Health: `GET /health` — service status + DB/Redis connectivity
- Queue: Bull Board at `/admin/queues` (admin-only)

---

## Scaling

- API: Horizontal (stateless; all state in DB/Redis)
- Workers: Scale independently from API
- DB: Read replicas for analytics; PgBouncer connection pooling
- Agent API: Rate limiting + exponential backoff on 429s
