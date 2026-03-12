'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ORBIT SIGNAL INGESTION SERVICE
 *
 *  Pulls real-time data from trusted external sources and normalizes
 *  them into Orbit signals for the predictive contact engine.
 *
 *  DATA SOURCES (by tier):
 *
 *  TIER 1 — WEALTH & CAPACITY (highest signal value)
 *    • SEC EDGAR        — Form 4, 13D/13G filings (free, public)
 *    • iWave            — Donor capacity & propensity API (paid)
 *    • WealthEngine     — Net worth & philanthropy score (paid)
 *    • DonorSearch      — Philanthropic history screening (paid)
 *
 *  TIER 2 — BEHAVIORAL (medium signal value)
 *    • LinkedIn Sales Navigator — career events (paid)
 *    • Google News API          — press mentions (free tier)
 *    • Twitter/X API            — cause alignment signals (paid)
 *
 *  TIER 3 — INSTITUTIONAL (internal enrichment)
 *    • Salesforce / RE NXT      — giving history, event attendance
 *    • Internal email metrics   — open/click rates
 *    • Web analytics            — giving page visits
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

const fetch  = require('node-fetch');
const db     = require('../db');
const logger = require('../utils/logger');

// ─── RATE LIMITER (simple token bucket) ──────────────────────────────────────
const rateLimits = {};
function checkRateLimit(source, maxPerHour) {
  const now  = Date.now();
  const key  = source;
  if (!rateLimits[key]) rateLimits[key] = { count: 0, windowStart: now };
  const window = rateLimits[key];
  if (now - window.windowStart > 3600000) { window.count = 0; window.windowStart = now; }
  if (window.count >= maxPerHour) return false;
  window.count++;
  return true;
}

// ─── SIGNAL NORMALIZER ────────────────────────────────────────────────────────
function normalizeSignal({ donorId, orgId, source, type, headline, detail, impact, score, rawData }) {
  return {
    donor_id:   donorId,
    org_id:     orgId,
    source,
    type,         // WEALTH | CAREER | LIFE | CAUSE | NETWORK | RISK
    headline,
    detail,
    impact,
    score:       score || 0,         // +/- score adjustment
    raw_data:    JSON.stringify(rawData || {}),
    applied:     false,
    created_at:  new Date().toISOString(),
  };
}

// ─── SEC EDGAR ───────────────────────────────────────────────────────────────
// Free public API — Form 4 insider trades, 13D/13G large holder filings
async function fetchSECSignals(donors, orgId) {
  const signals = [];
  if (!checkRateLimit('sec', 100)) {
    logger.warn('SEC EDGAR rate limit hit');
    return signals;
  }

  for (const donor of donors.slice(0, 20)) { // batch cap
    if (!donor.cik_number) continue; // need SEC CIK to match

    try {
      const url = `https://data.sec.gov/submissions/CIK${String(donor.cik_number).padStart(10,'0')}.json`;
      const res = await fetch(url, {
        headers: { 'User-Agent': `OrbitPlatform contact@orbitgiving.com` },
      });
      if (!res.ok) continue;
      const data = await res.json();

      // Look for recent Form 4 filings (insider sales = liquidity event)
      const recentFilings = (data.filings?.recent?.form || [])
        .map((form, i) => ({ form, date: data.filings.recent.filingDate[i] }))
        .filter(f => ['4','SC 13D','SC 13G'].includes(f.form))
        .filter(f => new Date(f.date) > new Date(Date.now() - 90 * 86400000)); // last 90 days

      for (const filing of recentFilings.slice(0, 3)) {
        signals.push(normalizeSignal({
          donorId:  donor.id,
          orgId,
          source:   'sec',
          type:     'WEALTH',
          headline: `SEC ${filing.form} filing — ${donor.name} — ${filing.date}`,
          detail:   `${filing.form === '4' ? 'Insider transaction' : 'Large ownership change'} detected via SEC EDGAR. May indicate liquidity event or major wealth event.`,
          impact:   'Review capacity estimate. Consult VPGO for planned giving opportunity.',
          score:    filing.form === '4' ? 25 : 18,
          rawData:  filing,
        }));
      }
    } catch(e) {
      logger.debug('SEC fetch failed', { donor: donor.id, err: e.message });
    }
  }
  return signals;
}

