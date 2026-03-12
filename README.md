# Orbit Fundraising Intelligence Platform
## Complete File Package — Greenfield University

---

## What's Included

| File | Type | Size | Purpose |
|------|------|------|---------|
| `orbit-dashboard.html` | App | 437 KB | **Main application** — full Orbit platform, open in any browser |
| `orbit-platform.html` | Marketing | 66 KB | Landing/sales page for Orbit |
| `orbit_salesforce_testdata.json` | Data | 285 KB | Salesforce NPSP dummy donor data (50 donors, 472 gifts) |
| `orbit_hubspot_testdata.json` | Data | 405 KB | HubSpot CRM dummy donor data (50 contacts, 472 deals) |
| `orbit_renxt_testdata.json` | Data | 1.0 MB | Raiser's Edge NXT dummy data (50 constituents, 543 gifts) |
| `orbit_salesforce_test.js` | Runner | 39 KB | Node.js test runner — provisions + seeds Salesforce NPSP |
| `orbit_hubspot_test.js` | Runner | 40 KB | Node.js test runner — provisions + seeds HubSpot CRM |
| `orbit_renxt_test.js` | Runner | 38 KB | Node.js test runner — provisions + seeds RE NXT via SKY API |
| `AlumniPulse.jsx` | Component | 38 KB | React component (alumni engagement module) |

---

## Quick Start

### 1. Open the Dashboard
Double-click `orbit-dashboard.html` — no server required, opens directly in Chrome, Edge, or Firefox.

The dashboard is fully self-contained: all React, fonts, and logic are bundled inline. You need an internet connection only for the Claude AI features (live agent reasoning, message generation).

---

## Dashboard Navigation

| Page | What's There |
|------|-------------|
| **Overview** | Live KPI cards, campaign progress, agent activity feed, gift pipeline |
| **Donors** | Full donor directory with AI profile panels, engagement scores, stage tags |
| **Gifts** | Gift pipeline, Smart Gift Agreement builder with e-signature workflow |
| **Agent Console** | VEO / VSO / VPGO / VCO live reasoning, donor queues, activity logs |
| **Campaigns** | Campaign builder, progress tracking, real-time optimization |
| **Outreach** | AI message composer, email/SMS previews, template library |
| **Analytics** | Retention curves, upgrade funnels, revenue forecasting |
| **Officer Intelligence** | AI donor briefings for gift officers — meeting prep, talking points |
| **Integrations** | CRM wizards for Salesforce, HubSpot, Raiser's Edge NXT |
| **Settings** | Global agent config, tone, thresholds, cadence rules |

---

## CRM Integration Wizards

All three wizards live at **Integrations** in the left nav. Each has three views: **Setup**, **Dashboard**, and **Docs**.

### Salesforce NPSP
- Click **Setup Wizard →** on the Salesforce card
- 5-step wizard: OAuth Connected App → NPSP Fields → Sync Settings → Field Mapping → Deploy
- Color: Salesforce blue (`#0176d3`)
- Auth: OAuth 2.0 Username-Password via Connected App
- Custom fields: 12 Orbit fields on the Contact object (Apex script in wizard Step 2)
- Test: see `orbit_salesforce_test.js`

### HubSpot CRM
- Click **Setup Wizard →** on the HubSpot card
- 5-step wizard: Private App Token → Custom Properties → Pipeline Setup → Field Mapping → Deploy
- Color: HubSpot orange (`#ff7a59`)
- Auth: Private App Token (modern replacement for API keys)
- Custom properties: 16 properties in the `orbit_integration` group
- Test: see `orbit_hubspot_test.js`

### Raiser's Edge NXT
- Click **Setup Wizard →** on the Raiser's Edge NXT card
- 6-step wizard: SKY API Auth → Environment → Sync Objects → Attribute Mapping → Solicit Codes → Deploy
- Color: Blackbaud green (`#1e7e4e`)
- Auth: Blackbaud SKY API OAuth 2.0 PKCE + Subscription Key (dual credential)
- Custom fields: 12 Orbit Attribute Types under category `ORBIT_INTEGRATION`
- Test: see `orbit_renxt_test.js`

---

## Running the Test Suites

### Prerequisites
```bash
node --version    # Requires Node.js 16+
npm install node-fetch dotenv   # for HubSpot and RE NXT
npm install jsforce dotenv      # for Salesforce
```

