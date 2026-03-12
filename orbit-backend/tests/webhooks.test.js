'use strict';
/**
 * Webhook Tests
 * Tests: Stripe billing (subscription created/cancelled/invoice),
 *        donor payment recording, signature verification,
 *        Twilio SMS status, SendGrid email tracking
 *
 * These are the highest-stakes tests — billing webhooks handle real money
 * and subscription provisioning.
 */

const request = require('supertest');
const crypto  = require('crypto');

jest.mock('../src/db', () => ({ query: jest.fn() }));
jest.mock('../src/jobs/index', () => ({ startJobs: jest.fn() }));

// Mock stripe to control constructEvent
jest.mock('stripe', () => {
  const mockStripe = jest.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: jest.fn(),
    },
  }));
  return mockStripe;
});

const db  = require('../src/db');
const app = require('../src/server');

const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001';
const STRIPE_SECRET = 'whsec_test_secret';

function makeStripeEvent(type, data) {
  return { id: `evt_test_${Date.now()}`, type, data: { object: data } };
}

// Helper: get the stripe instance used inside webhooks
function getStripeInstance() {
  const Stripe = require('stripe');
  return Stripe.mock.results[0]?.value;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/webhooks/stripe — Billing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_SECRET;
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.STRIPE_PRICE_GROWTH = 'price_growth_123';
  });

  test('rejects requests without STRIPE_WEBHOOK_SECRET configured', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const res = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({}));

    expect(res.status).toBe(500);
  });

  test('rejects requests with invalid signature', async () => {
    const Stripe = require('stripe');
    const stripeInstance = new Stripe();
    stripeInstance.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature');
    });
    Stripe.mockReturnValue(stripeInstance);

    const res = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('stripe-signature', 'bad_signature')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid signature/i);
  });

  test('provisions org on subscription.created', async () => {
    const event = makeStripeEvent('customer.subscription.created', {
      id:     'sub_test123',
      status: 'active',
      customer: 'cus_test123',
      metadata: { orbit_org_id: TEST_ORG_ID },
      items: { data: [{ price: { id: 'price_growth_123' } }] },
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 2592000,
    });

    const Stripe = require('stripe');
    const stripeInstance = new Stripe();
    stripeInstance.webhooks.constructEvent.mockReturnValue(event);
    Stripe.mockReturnValue(stripeInstance);

    db.query.mockResolvedValue({ rows: [], rowCount: 1 });

    const res = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('stripe-signature', 'valid_sig')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    // Wait for async processing
    await new Promise(r => setTimeout(r, 50));

    // Should call UPDATE organizations SET settings = ...
    const updateCalls = db.query.mock.calls.filter(c => c[0].includes('UPDATE organizations'));
    expect(updateCalls.length).toBeGreaterThan(0);
    // Verify plan tier and billing_status are set
    expect(updateCalls[0][1]).toContain('growth');
    expect(updateCalls[0][1]).toContain('active');
  });

  test('suspends org on subscription.deleted', async () => {
    const event = makeStripeEvent('customer.subscription.deleted', {
      id:       'sub_test123',
      status:   'canceled',
      metadata: { orbit_org_id: TEST_ORG_ID },
      items:    { data: [{ price: { id: 'price_growth_123' } }] },
    });

    const Stripe = require('stripe');
    const stripeInstance = new Stripe();
    stripeInstance.webhooks.constructEvent.mockReturnValue(event);
    Stripe.mockReturnValue(stripeInstance);

    db.query.mockResolvedValue({ rows: [], rowCount: 1 });

    const res = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('stripe-signature', 'valid_sig')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));

    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 50));

    const updateCalls = db.query.mock.calls.filter(c =>
      c[0].includes('UPDATE organizations') && c[1].some(v => v === 'cancelled')
    );
    expect(updateCalls.length).toBeGreaterThan(0);
  });

  test('records gift on payment_intent.succeeded', async () => {
    const event = makeStripeEvent('payment_intent.succeeded', {
      id:     'pi_test123',
      amount: 50000, // $500.00 in cents
      metadata: {
        donor_email: 'alice@test.com',
        fund: 'Scholarship Fund',
        orbit_org_id: TEST_ORG_ID,
      },
      status: 'succeeded',
    });

    const Stripe = require('stripe');
    const stripeInstance = new Stripe();
    stripeInstance.webhooks.constructEvent.mockReturnValue(event);
    Stripe.mockReturnValue(stripeInstance);

    // Mock: find donor, insert gift, update donor totals
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'donor-1', org_id: TEST_ORG_ID }] }) // find donor
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // insert gift
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // update donor totals

    const res = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('stripe-signature', 'valid_sig')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));

    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 50));

    // Verify gift insert was called with correct amount ($500, not 50000)
    const insertCalls = db.query.mock.calls.filter(c => c[0].includes('INSERT INTO gifts'));
    expect(insertCalls.length).toBeGreaterThan(0);
    expect(insertCalls[0][1]).toContain(500); // $500 not cents
    expect(insertCalls[0][1]).toContain('Scholarship Fund');
  });

  test('does not crash if donor not found in payment webhook', async () => {
    const event = makeStripeEvent('payment_intent.succeeded', {
      id:     'pi_unknown',
      amount: 10000,
      metadata: { donor_email: 'nobody@nowhere.com' },
    });

    const Stripe = require('stripe');
    const stripeInstance = new Stripe();
    stripeInstance.webhooks.constructEvent.mockReturnValue(event);
    Stripe.mockReturnValue(stripeInstance);

    db.query.mockResolvedValueOnce({ rows: [] }); // Donor not found

    const res = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('stripe-signature', 'valid_sig')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));

    // Must return 200 — Stripe would retry on 4xx/5xx
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/webhooks/twilio/status', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates message status on delivery', async () => {
    // Skip Twilio signature validation in tests
    process.env.TWILIO_AUTH_TOKEN = '';

    db.query.mockResolvedValue({ rows: [], rowCount: 1 });

    const res = await request(app)
      .post('/api/v1/webhooks/twilio/status')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('MessageSid=SM123&MessageStatus=delivered&To=%2B15551234567');

    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 20));

    const updateCalls = db.query.mock.calls.filter(c =>
      c[0].includes('UPDATE outreach_messages')
    );
    expect(updateCalls.length).toBeGreaterThan(0);
    expect(updateCalls[0][1]).toContain('delivered');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/webhooks/sendgrid', () => {
  beforeEach(() => jest.clearAllMocks());

  test('marks message as opened on open event', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 1 });

    const events = [{ event: 'open', orbit_message_id: 'msg-001', orbit_donor_id: 'donor-001' }];

    const res = await request(app)
      .post('/api/v1/webhooks/sendgrid')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(events));

    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 20));

    const updateCalls = db.query.mock.calls.filter(c =>
      c[0].includes('UPDATE outreach_messages')
    );
    expect(updateCalls.length).toBeGreaterThan(0);
    expect(updateCalls[0][1]).toContain('opened');
  });

  test('opts donor out of email on unsubscribe event', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // update message
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // update donor

    const events = [{
      event: 'unsubscribe',
      orbit_message_id: 'msg-001',
      orbit_donor_id:   'donor-001',
    }];

    const res = await request(app)
      .post('/api/v1/webhooks/sendgrid')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(events));

    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 20));

    // Should update donor email_opt_out
    const donorUpdateCalls = db.query.mock.calls.filter(c =>
      c[0].includes('UPDATE donors') && c[0].includes('email_opt_out')
    );
    expect(donorUpdateCalls.length).toBeGreaterThan(0);
  });

  test('handles malformed payload gracefully', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/sendgrid')
      .set('Content-Type', 'application/json')
      .send('not valid json at all!!!');

    expect(res.status).toBe(200); // Never crash on webhook
  });
});
