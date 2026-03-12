'use strict';
/**
 * Super Admin Routes
 * ALL routes require superadmin role in JWT.
 * These endpoints provision and manage customer orgs.
 *
 * POST /api/v1/superadmin/orgs          — provision new org
 * GET  /api/v1/superadmin/orgs          — list all orgs
 * GET  /api/v1/superadmin/orgs/:id      — org detail
 * PATCH /api/v1/superadmin/orgs/:id     — update org
 * POST /api/v1/superadmin/orgs/:id/suspend  — suspend
 * POST /api/v1/superadmin/orgs/:id/resume   — resume
 * DELETE /api/v1/superadmin/orgs/:id    — soft-delete
 * GET  /api/v1/superadmin/revenue       — MRR/ARR dashboard
 * GET  /api/v1/superadmin/health        — system health
 * POST /api/v1/superadmin/impersonate/:orgId — get scoped token
 */

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const db      = require('../db');
const logger  = require('../utils/logger');

// ── Middleware: require superadmin role ────────────────────────────────────────
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin') {
    logger.warn({ userId: req.user?.id, path: req.path }, 'superadmin access denied');
    return res.status(403).json({ error: 'Super admin access required' });
  }
  next();
}

// Apply to all routes in this file
router.use(requireSuperAdmin);

// ── Helpers ────────────────────────────────────────────────────────────────────
function generateOrgId() {
  return 'org_' + crypto.randomBytes(8).toString('hex');
}