### Environment Setup
Create a `.env` file in the same folder as the test scripts:

**Salesforce (.env)**
```env
SF_INSTANCE_URL=https://your-org.my.salesforce.com
SF_CONSUMER_KEY=3MVG9xxxxxxxxxxxxxxxxxxxxx
SF_CONSUMER_SECRET=your_consumer_secret
SF_USERNAME=admin@your-org.com
SF_PASSWORD=yourpassword
SF_SECURITY_TOKEN=yourtoken
SF_API_VERSION=59.0
SF_SANDBOX=false
```

**HubSpot (.env)**
```env
HS_TOKEN=pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
HS_PORTAL_ID=12345678
```

**Raiser's Edge NXT (.env)**
```env
RENXT_SUBSCRIPTION_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
RENXT_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
RENXT_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
RENXT_ACCESS_TOKEN=eyJ...
RENXT_REFRESH_TOKEN=eyJ...
RENXT_ENV_ID=p-xxxxxxxxxxxxxxxxxx
```

> **No credentials?** All three test runners work in **simulation mode** without any `.env` file. They will run the full validation suite against mock data and print a complete report. Set up `.env` only when you're ready to test against a live sandbox.

### Salesforce Test Runner
```bash
node orbit_salesforce_test.js                  # Full suite
node orbit_salesforce_test.js --provision      # Create custom fields only
node orbit_salesforce_test.js --seed-data      # Seed 50 contacts + gifts only
node orbit_salesforce_test.js --dry-run        # Read-only validation
node orbit_salesforce_test.js --cleanup        # Remove all test records
node orbit_salesforce_test.js --report         # Print stats
node orbit_salesforce_test.js --verbose        # Verbose logging
```

**What it does:**
1. Authenticates via OAuth 2.0 Username-Password
2. Creates all 12 Orbit custom fields on the Contact object (idempotent)
3. Upserts 50 realistic donor Contact records
4. Creates 80+ Opportunity (gift) records linked to donors
5. Creates 3 Campaign records
6. Validates bidirectional field mapping
7. Tests conflict-resolution scenarios
8. Prints full validation report

### HubSpot Test Runner
```bash
node orbit_hubspot_test.js                     # Full suite
node orbit_hubspot_test.js --provision         # Create properties only
node orbit_hubspot_test.js --seed-data         # Seed contacts + deals only
node orbit_hubspot_test.js --dry-run           # Read-only
node orbit_hubspot_test.js --cleanup           # Delete test records
node orbit_hubspot_test.js --report            # Print stats
node orbit_hubspot_test.js --verbose           # Verbose logging
```

**What it does:**
1. Authenticates with Private App token
2. Creates `orbit_integration` property group
3. Provisions all 16 custom contact properties (idempotent)
4. Upserts 50 contact records via batch endpoint (email as dedup key)
5. Creates 90+ Deal records with contact associations
6. Posts Timeline Events for engagement activity
7. Tests opt-out propagation (`hs_email_optout`)
8. Prints full validation report

### Raiser's Edge NXT Test Runner
```bash
node orbit_renxt_test.js                       # Full suite
node orbit_renxt_test.js --provision           # Create attribute types only
node orbit_renxt_test.js --seed-data           # Seed constituents + gifts only
node orbit_renxt_test.js --dry-run             # Read-only
node orbit_renxt_test.js --cleanup             # Remove test constituents
node orbit_renxt_test.js --report              # Print stats
node orbit_renxt_test.js --verbose             # Verbose logging
```

**What it does:**
1. Authenticates via SKY API (uses refresh token to keep access token fresh)
2. Creates 12 Orbit Attribute Types under `ORBIT_INTEGRATION` category
3. Provisions 10 Funds, 9 Campaigns, 8 Appeals
4. Upserts 50 Constituent records (with addresses, phones, emails)
5. Writes all 11 Orbit custom attributes to each constituent
6. Adds Solicit Codes to ~10% of constituents (Do Not Email, Do Not Solicit)
7. Creates 543 Gift records with fund/campaign/appeal attribution
8. Runs 14 validation scenarios (dedup, solicit codes, FuzzyDate, conflicts, etc.)
9. Prints full validation report

---

## Test Data Reference

