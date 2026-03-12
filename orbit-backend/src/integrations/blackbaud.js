'use strict';
/**
 * Blackbaud Raiser's Edge NXT Adapter
 * Uses SKY API v1 with OAuth 2.0 PKCE.
 * Docs: https://developer.blackbaud.com/skyapi/apis
 */

const fetch  = require('node-fetch');
const logger = require('../utils/logger');

const SKY_BASE  = 'https://api.sky.blackbaud.com';
const AUTH_BASE = 'https://oauth2.sky.blackbaud.com';

function headers(creds) {
  return {
    'Bb-Api-Subscription-Key': creds.subscriptionKey,
    'Authorization':           `Bearer ${creds.accessToken}`,
    'Content-Type':            'application/json',
  };
}

async function skyGet(creds, path) {
  const res = await fetch(`${SKY_BASE}${path}`, { headers: headers(creds) });
  if (res.status === 401) throw new Error('RE NXT: 401 Unauthorized — token expired or invalid subscription key');
  if (res.status === 403) throw new Error('RE NXT: 403 Forbidden — insufficient role (System Admin required)');
  if (res.status === 429) throw new Error('RE NXT: 429 Rate limit (100 calls/min on Standard)');
  if (res.status === 404) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`RE NXT ${res.status}: ${data.message || JSON.stringify(data)}`);
  return data;
}

async function skyPost(creds, path, body) {
  const res = await fetch(`${SKY_BASE}${path}`, {
    method:  'POST',
    headers: headers(creds),
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`RE NXT POST ${res.status}: ${data.message || JSON.stringify(data)}`);
  }
  return res.json().catch(() => ({}));
}

async function skyPatch(creds, path, body) {
  const res = await fetch(`${SKY_BASE}${path}`, {
    method:  'PATCH',
    headers: headers(creds),
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`RE NXT PATCH ${res.status}: ${data.message || JSON.stringify(data)}`);
  }
  return res.status === 204 ? null : res.json().catch(() => ({}));
}