// ─── GOOGLE NEWS ─────────────────────────────────────────────────────────────
// NewsAPI.org free tier — 100 req/day
async function fetchNewsSignals(donors, orgId) {
  const signals = [];
  const apiKey  = process.env.NEWS_API_KEY;
  if (!apiKey) return signals;
  if (!checkRateLimit('news', 80)) return signals;

  for (const donor of donors.slice(0, 10)) {
    const query = encodeURIComponent(`"${donor.name}" OR "${donor.org_name || ''}"`);
    try {
      const url = `https://newsapi.org/v2/everything?q=${query}&sortBy=publishedAt&pageSize=5&apiKey=${apiKey}`;
      const res  = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();

      for (const article of (data.articles || []).slice(0, 3)) {
        const ageMs    = Date.now() - new Date(article.publishedAt).getTime();
        const ageDays  = ageMs / 86400000;
        if (ageDays > 30) continue;

        // Classify signal type from content
        const content   = `${article.title} ${article.description || ''}`.toLowerCase();
        let type  = 'NETWORK';
        let score = 5;
        if (content.match(/acquisition|merger|ipo|fund.?raise|series [a-e]|million|billion/)) {
          type = 'WEALTH'; score = 20;
        } else if (content.match(/appointed|promoted|named|president|ceo|chairman|director/)) {
          type = 'CAREER'; score = 15;
        } else if (content.match(/award|honor|named|philanthrop|donat|foundation/)) {
          type = 'CAUSE'; score = 10;
        } else if (content.match(/lawsuit|charged|investigation|scandal|resign/)) {
          type = 'RISK'; score = -20;
        }

        signals.push(normalizeSignal({
          donorId:  donor.id,
          orgId,
          source:   'news',
          type,
          headline: article.title,
          detail:   article.description || '',
          impact:   type === 'WEALTH' ? 'Review capacity estimate and advance ask timing.' :
                    type === 'RISK'   ? 'Hold outreach — review with gift officer.' :
                    'Update donor profile. Consider referencing in next outreach.',
          score,
          rawData:  { url: article.url, source: article.source?.name, publishedAt: article.publishedAt },
        }));
      }
    } catch(e) {
      logger.debug('News fetch failed', { donor: donor.id, err: e.message });
    }
  }
  return signals;
}

// ─── IWAVE (WEALTH SCREENING) ─────────────────────────────────────────────────
// iWave API — paid — returns propensity, capacity, affinity scores
async function fetchIWaveScreening(donors, orgId) {
  const signals  = [];
  const apiKey   = process.env.IWAVE_API_KEY;
  const apiBase  = 'https://api.iwave.com/v3';
  if (!apiKey) return signals;
  if (!checkRateLimit('iwave', 50)) return signals;

  for (const donor of donors.slice(0, 5)) {
    if (!donor.email) continue;
    try {
      const res = await fetch(`${apiBase}/search`, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          firstName: donor.name.split(' ')[0],
          lastName:  donor.name.split(' ').slice(1).join(' '),
          email:     donor.email,
          city:      donor.city,
          state:     donor.state,
        }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const iScore = data.iWaveScore || 0;

      if (iScore > 0) {
        signals.push(normalizeSignal({
          donorId:  donor.id,
          orgId,
          source:   'iwave',
          type:     'WEALTH',
          headline: `iWave score: ${iScore}/100 — ${donor.name}`,
          detail:   `Propensity: ${data.propensity || '—'} | Capacity: ${data.capacity || '—'} | Affinity: ${data.affinity || '—'}`,
          impact:   iScore >= 70 ? 'High-capacity donor. Advance to major gift conversation.' : 'Continue cultivation.',
          score:    Math.round((iScore / 100) * 25),
          rawData:  data,
        }));

        // Update donor record with new screening scores
        await db.query(
          `UPDATE donors SET wealth_score=$1, capacity_rating=$2, iwave_score=$3, screened_at=NOW()
           WHERE id=$4 AND org_id=$5`,
          [iScore, data.capacity || null, iScore, donor.id, orgId]
        ).catch(e => logger.warn('iWave DB update failed', { err: e.message }));
      }
    } catch(e) {
      logger.debug('iWave fetch failed', { donor: donor.id, err: e.message });
    }
  }
  return signals;
}

// ─── DONOR SEARCH (PHILANTHROPIC HISTORY) ────────────────────────────────────
async function fetchDonorSearchData(donors, orgId) {
  const signals = [];
  const apiKey  = process.env.DONOR_SEARCH_API_KEY;
  const apiBase = 'https://api.donorsearch.net/api/v1';
  if (!apiKey) return signals;

  for (const donor of donors.slice(0, 5)) {
    try {
      const res = await fetch(`${apiBase}/GetAllData`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, first_name: donor.name.split(' ')[0], last_name: donor.name.split(' ').slice(-1)[0], email: donor.email }),
      });
      if (!res.ok) continue;
      const data = await res.json();

      const ratingMap = { '1+':30, '1':20, '2':12, '3':8, '4':4, '5':0 };
      const rScore = ratingMap[data.overall_rating] || 0;

      if (rScore > 0) {
        signals.push(normalizeSignal({
          donorId:  donor.id,
          orgId,
          source:   'donorsearch',
          type:     'WEALTH',
          headline: `DonorSearch rating: ${data.overall_rating} — ${donor.name}`,
          detail:   `Real estate: ${data.real_estate_total ? '$'+Number(data.real_estate_total).toLocaleString() : '—'} | Political giving: ${data.political_giving_total ? '$'+Number(data.political_giving_total).toLocaleString() : '—'}`,
          impact:   'Update capacity estimate in donor profile.',
          score:    rScore,
          rawData:  data,
        }));
      }
    } catch(e) {
      logger.debug('DonorSearch failed', { donor: donor.id, err: e.message });
    }
  }
  return signals;
}

