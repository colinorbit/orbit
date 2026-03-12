# Orbit API — Production Deployment Guide

## Option A: Railway (Recommended — fastest)

### 1-click from this repo
1. Go to https://railway.app → New Project → Deploy from GitHub
2. Point at this repo → Railway auto-detects Node.js via `package.json`
3. Set environment variables (see ENV VARS section below)
4. Railway provisions a Postgres database automatically — copy DATABASE_URL
5. Click Deploy → live in ~90 seconds

### Verify
```
curl https://your-app.railway.app/health
# {"status":"ok","version":"2.0.0","mounted":23}
```

---

## Option B: Render

1. New Web Service → Connect GitHub repo
2. Build command: `npm ci --omit=dev`
3. Start command: `node src/server.js`
4. Add Postgres database from Render dashboard → copy DATABASE_URL
5. Set all env vars → Deploy

---

## Required Environment Variables

Copy `.env.production.template` to Railway/Render env settings.

### Minimum to start (app boots, AI works, auth works):
```
DATABASE_URL=         # Postgres connection string from Railway/Render
JWT_SECRET=           # 64+ char random string: openssl rand -hex 32
ANTHROPIC_API_KEY=    # From console.anthropic.com
NODE_ENV=production
FRONTEND_URLS=        # Comma-separated allowed origins, e.g. https://yourdomain.com
```

### For error monitoring (P1 — install before first user):
```
SENTRY_DSN=           # From sentry.io → New Project → Node.js
```

### For payments to actually process:
```
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
```

### For CRM sync (add when configuring integrations):
```
# RE NXT (Blackbaud)
BLACKBAUD_CLIENT_ID=
BLACKBAUD_CLIENT_SECRET=
# Salesforce
SF_LOGIN_URL=https://login.salesforce.com
```

---

## Post-Deploy Checklist

- [ ] `GET /health` returns `{"status":"ok","version":"2.0.0","mounted":23}`
- [ ] `POST /api/v1/auth/login` returns 200 with JWT
- [ ] `GET /api/v1/giving` returns 200 (not 404)
- [ ] `GET /api/v1/vso/queue` returns 200 (not 404) ← these were 404 in v1.x
- [ ] `GET /api/v1/planned-giving/prospects` returns 200 (not 404)
- [ ] Sentry dashboard shows first event within 60s of deploy
- [ ] Set `FRONTEND_URLS` to your actual dashboard domain

---

## Running DB Migrations

```bash
# SSH into Railway shell or run locally pointing at prod DB:
DATABASE_URL=<prod-url> node -e "
  const db = require('./src/db/index');
  const fs = require('fs');
  const sql = fs.readFileSync('./src/db/migrations/004_predictive_engine.sql','utf8');
  db.query(sql).then(() => console.log('004 done')).catch(console.error);
"
# Repeat for 005, 006
```

---

## Sentry Setup (10 minutes)

1. Go to https://sentry.io → New Project → Node.js
2. Copy DSN
3. Add `SENTRY_DSN=https://xxx@sentry.io/xxx` to Railway env vars
4. Redeploy — errors now auto-report with stack traces + org/user context
5. Set up Slack alert channel in Sentry for P0 errors

---

## Monitoring the Cron Jobs

After deployment, check Railway logs for:
```
[Orbit] Jobs started
  ✓ metrics-rollup     */5 * * * *
  ✓ crm-sync           0 3 * * *
  ✓ predictive-score   0 4 * * *
  ✓ signal-ingest      0 1 * * *
  ✓ vso-queue          0 6 * * *
  ✓ sustainer-churn    0 7 * * *
```
