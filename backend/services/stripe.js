/**
 * services/stripe.js
 *
 * Stripe Payments + Subscriptions
 * Docs: https://stripe.com/docs/api  |  https://docs.stripe.com/webhooks
 *
 * Key patterns from docs research:
 * - Amount is ALWAYS in cents (integer) — multiply dollars × 100
 * - Webhook route MUST use express.raw() BEFORE express.json() in server
 * - Verify with stripe.webhooks.constructEvent(rawBody, sig, secret) — throws on invalid
 * - Return 200 quickly; do work async. Stripe retries on non-2xx for up to 72h
 * - Use idempotencyKey on creates to safely retry without duplicates
 * - setup_future_usage: 'off_session' saves card for recurring pledge charges
 */
'use strict';
const Stripe = require('stripe');
const logger = require('../config/logger');
const { Gift, Org, Installment } = require('../models');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20',
  maxNetworkRetries: 3,
  timeout: 10000,
});

// ── Customer helpers ──────────────────────────────────────────────────────────

async function getOrCreateCustomer(donor) {
  const cachedId = donor.customFields?.stripeCustomerId;
  if (cachedId) return cachedId;

  // Search first to avoid duplicates
  const existing = await stripe.customers.search({
    query: `metadata['donorId']:'${donor.id}'`,
  });
  if (existing.data.length) {
    const id = existing.data[0].id;
    await donor.update({ customFields: { ...donor.customFields, stripeCustomerId: id } });
    return id;
  }

  const customer = await stripe.customers.create({
    email: donor.email,
    name:  `${donor.firstName} ${donor.lastName}`,
    phone: donor.phone,
    metadata: { donorId: donor.id, orgId: donor.orgId },
  });
  await donor.update({ customFields: { ...donor.customFields, stripeCustomerId: customer.id } });
  return customer.id;
}

// ── One-time gift payment intent ──────────────────────────────────────────────
async function createPaymentIntent({ donor, amountDollars, giftId, description }) {
  const customerId = await getOrCreateCustomer(donor);
  const pi = await stripe.paymentIntents.create({
    amount:   Math.round(amountDollars * 100),
    currency: 'usd',
    customer: customerId,
    description: description || `Gift — ${donor.firstName} ${donor.lastName}`,
    setup_future_usage: 'off_session',
    automatic_payment_methods: { enabled: true },
    metadata: { giftId, donorId: donor.id, orgId: donor.orgId },
  }, { idempotencyKey: `gift_${giftId}_pi` });

  logger.info(`Stripe PI created: ${pi.id} for gift ${giftId}`);
  return { clientSecret: pi.client_secret, paymentIntentId: pi.id };
}

// ── Pledge subscription ────────────────────────────────────────────────────────
async function createPledgeSubscription({ donor, installmentAmount, freq, giftId, startDate, installments }) {
  const customerId = await getOrCreateCustomer(donor);
  const freqMap = {
    monthly:   { interval: 'month', interval_count: 1 },
    quarterly: { interval: 'month', interval_count: 3 },
    annually:  { interval: 'year',  interval_count: 1 },
  };
  const recurring = freqMap[freq] || freqMap.annually;

  const price = await stripe.prices.create({
    currency: 'usd',
    unit_amount: Math.round(installmentAmount * 100),
    recurring,
    product_data: { name: `Pledge — ${donor.firstName} ${donor.lastName}`, metadata: { giftId } },
  });

  const params = {
    customer: customerId,
    items: [{ price: price.id }],
    payment_behavior: 'default_incomplete',
    expand: ['latest_invoice.payment_intent'],
    metadata: { giftId, donorId: donor.id, orgId: donor.orgId, type: 'pledge' },
  };
  if (startDate) params.billing_cycle_anchor = Math.floor(new Date(startDate).getTime() / 1000);
  if (installments > 0) {
    const msPerInstall = recurring.interval === 'year' ? 365*86400*1000 : recurring.interval_count*30*86400*1000;
    params.cancel_at = Math.floor((new Date(startDate || Date.now()).getTime() + installments * msPerInstall) / 1000);
  }

  const sub = await stripe.subscriptions.create(params, { idempotencyKey: `pledge_${giftId}_sub` });
  return { subscriptionId: sub.id, clientSecret: sub.latest_invoice?.payment_intent?.client_secret };
}

// ── Org platform subscription (Orbit plans) ────────────────────────────────────
async function createOrgSubscription({ org, priceId, trialDays = 14 }) {
  let customerId = org.stripeCustomerId;
  if (!customerId) {
    const c = await stripe.customers.create({ name: org.name, metadata: { orgId: org.id } });
    customerId = c.id;
    await org.update({ stripeCustomerId: customerId });
  }
  const sub = await stripe.subscriptions.create({
    customer: customerId, items: [{ price: priceId }],
    trial_period_days: trialDays,
    payment_behavior: 'default_incomplete',
    expand: ['latest_invoice.payment_intent'],
    metadata: { orgId: org.id },
  }, { idempotencyKey: `org_${org.id}_${priceId}` });

  return {
    subscriptionId: sub.id,
    status:         sub.status,
    trialEnd:       sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    clientSecret:   sub.latest_invoice?.payment_intent?.client_secret,
  };
}

// ── Webhook verification + routing ────────────────────────────────────────────
function constructEvent(rawBody, sig) {
  return stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
}

async function handleEvent(event) {
  logger.info(`Stripe event: ${event.type} [${event.id}]`);

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      const { giftId } = pi.metadata;
      if (giftId) await Gift.update({ status: 'received', receivedAt: new Date(), stripePaymentIntentId: pi.id }, { where: { id: giftId } });
      break;
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      if (pi.metadata.giftId) await Gift.update({ status: 'failed' }, { where: { id: pi.metadata.giftId } });
      break;
    }
    case 'invoice.payment_succeeded': {
      const inv = event.data.object;
      const { giftId } = inv.subscription_details?.metadata || {};
      if (giftId) {
        await Installment.update(
          { status: 'received', receivedAt: new Date(), stripePaymentIntentId: inv.payment_intent },
          { where: { giftId, status: ['upcoming','reminded'] }, order: [['num','ASC']], limit: 1 }
        );
      }
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      if (sub.metadata.orgId) await Org.update({ subscriptionStatus: sub.status, stripeSubscriptionId: sub.id }, { where: { id: sub.metadata.orgId } });
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      if (sub.metadata.orgId) await Org.update({ subscriptionStatus: 'canceled' }, { where: { id: sub.metadata.orgId } });
      break;
    }
    default:
      logger.debug(`Unhandled Stripe event: ${event.type}`);
  }
}

module.exports = { stripe, getOrCreateCustomer, createPaymentIntent, createPledgeSubscription, createOrgSubscription, constructEvent, handleEvent };
