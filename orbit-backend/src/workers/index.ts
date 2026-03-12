/**
 * Background Workers – Bull Queues
 *
 * Queues:
 *  agent-scheduler  – cron-driven: finds donors due for contact → enqueues agent-runs
 *  agent-runs       – executes AgentService.decide() for each donor
 *  outreach         – executes the action from AgentDecision (email/SMS/DocuSign)
 *  agent-replies    – processes inbound donor messages
 *  gifts            – post-gift processing (DocuSign → Salesforce → thank-you email)
 */

import Queue, { type Job } from 'bull';
import { logger } from '../config/logger';
import { getDB } from '../config/database';
import { agentService, type AgentType, type DonorContext, type AgentDecision } from '../services/agentService';
import {
  sendWelcome, sendImpactUpdate, sendGiftAsk,
  sendGiftReceipt, sendPledgeReminder,
} from '../services/emailService';
import { sendSMS } from '../services/smsService';
import { createGiftAgreement } from '../services/docusignService';
import { createOpportunity } from '../services/salesforceService';

// ─── Queue factory (DRY) ─────────────────────────────────────────
const redisOpts = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
};

function makeQueue(name: string, concurrency = 5) {
  const q = new Queue(name, { redis: redisOpts });
  q.on('error',   err  => logger.error(`[Queue:${name}] Error`, err));
  q.on('failed',  (job, err) => logger.warn(`[Queue:${name}] Job ${job.id} failed`, err));
  q.on('completed', job => logger.debug(`[Queue:${name}] Job ${job.id} completed`));
  return { q, concurrency };
}

const queues = {
  scheduler:  makeQueue('agent-scheduler', 1),
  agentRuns:  makeQueue('agent-runs', 10),
  outreach:   makeQueue('outreach', 20),
  replies:    makeQueue('agent-replies', 10),
  gifts:      makeQueue('gifts', 5),
};

