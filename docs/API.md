# Orbit Platform: Integration Layers Reference

> Extracted from CLAUDE.md. For binding development rules, see CLAUDE.md and .claude/rules/.

---

## Integration Layers

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