function slugify(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40);
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/v1/superadmin/orgs  — provision a new customer org
// ══════════════════════════════════════════════════════════════════════════════
router.post('/orgs', async (req, res) => {
  const {
    // institution
    name, shortName, type, city, website, donorCount, currentTech,
    // plan
    plan, startType, billingEmail, billingName,
    // admin user
    adminFirstName, adminLastName, adminEmail, adminPassword, adminTitle, extraUsers,
    // branding
    primaryColor, fromName, replyTo, signatureName, subdomain,
    // integrations (array of { id, config })
    integrations,
  } = req.body;

  // ── Validation ────────────────────────────────────────────────────────────
  if (!name || !plan || !adminEmail || !adminPassword) {
    return res.status(400).json({
      error: 'Missing required fields: name, plan, adminEmail, adminPassword',
    });
  }
  if (!['starter', 'growth', 'enterprise'].includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan. Must be starter, growth, or enterprise.' });
  }
  if (adminPassword.length < 12) {
    return res.status(400).json({ error: 'Admin password must be at least 12 characters.' });
  }
  if (subdomain && !/^[a-z0-9-]+$/.test(subdomain)) {
    return res.status(400).json({ error: 'Subdomain may only contain lowercase letters, numbers, and hyphens.' });
  }

  // ── Check for duplicate email / subdomain ────────────────────────────────
  const emailCheck = await db.query(
    'SELECT id FROM users WHERE email = $1', [adminEmail.toLowerCase()]
  );
  if (emailCheck.rows.length > 0) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }
  if (subdomain) {
    const subCheck = await db.query(
      "SELECT id FROM organizations WHERE settings->>'subdomain' = $1", [subdomain]
    );
    if (subCheck.rows.length > 0) {
      return res.status(409).json({ error: `Subdomain "${subdomain}" is already taken.` });
    }
  }

  // ── Transaction: create org + admin user atomically ──────────────────────
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const orgId   = generateOrgId();
    const orgSlug = subdomain || slugify(name);

    const PLAN_LIMITS = {
      starter:    { maxDonors: 2500,   features: ['email', 'sms', 'basic_analytics'] },
      growth:     { maxDonors: 20000,  features: ['email', 'sms', 'advanced_analytics', 'signals', 'matching_gifts', 'pledge_management'] },
      enterprise: { maxDonors: 999999, features: ['email', 'sms', 'advanced_analytics', 'signals', 'matching_gifts', 'pledge_management', 'white_label', 'sso', 'custom_ai'] },
    };
    const planConfig = PLAN_LIMITS[plan];

    // Insert organization
    const orgResult = await client.query(`
      INSERT INTO organizations (id, name, slug, settings, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING *
    `, [
      orgId, name, orgSlug,
      JSON.stringify({
        shortName:      shortName || name.split(' ').map(w=>w[0]).join('').slice(0,4),
        type:           type || 'university',
        city:           city || '',
        website:        website || '',
        plan,
        billing_status: startType === 'trial' ? 'trial' : 'active',
        start_type:     startType || 'trial',
        billing_email:  billingEmail || adminEmail,
        billing_name:   billingName || `${adminFirstName} ${adminLastName}`,
        max_donors:     planConfig.maxDonors,
        features:       planConfig.features,
        subdomain:      orgSlug,
        primaryColor:   primaryColor || '#2a8c7e',
        fromName:       fromName || `${name} Advancement`,
        replyTo:        replyTo || adminEmail,
        signatureName:  signatureName || `The ${name} Advancement Team`,
        trial_ends_at:  startType === 'trial' ? new Date(Date.now() + 30*24*60*60*1000).toISOString() : null,
        onboarded_by:   req.user.id,
        current_tech:   currentTech || [],
      }),
    ]);

    // Hash password
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    // Insert admin user
    const userResult = await client.query(`
      INSERT INTO users (id, org_id, email, password_hash, first_name, last_name, role, title,
                         must_change_password, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'admin', $6, true, NOW(), NOW())
      RETURNING id, email, first_name, last_name, role
    `, [orgId, adminEmail.toLowerCase(), passwordHash,
        adminFirstName || 'Admin', adminLastName || 'User',
        adminTitle || 'Administrator']);

    // Insert extra users if provided
    if (Array.isArray(extraUsers) && extraUsers.length > 0) {
      for (const u of extraUsers) {
        if (!u.email) continue;
        const tempPw = crypto.randomBytes(12).toString('base64');
        const tempHash = await bcrypt.hash(tempPw, 12);
        await client.query(`
          INSERT INTO users (id, org_id, email, password_hash, first_name, last_name, role, must_change_password, created_at, updated_at)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, true, NOW(), NOW())
          ON CONFLICT (email) DO NOTHING
        `, [orgId, u.email.toLowerCase(), tempHash,
            (u.name||'').split(' ')[0]||'User',
            (u.name||'').split(' ').slice(1).join(' ')||'',
            u.role || 'officer']);
      }
    }

    // Store integration configs (encrypted)
    if (Array.isArray(integrations) && integrations.length > 0) {
      for (const intg of integrations) {
        if (!intg.id || !intg.config) continue;
        // Encrypt sensitive values
        const encrypted = encryptIntegrationConfig(intg.config);
        await client.query(`
          INSERT INTO integration_configs (org_id, integration_type, config_encrypted, enabled, created_at)
          VALUES ($1, $2, $3, true, NOW())
          ON CONFLICT (org_id, integration_type) DO UPDATE
          SET config_encrypted = $3, enabled = true, updated_at = NOW()
        `, [orgId, intg.id, encrypted]);
      }
    }

    await client.query('COMMIT');

    // Audit log
    logger.info({
      action:    'org_provisioned',
      actor:     req.user.email,
      org:       orgId,
      orgName:   name,
      plan,
      startType,
    }, `Super admin provisioned org: ${name}`);

    res.status(201).json({
      org:       orgResult.rows[0],
      adminUser: userResult.rows[0],
      loginUrl:  `https://${orgSlug}.orbit.ai`,
      message:   `${name} provisioned successfully. Welcome email queued for ${adminEmail}.`,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, orgName: name }, 'Failed to provision org');
    throw err;
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/superadmin/orgs
// ══════════════════════════════════════════════════════════════════════════════
router.get('/orgs', async (req, res) => {
  const { status, plan, search, sort = 'created_at', order = 'desc', limit = 50, offset = 0 } = req.query;

  let where   = ['o.deleted_at IS NULL'];
  let params  = [];
  let pIdx    = 1;

  if (status) {
    where.push(`o.settings->>'billing_status' = $${pIdx++}`);
    params.push(status);
  }
  if (plan) {
    where.push(`o.settings->>'plan' = $${pIdx++}`);
    params.push(plan);
  }
  if (search) {
    where.push(`(o.name ILIKE $${pIdx} OR o.settings->>'billing_email' ILIKE $${pIdx})`);
    params.push(`%${search}%`);
    pIdx++;
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const validSorts  = { name:'o.name', created_at:'o.created_at', mrr:'(o.settings->>\'plan\')' };
  const sortCol     = validSorts[sort] || 'o.created_at';

  params.push(parseInt(limit), parseInt(offset));
  const orgs = await db.query(`
    SELECT
      o.id, o.name, o.slug, o.settings, o.created_at,
      COUNT(u.id)::int AS user_count,
      COUNT(d.id)::int AS donor_count
    FROM organizations o
    LEFT JOIN users u ON u.org_id = o.id AND u.deleted_at IS NULL
    LEFT JOIN donors d ON d.org_id = o.id AND d.deleted_at IS NULL
    ${whereClause}
    GROUP BY o.id, o.name, o.slug, o.settings, o.created_at
    ORDER BY ${sortCol} ${order === 'asc' ? 'ASC' : 'DESC'}
    LIMIT $${pIdx++} OFFSET $${pIdx++}
  `, params);

  const countResult = await db.query(`
    SELECT COUNT(*)::int FROM organizations o ${whereClause}
  `, params.slice(0, -2));

  res.json({
    data:  orgs.rows,
    total: countResult.rows[0].count,
    limit: parseInt(limit),
    offset: parseInt(offset),
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/superadmin/orgs/:id
// ══════════════════════════════════════════════════════════════════════════════
router.get('/orgs/:id', async (req, res) => {
  const { id } = req.params;
  const result = await db.query(`
    SELECT
      o.*,
      COUNT(DISTINCT u.id)::int AS user_count,
      COUNT(DISTINCT d.id)::int AS donor_count,
      COALESCE(SUM(g.amount), 0) AS lifetime_raised,
      COUNT(DISTINCT g.id)::int AS gift_count
    FROM organizations o
    LEFT JOIN users u ON u.org_id = o.id AND u.deleted_at IS NULL
    LEFT JOIN donors d ON d.org_id = o.id AND d.deleted_at IS NULL
    LEFT JOIN gifts g ON g.org_id = o.id
    WHERE o.id = $1 AND o.deleted_at IS NULL
    GROUP BY o.id
  `, [id]);

  if (!result.rows.length) return res.status(404).json({ error: 'Organization not found' });

  // Get users
  const users = await db.query(
    'SELECT id, email, first_name, last_name, role, title, last_login_at, created_at FROM users WHERE org_id = $1 AND deleted_at IS NULL ORDER BY created_at',
    [id]
  );

  // Get integrations
  const integrations = await db.query(
    'SELECT integration_type, enabled, last_sync_at, created_at FROM integration_configs WHERE org_id = $1',
    [id]
  );

  res.json({
    ...result.rows[0],
    users:        users.rows,
    integrations: integrations.rows,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/v1/superadmin/orgs/:id
// ══════════════════════════════════════════════════════════════════════════════
router.patch('/orgs/:id', async (req, res) => {
  const { id } = req.params;
  const allowed = ['name', 'settings'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields to update' });

  const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i+2}`).join(', ');
  const result = await db.query(
    `UPDATE organizations SET ${setClauses}, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, ...Object.values(updates)]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Organization not found' });

  logger.info({ action: 'org_updated', actor: req.user.email, org: id });
  res.json(result.rows[0]);
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/v1/superadmin/orgs/:id/suspend
// ══════════════════════════════════════════════════════════════════════════════
router.post('/orgs/:id/suspend', async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  await db.query(`
    UPDATE organizations
    SET settings = settings || '{"billing_status":"suspended"}'::jsonb, updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
  `, [id]);
  logger.warn({ action: 'org_suspended', actor: req.user.email, org: id, reason });
  res.json({ suspended: true, reason });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/v1/superadmin/orgs/:id/resume
// ══════════════════════════════════════════════════════════════════════════════
router.post('/orgs/:id/resume', async (req, res) => {
  const { id } = req.params;
  await db.query(`
    UPDATE organizations
    SET settings = settings || '{"billing_status":"active"}'::jsonb, updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
  `, [id]);
  logger.info({ action: 'org_resumed', actor: req.user.email, org: id });
  res.json({ resumed: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/v1/superadmin/impersonate/:orgId
// Creates a short-lived JWT scoped to the org (admin role)
// ══════════════════════════════════════════════════════════════════════════════
router.post('/impersonate/:orgId', async (req, res) => {
  const { orgId } = req.params;

  const orgResult = await db.query(
    'SELECT id, name FROM organizations WHERE id = $1 AND deleted_at IS NULL', [orgId]
  );
  if (!orgResult.rows.length) return res.status(404).json({ error: 'Organization not found' });

  // Find or get a representative admin user for the org
  const adminUser = await db.query(
    "SELECT id, email, first_name, last_name FROM users WHERE org_id = $1 AND role = 'admin' AND deleted_at IS NULL LIMIT 1",
    [orgId]
  );
  if (!adminUser.rows.length) return res.status(404).json({ error: 'No admin user found for this org' });

  const user = adminUser.rows[0];
  // Short-lived (1 hour), includes impersonation flag
  const token = jwt.sign(
    {
      id:           user.id,
      email:        user.email,
      orgId,
      role:         'admin',
      impersonating: true,
      impersonatedBy: req.user.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  logger.warn({
    action: 'impersonation_started',
    actor:  req.user.email,
    target: orgId,
    orgName: orgResult.rows[0].name,
  }, `IMPERSONATION: ${req.user.email} impersonating ${orgResult.rows[0].name}`);

  res.json({
    token,
    org:     orgResult.rows[0],
    user:    { email: user.email, name: `${user.first_name} ${user.last_name}` },
    expiresIn: '1h',
    warning: 'This token grants full admin access to the customer account. All actions are logged.',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/superadmin/revenue
// ══════════════════════════════════════════════════════════════════════════════
router.get('/revenue', async (req, res) => {
  const result = await db.query(`
    SELECT
      COUNT(*)::int AS total_orgs,
      COUNT(*) FILTER (WHERE settings->>'billing_status' = 'active')::int AS active_orgs,
      COUNT(*) FILTER (WHERE settings->>'billing_status' = 'trial')::int AS trial_orgs,
      COUNT(*) FILTER (WHERE settings->>'billing_status' = 'past_due')::int AS past_due_orgs,
      COUNT(*) FILTER (WHERE settings->>'billing_status' = 'suspended')::int AS suspended_orgs,
      COUNT(*) FILTER (WHERE settings->>'plan' = 'starter')::int AS starter_count,
      COUNT(*) FILTER (WHERE settings->>'plan' = 'growth')::int AS growth_count,
      COUNT(*) FILTER (WHERE settings->>'plan' = 'enterprise')::int AS enterprise_count
    FROM organizations WHERE deleted_at IS NULL
  `);

  const stats = result.rows[0];
  const MRR_BY_PLAN = { starter: 499, growth: 1299, enterprise: 3999 };
  const mrr = stats.starter_count * MRR_BY_PLAN.starter
            + stats.growth_count  * MRR_BY_PLAN.growth
            + stats.enterprise_count * MRR_BY_PLAN.enterprise;

  // Recent orgs created
  const recent = await db.query(`
    SELECT id, name, settings->>'plan' AS plan, settings->>'billing_status' AS billing_status, created_at
    FROM organizations WHERE deleted_at IS NULL
    ORDER BY created_at DESC LIMIT 10
  `);

  res.json({
    mrr,
    arr: mrr * 12,
    ...stats,
    recentOrgs: recent.rows,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/superadmin/health
// ══════════════════════════════════════════════════════════════════════════════
router.get('/health', async (req, res) => {
  const checks = [];
  const t = (name, fn) => checks.push({ name, check: fn });

  t('PostgreSQL', async () => {
    const start = Date.now();
    await db.query('SELECT 1');
    return { latency: Date.now() - start, status: 'operational' };
  });

  t('Active Orgs', async () => {
    const r = await db.query("SELECT COUNT(*)::int AS n FROM organizations WHERE settings->>'billing_status' = 'active'");
    return { count: r.rows[0].n, status: 'operational' };
  });

  t('Message Queue', async () => {
    const r = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='pending')::int AS pending,
        COUNT(*) FILTER (WHERE status='sent')::int AS sent_today
      FROM outreach_messages WHERE created_at > NOW() - INTERVAL '24h'
    `);
    return { ...r.rows[0], status: 'operational' };
  });

  const results = await Promise.allSettled(checks.map(async c => ({
    name: c.name,
    ...(await c.check()),
  })));

  res.json({
    timestamp: new Date().toISOString(),
    services: results.map((r, i) => ({
      name: checks[i].name,
      status: r.status === 'fulfilled' ? r.value.status : 'degraded',
      ...(r.status === 'fulfilled' ? r.value : { error: r.reason?.message }),
    })),
  });
});

// ── Utility: encrypt integration config ────────────────────────────────────────
function encryptIntegrationConfig(config) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex').slice(0,64), 'hex');
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(config)), cipher.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}

module.exports = router;
