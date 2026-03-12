/**
 * Stripe Payment Service
 *
 * Integration notes from docs:
 *  • Base URL: https://api.stripe.com/v1
 *  • Auth: Bearer token (STRIPE_SECRET_KEY)
 *  • Nonprofit rate: 2.2% + $0.30 (must be verified at dashboard.stripe.com)
 *  • For pledge instalments → Stripe Subscriptions with billing_cycle_anchor
 *  • For one-time gifts      → PaymentIntents
 *  • Stripe Customer Portal  → donors can update cards, view history
 *  • Webhook signature verification via stripe.webhooks.constructEvent()
 *
 * Key webhook events we listen to (registered via Stripe Dashboard > Webhooks):
 *  payment_intent.succeeded          → record confirmed gift
 *  payment_intent.payment_failed     → alert donor, retry
 *  invoice.paid                      → pledge instalment fulfilled
 *  invoice.payment_failed            → pledge instalment failed → send reminder
 *  customer.subscription.deleted     → pledge cancelled → update pledge status
 *  charge.dispute.created            → flag for manual review
 */

import Stripe from 'stripe';
import { logger } from '../config/logger';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
  apiVersion: '2024-06-20',
  typescript:  true,
});

// ─── Customer management ─────────────────────────────────────────

export async function getOrCreateCustomer(donor: {
  id:        string;
  email:     string;
  firstName: string;
  lastName:  string;
  orgId:     string;
}): Promise<string> {
  // Look up existing customer by metadata donor ID
  const existing = await stripe.customers.search({
    query: `metadata['donor_id']:'${donor.id}'`,
    limit: 1,
  });

  if (existing.data.length > 0) return existing.data[0].id;

  const customer = await stripe.customers.create({
    email: donor.email,
    name:  `${donor.firstName} ${donor.lastName}`,
    metadata: {
      donor_id: donor.id,
      org_id:   donor.orgId,
    },
  });

  logger.debug(`[Stripe] Created customer ${customer.id} for donor ${donor.id}`);
  return customer.id;
}

// ─── One-time gifts ──────────────────────────────────────────────

interface OneTimeGiftOptions {
  customerId: string;
  amountCents: number;
  currency?:   string;
  donorId:     string;
  orgId:       string;
  fundName:    string;
  description: string;
}

/**
 * Create a PaymentIntent for a one-time gift.
 * Returns client_secret to send to the frontend for Stripe Elements.
 */
export async function createPaymentIntent(opts: OneTimeGiftOptions): Promise<{
  clientSecret: string;
  paymentIntentId: string;
}> {
  const pi = await stripe.paymentIntents.create({
    amount:   opts.amountCents,
    currency: opts.currency ?? 'usd',
    customer: opts.customerId,
    description: opts.description,
    metadata: {
      donor_id:  opts.donorId,
      org_id:    opts.orgId,
      fund_name: opts.fundName,
      gift_type: 'one_time',
    },
    // Save payment method for future pledge instalments
    setup_future_usage: 'off_session',
    // Automatic payment methods (cards, ACH, etc.)
    automatic_payment_methods: { enabled: true },
  });

  return { clientSecret: pi.client_secret!, paymentIntentId: pi.id };
}

// ─── Pledge / Recurring instalments ─────────────────────────────

interface PledgeOptions {
  customerId:       string;
  paymentMethodId:  string;   // from Stripe Elements on frontend
  installmentCents: number;
  frequency:        'monthly' | 'quarterly' | 'annually';
  startDate:        Date;
  donorId:          string;
  orgId:            string;
  fundName:         string;
  pledgeId:         string;
}

/**
 * Create a Stripe Subscription to handle recurring pledge instalments.
 * We create a Price on-the-fly tied to a reusable Product per org.
 */
export async function createPledgeSubscription(opts: PledgeOptions): Promise<string> {
  // Map frequency to Stripe interval
  const intervalMap = {
    monthly:   { interval: 'month' as const, interval_count: 1 },
    quarterly: { interval: 'month' as const, interval_count: 3 },
    annually:  { interval: 'year'  as const, interval_count: 1 },
  };
  const { interval, interval_count } = intervalMap[opts.frequency];

  // Create a price for this specific instalment
  const price = await stripe.prices.create({
    unit_amount: opts.installmentCents,
    currency:    'usd',
    recurring:   { interval, interval_count },
    product_data: {
      name: `Pledge to ${opts.fundName}`,
    },
  });

  const subscription = await stripe.subscriptions.create({
    customer:        opts.customerId,
    default_payment_method: opts.paymentMethodId,
    items:           [{ price: price.id }],
    billing_cycle_anchor: Math.floor(opts.startDate.getTime() / 1000),
    proration_behavior: 'none',
    metadata: {
      donor_id:  opts.donorId,
      org_id:    opts.orgId,
      fund_name: opts.fundName,
      pledge_id: opts.pledgeId,
      gift_type: 'pledge',
    },
  });

  logger.info(`[Stripe] Subscription ${subscription.id} created for pledge ${opts.pledgeId}`);
  return subscription.id;
}

// ─── Customer Portal (donor self-service) ────────────────────────

/**
 * Generate a Stripe Customer Portal session link.
 * Donors use this to update payment methods, view history, cancel.
 */
export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer:   customerId,
    return_url: returnUrl,
  });
  return session.url;
}

// ─── Webhook verification ────────────────────────────────────────

/**
 * Verify Stripe webhook signature and parse event.
 * MUST be called with raw (unparsed) request body.
 *
 * @param rawBody   Buffer or string from req.rawBody
 * @param signature Stripe-Signature header value
 */
export function constructWebhookEvent(rawBody: Buffer | string, signature: string): Stripe.Event {
  return stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );
}
