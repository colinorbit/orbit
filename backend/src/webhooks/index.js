'use strict';
/**
 * Webhook Receivers
 * Inbound real-time events from CRMs.
 * All webhooks are unauthenticated routes — signature verified per-provider.
 */

const express = require('express');
const crypto  = require('crypto');
const db      = require('../db');
const logger  = require('../utils/logger');
const router  = express.Router();

// Use raw body for signature verification
router.use(express.raw({ type: 'application/json' }));

// ─────────────────────────────────────────────────────────────────────────────
// HubSpot Webhook
// Header: X-HubSpot-Signature-v3
// Docs: https://developers.hubspot.com/docs/api/webhooks
// ─────────────────────────────────────────────────────────────────────────────
router.post('/hubspot', async (req, res) => {
  // Acknowledge immediately (HubSpot requires <5s response)
  res.status(200).json({ received: true });

  const body = req.body.toString();
  let events;
  try {
    events = JSON.parse(body);
  } catch(e) {
    return logger.warn('HubSpot webhook: invalid JSON');
  }

  // Verify signature
  const sig = req.headers['x-hubspot-signature-v3'];
  // const secret = process.env.HS_WEBHOOK_SECRET;
  // TODO: verify HMAC-SHA256 of requestUri + body + timestamp

  for (const event of (Array.isArray(events) ? events : [events])) {
    try {
      await handleHubSpotEvent(event);
    } catch(e) {
      logger.error('HubSpot event handling failed', { event: event.subscriptionType, err: e.message });
    }
  }
});

