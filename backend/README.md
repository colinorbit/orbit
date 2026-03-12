# Orbit Backend API

Production-ready Node.js + PostgreSQL API for the Orbit Fundraising Intelligence platform.

## Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | Node.js 18+ (Express) | Fast, npm ecosystem, async I/O for CRM calls |
| Database | PostgreSQL 15+ | JSONB for flexible CRM IDs, pg_trgm for donor search |
| Auth | JWT (access 15m + refresh 30d) | Stateless, scalable |
| AI | Claude API (Anthropic) | Donor briefs, agent reasoning, message generation |
| Encryption | AES-256-GCM | CRM credentials encrypted at rest |
| Jobs | node-cron | Sync scheduler, pledge health, RE NXT token refresh |

---

## Project Structure

```
orbit-backend/
├── openapi.yaml              # API contract — source of truth
├── schema.sql                # PostgreSQL schema (run once)
├── .env.example              # Copy to .env and fill in
├── src/
│   ├── server.js             # Express app entrypoint
│   ├── db/index.js           # PostgreSQL pool + transaction helper
│   ├── middleware/auth.js    # JWT verify + role guard
│   ├── routes/
│   │   ├── auth.js           # Login, refresh, logout, /me
│   │   ├── metrics.js        # KPI tiles + drill-down data
│   │   ├── donors.js         # Donor CRUD + AI brief
│   │   └── integrations.js   # Connect, test, sync, status, disconnect
│   ├── services/
│   │   ├── ai.js             # Claude API: briefs, reasoning, messages
│   │   └── sync.js           # Orchestrates bi-directional CRM sync
│   ├── integrations/
│   │   ├── hubspot.js        # HubSpot API v3 adapter (real calls)
│   │   ├── salesforce.js     # Salesforce NPSP adapter (jsforce)
│   │   └── blackbaud.js      # Blackbaud SKY API adapter (real calls)
│   ├── webhooks/index.js     # Inbound: HubSpot, Salesforce, RE NXT, Stripe
│   ├── jobs/index.js         # Cron: sync scheduler, snapshots, pledge health
│   └── utils/
│       ├── logger.js         # Winston structured logging
│       └── crypto.js         # AES-256-GCM credential encryption
└── tests/                    # Jest test suite (add your tests here)
```

---

## Quick Start (Local)

### 1. Prerequisites
```bash
node --version   # 18+
psql --version   # PostgreSQL 15+
```

### 2. Install dependencies
```bash
cd orbit-backend
npm install
npm install jsforce   # add for live Salesforce sync
```

### 3. Database setup
```bash
createdb orbit
psql -U postgres -d orbit -f schema.sql
```

### 4. Environment
```bash
cp .env.example .env
# Fill in: DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY
# Add CRM credentials after connecting via the dashboard wizard
```

### 5. Run
```bash
npm run dev      # nodemon — auto-restarts on changes
# API available at http://localhost:3001
# Health check:  http://localhost:3001/health
```

---

## API Endpoints

All protected endpoints require: `Authorization: Bearer <accessToken>`

### Auth
```
POST /api/v1/auth/login          { email, password } → { accessToken, refreshToken, user }
POST /api/v1/auth/refresh        { refreshToken }    → { accessToken }
POST /api/v1/auth/logout         revokes refresh token
GET  /api/v1/auth/me             current user profile
```

### Metrics (Dashboard KPIs)
```
GET /api/v1/metrics/overview     KPI tiles: raised, donors, pledges, retention
GET /api/v1/metrics/revenue      Monthly raised vs goal chart data
GET /api/v1/metrics/retention    Retention trend timeseries
GET /api/v1/metrics/drill/:tile  Drill-down: raised|donors|pledges|retention
```

### Donors
```
GET    /api/v1/donors                     List (filter by stage, agent, search, minScore)
GET    /api/v1/donors/:id                 Full donor record
PATCH  /api/v1/donors/:id                 Update stage, agent, preferences
GET    /api/v1/donors/:id/gifts           Gift history
POST   /api/v1/donors/:id/ai-brief        AI briefing (calls Claude API)
```

### Agents
```
GET  /api/v1/agents/:key/queue     Prioritized donor queue (VEO|VSO|VPGO|VCO)
GET  /api/v1/agents/:key/activity  Activity log
GET  /api/v1/agents/:key/config    Agent configuration
PUT  /api/v1/agents/:key/config    Save configuration
POST /api/v1/agents/:key/run       AI reasoning + action on a donor
```