### What's in the JSON files

All three JSON files share the same 50 donor names (James Henderson, Margaret Okafor, etc.) so you can cross-reference records across CRM systems.

| Field | SF | HubSpot | RE NXT |
|-------|----|---------|--------|
| Donor profiles | 50 Contacts | 50 Contacts | 50 Constituents |
| Gifts | 472 Opportunities | 472 Deals | 543 Gifts |
| Campaigns | 9 Campaigns | — | 9 Campaigns |
| Funds | — | — | 10 Funds |
| Appeals | — | — | 8 Appeals |
| Custom fields | 12 Contact fields | 16 Properties | 12 Attribute Types |
| Test scenarios | 12 | 12 | 14 |
| Solicit codes | No | No | Yes (~5 donors) |

### Orbit-enriched fields on every donor record
Every dummy donor has these Orbit AI fields pre-populated:
- `orbit_id` — unique Orbit platform key
- `orbit_stage` — donor lifecycle stage (prospect → legacy_prospect)
- `orbit_agent` — assigned agent (VEO / VSO / VPGO / VCO)
- `orbit_propensity_score` — AI gift propensity 0-100
- `orbit_engagement_score` — AI engagement index 0-100
- `orbit_sentiment_trend` — rising / stable / cooling
- `orbit_interests` — semicolon-delimited interest tags
- `preferred_channel` — Email / Phone / SMS
- `sms_opt_in` — boolean
- `annual_capacity_estimate` — AI capacity in dollars
- `alumni_class_year` — graduation year

---

## Agent Configuration

In the **Agent Console**, click **⚙️ Configure** on any agent card to open the full configuration modal.

### Easy Setup (4-step wizard)
1. **Set Goal** — Choose primary objective per agent type
2. **Voice and Tone** — 6 tone options with persona descriptions
3. **Cadence** — Touchpoint limits, quiet periods, send windows
4. **Guardrails** — Custom compliance rules

### Advanced Configuration (6 tabs)
- **Persona and Voice** — Edit the full AI system prompt, institution name, mission statement
- **Cadence and Timing** — All sliders, day-of-week toggles, send hours, lapsed donor re-entry
- **Thresholds and Rules** — Contact score floor, ask-readiness threshold, major gift escalation
- **Channels** — Email / SMS / Phone / Note / LinkedIn toggles
- **Integrations** — Per-agent CRM and platform connections
- **Test and Preview** — Live AI message generation using current configuration

---

## AI Features (require internet)

The following features make live calls to the Claude API:

| Feature | Location | What it does |
|---------|----------|-------------|
| **Agent Reasoning** | Agent Console → Run → on any donor | Live AI reasoning trace — strategy, tone, action |
| **Donor AI Profile** | Donors → any donor → AI Profile | AI-generated donor brief with talking points |
| **Officer Intelligence** | Officer Intelligence page | Full meeting prep briefs for gift officers |
| **Outreach Composer** | Outreach → Compose | AI-generated email/SMS with donor personalization |
| **Agent Config Test** | Configure → Advanced → Test tab | Sample message using configured persona and tone |

---

## Browser Compatibility

| Browser | Status |
|---------|--------|
| Chrome 100+ | ✅ Recommended |
| Edge 100+ | ✅ Fully supported |
| Firefox 100+ | ✅ Fully supported |
| Safari 16+ | ✅ Supported |
| IE 11 | ❌ Not supported |

---

## File Sizes and Performance

| File | Lines | Load time (est.) |
|------|-------|-----------------|
| `orbit-dashboard.html` | 6,823 | < 1s (local) |
| `orbit_renxt_testdata.json` | ~28,000 | N/A (data file) |
| `orbit_hubspot_testdata.json` | ~22,000 | N/A (data file) |
| `orbit_salesforce_testdata.json` | ~15,000 | N/A (data file) |

---

## Version

| Component | Version |
|-----------|---------|
| Orbit Dashboard | 4.0.0 |
| Salesforce Integration | 2.1.4 |
| HubSpot Integration | 1.4.0 |
| RE NXT Integration | 1.0.0 |
| Test Data Schema | 1.0.0 |

---

*Orbit Fundraising Intelligence — Built for university advancement offices.*
*© 2025 Orbit Fundraising Inc. All rights reserved.*
