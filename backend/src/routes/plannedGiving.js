'use strict';
/**
 * ORBIT VPGO + MARKETING STUDIO ROUTES  v1.0
 *
 * GET  /pg/vehicles                → list all PG vehicles with full mechanics
 * GET  /pg/prospects               → portfolio-level PG prospect scan
 * GET  /pg/profile/:donorId        → full donor intelligence profile
 * GET  /pg/stewardship/:donorId    → stewardship prescription
 * POST /pg/proposal                → generate personalized PG proposal letter
 * POST /pg/sequence                → generate conversation sequence
 * POST /pg/objection               → handle a specific objection
 * POST /pg/cga-calc                → CGA rate + income calculator
 * POST /pg/marketing               → generate marketing content (copy)
 * POST /pg/image                   → generate campaign image (DALL-E 3)
 * POST /campaign/kit               → full campaign kit generation
 * POST /campaign/appeal            → personalized appeal letter
 * POST /campaign/stewardship-report→ donor stewardship report
 * POST /campaign/phone-script      → phone call script
 */

const express  = require('express');
const router   = express.Router();
const { authenticate, tenantScope, requireRole } = require('../middleware/auth');
const logger   = require('../utils/logger');

const {
  PG_VEHICLES, OBJECTIONS, calculateCGA,
  scanPortfolioForPGProspects,
  generateConversationSequence,
  generatePGProposal,
  generatePGMarketingContent,
  generateMarketingImage,
  handleObjection,
} = require('../services/plannedGivingBrain');

const {
  buildDonorProfile,
  buildStewardshipPlan,
  ARCHETYPES,
} = require('../services/donorIntelligence');

const {
  generateCampaignKit,
  generateStewardshipReport,
  generatePersonalizedAppeal,
  generatePhoneScript,
  generateImage,
} = require('../services/marketingStudio');

// All routes require auth
router.use(authenticate, tenantScope);

// ─── PG Vehicles ──────────────────────────────────────────────────────────────
router.get('/pg/vehicles', (req, res) => {
  res.json({
    vehicles: Object.values(PG_VEHICLES),
    totalVehicles: Object.keys(PG_VEHICLES).length,
  });
});

// ─── Portfolio PG prospect scan ───────────────────────────────────────────────
router.get('/pg/prospects', async (req, res) => {
  try {
    const prospects = await scanPortfolioForPGProspects(req.user.orgId);
    res.json({ prospects, count: prospects.length, scannedAt: new Date().toISOString() });
  } catch(e) {
    logger.error('PG prospect scan failed', { err: e.message });
    res.status(500).json({ error: 'ScanFailed', message: e.message });
  }
});

// ─── Full 360° donor intelligence profile ────────────────────────────────────
router.get('/pg/profile/:donorId', async (req, res) => {
  try {
    const profile = await buildDonorProfile(req.params.donorId, req.user.orgId);
    res.json(profile);
  } catch(e) {
    logger.error('Donor profile failed', { err: e.message });
    res.status(500).json({ error: 'ProfileFailed', message: e.message });
  }
});

// ─── Stewardship prescription ─────────────────────────────────────────────────
router.get('/pg/stewardship/:donorId', async (req, res) => {
  try {
    const plan = await buildStewardshipPlan(req.params.donorId, req.user.orgId);
    res.json(plan);
  } catch(e) {
    res.status(500).json({ error: 'StewardshipFailed', message: e.message });
  }
});

// ─── PG proposal generator ────────────────────────────────────────────────────
router.post('/pg/proposal', async (req, res) => {
  const { donorId, vehicleId, giftAmount } = req.body;
  if (!donorId || !vehicleId) return res.status(400).json({ error: 'Missing donorId or vehicleId' });
  try {
    const { rows } = await require('../db').query(
      `SELECT d.*, SUM(g.amount) as total_giving FROM donors d
       LEFT JOIN gifts g ON g.donor_id=d.id AND g.org_id=$1
       WHERE d.id=$2 AND d.org_id=$1 GROUP BY d.id`,
      [req.user.orgId, donorId]
    );
    if (!rows.length) return res.status(404).json({ error: 'DonorNotFound' });
    const proposal = await generatePGProposal(rows[0], vehicleId, giftAmount);
    res.json(proposal);
  } catch(e) {
    res.status(500).json({ error: 'ProposalFailed', message: e.message });
  }
});

// ─── Conversation sequence ────────────────────────────────────────────────────
router.post('/pg/sequence', async (req, res) => {
  const { donorId, vehicleId } = req.body;
  if (!donorId || !vehicleId) return res.status(400).json({ error: 'Missing required fields' });
  try {
    const { rows } = await require('../db').query(
      `SELECT d.*, SUM(g.amount) as total_giving FROM donors d
       LEFT JOIN gifts g ON g.donor_id=d.id AND g.org_id=$1
       WHERE d.id=$2 AND d.org_id=$1 GROUP BY d.id`,
      [req.user.orgId, donorId]
    );
    if (!rows.length) return res.status(404).json({ error: 'DonorNotFound' });
    const seq = await generateConversationSequence(rows[0], vehicleId);
    res.json(seq);
  } catch(e) {
    res.status(500).json({ error: 'SequenceFailed', message: e.message });
  }
});

