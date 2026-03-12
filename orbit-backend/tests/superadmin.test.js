'use strict';
/**
 * Super Admin Route Tests
 * Critical: verifies that ONLY superadmin role can access these endpoints
 */

const request = require('supertest');
const { authHeader, TEST_ORG_ID } = require('./helpers');

jest.mock('../src/db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
jest.mock('../src/jobs/index', () => ({ startJobs: jest.fn() }));
jest.mock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('$2b$hashed'), compare: jest.fn() }));

const db  = require('../src/db');
const app = require('../src/server');

// ── Auth helpers ────────────────────────────────────────────────────────────
const { createTestJWT } = require('./helpers');
const superAdminHeader = () => ({
  Authorization: 'Bearer ' + createTestJWT({ role: 'superadmin', orgId: null })
});
const regularAdminHeader = () => ({
  Authorization: 'Bearer ' + createTestJWT({ role: 'admin', orgId: TEST_ORG_ID })
});

// ── RBAC: non-superadmin MUST be rejected ──────────────────────────────────
describe('SECURITY: superadmin role enforcement', () => {
  test('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/v1/superadmin/orgs');
    expect(res.status).toBe(401);
  });

  test('rejects regular admin users', async () => {
    const res = await request(app)
      .get('/api/v1/superadmin/orgs')
      .set(regularAdminHeader());
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/super admin/i);
  });

  test('rejects officer role', async () => {
    const res = await request(app)
      .get('/api/v1/superadmin/orgs')
      .set({ Authorization: 'Bearer ' + createTestJWT({ role: 'officer', orgId: TEST_ORG_ID }) });
    expect(res.status).toBe(403);
  });

  test('allows superadmin role', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });
    const res = await request(app)
      .get('/api/v1/superadmin/orgs')
      .set(superAdminHeader());
    expect(res.status).toBe(200);
  });
});

// ── POST /orgs: validation ─────────────────────────────────────────────────
describe('POST /api/v1/superadmin/orgs — validation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects missing required fields', async () => {
    const res = await request(app)
      .post('/api/v1/superadmin/orgs')
      .set(superAdminHeader())
      .send({ name: 'Test Uni' }); // missing plan, adminEmail, adminPassword
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  test('rejects invalid plan', async () => {
    const res = await request(app)
      .post('/api/v1/superadmin/orgs')
      .set(superAdminHeader())
      .send({ name: 'Test', plan: 'ultra_pro_max', adminEmail: 'a@b.edu', adminPassword: 'SecurePass123!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/plan/i);
  });

  test('rejects password under 12 characters', async () => {
    const res = await request(app)
      .post('/api/v1/superadmin/orgs')
      .set(superAdminHeader())
      .send({ name: 'Test', plan: 'starter', adminEmail: 'a@b.edu', adminPassword: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/12 characters/i);
  });

  test('rejects duplicate email', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'existing-user' }] }); // user exists
    const res = await request(app)
      .post('/api/v1/superadmin/orgs')
      .set(superAdminHeader())
      .send({ name: 'Test Uni', plan: 'starter', adminEmail: 'existing@uni.edu', adminPassword: 'SecurePass123!' });
    expect(res.status).toBe(409);
  });
});

// ── Revenue endpoint ───────────────────────────────────────────────────────
describe('GET /api/v1/superadmin/revenue', () => {
  test('returns MRR/ARR summary', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total_orgs:6, active_orgs:4, trial_orgs:1, past_due_orgs:1, suspended_orgs:0, starter_count:2, growth_count:3, enterprise_count:1 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/v1/superadmin/revenue')
      .set(superAdminHeader());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('mrr');
    expect(res.body).toHaveProperty('arr');
    expect(res.body.arr).toBe(res.body.mrr * 12);
  });
});