// ─── EMAIL ENGAGEMENT SIGNALS ─────────────────────────────────────────────────
// Internal — from our own delivery service
async function fetchEmailEngagementSignals(orgId) {
  const signals = [];
  try {
    // Find donors who opened 2+ emails in last 48 hours (hot engagement window)
    const { rows } = await db.query(
      `SELECT d.id, d.name, COUNT(e.id) as opens, MAX(e.opened_at) as last_open
       FROM donors d
       JOIN email_events e ON e.donor_id = d.id AND e.org_id = d.org_id
       WHERE d.org_id = $1
         AND e.event_type = 'open'
         AND e.opened_at > NOW() - INTERVAL '48 hours'
       GROUP BY d.id, d.name
       HAVING COUNT(e.id) >= 2`,
      [orgId]
    );

    for (const row of rows) {
      signals.push(normalizeSignal({
        donorId: row.id,
        orgId,
        source:  'email',
        type:    'CAUSE',
        headline: `${row.name} opened ${row.opens} emails in the last 48 hours`,
        detail:  'High email engagement detected. Donor is actively reading your communications.',
        impact:  'Strike while hot — send personalized follow-up within 24 hours.',
        score:   8,
        rawData: { opens: row.opens, last_open: row.last_open },
      }));
    }

    // Also update recent_email_opens on donor record
    for (const row of rows) {
      await db.query(
        'UPDATE donors SET recent_email_opens=$1 WHERE id=$2 AND org_id=$3',
        [row.opens, row.id, orgId]
      ).catch(() => {});
    }
  } catch(e) {
    logger.warn('Email engagement signals failed', { err: e.message, orgId });
  }
  return signals;
}

// ─── MASTER INGESTION RUNNER ─────────────────────────────────────────────────
/**
 * runSignalIngestion
 * Called by the daily job scheduler. Pulls all enabled sources,
 * deduplicates, persists to DB, and returns summary.
 */
async function runSignalIngestion(orgId, options = {}) {
  const startTime = Date.now();
  logger.info('Signal ingestion started', { orgId });

  // Get donors to screen (top 100 by propensity, skip DNC)
  const { rows: donors } = await db.query(
    `SELECT id, name, email, phone, org_name, stage, assigned_agent,
            propensity_score, engagement_score, lifetime_giving, last_gift_date,
            interests, city, state, cik_number, wealth_score, capacity_rating,
            last_contact_at, sentiment_trend, do_not_contact
     FROM donors
     WHERE org_id = $1 AND do_not_contact = false
     ORDER BY propensity_score DESC NULLS LAST
     LIMIT 100`,
    [orgId]
  );

  if (donors.length === 0) {
    logger.info('No donors to screen', { orgId });
    return { signals: 0, donors: 0, duration: 0 };
  }

  // Run all sources in parallel (with individual error isolation)
  const [secSigs, newsSigs, iwaveSigs, dsearchSigs, emailSigs] = await Promise.all([
    fetchSECSignals(donors, orgId).catch(e => { logger.error('SEC ingestion error', { e }); return []; }),
    fetchNewsSignals(donors, orgId).catch(e => { logger.error('News ingestion error', { e }); return []; }),
    fetchIWaveScreening(donors, orgId).catch(e => { logger.error('iWave ingestion error', { e }); return []; }),
    fetchDonorSearchData(donors, orgId).catch(e => { logger.error('DonorSearch ingestion error', { e }); return []; }),
    fetchEmailEngagementSignals(orgId).catch(e => { logger.error('Email signals error', { e }); return []; }),
  ]);

  const allSignals = [...secSigs, ...newsSigs, ...iwaveSigs, ...dsearchSigs, ...emailSigs];

  // Persist to DB (upsert by donor+source+headline to avoid duplication)
  let saved = 0;
  for (const sig of allSignals) {
    try {
      await db.query(
        `INSERT INTO donor_signals (donor_id, org_id, source, type, headline, detail, impact, score, raw_data, applied, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (donor_id, org_id, source, headline) DO NOTHING`,
        [sig.donor_id, sig.org_id, sig.source, sig.type, sig.headline,
         sig.detail, sig.impact, sig.score, sig.raw_data, false, sig.created_at]
      );
      saved++;
    } catch(e) {
      logger.debug('Signal upsert conflict', { err: e.message });
    }
  }

  const duration = Date.now() - startTime;
  logger.info('Signal ingestion complete', { orgId, total: allSignals.length, saved, duration });

  return {
    signals:  saved,
    donors:   donors.length,
    sources:  { sec: secSigs.length, news: newsSigs.length, iwave: iwaveSigs.length, donorsearch: dsearchSigs.length, email: emailSigs.length },
    duration,
  };
}

module.exports = {
  runSignalIngestion,
  fetchSECSignals,
  fetchNewsSignals,
  fetchIWaveScreening,
  fetchEmailEngagementSignals,
  normalizeSignal,
};