// ── Token refresh ─────────────────────────────────────────────────────────────
async function refreshToken(creds) {
  const res = await fetch(`${AUTH_BASE}/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: creds.refreshToken,
      client_id:     creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh failed: ' + (data.error_description || data.error));
  return data.access_token;
}

// ── testConnection ─────────────────────────────────────────────────────────────
async function testConnection(creds) {
  // Attempt a lightweight constituents search
  const data = await skyGet(creds, '/constituent/v1/constituents?limit=1');
  if (!data) return { ok: false, error: 'No response from SKY API' };
  return { ok: true, message: 'RE NXT connected via SKY API', count: data.count };
}

// ── Paginated SKY API list fetch ───────────────────────────────────────────────
async function fetchAll(creds, endpoint, pageSize = 200) {
  const results = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const data = await skyGet(creds, `${endpoint}${sep}limit=${pageSize}&offset=${offset}`);
    if (!data || !data.value?.length) break;

    results.push(...data.value);
    offset  += data.value.length;
    hasMore  = !!data.next_link;

    // Rate limit: 100 calls/min Standard — 200 records/call = ~20,000 records/min
    if (offset % 2000 === 0) await sleep(1000);
  }
  return results;
}

// ── pull: RE NXT → Orbit ──────────────────────────────────────────────────────
async function pull(creds, config, orgId) {
  const donors = [];
  const gifts  = [];

  // Refresh token if needed — mark _tokenRefreshed so sync.js writes new token to DB
  if (creds.refreshToken) {
    try {
      creds.accessToken    = await refreshToken(creds);
      creds._tokenRefreshed = true;
    } catch(e) {
      logger.warn('RE NXT token refresh failed', { err: e.message });
    }
  }

  logger.info('RE NXT constituent pull started', { orgId });

  // Pull constituents
  const constituents = await fetchAll(creds, '/constituent/v1/constituents');
  for (const c of constituents) {
    // Pull custom attributes (Orbit scores)
    const attrs = await skyGet(creds, `/constituent/v1/constituents/${c.id}/customfields`);
    const orbit = {};
    for (const a of (attrs?.value || [])) {
      if (a.category === 'ORBIT_INTEGRATION') orbit[a.comment] = a.value;
    }

    // Pull solicit codes (opt-out)
    const solicit = await skyGet(creds, `/constituent/v1/constituents/${c.id}/solicitcodes`);
    const codes   = (solicit?.value || []).map(s => s.solicit_code);
    const doNotEmail   = codes.some(s => ['Do Not Email','Do Not Solicit'].includes(s));
    const doNotContact = codes.includes('Do Not Solicit');

    // Get primary email and phone
    const emails  = await skyGet(creds, `/constituent/v1/constituents/${c.id}/emailaddresses`);
    const phones  = await skyGet(creds, `/constituent/v1/constituents/${c.id}/phones`);
    const email   = emails?.value?.find(e => e.primary)?.address;
    const phone   = phones?.value?.find(p => p.primary)?.number;

    // Get giving summary
    const giving  = await skyGet(creds, `/constituent/v1/constituents/${c.id}/givingsummary`);

    donors.push({
      externalId:       c.id,
      name:             `${c.first || ''} ${c.last || ''}`.trim(),
      email,
      phone,
      city:             c.address?.city,
      state:            c.address?.state,
      zip:              c.address?.postal_code,
      country:          c.address?.country || 'United States',
      stage:            orbit['OrbitStage'] || 'prospect',
      alumniClassYear:  c.class_of ? parseInt(c.class_of) : null,
      lifetimeGiving:   giving?.total_lifetime_giving,
      lastGiftAmount:   giving?.last_gift_amount,
      lastGiftDate:     giving?.last_gift_date,
      preferredChannel: orbit['PreferredChannel'] || 'Email',
      smsOptIn:         orbit['SMSOptIn'] === 'true',
      emailOptOut:      doNotEmail,
      doNotContact,
      interests:        orbit['OrbitInterests'] ? orbit['OrbitInterests'].split(';') : [],
    });

    // Respect rate limit between constituents
    await sleep(50);
  }

  // Pull gifts
  if (config.syncObjects?.gifts !== false) {
    const giftList = await fetchAll(creds, '/gift/v1/gifts');
    for (const g of giftList) {
      gifts.push({
        externalId:      g.id,
        donorExternalId: g.constituent_id,
        amount:          g.amount?.value,
        date:            g.date,
        type:            g.type || 'Cash',
        status:          g.post_status === 'Posted' ? 'completed' : 'pending',
        fund:            g.fund?.description,
        campaign:        g.campaign?.description,
        appeal:          g.appeal?.description,
        acknowledged:    g.acknowledgements?.[0]?.status === 'Sent',
        receiptSent:     g.receipts?.[0]?.status === 'Sent',
      });
    }
  }

  logger.info('RE NXT pull complete', { constituents: donors.length, gifts: gifts.length });
  return { donors, gifts };
}

// ── push: Orbit scores → RE NXT custom attributes ─────────────────────────────
async function push(creds, config, orbitDonors) {
  if (creds.refreshToken) {
    try {
      creds.accessToken     = await refreshToken(creds);
      creds._tokenRefreshed = true;
    } catch(e) { logger.warn('RE NXT token refresh failed (push)', { err: e.message }); }
  }

  const today = new Date().toISOString().split('T')[0];

  for (const donor of orbitDonors) {
    const reId = donor.external_ids?.blackbaud;
    if (!reId) continue;

    const attributes = [
      { comment: 'OrbitPropensityScore',  value: String(donor.propensity_score || '') },
      { comment: 'OrbitEngagementScore',  value: String(donor.engagement_score || '') },
      { comment: 'OrbitStage',            value: donor.stage || '' },
      { comment: 'OrbitAgent',            value: donor.assigned_agent || '' },
      { comment: 'OrbitSentimentTrend',   value: donor.sentiment_trend || '' },
      { comment: 'OrbitLastSync',         value: today },
    ];

    for (const attr of attributes) {
      try {
        await skyPost(creds, `/constituent/v1/constituents/${reId}/customfields`, {
          category: 'ORBIT_INTEGRATION',
          type:     'String',
          comment:  attr.comment,
          value:    attr.value,
          date:     today,
        });
      } catch (e) {
        logger.warn('RE NXT attribute push failed', { reId, attr: attr.comment, err: e.message });
      }
      await sleep(80); // Stay well under 100 calls/min
    }
  }
}

// ── writeSolicitCode (when donor opts out via Orbit) ─────────────────────────
async function writeSolicitCode(creds, constituentId, solicitCode, reason = '') {
  return skyPost(creds, `/constituent/v1/constituents/${constituentId}/solicitcodes`, {
    solicit_code: solicitCode,
    comment:      reason || `Opt-out via Orbit — ${new Date().toISOString()}`,
    date:         new Date().toISOString().split('T')[0],
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { testConnection, pull, push, writeSolicitCode, refreshToken };
