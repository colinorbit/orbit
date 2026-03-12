'use strict';
/**
 * Orbit — Billing Routes
 * POST /api/v1/billing/checkout      → create Stripe Checkout Session
 * POST /api/v1/billing/portal        → Stripe Customer Portal (manage/cancel)
 * GET  /api/v1/billing/subscription  → current subscription status
 * GET  /api/v1/billing/invoices      → past invoices
 * POST /api/v1/billing/cancel        → cancel at period end
 */

const express  = require('express');
const router   = express.Router();
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');
const logger   = require('../utils/logger');

// All billing routes require auth
router.use(authenticate);

// ─── Plan Definitions ──────────────────────────────────────────────────────────
const PLANS = {
  starter: {
    name:       'Starter',
    priceId:    process.env.STRIPE_PRICE_STARTER,    // Set in .env
    amount:     12000,  // $12,000/yr in cents × 100
    interval:   'year',
    features:   ['VEO', 'VSO', 'Up to 2,500 donors', 'Email + SMS outreach'],
  },
  growth: {
    name:       'Growth',
    priceId:    process.env.STRIPE_PRICE_GROWTH,
    amount:     36000,
    interval:   'year',
    features:   ['VEO', 'VSO', 'VCO', 'Up to 15,000 donors', 'All outreach channels', 'Matching gifts'],
  },
  enterprise: {
    name:       'Enterprise',
    priceId:    process.env.STRIPE_PRICE_ENTERPRISE,
    amount:     72000,
    interval:   'year',
    features:   ['All 4 agents', 'VPGO planned giving', 'Unlimited donors', 'Dedicated CSM', 'SLA 99.9%'],
  },
};

// ─── Helper: get or create Stripe customer for org ────────────────────────────
async function getOrCreateStripeCustomer(org) {
  if (org.stripe_customer_id) return org.stripe_customer_id;

  const customer = await stripe.customers.create({
    name:     org.name,
    email:    org.billing_email,
    metadata: { org_id: org.id, plan: org.plan },
  });

  await pool.query(
    'UPDATE orgs SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2',
    [customer.id, org.id]
  );

  logger.info({ org_id: org.id, customer_id: customer.id }, 'Stripe customer created');
  return customer.id;
}

// ─── POST /checkout ───────────────────────────────────────────────────────────
// Creates a Stripe Checkout Session for plan subscription
router.post('/checkout', async (req, res) => {
  const { plan, successUrl, cancelUrl } = req.body;

  if (!PLANS[plan]) {
    return res.status(400).json({ error: 'InvalidPlan', validPlans: Object.keys(PLANS) });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'BillingNotConfigured', message: 'Stripe is not configured on this server.' });
  }

  try {
    // Load org from DB
    const { rows } = await pool.query(
      'SELECT id, name, billing_email, plan, stripe_customer_id FROM orgs WHERE id = $1',
      [req.user.org_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'OrgNotFound' });
    const org = rows[0];

    const customerId = await getOrCreateStripeCustomer(org);
    const planDef    = PLANS[plan];

    const session = await stripe.checkout.sessions.create({
      customer:    customerId,
      mode:        'subscription',
      line_items:  [{ price: planDef.priceId, quantity: 1 }],
      success_url: successUrl || `${process.env.FRONTEND_URL}/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  cancelUrl  || `${process.env.FRONTEND_URL}/billing?cancelled=true`,
      subscription_data: {
        metadata: { org_id: org.id, plan },
      },
      metadata: { org_id: org.id, plan },
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      // Annual invoices — paid upfront
      payment_method_types: ['card', 'us_bank_account'],
    });

    logger.info({ org_id: org.id, plan, session_id: session.id }, 'Checkout session created');
    res.json({ sessionId: session.id, url: session.url });

  } catch (err) {
    logger.error({ err, org_id: req.user.org_id }, 'Checkout session creation failed');
    res.status(500).json({ error: 'CheckoutFailed', message: err.message });
  }
});

// ─── POST /portal ─────────────────────────────────────────────────────────────
// Redirects to Stripe Customer Portal (manage billing, cancel, update payment)
router.post('/portal', async (req, res) => {
  const { returnUrl } = req.body;

  try {
    const { rows } = await pool.query(
      'SELECT stripe_customer_id FROM orgs WHERE id = $1',
      [req.user.org_id]
    );
    if (!rows.length || !rows[0].stripe_customer_id) {
      return res.status(404).json({ error: 'NoStripeCustomer', message: 'No billing account found. Complete a checkout first.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer:   rows[0].stripe_customer_id,
      return_url: returnUrl || `${process.env.FRONTEND_URL}/billing`,
    });

    res.json({ url: session.url });

  } catch (err) {
    logger.error({ err, org_id: req.user.org_id }, 'Billing portal session failed');
    res.status(500).json({ error: 'PortalFailed', message: err.message });
  }
});

// ─── GET /subscription ────────────────────────────────────────────────────────
// Returns current subscription state for the dashboard billing page
router.get('/subscription', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.name, o.plan, o.billing_status, o.stripe_customer_id,
              o.trial_ends_at, o.created_at,
              (SELECT SUM(amount) FROM gifts WHERE org_id = o.id AND status = 'confirmed') as total_raised
       FROM orgs o WHERE o.id = $1`,
      [req.user.org_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'OrgNotFound' });
    const org = rows[0];

    let stripeData = null;
    if (org.stripe_customer_id && process.env.STRIPE_SECRET_KEY) {
      try {
        const subs = await stripe.subscriptions.list({
          customer: org.stripe_customer_id,
          status:   'all',
          limit:    1,
          expand:   ['data.default_payment_method'],
        });
        if (subs.data.length) {
          const sub = subs.data[0];
          stripeData = {
            subscriptionId: sub.id,
            status:         sub.status,
            currentPeriodEnd:   new Date(sub.current_period_end   * 1000).toISOString(),
            currentPeriodStart: new Date(sub.current_period_start * 1000).toISOString(),
            cancelAtPeriodEnd:  sub.cancel_at_period_end,
            amount:   sub.items.data[0]?.price?.unit_amount,
            interval: sub.items.data[0]?.price?.recurring?.interval,
            paymentMethod: sub.default_payment_method ? {
              brand: sub.default_payment_method.card?.brand,
              last4: sub.default_payment_method.card?.last4,
              expMonth: sub.default_payment_method.card?.exp_month,
              expYear:  sub.default_payment_method.card?.exp_year,
            } : null,
          };
        }
      } catch (stripeErr) {
        logger.warn({ stripeErr }, 'Could not fetch Stripe subscription — returning DB data only');
      }
    }

    res.json({
      org: {
        id:            org.id,
        name:          org.name,
        plan:          org.plan,
        billingStatus: org.billing_status,
        trialEndsAt:   org.trial_ends_at,
        createdAt:     org.created_at,
        totalRaised:   parseInt(org.total_raised || 0),
      },
      planDetails: PLANS[org.plan] || null,
      subscription: stripeData,
    });

  } catch (err) {
    logger.error({ err, org_id: req.user.org_id }, 'Get subscription failed');
    res.status(500).json({ error: 'SubscriptionFetchFailed' });
  }
});

