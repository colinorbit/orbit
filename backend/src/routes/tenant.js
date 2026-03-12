'use strict';
/**
 * Orbit — Tenant Configuration Route
 * GET /api/v1/tenant     → returns org branding, config, plan details for TenantContext
 * PATCH /api/v1/tenant   → update branding (admin only)
 *
 * This is what replaces the hardcoded "Greenfield University" in the dashboard.
 * The frontend TenantContext calls GET /api/v1/tenant on load, and the returned
 * config drives the university name, logo, colors, and email signature everywhere.
 */

const express  = require('express');
const router   = express.Router();
const { pool } = require('../db');
const { authenticate }  = require('../middleware/auth');
const { requireRole, auditLog } = require('../middleware/tenant');
const logger   = require('../utils/logger');

router.use(authenticate);

// ─── GET /tenant ──────────────────────────────────────────────────────────────
// Returns the complete tenant config for the authenticated org.
// Called by TenantContext on app load — drives all university-specific UI.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         o.id, o.name, o.plan, o.billing_status,
         o.branding, o.settings, o.created_at,
         o.trial_ends_at,
         -- Count active users
         (SELECT COUNT(*) FROM users WHERE org_id = o.id AND active = true) AS user_count,
         -- Count donors (approximate — from cached stats)
         COALESCE(os.donor_count, 0)  AS donor_count,
         COALESCE(os.total_raised, 0) AS total_raised,
         COALESCE(os.active_campaigns, 0) AS active_campaigns
       FROM orgs o
       LEFT JOIN org_stats os ON os.org_id = o.id
       WHERE o.id = $1`,
      [req.user.org_id]
    );

    if (!rows.length) return res.status(404).json({ error: 'OrgNotFound' });
    const org = rows[0];

    // Parse branding blob (stored as JSONB)
    const branding = org.branding || {};
    const settings = org.settings || {};

    // Build the tenant config object matching the frontend TenantContext shape
    const tenantConfig = {
      id:           org.id,
      name:         org.name,
      shortName:    branding.shortName    || org.name.split(' ').slice(0, 2).join(' '),
      initials:     branding.initials     || org.name.split(' ').filter(w => /^[A-Z]/.test(w)).map(w => w[0]).join('').slice(0, 3),
      logoText:     branding.logoText     || org.name[0],
      logoUrl:      branding.logoUrl      || null,
      primaryColor: branding.primaryColor || '#2a8c7e',
      accentColor:  branding.accentColor  || '#48a99d',
      tagline:      branding.tagline      || '',
      emailDomain:  branding.emailDomain  || '',
      signatureName: branding.signatureName || `The ${org.name} Advancement Team`,
      subdomain:    branding.subdomain    || null,
      timezone:     settings.timezone     || 'America/Chicago',
      fiscalYearEnd: settings.fiscalYearEnd || 'June',

      // Plan info
      plan:          org.plan,
      billingStatus: org.billing_status,
      trialEndsAt:   org.trial_ends_at,

      // Capabilities (what the plan unlocks)
      agents:        getPlanAgents(org.plan),
      maxDonors:     getPlanMaxDonors(org.plan),
      features:      getPlanFeatures(org.plan),

      // Live stats (shown in dashboard overview)
      stats: {
        donorCount:      parseInt(org.donor_count)      || 0,
        totalRaised:     parseInt(org.total_raised)     || 0,
        activeCampaigns: parseInt(org.active_campaigns) || 0,
        userCount:       parseInt(org.user_count)       || 0,
      },
    };

    res.json(tenantConfig);

  } catch (err) {
    logger.error({ err, org_id: req.user.org_id }, 'Get tenant config failed');
    res.status(500).json({ error: 'TenantFetchFailed' });
  }
});

// ─── PATCH /tenant ────────────────────────────────────────────────────────────
// Update branding for the org (admin-only)
router.patch('/', requireRole('admin', 'superadmin'), async (req, res) => {
  const {
    shortName, logoUrl, logoText, primaryColor, accentColor,
    tagline, emailDomain, signatureName, timezone, fiscalYearEnd
  } = req.body;

  try {
    // Build partial branding update (only update provided fields)
    const { rows: current } = await pool.query(
      'SELECT branding, settings FROM orgs WHERE id = $1',
      [req.user.org_id]
    );
    if (!current.length) return res.status(404).json({ error: 'OrgNotFound' });

    const existingBranding = current[0].branding || {};
    const existingSettings = current[0].settings || {};

    const newBranding = {
      ...existingBranding,
      ...(shortName    !== undefined && { shortName }),
      ...(logoUrl      !== undefined && { logoUrl }),
      ...(logoText     !== undefined && { logoText }),
      ...(primaryColor !== undefined && { primaryColor }),
      ...(accentColor  !== undefined && { accentColor }),
      ...(tagline      !== undefined && { tagline }),
      ...(emailDomain  !== undefined && { emailDomain }),
      ...(signatureName !== undefined && { signatureName }),
    };

    const newSettings = {
      ...existingSettings,
      ...(timezone      !== undefined && { timezone }),
      ...(fiscalYearEnd !== undefined && { fiscalYearEnd }),
    };

    await pool.query(
      'UPDATE orgs SET branding = $1, settings = $2, updated_at = NOW() WHERE id = $3',
      [JSON.stringify(newBranding), JSON.stringify(newSettings), req.user.org_id]
    );

    await auditLog(req, 'org.branding_updated', 'orgs', req.user.org_id, {
      changedFields: Object.keys(req.body),
    });

    logger.info({ org_id: req.user.org_id, changes: Object.keys(req.body) }, 'Tenant branding updated');
    res.json({ message: 'Tenant config updated successfully.' });

  } catch (err) {
    logger.error({ err }, 'Update tenant config failed');
    res.status(500).json({ error: 'TenantUpdateFailed' });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getPlanAgents(plan) {
  const agents = { starter: ['VEO','VSO'], growth: ['VEO','VSO','VCO'], enterprise: ['VEO','VSO','VCO','VPGO'] };
  return agents[plan] || agents.starter;
}

function getPlanMaxDonors(plan) {
  return { starter: 2500, growth: 15000, enterprise: Infinity }[plan] || 2500;
}

function getPlanFeatures(plan) {
  const base = ['email_outreach', 'sms_outreach', 'analytics', 'donor_profiles'];
  if (plan === 'growth' || plan === 'enterprise') base.push('campaigns', 'matching_gifts', 'bulk_outreach');
  if (plan === 'enterprise') base.push('planned_giving', 'membership_officer', 'api_access', 'white_label');
  return base;
}

module.exports = router;
