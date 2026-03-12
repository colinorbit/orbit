'use strict';
/**
 * Outreach Route Tests
 * Tests: list queue, generate, approve flow, rejection, compliance (DNC/opt-out),
 *        bulk generate limits, delivery dispatch on approve
 */

const request = require('supertest');
const { authHeader, makeDonor, TEST_ORG_ID } = require('./helpers');

jest.mock('../src/db', () => ({ query: jest.fn() }));
jest.mock('../src/jobs/index', () => ({ startJobs: jest.fn() }));
jest.mock('../src/services/ai', () => ({
  generateOutreachMessage: jest.fn().mockResolvedValue({
    subject: 'Thinking of you',
    body:    'Dear Alice, we appreciate your continued support.',
    rationale: 'Re-engagement after 6 month gap',
  }),
  callClaude: jest.fn().mockResolvedValue(JSON.stringify({
    subject: 'Your pledge reminder',
    body:    'Dear Alice, your pledge installment is due.',
  })),
}));
jest.mock('../src/services/delivery', () => ({
  deliverMessage: jest.fn().mockResolvedValue({ ok: true, provider_id: 'msg_test123' }),
  runDeliveryWorker: jest.fn(),
}));

const db       = require('../src/db');
const delivery = require('../src/services/delivery');
const app      = require('../src/server');