// ─── GET /invoices ────────────────────────────────────────────────────────────
router.get('/invoices', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT stripe_customer_id FROM orgs WHERE id = $1',
      [req.user.org_id]
    );
    if (!rows.length || !rows[0].stripe_customer_id || !process.env.STRIPE_SECRET_KEY) {
      return res.json({ invoices: [] });
    }

    const invoices = await stripe.invoices.list({
      customer: rows[0].stripe_customer_id,
      limit:    24,
    });

    res.json({
      invoices: invoices.data.map(inv => ({
        id:          inv.id,
        number:      inv.number,
        status:      inv.status,
        amount:      inv.amount_paid,
        currency:    inv.currency,
        created:     new Date(inv.created * 1000).toISOString(),
        periodStart: new Date(inv.period_start * 1000).toISOString(),
        periodEnd:   new Date(inv.period_end   * 1000).toISOString(),
        pdfUrl:      inv.invoice_pdf,
        hostedUrl:   inv.hosted_invoice_url,
        description: inv.lines?.data?.[0]?.description || '',
      })),
    });

  } catch (err) {
    logger.error({ err }, 'Get invoices failed');
    res.status(500).json({ error: 'InvoiceFetchFailed' });
  }
});

// ─── POST /cancel ─────────────────────────────────────────────────────────────
// Cancel subscription at end of billing period
router.post('/cancel', async (req, res) => {
  const { reason } = req.body;

  try {
    const { rows } = await pool.query(
      'SELECT stripe_customer_id, plan FROM orgs WHERE id = $1',
      [req.user.org_id]
    );
    if (!rows.length || !rows[0].stripe_customer_id) {
      return res.status(404).json({ error: 'NoStripeCustomer' });
    }

    const subs = await stripe.subscriptions.list({
      customer: rows[0].stripe_customer_id,
      status:   'active',
      limit:    1,
    });

    if (!subs.data.length) {
      return res.status(404).json({ error: 'NoActiveSubscription' });
    }

    // Cancel at period end (not immediately — give them time to reconsider)
    const updated = await stripe.subscriptions.update(subs.data[0].id, {
      cancel_at_period_end: true,
      metadata:             { cancellation_reason: reason || 'Not provided' },
    });

    // Log to audit table
    await pool.query(
      `INSERT INTO audit_log (org_id, actor_id, action, resource, resource_id, detail, created_at)
       VALUES ($1, $2, 'billing.cancel_requested', 'subscription', $3, $4, NOW())`,
      [req.user.org_id, req.user.id, updated.id, JSON.stringify({ reason, cancelAt: updated.cancel_at })]
    );

    logger.info({ org_id: req.user.org_id, sub_id: updated.id, reason }, 'Subscription cancellation scheduled');
    res.json({
      message:   'Subscription will cancel at end of billing period.',
      cancelAt:  new Date(updated.current_period_end * 1000).toISOString(),
    });

  } catch (err) {
    logger.error({ err }, 'Cancel subscription failed');
    res.status(500).json({ error: 'CancelFailed', message: err.message });
  }
});

module.exports = router;
