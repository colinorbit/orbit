'use strict';
/**
 * VSO Routes — Virtual Stewardship Officer API
 * Mounted at: /api/v1/vso
 */
const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const vso      = require('../services/vsoEngine');
const logger   = require('../utils/logger');
const { audit } = require('../utils/audit');

/* GET /vso/queue — daily stewardship queue for org */
router.get('/queue', async (req, res) => {
  const { limit = 50 } = req.query;
  const queue = await vso.buildDailyQueue(req.org.id, parseInt(limit));
  res.json({ success: true, data: queue });
});

/* POST /vso/classify — classify a single donor */
router.post('/classify', async (req, res) => {
  const { donor } = req.body;
  if (!donor) return res.status(400).json({ error: 'donor required' });
  const donorType = vso.classifyDonor(donor);
  const rhs       = vso.calculateRHS(donor, req.body.activity || {});
  const schedule  = vso.scheduleNextTouchpoint(donor, req.body.activity || {}, donorType);
  res.json({ success: true, data: { donorType, rhs, tier: vso.rhsTier(rhs), schedule } });
});

/* POST /vso/generate — generate stewardship content */
router.post('/generate', async (req, res) => {
  const { donor, donorType, touchpointType, channel, impactStory, includeAsk, askAmount } = req.body;
  if (!donor || !touchpointType) return res.status(400).json({ error: 'donor and touchpointType required' });
  const result = await vso.generateStewardshipContent(
    { donor, donorType: donorType || vso.classifyDonor(donor), touchpointType, channel: channel || 'email', impactStory, includeAsk, askAmount },
    req.org
  );
  await audit('VSO_CONTENT_GENERATED', req.user?.id, 'donor', donor.id, `${touchpointType} via ${channel||'email'}`);
  res.json({ success: true, data: result });
});

/* GET /vso/planned-gift-plan/:donorId — full 12-month stewardship plan */
router.get('/planned-gift-plan/:donorId', async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM donors WHERE id = $1 AND org_id = $2',
    [req.params.donorId, req.org.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Donor not found' });
  const plan = vso.buildPlannedGiftStewardshipPlan(rows[0]);
  res.json({ success: true, data: plan });
});

/* POST /vso/evaluate-upgrade — leadership annual upgrade path */
router.post('/evaluate-upgrade', async (req, res) => {
  const { donor, activity } = req.body;
  if (!donor) return res.status(400).json({ error: 'donor required' });
  const result = vso.evaluateUpgradePath(donor, activity || {});
  res.json({ success: true, data: result });
});

/* POST /vso/churn-risk — sustainer churn risk assessment */
router.post('/churn-risk', async (req, res) => {
  const { donor, activity } = req.body;
  if (!donor) return res.status(400).json({ error: 'donor required' });
  const result = vso.assessSustainerChurnRisk(donor, activity || {});
  res.json({ success: true, data: result });
});

/* POST /vso/sentiment — analyze donor reply sentiment */
router.post('/sentiment', async (req, res) => {
  const { replyText, donor } = req.body;
  if (!replyText || !donor) return res.status(400).json({ error: 'replyText and donor required' });
  const result = await vso.analyzeDonorSentiment(replyText, donor, req.org);
  res.json({ success: true, data: result });
});

/* GET /vso/performance — VSO performance report */
router.get('/performance', async (req, res) => {
  const { days = 30 } = req.query;
  const report = await vso.getVSOPerformanceReport(req.org.id, parseInt(days));
  res.json({ success: true, data: report });
});

module.exports = router;
