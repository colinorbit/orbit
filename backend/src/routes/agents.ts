/**
 * Agent Routes – /api/v1/agents
 *
 * Manage VEO / VSO / VPGO / VCO instances per organization.
 * Trigger manual agent runs, view decision logs, configure personas.
 */

import express from 'express';
import { body, param, query } from 'express-validator';
import { authenticate } from '../middleware/authenticate';
import { validateRequest } from '../middleware/validateRequest';
import { getDB } from '../config/database';
import { agentService, type AgentType } from '../services/agentService';
import { logger } from '../config/logger';
import Queue from 'bull';

const router = express.Router();
router.use(authenticate);

// ─── GET /agents — list all agents for org ───────────────────────
router.get('/', async (req, res, next) => {
  try {
    const agents = await getDB()('agents')
      .where({ org_id: req.user!.orgId })
      .orderBy('created_at', 'desc');
    res.json({ data: agents });
  } catch (err) { next(err); }
});

// ─── POST /agents — create a new agent ──────────────────────────
router.post('/', [
  body('type').isIn(['VEO', 'VSO', 'VPGO', 'VCO']),
  body('name').isString().trim().notEmpty(),
  body('persona').isString().trim().notEmpty(),    // agent's "name" shown to donors
  body('config').optional().isObject(),
], validateRequest, async (req, res, next) => {
  try {
    const [agent] = await getDB()('agents').insert({
      org_id:   req.user!.orgId,
      type:     req.body.type,
      name:     req.body.name,
      persona:  req.body.persona,
      config:   JSON.stringify(req.body.config ?? {}),
      status:   'active',
      created_at: new Date(),
      updated_at: new Date(),
    }).returning('*');
    res.status(201).json({ data: agent });
  } catch (err) { next(err); }
});

// ─── GET /agents/:id — get agent detail + stats ──────────────────
router.get('/:id', param('id').isUUID(), validateRequest, async (req, res, next) => {
  try {
    const agent = await getDB()('agents')
      .where({ id: req.params.id, org_id: req.user!.orgId })
      .first();
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

    const stats = await getDB()('agent_assignments')
      .where({ agent_id: req.params.id })
      .count('donor_id as total_donors')
      .first();

    const touchpointCount = await getDB()('touchpoints')
      .where({ agent_id: req.params.id })
      .count('id as total')
      .first();

    const giftsTotal = await getDB()('gifts')
      .where({ agent_id: req.params.id })
      .sum('amount_cents as total')
      .first();

    res.json({
      data: {
        ...agent,
        stats: {
          totalDonors:      Number(stats?.total_donors ?? 0),
          totalTouchpoints: Number(touchpointCount?.total ?? 0),
          totalGiftsCents:  Number(giftsTotal?.total ?? 0),
        },
      },
    });
  } catch (err) { next(err); }
});

// ─── POST /agents/:id/assign — assign donors to agent ───────────
router.post('/:id/assign', [
  param('id').isUUID(),
  body('donorIds').isArray({ min: 1, max: 2000 }),
  body('donorIds.*').isUUID(),
], validateRequest, async (req, res, next) => {
  try {
    const rows = (req.body.donorIds as string[]).map(donorId => ({
      agent_id:   req.params.id,
      donor_id:   donorId,
      org_id:     req.user!.orgId,
      assigned_at: new Date(),
    }));

    await getDB()('agent_assignments')
      .insert(rows)
      .onConflict(['agent_id', 'donor_id'])
      .ignore();

    res.json({ data: { assigned: rows.length } });
  } catch (err) { next(err); }
});

// ─── POST /agents/:id/run — manually trigger agent for a donor ───
router.post('/:id/run', [
  param('id').isUUID(),
  body('donorId').isUUID(),
], validateRequest, async (req, res, next) => {
  try {
    const agent = await getDB()('agents')
      .where({ id: req.params.id, org_id: req.user!.orgId })
      .first();
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

    // Load donor context
    const donor = await getDB()('donors')
      .where({ id: req.body.donorId, org_id: req.user!.orgId })
      .first();
    if (!donor) { res.status(404).json({ error: 'Donor not found' }); return; }

    // Queue for async processing (don't block the HTTP response)
    const agentQueue = new Queue('agent-runs', { redis: { host: 'localhost', port: 6379 } });
    const job = await agentQueue.add({
      agentId:  agent.id,
      agentType: agent.type as AgentType,
      donorId:  donor.id,
      orgId:    req.user!.orgId,
      manual:   true,
    });

    logger.info(`[AgentRoutes] Manual run queued: job ${job.id} for donor ${donor.id}`);
    res.json({ data: { jobId: job.id, status: 'queued' } });
  } catch (err) { next(err); }
});

// ─── GET /agents/:id/decisions — decision log ───────────────────
router.get('/:id/decisions', [
  param('id').isUUID(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], validateRequest, async (req, res, next) => {
  try {
    const page  = Number(req.query.page  ?? 1);
    const limit = Number(req.query.limit ?? 20);

    const decisions = await getDB()('agent_decisions')
      .where({ agent_id: req.params.id, org_id: req.user!.orgId })
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset((page - 1) * limit);

    const total = await getDB()('agent_decisions')
      .where({ agent_id: req.params.id, org_id: req.user!.orgId })
      .count('id as count')
      .first();

    res.json({
      data:       decisions,
      pagination: { page, limit, total: Number(total?.count ?? 0) },
    });
  } catch (err) { next(err); }
});

// ─── PATCH /agents/:id — update agent config / status ────────────
router.patch('/:id', [
  param('id').isUUID(),
  body('status').optional().isIn(['active', 'paused', 'archived']),
  body('persona').optional().isString().trim(),
  body('config').optional().isObject(),
], validateRequest, async (req, res, next) => {
  try {
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (req.body.status  !== undefined) updates.status  = req.body.status;
    if (req.body.persona !== undefined) updates.persona = req.body.persona;
    if (req.body.config  !== undefined) updates.config  = JSON.stringify(req.body.config);

    const [updated] = await getDB()('agents')
      .where({ id: req.params.id, org_id: req.user!.orgId })
      .update(updates)
      .returning('*');

    if (!updated) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json({ data: updated });
  } catch (err) { next(err); }
});

export default router;