// ─── Scheduler: find donors due for contact ──────────────────────
queues.scheduler.q.process(async () => {
  const db = getDB();
  const now = new Date();

  // Find all active assignments where next_contact_at is due
  const due = await db('agent_assignments as aa')
    .join('agents as ag',  'ag.id',  'aa.agent_id')
    .join('donors as d',   'd.id',   'aa.donor_id')
    .where('ag.status', 'active')
    .where('d.ai_opted_in', true)
    .where(qb => {
      qb.whereNull('aa.next_contact_at')
        .orWhere('aa.next_contact_at', '<=', now);
    })
    .select(
      'aa.agent_id', 'aa.donor_id', 'ag.type as agent_type',
      'ag.org_id', 'ag.persona'
    )
    .limit(500);  // batch size

  logger.info(`[Scheduler] Found ${due.length} donors due for contact`);

  for (const row of due) {
    await queues.agentRuns.q.add({
      agentId:   row.agent_id,
      agentType: row.agent_type as AgentType,
      donorId:   row.donor_id,
      orgId:     row.org_id,
      persona:   row.persona,
    }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
  }
});

// ─── Agent Runs: call Claude and get decision ────────────────────
queues.agentRuns.q.process(queues.agentRuns.concurrency, async (job: Job) => {
  const { agentId, agentType, donorId, orgId, persona } = job.data as {
    agentId: string; agentType: AgentType; donorId: string; orgId: string; persona: string;
  };

  const db = getDB();

  // Build donor context from DB
  const donor = await db('donors').where({ id: donorId }).first();
  const org   = await db('organizations').where({ id: orgId }).first();
  if (!donor || !org) { logger.warn(`[AgentRun] Donor or org not found: ${donorId}`); return; }

  const history = await db('touchpoints')
    .where({ donor_id: donorId })
    .orderBy('created_at', 'asc')
    .limit(20)
    .select('direction', 'body', 'channel', 'created_at');

  const donorCtx: DonorContext = {
    id:                donor.id,
    firstName:         donor.first_name,
    lastName:          donor.last_name,
    email:             donor.email,
    phone:             donor.phone,
    totalGiving:       donor.total_giving_cents,
    lastGiftAmount:    donor.last_gift_cents,
    lastGiftDate:      donor.last_gift_date,
    givingStreak:      donor.consecutive_giving_years,
    lapsedYears:       donor.lapsed_years,
    wealthCapacity:    donor.wealth_capacity_cents,
    propensityScore:   donor.propensity_score,
    bequeathScore:     donor.bequeath_score,
    interests:         donor.interests ?? [],
    communicationPref: donor.communication_pref,
    optedInToAI:       donor.ai_opted_in,
    currentStage:      donor.journey_stage,
    touchpointCount:   donor.touchpoint_count,
    lastContactDate:   donor.last_contact_at,
    sentiment:         donor.sentiment,
    conversationHistory: history.map(h => ({
      role:    h.direction === 'outbound' ? 'agent' : 'donor',
      content: h.body,
      channel: h.channel,
      ts:      h.created_at,
    })),
    organizationName:    org.name,
    organizationMission: org.mission ?? '',
  };

  const decision: AgentDecision = await agentService.decide(agentType, donorCtx);

  // Persist the decision log
  await db('agent_decisions').insert({
    agent_id:        agentId,
    donor_id:        donorId,
    org_id:          orgId,
    action_type:     decision.action.type,
    decision_payload: JSON.stringify(decision),
    stage_before:    donor.journey_stage,
    stage_after:     decision.newStage ?? donor.journey_stage,
    next_contact_days: decision.nextContactDays,
    escalated:       decision.escalateToHuman,
    escalation_reason: decision.escalationReason,
    created_at:      new Date(),
    updated_at:      new Date(),
  });

  // Update donor journey stage and next contact
  const nextContact = new Date();
  nextContact.setDate(nextContact.getDate() + (decision.nextContactDays ?? 7));

  await db('donors').where({ id: donorId }).update({
    journey_stage:   decision.newStage ?? donor.journey_stage,
    sentiment:       decision.sentimentUpdate ?? donor.sentiment,
    last_contact_at: new Date(),
    updated_at:      new Date(),
  });

  await db('agent_assignments')
    .where({ agent_id: agentId, donor_id: donorId })
    .update({ next_contact_at: nextContact });

  // Enqueue outreach action (unless no_action or opt_out)
  if (decision.action.type !== 'no_action' && decision.action.type !== 'opt_out_acknowledged') {
    await queues.outreach.q.add({
      action:    decision.action,
      donorCtx,
      agentId,
      persona,
      orgId,
    }, { attempts: 3 });
  }

  if (decision.action.type === 'opt_out_acknowledged') {
    await db('donors').where({ id: donorId }).update({ ai_opted_in: false });
  }
});

// ─── Outreach Executor: send the message ─────────────────────────
queues.outreach.q.process(queues.outreach.concurrency, async (job: Job) => {
  const { action, donorCtx, agentId, persona, orgId } = job.data as {
    action: AgentDecision['action'];
    donorCtx: DonorContext;
    agentId: string; persona: string; orgId: string;
  };

  const db = getDB();
  const toName = `${donorCtx.firstName} ${donorCtx.lastName}`;
  let touchpointBody = '';
  let channel: 'email' | 'sms' | 'note' = 'email';

  switch (action.type) {

    case 'send_email':
    case 'send_gift_ask': {
      channel = 'email';
      const isAsk = action.type === 'send_gift_ask';
      touchpointBody = action.body;

      if (isAsk) {
        await sendGiftAsk(donorCtx.email, toName, {
          orgName:          donorCtx.organizationName,
          agentName:        persona,
          donorFirstName:   donorCtx.firstName,
          askAmount:        `$${((action.askAmount ?? 0) / 100).toLocaleString()}`,
          fundName:         action.fundName,
          impactStatement:  action.body,
          donateUrl:        `${process.env.CLIENT_URL}/give/${orgId}`,
          isUpgrade:        donorCtx.lastGiftAmount > 0,
          multiYear:        action.multiYear ?? false,
          subject:          action.subject,
        });
      } else {
        await sendImpactUpdate(donorCtx.email, toName, {
          orgName:     donorCtx.organizationName,
          agentName:   persona,
          programName: 'Impact Update',
          impactStory: action.body,
        });
      }
      break;
    }

    case 'send_sms': {
      channel = 'sms';
      touchpointBody = action.body;
      if (donorCtx.phone) {
        await sendSMS({ to: donorCtx.phone, body: action.body, donorId: donorCtx.id });
      }
      break;
    }

    case 'create_gift_agreement': {
      channel = 'note';
      touchpointBody = `Gift agreement created: ${action.giftType} $${(action.amount / 100).toLocaleString()} to ${action.fundName}`;
      const result = await createGiftAgreement({
        giftType:       action.giftType,
        donorFirstName: donorCtx.firstName,
        donorLastName:  donorCtx.lastName,
        donorEmail:     donorCtx.email,
        orgName:        donorCtx.organizationName,
        amount:         action.amount,
        fundName:       action.fundName,
        years:          action.years,
        startDate:      new Date().toISOString().split('T')[0],
      });
      await db('gift_agreements').insert({
        org_id:               orgId,
        donor_id:             donorCtx.id,
        docusign_envelope_id: result.envelopeId,
        gift_type:            action.giftType,
        amount_cents:         action.amount,
        fund_name:            action.fundName,
        pledge_years:         action.years,
        status:               result.status,
        created_at:           new Date(),
        updated_at:           new Date(),
      });
      break;
    }

    case 'schedule_human_call': {
      channel = 'note';
      touchpointBody = `Escalated to human: ${action.notes}`;
      // TODO: create task in CRM or Slack notification to gift officer
      break;
    }
  }

  // Record touchpoint
  if (touchpointBody) {
    await db('touchpoints').insert({
      org_id:    orgId,
      donor_id:  donorCtx.id,
      agent_id:  agentId,
      channel,
      direction: 'outbound',
      body:      touchpointBody,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await db('donors').where({ id: donorCtx.id }).increment('touchpoint_count', 1);
  }
});

// ─── Gift processing: post-signature ─────────────────────────────
queues.gifts.q.process(queues.gifts.concurrency, async (job: Job) => {
  const { envelopeId } = job.data as { envelopeId: string };
  const db = getDB();

  const agreement = await db('gift_agreements').where({ docusign_envelope_id: envelopeId }).first();
  if (!agreement) return;

  const donor = await db('donors').where({ id: agreement.donor_id }).first();
  const org   = await db('organizations').where({ id: agreement.org_id }).first();
  if (!donor || !org) return;

  // Write to Salesforce if enabled
  if (process.env.ENABLE_SALESFORCE === 'true') {
    try {
      const sfOppId = await createOpportunity({
        contactId:  donor.salesforce_contact_id,
        accountId:  donor.salesforce_household_id,
        amount:     agreement.amount_cents,
        closeDate:  new Date().toISOString().split('T')[0],
        stageName:  'Closed Won',
        name:       `${donor.first_name} ${donor.last_name} - ${agreement.fund_name ?? 'General'} ${new Date().getFullYear()}`,
      });
      await db('gifts').where({ id: agreement.gift_id }).update({
        salesforce_opportunity_id: sfOppId,
      });
    } catch (err) {
      logger.error('[GiftWorker] Salesforce sync failed', err);
    }
  }

  // Send gift receipt
  await sendGiftReceipt(donor.email, `${donor.first_name} ${donor.last_name}`, {
    orgName:        org.name,
    donorFirstName: donor.first_name,
    giftAmount:     `$${(agreement.amount_cents / 100).toLocaleString()}`,
    giftDate:       new Date().toLocaleDateString('en-US'),
    fundName:       agreement.fund_name ?? 'General Fund',
    taxReceiptText: `${org.name} is a 501(c)(3) organisation. No goods or services were provided in exchange for this gift.`,
    receiptNumber:  `ORB-${Date.now()}`,
  });
});

// ─── Start all workers ───────────────────────────────────────────
export async function startWorkers(): Promise<void> {
  // Schedule agent runs every 15 minutes
  await queues.scheduler.q.add({}, {
    repeat: { cron: '*/15 * * * *' },
    removeOnComplete: true,
  });

  logger.info('✅ Background workers started');
}