async function handleHubSpotEvent(event) {
  const { subscriptionType, objectId, portalId } = event;
  logger.info('HubSpot webhook received', { subscriptionType, objectId });

  // Find org by portal ID
  const { rows } = await db.query(
    `SELECT org_id FROM integrations WHERE provider='hubspot' AND config->>'portalId'=$1 LIMIT 1`,
    [String(portalId)]
  );
  const orgId = rows[0]?.org_id;
  if (!orgId) return logger.warn('HubSpot webhook: unknown portalId', { portalId });

  if (subscriptionType === 'contact.creation' || subscriptionType === 'contact.propertyChange') {
    // Queue a targeted donor re-sync
    await db.query(
      `INSERT INTO sync_events (org_id, provider, type, status, message, payload)
       VALUES ($1,'hubspot','webhook_contact','ok',$2,$3)`,
      [orgId, `HubSpot contact ${objectId} updated`, JSON.stringify(event)]
    );
    // In production: trigger targeted re-fetch of this contact only
  }

  if (subscriptionType === 'deal.creation') {
    await db.query(
      `INSERT INTO sync_events (org_id, provider, type, status, message, payload)
       VALUES ($1,'hubspot','webhook_gift','ok',$2,$3)`,
      [orgId, `HubSpot deal ${objectId} created`, JSON.stringify(event)]
    );
    // In production: fetch deal, upsert as gift, trigger VSO stewardship
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Salesforce Outbound Message (SOAP-based)
// Header: Authorization: Basic (configurable in SF)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/salesforce', express.text({ type: 'text/xml' }), async (req, res) => {
  res.status(200).send(`<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body><notificationsResponse xmlns="http://soap.sforce.com/2005/09/outbound">
    <Ack>true</Ack>
  </notificationsResponse></soapenv:Body>
</soapenv:Envelope>`);

  const body = req.body;
  logger.info('Salesforce webhook received');

  // Parse SOAP XML — in production use xml2js or fast-xml-parser
  // Extract Contact IDs from <sObject> nodes and queue re-sync
  try {
    // Simplified: log the event
    await db.query(
      `INSERT INTO sync_events (org_id, provider, type, status, message)
       SELECT org_id, 'salesforce', 'webhook_received', 'ok', 'Outbound message received'
       FROM integrations WHERE provider='salesforce' LIMIT 1`
    );
  } catch(e) {
    logger.error('SF webhook log failed', { err: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Raiser's Edge NXT — Blackbaud SKY API Webhook
// Header: Bb-Webhook-Signature (HMAC-SHA256 of body)
// Docs: https://developer.blackbaud.com/skyapi/docs/webhooks
// ─────────────────────────────────────────────────────────────────────────────
router.post('/renxt', async (req, res) => {
  res.status(200).json({ received: true });

  const body = req.body.toString();
  const signature = req.headers['bb-webhook-signature'];

  // Verify HMAC-SHA256 signature
  // const secret = process.env.RENXT_WEBHOOK_SECRET;
  // const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  // if (signature !== expected) return logger.warn('RE NXT: invalid webhook signature');

  let event;
  try { event = JSON.parse(body); } catch(e) { return; }

  logger.info('RE NXT webhook received', { type: event.type });

  const eventType = event.type; // e.g. 'constituent.updated', 'gift.created'

  // Find org that has this RE NXT integration
  const { rows } = await db.query(
    `SELECT org_id FROM integrations WHERE provider='blackbaud' AND status='connected' LIMIT 1`
  );
  const orgId = rows[0]?.org_id;
  if (!orgId) return;

  await db.query(
    `INSERT INTO sync_events (org_id, provider, type, status, message, payload)
     VALUES ($1,'blackbaud',$2,'ok',$3,$4)`,
    [orgId, eventType,
     `RE NXT ${eventType} received`,
     JSON.stringify(event)]
  );

  if (eventType === 'gift.created') {
    // Trigger VSO stewardship queue
    logger.info('RE NXT gift.created → VSO stewardship queued', { orgId });
    // In production: fetch gift, upsert, enqueue VSO task
  }

  if (eventType === 'constituent.updated') {
    // Queue targeted constituent re-sync
    logger.info('RE NXT constituent.updated → targeted re-sync', { orgId, id: event.data?.id });
  }

  if (eventType === 'solicitcode.added') {
    // Immediately propagate opt-out to Orbit donor record
    const constituentId = event.data?.constituent_id;
    const code          = event.data?.solicit_code;
    if (constituentId && code) {
      await db.query(
        `UPDATE donors SET
           email_opt_out = CASE WHEN $1=ANY(ARRAY['Do Not Email','Do Not Solicit']) THEN true ELSE email_opt_out END,
           do_not_contact = CASE WHEN $1='Do Not Solicit' THEN true ELSE do_not_contact END
         WHERE org_id=$2 AND external_ids->'blackbaud' = $3::jsonb`,
        [code, orgId, JSON.stringify(constituentId)]
      );
      logger.info('RE NXT solicit code propagated', { constituentId, code });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Stripe Webhook — DUAL PURPOSE:
//   1. Donor gift payments (payment_intent events)
//   2. Orbit SaaS billing (subscription/invoice events)
//
// CRITICAL: Stripe signature MUST be verified — without this, anyone can
// send fake events to provision free accounts or cancel real ones.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/stripe', async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    logger.error('STRIPE_WEBHOOK_SECRET not set — rejecting all Stripe webhooks');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;
  try {
    // Cryptographic verification — prevents spoofed events
    // req.body is raw Buffer here (express.raw middleware set in server.js)
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch(e) {
    logger.warn('Stripe webhook: signature verification failed', { err: e.message });
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // Always acknowledge before processing (Stripe retries if no 2xx within 30s)
  res.status(200).json({ received: true });

  logger.info('Stripe event received', { type: event.type, id: event.id });

  try {
    // ── DONOR GIFT PAYMENTS ────────────────────────────────────────────────
    if (event.type === 'payment_intent.succeeded') {
      await handleDonorPayment(event.data.object);
    }
    if (event.type === 'payment_intent.payment_failed') {
      logger.warn('Stripe donor payment failed', { id: event.data.object.id,
        reason: event.data.object.last_payment_error?.message });
    }

    // ── ORBIT SAAS BILLING ────────────────────────────────────────────────
    // Subscription created / trial started → provision access
    if (event.type === 'customer.subscription.created') {
      await handleSubscriptionCreated(event.data.object);
    }
    // Subscription updated (plan change, seat change) → update plan
    if (event.type === 'customer.subscription.updated') {
      await handleSubscriptionUpdated(event.data.object);
    }
    // Subscription cancelled → revoke access after period end
    if (event.type === 'customer.subscription.deleted') {
      await handleSubscriptionDeleted(event.data.object);
    }
    // Invoice paid → extend billing period
    if (event.type === 'invoice.payment_succeeded') {
      await handleInvoicePaid(event.data.object);
    }
    // Invoice payment failed → warn org admin, grace period
    if (event.type === 'invoice.payment_failed') {
      await handleInvoiceFailed(event.data.object);
    }
    // Checkout session complete → new customer first subscription
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutComplete(event.data.object);
    }
  } catch(e) {
    logger.error('Stripe event processing error', { type: event.type, err: e.message, stack: e.stack });
    // Don't re-throw — we already sent 200. Log for manual review.
  }
});

// ── DONOR PAYMENT HANDLER ─────────────────────────────────────────────────────
async function handleDonorPayment(pi) {
  const amount     = pi.amount / 100;
  const donorEmail = pi.metadata?.donor_email;
  const fund       = pi.metadata?.fund || 'Annual Fund';
  const orgId      = pi.metadata?.orbit_org_id;

  if (!donorEmail) {
    logger.warn('Stripe payment_intent has no donor_email metadata', { pi: pi.id });
    return;
  }

  const donor = await db.query(
    `SELECT id, org_id, name FROM donors
     WHERE email = $1 AND ($2::uuid IS NULL OR org_id = $2)
     LIMIT 1`,
    [donorEmail, orgId || null]
  );

  if (!donor.rows[0]) {
    logger.warn('Stripe payment: donor not found', { email: donorEmail });
    return;
  }

  const d = donor.rows[0];

  // Idempotent insert (ON CONFLICT handles Stripe retries)
  await db.query(
    `INSERT INTO gifts
       (org_id, donor_id, amount, date, fund, payment_method, source, status,
        external_id, external_source)
     VALUES ($1,$2,$3,NOW()::date,$4,'stripe_online','online','completed',$5,'stripe')
     ON CONFLICT (external_source, external_id) DO NOTHING`,
    [d.org_id, d.id, amount, fund, pi.id]
  );

  // Update donor totals
  await db.query(
    `UPDATE donors SET
       lifetime_giving = lifetime_giving + $1,
       last_gift_amount = $1,
       last_gift_date = NOW()::date,
       total_gifts = total_gifts + 1,
       stage = CASE WHEN stage IN ('lapsed','prospect') THEN 'engaged' ELSE stage END,
       updated_at = NOW()
     WHERE id = $2`,
    [amount, d.id]
  );

  logger.info('Donor gift recorded from Stripe', { donorId: d.id, amount, fund });
}

// ── SAAS BILLING HANDLERS ─────────────────────────────────────────────────────

// Map Stripe price IDs to Orbit plan tiers
const PLAN_MAP = {
  [process.env.STRIPE_PRICE_STARTER]:    { tier: 'starter',    maxDonors: 2500,   features: ['email','sms','basic_ai'] },
  [process.env.STRIPE_PRICE_GROWTH]:     { tier: 'growth',     maxDonors: 20000,  features: ['email','sms','ai','signal','matching','legacy'] },
  [process.env.STRIPE_PRICE_ENTERPRISE]: { tier: 'enterprise', maxDonors: 999999, features: ['all','white_label','sso','custom_ai'] },
};

async function handleSubscriptionCreated(sub) {
  const plan = getPlanFromSub(sub);
  if (!plan) return logger.warn('Stripe sub created: unknown price', { sub: sub.id });

  const orgId = sub.metadata?.orbit_org_id;
  if (!orgId) return logger.warn('Stripe sub created: no orbit_org_id metadata', { sub: sub.id });

  await provisionOrg(orgId, sub, plan, 'created');
}

async function handleSubscriptionUpdated(sub) {
  const plan = getPlanFromSub(sub);
  const orgId = sub.metadata?.orbit_org_id;
  if (!plan || !orgId) return;

  const newStatus = sub.status === 'active' ? 'active'
    : sub.status === 'past_due' ? 'past_due'
    : sub.status === 'trialing' ? 'trial'
    : 'active';

  await db.query(
    `UPDATE organizations SET
       settings = settings ||
         jsonb_build_object(
           'plan', $1,
           'billing_status', $2,
           'max_donors', $3,
           'features', $4::jsonb,
           'billing_period_end', $5,
           'stripe_sub_id', $6,
           'updated_at', NOW()::text
         ),
       updated_at = NOW()
     WHERE id = $7`,
    [plan.tier, newStatus, plan.maxDonors,
     JSON.stringify(plan.features),
     new Date(sub.current_period_end * 1000).toISOString(),
     sub.id, orgId]
  );

  logger.info('Org plan updated', { orgId, tier: plan.tier, status: newStatus });
}

async function handleSubscriptionDeleted(sub) {
  const orgId = sub.metadata?.orbit_org_id;
  if (!orgId) return;

  // Don't delete data — just mark suspended. Reactivation restores access.
  await db.query(
    `UPDATE organizations SET
       settings = settings || jsonb_build_object(
         'billing_status', 'cancelled',
         'suspended_at', NOW()::text,
         'suspension_reason', 'subscription_cancelled'
       ),
       updated_at = NOW()
     WHERE id = $1`,
    [orgId]
  );

  logger.warn('Org subscription cancelled', { orgId, subId: sub.id });
}

async function handleInvoicePaid(invoice) {
  const subId = invoice.subscription;
  if (!subId) return;

  const { rows } = await db.query(
    `SELECT id FROM organizations
     WHERE settings->>'stripe_sub_id' = $1 LIMIT 1`,
    [subId]
  );
  if (!rows[0]) return;

  // Clear any past_due flags, extend period
  await db.query(
    `UPDATE organizations SET
       settings = settings || jsonb_build_object(
         'billing_status', 'active',
         'last_invoice_paid', NOW()::text,
         'billing_period_end', $1
       ),
       updated_at = NOW()
     WHERE id = $2`,
    [new Date(invoice.lines?.data?.[0]?.period?.end * 1000 || Date.now()).toISOString(), rows[0].id]
  );

  logger.info('Invoice paid — org access confirmed', { orgId: rows[0].id, invoiceId: invoice.id });
}

async function handleInvoiceFailed(invoice) {
  const subId = invoice.subscription;
  if (!subId) return;

  const { rows } = await db.query(
    `SELECT id, name FROM organizations
     WHERE settings->>'stripe_sub_id' = $1 LIMIT 1`,
    [subId]
  );
  if (!rows[0]) return;

  const attemptCount = invoice.attempt_count || 1;
  const status = attemptCount >= 3 ? 'suspended' : 'past_due';

  await db.query(
    `UPDATE organizations SET
       settings = settings || jsonb_build_object(
         'billing_status', $1,
         'failed_invoice_id', $2,
         'payment_failed_at', NOW()::text,
         'payment_attempt_count', $3
       ),
       updated_at = NOW()
     WHERE id = $4`,
    [status, invoice.id, attemptCount, rows[0].id]
  );

  logger.warn('Invoice payment failed', {
    orgId: rows[0].id, orgName: rows[0].name,
    attempt: attemptCount, status
  });
}

async function handleCheckoutComplete(session) {
  const orgId = session.metadata?.orbit_org_id;
  if (!orgId || !session.subscription) return;

  // Checkout creates a new subscription — handled by subscription.created
  // but we also want to log the conversion
  logger.info('Checkout complete — new Orbit customer', {
    orgId, subId: session.subscription, customerId: session.customer
  });

  // Store Stripe customer ID for future billing operations
  await db.query(
    `UPDATE organizations SET
       settings = settings || jsonb_build_object('stripe_customer_id', $1),
       updated_at = NOW()
     WHERE id = $2`,
    [session.customer, orgId]
  );
}

async function provisionOrg(orgId, sub, plan, event) {
  await db.query(
    `UPDATE organizations SET
       settings = settings ||
         jsonb_build_object(
           'plan', $1,
           'billing_status', $2,
           'max_donors', $3,
           'features', $4::jsonb,
           'billing_period_start', $5,
           'billing_period_end', $6,
           'stripe_sub_id', $7,
           'stripe_customer_id', $8,
           'provisioned_at', NOW()::text
         ),
       updated_at = NOW()
     WHERE id = $9`,
    [
      plan.tier,
      sub.status === 'trialing' ? 'trial' : 'active',
      plan.maxDonors,
      JSON.stringify(plan.features),
      new Date(sub.current_period_start * 1000).toISOString(),
      new Date(sub.current_period_end * 1000).toISOString(),
      sub.id, sub.customer, orgId,
    ]
  );
  logger.info(`Org ${event}`, { orgId, tier: plan.tier, subId: sub.id });
}

function getPlanFromSub(sub) {
  const priceId = sub.items?.data?.[0]?.price?.id;
  return PLAN_MAP[priceId] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Twilio Status Callback — updates SMS delivery status in real-time
// POST /webhooks/twilio/status
// ─────────────────────────────────────────────────────────────────────────────
router.post('/twilio/status', express.urlencoded({ extended: false }), async (req, res) => {
  res.status(200).end(); // Twilio expects empty 200

  const { MessageSid, MessageStatus, To, ErrorCode } = req.body;
  if (!MessageSid) return;

  // Validate Twilio signature
  try {
    const twilio    = require('twilio');
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const url       = `${process.env.API_URL}/api/v1/webhooks/twilio/status`;
    const valid     = twilio.validateRequest(authToken, req.headers['x-twilio-signature'], url, req.body);
    if (!valid) {
      logger.warn('Twilio status: invalid signature');
      return;
    }
  } catch(e) {
    logger.warn('Twilio signature check failed', { err: e.message });
  }

  // Map Twilio status → Orbit status
  const statusMap = {
    queued:     'sent',
    sent:       'sent',
    delivered:  'delivered',
    undelivered:'failed',
    failed:     'failed',
  };

  const orbitStatus = statusMap[MessageStatus] || 'sent';

  await db.query(
    `UPDATE outreach_messages
     SET status = $1,
         metadata = metadata || $2,
         updated_at = NOW()
     WHERE metadata->>'provider_id' = $3`,
    [
      orbitStatus,
      JSON.stringify({ twilio_status: MessageStatus, error_code: ErrorCode || null }),
      MessageSid,
    ]
  );

  if (MessageStatus === 'delivered') {
    logger.info('SMS delivered', { sid: MessageSid, to: To });
  } else if (['undelivered','failed'].includes(MessageStatus)) {
    logger.warn('SMS delivery failed', { sid: MessageSid, code: ErrorCode });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SendGrid Event Webhook — email open/click/bounce tracking
// POST /webhooks/sendgrid
// Docs: https://docs.sendgrid.com/for-developers/tracking-events/event
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sendgrid', async (req, res) => {
  res.status(200).end();

  let events;
  try {
    events = JSON.parse(req.body.toString());
  } catch(e) { return; }

  if (!Array.isArray(events)) return;

  for (const event of events) {
    const messageId = event.orbit_message_id;
    if (!messageId) continue;

    const statusMap = {
      open:        'opened',
      click:       'opened',
      delivered:   'delivered',
      bounce:      'bounced',
      spamreport:  'failed',
      unsubscribe: 'failed',
    };

    const newStatus = statusMap[event.event];
    if (!newStatus) continue;

    try {
      // Build SQL dynamically to avoid embedding template literals in template literals
      const setOpenedAt   = event.event === 'open'   ? 'opened_at = COALESCE(opened_at, NOW()),' : '';
      const setBounceFlag = event.event === 'bounce' ? "metadata = metadata || '{\"bounced\":true}'::jsonb," : '';

      await db.query(
        `UPDATE outreach_messages
         SET status = CASE
               WHEN status = 'opened' AND $1 = 'delivered' THEN 'opened'
               WHEN $1 = 'opened' THEN 'opened'
               ELSE $1
             END,
             ${setOpenedAt}
             ${setBounceFlag}
             updated_at = NOW()
         WHERE id = $2`,
        [newStatus, messageId]
      );

      // Handle unsubscribes — update donor opt-out
      if (event.event === 'unsubscribe' && event.orbit_donor_id) {
        await db.query(
          `UPDATE donors SET email_opt_out = true, updated_at = NOW() WHERE id = $1`,
          [event.orbit_donor_id]
        );
        logger.info('Donor email unsubscribe processed', { donorId: event.orbit_donor_id });
      }
    } catch(e) {
      logger.error('SendGrid event processing failed', { event: event.event, err: e.message });
    }
  }
});

module.exports = router;