### Integrations
```
GET    /api/v1/integrations                    List all with status
POST   /api/v1/integrations/:provider/connect  Save creds + test + start sync
POST   /api/v1/integrations/:provider/test     Test connection
POST   /api/v1/integrations/:provider/sync     Force sync
GET    /api/v1/integrations/:provider/status   Live sync health + recent events
DELETE /api/v1/integrations/:provider/disconnect
```

### Webhooks (no auth — signature verified)
```
POST /api/v1/webhooks/hubspot     HubSpot contact/deal events
POST /api/v1/webhooks/salesforce  Salesforce outbound messages (SOAP)
POST /api/v1/webhooks/renxt       Blackbaud SKY API events
POST /api/v1/webhooks/stripe      Stripe payment events
```

---

## Wiring the Frontend

The dashboard HTML calls `callClaude()` directly via client-side fetch. To switch to the backend:

**1. Add an API client to the dashboard**
```javascript
// Replace the hardcoded constants with these fetches:
const API = 'http://localhost:3001/api/v1';
const token = localStorage.getItem('orbit_token');

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

**2. Replace each hardcoded constant with a fetch**
```javascript
// Before (hardcoded):
const [kpis, setKpis] = useState({ raisedThisMonth: 231400, ... });

// After (live data):
useEffect(() => {
  apiFetch('/metrics/overview').then(setKpis);
}, []);
```

**3. Wire the integration "Connect" button**
```javascript
// In the wizard deploy step:
const handleConnect = async () => {
  await apiFetch('/integrations/hubspot/connect', {
    method: 'POST',
    body: JSON.stringify({ token, portalId, config: { syncInterval: 15 } }),
  });
  // Dashboard now shows live HubSpot data
};
```

---

## Integration Architecture

```
Dashboard (browser)
        │ POST /integrations/hubspot/connect {token}
        ▼
  integrations.js route
        │ testConnection() → HubSpot API
        │ encrypt(creds) → DB
        │ triggerSync() [background]
        ▼
  sync.js orchestrator
        │ hubspot.pull() → paginate all contacts + deals
        │ upsertDonor()  → donors table
        │ upsertGift()   → gifts table
        │ hubspot.push() → write Orbit scores back
        ▼
  PostgreSQL (donors, gifts, sync_events)
        │
        ▼
  metrics.js routes → Dashboard KPI tiles (live data)

  Background: cron every 5m → sync_scheduler → triggerSync()
  Real-time:  POST /webhooks/hubspot → instant donor update
```

---

## CRM Integration Status

| Provider | Pull (CRM→Orbit) | Push (Orbit→CRM) | Webhooks | Notes |
|----------|-----------------|-----------------|----------|-------|
| **HubSpot** | ✅ Real API calls | ✅ Batch update | ✅ contact/deal events | `npm install` — no extra deps |
| **Salesforce** | ✅ SOQL mapped | ✅ Bulk update | ✅ Outbound messages | Requires `npm install jsforce` |
| **RE NXT** | ✅ SKY API paginated | ✅ Custom attributes | ✅ SKY API events | Token auto-refreshed every 50min |
| Stripe | — | — | ✅ payment_intent | Auto-creates gift records |

---

## Deployment (Production)

### Environment variables to set
```
NODE_ENV=production
DATABASE_URL=postgresql://...?sslmode=require
JWT_SECRET=<64 random chars>
ENCRYPTION_KEY=<32 byte hex>
ANTHROPIC_API_KEY=sk-ant-...
```

### Recommended hosting
- **API**: Railway, Render, Fly.io, or any Node.js host
- **Database**: Supabase, Neon, or Railway PostgreSQL  
- **Webhooks**: Ensure your webhook URLs are publicly accessible

### Process manager
```bash
npm install -g pm2
pm2 start src/server.js --name orbit-api
pm2 save && pm2 startup
```

### HTTPS / reverse proxy (Nginx)
```nginx
location /api/ {
  proxy_pass         http://localhost:3001;
  proxy_http_version 1.1;
  proxy_set_header   Upgrade $http_upgrade;
  proxy_set_header   Connection keep-alive;
  proxy_set_header   Host $host;
  proxy_set_header   X-Real-IP $remote_addr;
}
```

---

## Security Notes

- CRM credentials are AES-256-GCM encrypted before storage — the DB holds ciphertext only
- JWT access tokens expire in 15 minutes; refresh tokens in 30 days
- All webhook routes verify provider signatures (HubSpot HMAC-v3, Stripe, Blackbaud)
- Rate limiting: 300 req/15min general, 20 req/15min on auth endpoints
- `do_not_contact` and `email_opt_out` flags are respected before any AI outreach action
