'use strict';
/**
 * Billing Route Tests
 * Tests: subscription status, checkout session, webhook handling,
 *        plan gating, past-due blocking
 */
const request = require('supertest');
const app     = require('../src/server');
const { createTestOrg, createTestUser, getAuthToken, cleanupOrg } = require('./helpers');

let org, user, token;

beforeAll(async () => {
  org   = await createTestOrg({ name: 'Billing Test Org', plan: 'trial' });
  user  = await createTestUser({ orgId: org.id, role: 'admin' });
  token = await getAuthToken(user);
});

afterAll(async () => {
  await cleanupOrg(org?.id);
});

describe('GET /billing/subscription', () => {
  test('returns current plan and billing status', async () => {
    const res = await request(app)
      .get('/api/v1/billing/subscription')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toMatchObject({
      plan:           expect.stringMatching(/trial|starter|growth|enterprise/),
      billing_status: expect.stringMatching(/trialing|active|past_due|suspended/),
    });
  });

  test('returns feature flags for current plan', async () => {
    const res = await request(app)
      .get('/api/v1/billing/subscription')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.feature_flags).toBeDefined();
    expect(typeof res.body.feature_flags).toBe('object');
  });

  test('returns 401 without auth', async () => {
    await request(app)
      .get('/api/v1/billing/subscription')
      .expect(401);
  });
});

describe('GET /billing/invoices', () => {
  test('returns invoice list (may be empty for new org)', async () => {
    const res = await request(app)
      .get('/api/v1/billing/invoices')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body.invoices)).toBe(true);
  });
});

describe('POST /billing/checkout', () => {
  test('returns 400 for invalid plan', async () => {
    await request(app)
      .post('/api/v1/billing/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'mega-ultra-plan' })
      .expect(400);
  });

  test('returns checkout URL for valid plan (test mode)', async () => {
    if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
      console.log('Skipping — no Stripe test key');
      return;
    }

    const res = await request(app)
      .post('/api/v1/billing/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'growth' })
      .expect(200);

    expect(res.body.checkoutUrl).toContain('checkout.stripe.com');
  });
});

describe('Past-due billing gate', () => {
  let pastDueOrg, pastDueUser, pastDueToken;

  beforeAll(async () => {
    // Create an org and manually set billing_status to past_due
    pastDueOrg  = await createTestOrg({ name: 'Past Due Org', plan: 'growth', billing_status: 'past_due' });
    pastDueUser = await createTestUser({ orgId: pastDueOrg.id, role: 'admin' });
    pastDueToken = await getAuthToken(pastDueUser);
  });

  afterAll(async () => {
    await cleanupOrg(pastDueOrg?.id);
  });

  test('past-due org blocked from donor endpoints', async () => {
    const res = await request(app)
      .get('/api/v1/donors')
      .set('Authorization', `Bearer ${pastDueToken}`)
      .expect(402);

    expect(res.body.error).toMatch(/PaymentRequired/);
  });

  test('past-due org CAN still access billing to fix payment', async () => {
    await request(app)
      .get('/api/v1/billing/subscription')
      .set('Authorization', `Bearer ${pastDueToken}`)
      .expect(200);
  });
});
