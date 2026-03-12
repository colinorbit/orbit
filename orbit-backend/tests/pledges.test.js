'use strict';
/**
 * Pledges Route Tests
 * Tests: create, payment recording, balance calculation,
 *        AI reminder generation, status updates, multi-tenant isolation
 */

const request = require('supertest');
const { authHeader, makeDonor, TEST_ORG_ID } = require('./helpers');

jest.mock('../src/db', () => ({ query: jest.fn() }));
jest.mock('../src/jobs/index', () => ({ startJobs: jest.fn() }));
jest.mock('../src/services/ai', () => ({
  callClaude: jest.fn().mockResolvedValue(JSON.stringify({
    subject: 'Your pledge reminder from Greenfield University',
    body: 'Dear Test, your pledge installment of $500 is coming up.',
  })),
  generateDonorBrief: jest.fn(),
  generateOutreachMessage: jest.fn(),
  generateAgentReasoning: jest.fn(),
}));

const db  = require('../src/db');
const app = require('../src/server');

const mockPledge = {
  id:                 'pledge-001',
  org_id:             TEST_ORG_ID,
  donor_id:           'donor-001',
  donor_name:         'Test Donor',
  donor_email:        'donor@test.com',
  total_amount:       5000,
  paid_amount:        1000,
  balance:            4000,
  frequency:          'annual',
  installment_amount: 1000,
  start_date:         '2025-01-01',
  next_due_date:      '2026-01-01',
  status:             'current',
  fund:               'Scholarship Fund',
  reminders_sent:     0,
};

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/v1/pledges', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns pledge list scoped to org', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [mockPledge] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app)
      .get('/api/v1/pledges')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('pledge-001');

    // Multi-tenant: always filtered by org_id from JWT
    expect(db.query.mock.calls[0][1]).toContain(TEST_ORG_ID);
  });

  test('filters by status=overdue', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await request(app)
      .get('/api/v1/pledges?status=overdue')
      .set(authHeader());

    const params = db.query.mock.calls[0][1];
    expect(params).toContain('overdue');
  });

  test('requires auth', async () => {
    const res = await request(app).get('/api/v1/pledges');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/v1/pledges/summary', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns summary KPIs', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        open_count:     5,
        open_balance:   18500,
        overdue_count:  1,
        overdue_amount: 1000,
        due_soon:       2,
      }],
    });

    const res = await request(app)
      .get('/api/v1/pledges/summary')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('open_count');
    expect(res.body).toHaveProperty('open_balance');
    expect(res.body).toHaveProperty('overdue_count');
    expect(typeof res.body.open_balance).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/pledges', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates pledge and returns it', async () => {
    // Verify donor exists
    db.query.mockResolvedValueOnce({ rows: [{ id: 'donor-001' }] });
    // Insert pledge
    db.query.mockResolvedValueOnce({ rows: [mockPledge] });

    const res = await request(app)
      .post('/api/v1/pledges')
      .set(authHeader())
      .send({
        donorId:           'donor-001',
        totalAmount:       5000,
        frequency:         'annual',
        installmentAmount: 1000,
        fund:              'Scholarship Fund',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('pledge-001');
    expect(res.body.total_amount).toBe(5000);
  });

  test('returns 400 when required fields missing', async () => {
    const res = await request(app)
      .post('/api/v1/pledges')
      .set(authHeader())
      .send({ donorId: 'donor-001' }); // Missing totalAmount and frequency

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  test('returns 404 when donor not found in org', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // Donor not found

    const res = await request(app)
      .post('/api/v1/pledges')
      .set(authHeader())
      .send({ donorId: 'nonexistent', totalAmount: 1000, frequency: 'annual' });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /api/v1/pledges/:id/payment', () => {
  beforeEach(() => jest.clearAllMocks());

  test('records payment and recalculates balance', async () => {
    const updatedPledge = { ...mockPledge, paid_amount: 2000, balance: 3000, status: 'current' };

    db.query
      .mockResolvedValueOnce({ rows: [mockPledge] })       // fetch pledge
      .mockResolvedValueOnce({ rows: [updatedPledge] })    // update pledge
      .mockResolvedValueOnce({ rows: [] });                // insert gift

    const res = await request(app)
      .patch('/api/v1/pledges/pledge-001/payment')
      .set(authHeader())
      .send({ amount: 1000, paymentMethod: 'check' });

    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(3000);
    expect(res.body.paid_amount).toBe(2000);
  });

  test('marks pledge fulfilled when balance reaches zero', async () => {
    const nearFinalPledge = { ...mockPledge, paid_amount: 4000, balance: 1000 };
    const fulfilledPledge = { ...mockPledge, paid_amount: 5000, balance: 0, status: 'fulfilled' };

    db.query
      .mockResolvedValueOnce({ rows: [nearFinalPledge] })
      .mockResolvedValueOnce({ rows: [fulfilledPledge] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch('/api/v1/pledges/pledge-001/payment')
      .set(authHeader())
      .send({ amount: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('fulfilled');
    expect(res.body.balance).toBe(0);
  });

  test('returns 400 when amount missing', async () => {
    const res = await request(app)
      .patch('/api/v1/pledges/pledge-001/payment')
      .set(authHeader())
      .send({}); // No amount

    expect(res.status).toBe(400);
  });

  test('returns 404 for pledge not in org', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // Not found

    const res = await request(app)
      .patch('/api/v1/pledges/unknown-pledge/payment')
      .set(authHeader())
      .send({ amount: 500 });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/pledges/:id/reminder', () => {
  beforeEach(() => jest.clearAllMocks());

  test('generates AI reminder and increments counter', async () => {
    const ai = require('../src/services/ai');

    db.query
      .mockResolvedValueOnce({ rows: [{ ...mockPledge, preferred_channel: 'Email' }] }) // fetch
      .mockResolvedValueOnce({ rows: [] }); // increment counter

    const res = await request(app)
      .post('/api/v1/pledges/pledge-001/reminder')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('subject');
    expect(res.body).toHaveProperty('body');
    expect(ai.callClaude).toHaveBeenCalled();

    // Counter increment query must be called
    const incrementCall = db.query.mock.calls[1];
    expect(incrementCall[0]).toContain('reminders_sent');
  });

  test('returns 404 for unknown pledge', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/v1/pledges/nonexistent/reminder')
      .set(authHeader());

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /api/v1/pledges/:id/status', () => {
  beforeEach(() => jest.clearAllMocks());

  test('accepts valid status transitions', async () => {
    const validStatuses = ['current', 'at-risk', 'overdue', 'paused', 'cancelled', 'fulfilled'];

    for (const status of validStatuses) {
      db.query.mockResolvedValueOnce({ rows: [{ ...mockPledge, status }] });

      const res = await request(app)
        .patch('/api/v1/pledges/pledge-001/status')
        .set(authHeader())
        .send({ status });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
    }
  });

  test('rejects invalid status values', async () => {
    const res = await request(app)
      .patch('/api/v1/pledges/pledge-001/status')
      .set(authHeader())
      .send({ status: 'totally-made-up' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('valid');
  });
});
