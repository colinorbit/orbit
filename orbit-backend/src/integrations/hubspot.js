'use strict';
/**
 * HubSpot CRM Adapter
 * Uses HubSpot API v3 with Private App token auth.
 * Docs: https://developers.hubspot.com/docs/api/overview
 */

const fetch  = require('node-fetch');
const logger = require('../utils/logger');

const BASE = 'https://api.hubapi.com';

function headers(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type':  'application/json',
  };
}

async function apiCall(token, method, path, body = null) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(token),
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) throw new Error('HubSpot: 401 Unauthorized — check Private App token');
  if (res.status === 429) throw new Error('HubSpot: 429 Rate limit — retry after ' + res.headers.get('Retry-After') + 's');
  if (res.status === 404) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${data.message || JSON.stringify(data)}`);
  return data;
}

// ── testConnection ────────────────────────────────────────────────────────────
async function testConnection(creds) {
  const data = await apiCall(creds.token, 'GET', '/crm/v3/objects/contacts?limit=1');
  return { ok: true, message: 'HubSpot connected', contactCount: data?.total };
}

// ── pull: HubSpot → Orbit ────────────────────────────────────────────────────
async function pull(creds, config, orgId) {
  const { token } = creds;
  const donors = [];
  const gifts  = [];

  // Orbit custom properties to fetch
  const ORBIT_PROPS = [
    'firstname','lastname','email','phone','mobilephone',
    'company','jobtitle','city','state','zip','country',
    'hs_email_optout',
    'orbit_id','orbit_stage','orbit_agent',
    'orbit_propensity_score','orbit_engagement_score','orbit_sentiment_trend',
    'orbit_interests','orbit_preferred_channel','orbit_sms_opt_in',
    'orbit_lifetime_giving','orbit_last_gift_amount','orbit_last_gift_date',
    'orbit_alumni_class_year','orbit_capacity_estimate',
  ].join(',');

  // Paginate through all contacts
  let after = undefined;
  let page  = 0;
  do {
    const qs = `limit=100&properties=${ORBIT_PROPS}${after ? `&after=${after}` : ''}`;
    const data = await apiCall(token, 'GET', `/crm/v3/objects/contacts?${qs}`);
    if (!data) break;

    for (const contact of data.results || []) {
      const p = contact.properties;
      donors.push({
        externalId:      contact.id,
        name:            `${p.firstname || ''} ${p.lastname || ''}`.trim(),
        email:           p.email,
        phone:           p.phone || p.mobilephone,
        orgName:         p.company,
        title:           p.jobtitle,
        city:            p.city,
        state:           p.state,
        zip:             p.zip,
        country:         p.country,
        stage:           p.orbit_stage || 'prospect',
        interests:       p.orbit_interests ? p.orbit_interests.split(';').map(s => s.trim()) : [],
        alumniClassYear: p.orbit_alumni_class_year ? parseInt(p.orbit_alumni_class_year) : null,
        lifetimeGiving:  p.orbit_lifetime_giving  ? parseFloat(p.orbit_lifetime_giving)  : null,
        lastGiftAmount:  p.orbit_last_gift_amount  ? parseFloat(p.orbit_last_gift_amount) : null,
        lastGiftDate:    p.orbit_last_gift_date    || null,
        preferredChannel:p.orbit_preferred_channel || 'Email',
        smsOptIn:        p.orbit_sms_opt_in === 'true',
        emailOptOut:     p.hs_email_optout === 'true',
        doNotContact:    false,
      });
    }

    after = data.paging?.next?.after;
    page++;
    // Respect rate limit: 100 reqs/10s on Basic, 150/10s on Professional
    if (page % 8 === 0) await sleep(1100);

  } while (after);

  // Pull deals (gifts)
  let dealAfter = undefined;
  do {
    const qs = `limit=100&properties=dealname,amount,closedate,pipeline,dealstage,hs_deal_stage_probability${dealAfter ? `&after=${dealAfter}` : ''}`;
    const data = await apiCall(token, 'GET', `/crm/v3/objects/deals?${qs}`);
    if (!data) break;

    for (const deal of data.results || []) {
      // Get associated contact
      const assoc = await apiCall(token, 'GET',
        `/crm/v3/objects/deals/${deal.id}/associations/contacts`);
      const contactId = assoc?.results?.[0]?.id;
      if (!contactId) continue;

      gifts.push({
        externalId:       `hs-deal-${deal.id}`,
        donorExternalId:  contactId,
        amount:           parseFloat(deal.properties.amount || 0),
        date:             deal.properties.closedate?.split('T')[0] || new Date().toISOString().split('T')[0],
        type:             'Cash',
        status:           deal.properties.dealstage === 'closedwon' ? 'completed' : 'pending',
        fund:             deal.properties.pipeline || 'Annual Fund',
        campaign:         deal.properties.dealname,
      });
    }

    dealAfter = data.paging?.next?.after;
  } while (dealAfter);

  logger.info('HubSpot pull complete', { donors: donors.length, gifts: gifts.length });
  return { donors, gifts };
}

// ── push: Orbit scores → HubSpot ─────────────────────────────────────────────
async function push(creds, config, orbitDonors) {
  const { token } = creds;
  const BATCH     = 100;

  for (let i = 0; i < orbitDonors.length; i += BATCH) {
    const chunk = orbitDonors.slice(i, i + BATCH);
    const inputs = chunk
      .filter(d => d.external_ids?.hubspot)
      .map(d => ({
        id: d.external_ids.hubspot,
        properties: {
          orbit_id:               d.id,
          orbit_stage:            d.stage,
          orbit_agent:            d.assigned_agent,
          orbit_propensity_score: String(d.propensity_score || ''),
          orbit_engagement_score: String(d.engagement_score || ''),
          orbit_sentiment_trend:  d.sentiment_trend || '',
          orbit_interests:        (d.interests || []).join(';'),
          orbit_preferred_channel:d.preferred_channel || '',
          orbit_sms_opt_in:       String(d.sms_opt_in || false),
          orbit_capacity_estimate:String(d.capacity_estimate || ''),
          orbit_last_sync:        new Date().toISOString(),
        },
      }));

    if (inputs.length) {
      await apiCall(token, 'POST', '/crm/v3/objects/contacts/batch/update', { inputs });
    }

    if (i + BATCH < orbitDonors.length) await sleep(200);
  }
}

// ── createContact: write a new contact to HubSpot ───────────────────────────
async function createContact(creds, donor) {
  return apiCall(creds.token, 'POST', '/crm/v3/objects/contacts', {
    properties: {
      email:       donor.email,
      firstname:   donor.name.split(' ')[0],
      lastname:    donor.name.split(' ').slice(1).join(' '),
      phone:       donor.phone,
      company:     donor.org_name,
      jobtitle:    donor.title,
      orbit_id:    donor.id,
      orbit_stage: donor.stage,
    },
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { testConnection, pull, push, createContact };