const DRAFT_MESSAGE = {
  id:          'msg-001',
  org_id:      TEST_ORG_ID,
  donor_id:    'donor-001',
  donor_name:  'Alice Hartwell',
  donor_email: 'alice@test.com',
  agent_key:   'VEO',
  channel:     'Email',
  subject:     'Thinking of you',
  body:        'Dear Alice...',
  status:      'draft',
  created_at:  new Date().toISOString(),
};

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/v1/outreach', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns pending queue', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [DRAFT_MESSAGE] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app)
      .get('/api/v1/outreach?status=draft')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('draft');
  });

  test('SECURITY: always scoped to org', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await request(app)
      .get('/api/v1/outreach')
      .set(authHeader());

    const call = db.query.mock.calls[0];
    expect(call[1][0]).toBe(TEST_ORG_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/outreach/generate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('generates and saves a draft message', async () => {
    const donor = makeDonor({ do_not_contact: false, email_opt_out: false });
    db.query
      .mockResolvedValueOnce({ rows: [donor] })          // find donor
      .mockResolvedValueOnce({ rows: [{ config: {} }] }) // agent config
      .mockResolvedValueOnce({ rows: [{                  // insert message
        id: 'new-msg-1', channel: 'Email',
        subject: 'Thinking of you', body: 'Dear Alice...',
        status: 'draft', created_at: new Date().toISOString(),
      }] });

    const res = await request(app)
      .post('/api/v1/outreach/generate')
      .set(authHeader())
      .send({ donorId: donor.id, agentKey: 'VEO', channel: 'Email' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.channel).toBe('Email');
  });

  test('blocks message to do_not_contact donor', async () => {
    const donor = makeDonor({ do_not_contact: true });
    db.query.mockResolvedValueOnce({ rows: [donor] });

    const res = await request(app)
      .post('/api/v1/outreach/generate')
      .set(authHeader())
      .send({ donorId: donor.id, agentKey: 'VEO', channel: 'Email' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/do_not_contact/i);
  });

  test('blocks email to opted-out donor', async () => {
    const donor = makeDonor({ email_opt_out: true });
    db.query.mockResolvedValueOnce({ rows: [donor] });

    const res = await request(app)
      .post('/api/v1/outreach/generate')
      .set(authHeader())
      .send({ donorId: donor.id, agentKey: 'VSO', channel: 'Email' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/opted out/i);
  });

  test('blocks SMS to non-opted-in donor', async () => {
    const donor = makeDonor({ sms_opt_in: false });
    db.query.mockResolvedValueOnce({ rows: [donor] });

    const res = await request(app)
      .post('/api/v1/outreach/generate')
      .set(authHeader())
      .send({ donorId: donor.id, agentKey: 'VCO', channel: 'SMS' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/SMS/i);
  });

  test('returns 404 for unknown donor', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/v1/outreach/generate')
      .set(authHeader())
      .send({ donorId: 'nonexistent', agentKey: 'VEO', channel: 'Email' });

    expect(res.status).toBe(404);
  });

  test('requires donorId and agentKey', async () => {
    const res = await request(app)
      .post('/api/v1/outreach/generate')
      .set(authHeader())
      .send({ channel: 'Email' }); // Missing required fields

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/outreach/:id/approve', () => {
  beforeEach(() => jest.clearAllMocks());

  test('moves message to scheduled and fires delivery', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ ...DRAFT_MESSAGE, status: 'scheduled', scheduled_at: new Date().toISOString() }],
    });

    const res = await request(app)
      .post('/api/v1/outreach/msg-001/approve')
      .set(authHeader())
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('scheduled');
    expect(res.body.queued_for_send).toBe(true);

    // Delivery should be triggered asynchronously
    // Give it a tick to fire
    await new Promise(r => setImmediate(r));
    expect(delivery.deliverMessage).toHaveBeenCalledWith('msg-001');
  });

  test('returns 404 if message not in draft status', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // UPDATE matched 0 rows

    const res = await request(app)
      .post('/api/v1/outreach/msg-999/approve')
      .set(authHeader())
      .send({});

    expect(res.status).toBe(404);
    expect(delivery.deliverMessage).not.toHaveBeenCalled();
  });

  test('scheduled future messages do NOT fire immediate delivery', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString(); // tomorrow
    db.query.mockResolvedValueOnce({
      rows: [{ ...DRAFT_MESSAGE, status: 'scheduled', scheduled_at: futureDate }],
    });

    const res = await request(app)
      .post('/api/v1/outreach/msg-001/approve')
      .set(authHeader())
      .send({ scheduledAt: futureDate });

    expect(res.status).toBe(200);
    expect(res.body.queued_for_send).toBe(false);

    await new Promise(r => setImmediate(r));
    expect(delivery.deliverMessage).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/outreach/:id/reject', () => {
  beforeEach(() => jest.clearAllMocks());

  test('moves message back to draft with rejection note', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'msg-001', status: 'draft' }],
    });

    const res = await request(app)
      .post('/api/v1/outreach/msg-001/reject')
      .set(authHeader())
      .send({ reason: 'Tone too formal' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('draft');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/outreach/bulk-generate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects more than 100 donors', async () => {
    const donors = Array.from({ length: 101 }, (_, i) => `id-${i}`);

    const res = await request(app)
      .post('/api/v1/outreach/bulk-generate')
      .set(authHeader())
      .send({ donorIds: donors, agentKey: 'VCO', channel: 'Email' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Max 100/i);
  });

  test('rejects empty donorIds', async () => {
    const res = await request(app)
      .post('/api/v1/outreach/bulk-generate')
      .set(authHeader())
      .send({ donorIds: [], agentKey: 'VCO' });

    expect(res.status).toBe(400);
  });

  test('returns counts of created/skipped/errors', async () => {
    const donors = [makeDonor({ id: 'd1' }), makeDonor({ id: 'd2' })];
    db.query
      .mockResolvedValueOnce({ rows: donors }) // find eligible donors
      .mockResolvedValueOnce({ rows: [] })     // insert d1
      .mockResolvedValueOnce({ rows: [] });    // insert d2

    const res = await request(app)
      .post('/api/v1/outreach/bulk-generate')
      .set(authHeader())
      .send({ donorIds: ['d1', 'd2'], agentKey: 'VCO', channel: 'Email' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('created');
    expect(res.body).toHaveProperty('skipped');
    expect(res.body).toHaveProperty('errors');
  });
});