// ─── Objection handler ────────────────────────────────────────────────────────
router.post('/pg/objection', async (req, res) => {
  const { objection, donorContext } = req.body;
  if (!objection) return res.status(400).json({ error: 'Missing objection text' });
  try {
    const response = await handleObjection(objection, donorContext || {});
    res.json(response);
  } catch(e) {
    res.status(500).json({ error: 'ObjectionFailed', message: e.message });
  }
});

// ─── CGA calculator ───────────────────────────────────────────────────────────
router.post('/pg/cga-calc', (req, res) => {
  const { age, amount, afr } = req.body;
  if (!age || !amount) return res.status(400).json({ error: 'Missing age or amount' });
  const result = calculateCGA(parseInt(age), parseFloat(amount), afr ? parseFloat(afr) : undefined);
  res.json({ age, amount, ...result, vehicle: PG_VEHICLES.CGA });
});

// ─── Marketing content ────────────────────────────────────────────────────────
router.post('/pg/marketing', async (req, res) => {
  const { type, orgName, options } = req.body;
  if (!type || !orgName) return res.status(400).json({ error: 'Missing type or orgName' });
  try {
    const content = await generatePGMarketingContent(type, orgName, options || {});
    res.json(content);
  } catch(e) {
    res.status(500).json({ error: 'MarketingFailed', message: e.message });
  }
});

// ─── Image generation ─────────────────────────────────────────────────────────
router.post('/pg/image', requireRole('admin', 'director', 'officer'), async (req, res) => {
  const { prompt, style, orgName } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  try {
    const img = await generateMarketingImage(prompt, style || 'photorealistic', orgName || '');
    res.json(img);
  } catch(e) {
    res.status(500).json({ error: 'ImageFailed', message: e.message });
  }
});

// ─── Campaign kit ─────────────────────────────────────────────────────────────
router.post('/campaign/kit', requireRole('admin', 'director', 'officer'), async (req, res) => {
  const brief = req.body;
  if (!brief.orgName || !brief.campaignType) {
    return res.status(400).json({ error: 'Missing orgName or campaignType' });
  }
  try {
    const kit = await generateCampaignKit(brief);
    res.json(kit);
  } catch(e) {
    logger.error('Campaign kit failed', { err: e.message });
    res.status(500).json({ error: 'KitFailed', message: e.message });
  }
});

// ─── Personalized appeal ──────────────────────────────────────────────────────
router.post('/campaign/appeal', async (req, res) => {
  const { donorId, campaignContext } = req.body;
  if (!donorId) return res.status(400).json({ error: 'Missing donorId' });
  try {
    const { rows } = await require('../db').query(
      `SELECT d.*, MAX(g.amount) as last_gift_amount, MAX(g.fund) as last_gift_fund,
              SUM(g.amount) as total_giving
       FROM donors d LEFT JOIN gifts g ON g.donor_id=d.id AND g.org_id=$1
       WHERE d.id=$2 AND d.org_id=$1 GROUP BY d.id`,
      [req.user.orgId, donorId]
    );
    if (!rows.length) return res.status(404).json({ error: 'DonorNotFound' });
    const letter = await generatePersonalizedAppeal(rows[0], campaignContext || {});
    res.json({ donorId, letter, generatedAt: new Date().toISOString() });
  } catch(e) {
    res.status(500).json({ error: 'AppealFailed', message: e.message });
  }
});

// ─── Stewardship report ───────────────────────────────────────────────────────
router.post('/campaign/stewardship-report', async (req, res) => {
  const { donorId, impactData } = req.body;
  if (!donorId) return res.status(400).json({ error: 'Missing donorId' });
  try {
    const { rows } = await require('../db').query(
      `SELECT d.*, SUM(g.amount) as total_giving, MAX(g.amount) as largest_gift
       FROM donors d LEFT JOIN gifts g ON g.donor_id=d.id AND g.org_id=$1
       WHERE d.id=$2 AND d.org_id=$1 GROUP BY d.id`,
      [req.user.orgId, donorId]
    );
    if (!rows.length) return res.status(404).json({ error: 'DonorNotFound' });
    const report = await generateStewardshipReport(rows[0], impactData || {});
    res.json({ donorId, report, generatedAt: new Date().toISOString() });
  } catch(e) {
    res.status(500).json({ error: 'ReportFailed', message: e.message });
  }
});

// ─── Phone script ─────────────────────────────────────────────────────────────
router.post('/campaign/phone-script', async (req, res) => {
  const { donorId, callPurpose } = req.body;
  if (!donorId) return res.status(400).json({ error: 'Missing donorId' });
  try {
    const { rows } = await require('../db').query(
      `SELECT d.*, SUM(g.amount) as total_giving, MAX(g.amount) as last_gift_amount
       FROM donors d LEFT JOIN gifts g ON g.donor_id=d.id AND g.org_id=$1
       WHERE d.id=$2 AND d.org_id=$1 GROUP BY d.id`,
      [req.user.orgId, donorId]
    );
    if (!rows.length) return res.status(404).json({ error: 'DonorNotFound' });
    const script = await generatePhoneScript(rows[0], callPurpose || 'Annual fund renewal');
    res.json({ donorId, script, generatedAt: new Date().toISOString() });
  } catch(e) {
    res.status(500).json({ error: 'ScriptFailed', message: e.message });
  }
});

// ─── Archetypes reference ─────────────────────────────────────────────────────
router.get('/pg/archetypes', (req, res) => {
  res.json({ archetypes: Object.values(ARCHETYPES) });
});

module.exports = router;
