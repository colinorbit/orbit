/**
 * Webhook Routes
 *
 * IMPORTANT: This router is mounted BEFORE express.json() so bodies remain raw.
 * Each provider signs its webhooks differently:
 *   Stripe:   Stripe-Signature header + stripe.webhooks.constructEvent()
 *   Twilio:   X-Twilio-Signature header + twilio.validateRequest()
 *   DocuSign: HMAC-SHA256 in X-DocuSign-Signature-1 header (Connect listener)
 *   SendGrid: Basic signature in X-Twilio-Email-Event-Webhook-Signature header
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'crypto';
import { constructWebhookEvent } from '../services/stripeService';
import { validateTwilioSignature } from '../services/smsService';
import { logger } from '../config/logger';
import { getDB } from '../config/database';
import Queue from 'bull';
import { getRedis } from '../config/redis';

const router = express.Router();

// ─── Raw body capture middleware ─────────────────────────────────
// Must come before any body parsers for these routes
const rawBody = express.raw({ type: '*/*', limit: '5mb' });

// ─── Stripe Webhook ──────────────────────────────────────────────
router.post('/stripe', rawBody, async (req: Request, res: Response, next: NextFunction) => {
  const sig = req.headers['stripe-signature'] as string;
  if (!sig) { res.status(400).send('Missing Stripe-Signature'); return; }

  let event;
  try {
    event = constructWebhookEvent(req.body as Buffer, sig);
  } catch (err) {
    logger.warn('[Webhook/Stripe] Signature verification failed', err);
    res.status(400).send('Webhook signature verification failed');
    return;
  }

  const db = getDB();

  try {
    switch (event.type) {

      case 'payment_intent.succeeded': {
        const pi = event.data.object as { id: string; amount: number; metadata: Record<string,string>; customer: string };
        await db('payments').insert({
          stripe_payment_intent_id: pi.id,
          donor_id:    pi.metadata.donor_id,
          org_id:      pi.metadata.org_id,
          amount_cents: pi.amount,
          status:      'succeeded',
          stripe_customer_id: pi.customer,
          paid_at:     new Date(),
        }).onConflict('stripe_payment_intent_id').ignore();

        // Trigger gift confirmation flow (DocuSign + Salesforce sync)
        const giftQueue = new Queue('gifts', { redis: { host: 'localhost', port: 6379 } });
        await giftQueue.add('confirm', { paymentIntentId: pi.id, donorId: pi.metadata.donor_id });
        logger.info(`[Webhook/Stripe] payment_intent.succeeded: ${pi.id}`);
        break;
      }

      case 'invoice.paid': {
        const inv = event.data.object as { id: string; subscription: string; amount_paid: number; metadata: Record<string,string>; customer: string };
        // Mark pledge instalment as paid
        await db('pledge_installments')
          .where({ stripe_invoice_id: inv.id })
          .orWhere({ stripe_subscription_id: inv.subscription })
          .limit(1)
          .update({ status: 'paid', paid_at: new Date(), stripe_invoice_id: inv.id });
        logger.info(`[Webhook/Stripe] invoice.paid: ${inv.id}`);
        break;
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object as { id: string; subscription: string; metadata: Record<string,string> };
        await db('pledge_installments')
          .where({ stripe_subscription_id: inv.subscription })
          .andWhere({ status: 'pending' })
          .limit(1)
          .update({ status: 'failed', updated_at: new Date() });

        // Queue a pledge reminder outreach
        const outreachQueue = new Queue('outreach', { redis: { host: 'localhost', port: 6379 } });
        await outreachQueue.add('pledge_reminder', { subscriptionId: inv.subscription });
        logger.warn(`[Webhook/Stripe] invoice.payment_failed: ${inv.id}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as { id: string; metadata: Record<string,string> };
        await db('pledges')
          .where({ stripe_subscription_id: sub.id })
          .update({ status: 'cancelled', updated_at: new Date() });
        logger.info(`[Webhook/Stripe] subscription deleted: ${sub.id}`);
        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object as { id: string; charge: string };
        logger.warn(`[Webhook/Stripe] Dispute created: ${dispute.id} on charge ${dispute.charge}`);
        // Flag for manual review
        await db('audit_logs').insert({
          event_type: 'stripe_dispute',
          payload:    JSON.stringify(dispute),
          created_at: new Date(),
        });
        break;
      }

      default:
        logger.debug(`[Webhook/Stripe] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
});

// ─── Twilio SMS Inbound / Status Callbacks ───────────────────────

// Status callback (delivery receipts)
router.post('/twilio/status', express.urlencoded({ extended: false }), async (req: Request, res: Response) => {
  const sig = req.headers['x-twilio-signature'] as string;
  const url = `${process.env.API_URL}/api/webhooks/twilio/status`;

  if (!validateTwilioSignature(url, req.body as Record<string, string>, sig)) {
    res.status(403).send('Forbidden'); return;
  }

  const { MessageSid, MessageStatus } = req.body as Record<string, string>;
  logger.debug(`[Webhook/Twilio] ${MessageSid} → ${MessageStatus}`);

  await getDB()('touchpoints')
    .where({ twilio_message_sid: MessageSid })
    .update({ sms_status: MessageStatus, updated_at: new Date() });

  res.sendStatus(200);
});

// Inbound SMS — donor replies
router.post('/twilio/inbound', express.urlencoded({ extended: false }), async (req: Request, res: Response) => {
  const sig = req.headers['x-twilio-signature'] as string;
  const url = `${process.env.API_URL}/api/webhooks/twilio/inbound`;

  if (!validateTwilioSignature(url, req.body as Record<string, string>, sig)) {
    res.status(403).send('Forbidden'); return;
  }

  const body = req.body as Record<string, string>;
  const from = body.From;
  const text = body.Body?.trim();

  logger.info(`[Webhook/Twilio] Inbound SMS from ${from}: "${text}"`);

  // Look up donor by phone number
  const donor = await getDB()('donors').where({ phone: from }).first();
  if (!donor) {
    res.type('text/xml').send('<Response/>'); return;
  }

  // STOP keyword — honour opt-out immediately
  if (/^(stop|unsubscribe|quit|cancel|end)$/i.test(text)) {
    await getDB()('donors').where({ id: donor.id }).update({
      sms_opted_in: false,
      updated_at:   new Date(),
    });
    // Twilio Messaging Services handle STOP replies automatically
    // We just update our DB
    res.type('text/xml').send('<Response/>');
    return;
  }

  // Queue reply for agent processing
  const agentQueue = new Queue('agent-replies', { redis: { host: 'localhost', port: 6379 } });
  await agentQueue.add({ donorId: donor.id, channel: 'sms', message: text });

  res.type('text/xml').send('<Response/>');
});

// ─── DocuSign Connect (envelope status) ──────────────────────────
router.post('/docusign', rawBody, async (req: Request, res: Response) => {
  // Verify HMAC-SHA256 signature from DocuSign Connect
  const sig     = req.headers['x-docusign-signature-1'] as string;
  const secret  = process.env.DOCUSIGN_CONNECT_SECRET ?? '';
  const payload = (req.body as Buffer).toString('utf8');

  if (secret && sig) {
    const computed = crypto
      .createHmac('sha256', Buffer.from(secret, 'base64'))
      .update(payload)
      .digest('base64');
    if (computed !== sig) {
      res.status(403).send('Signature mismatch'); return;
    }
  }

  const data = JSON.parse(payload) as { envelopeId?: string; status?: string };
  const { envelopeId, status } = data;

  if (envelopeId && status) {
    await getDB()('gift_agreements')
      .where({ docusign_envelope_id: envelopeId })
      .update({ status, updated_at: new Date() });

    if (status === 'completed') {
      // Trigger Salesforce sync for the completed gift
      const giftQueue = new Queue('gifts', { redis: { host: 'localhost', port: 6379 } });
      await giftQueue.add('agreement_signed', { envelopeId });
    }

    logger.info(`[Webhook/DocuSign] Envelope ${envelopeId} → ${status}`);
  }

  res.sendStatus(200);
});

// ─── SendGrid Event Webhooks (email engagement tracking) ─────────
router.post('/sendgrid', rawBody, async (req: Request, res: Response) => {
  const events = JSON.parse((req.body as Buffer).toString('utf8')) as Array<{
    event:     string;
    email:     string;
    timestamp: number;
    sg_message_id?: string;
    'smtp-id'?: string;
  }>;

  for (const ev of events) {
    const touchpointId = ev['smtp-id'] ?? ev.sg_message_id;
    if (!touchpointId) continue;

    const updateMap: Record<string, unknown> = {};
    if (ev.event === 'open')        updateMap.email_opened_at   = new Date(ev.timestamp * 1000);
    if (ev.event === 'click')       updateMap.email_clicked_at  = new Date(ev.timestamp * 1000);
    if (ev.event === 'bounce')      updateMap.email_status      = 'bounced';
    if (ev.event === 'unsubscribe') updateMap.email_status      = 'unsubscribed';
    if (ev.event === 'spamreport')  updateMap.email_status      = 'spam';

    if (Object.keys(updateMap).length > 0) {
      await getDB()('touchpoints')
        .where({ sendgrid_message_id: touchpointId })
        .update({ ...updateMap, updated_at: new Date() });
    }
  }

  res.sendStatus(200);
});

export default router;
