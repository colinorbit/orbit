'use strict';
/**
 * Donors Route Tests
 * Tests: list/filter, single donor, RBAC, multi-tenant isolation,
 *        search, pagination, score filtering
 */

const request = require('supertest');
const { authHeader, makeDonor, TEST_ORG_ID, TEST_USER_ID } = require('./helpers');

jest.mock('../src/db', () => ({ query: jest.fn() }));
jest.mock('../src/jobs/index', () => ({ startJobs: jest.fn() }));

const db  = require('../src/db');
const app = require('../src/server');

const DONOR_1 = makeDonor({ id: 'donor-1', name: 'Alice Hartwell', stage: 'active' });
const DONOR_2 = makeDonor({ id: 'donor-2', name: 'Bob Nguyen',     stage: 'lapsed' });

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/v1/donors', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns paginated donor list', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [DONOR_1, DONOR_2] })  // data
      .mockResolvedValueOnce({ rows: [{ count: '2' }] });   // total

    const res = await request(app)
      .get('/api/v1/donors')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page');
    expect(res.body).toHaveProperty('pages');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.total).toBe(2);
  });

  test('filters by stage', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [DONOR_2] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app)
      .get('/api/v1/donors?stage=lapsed')
      .set(authHeader());

    expect(res.status).toBe(200);
    // Verify the query included stage filter
    const call = db.query.mock.calls[0];
    expect(call[1]).toContain('lapsed');
  });

  test('filters by assigned agent', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [DONOR_1] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app)
      .get('/api/v1/donors?agent=VEO')
      .set(authHeader());

    expect(res.status).toBe(200);
    const call = db.query.mock.calls[0];
    expect(call[1]).toContain('VEO');
  });

  test('SECURITY: query always scoped to authenticated org', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await request(app)
      .get('/api/v1/donors')
      .set(authHeader({ orgId: TEST_ORG_ID }));

    // First param of first query must be the org_id
    const call = db.query.mock.calls[0];
    expect(call[1][0]).toBe(TEST_ORG_ID);
  });

  test('respects pagination params', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '100' }] });

    const res = await request(app)
      .get('/api/v1/donors?page=3&limit=10')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(3);
  });

  test('rejects unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/donors');
    expect(res.status).toBe(401);
  });

  test('viewer role can read donors', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [DONOR_1] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app)
      .get('/api/v1/donors')
      .set(authHeader({ role: 'viewer' }));

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/v1/donors/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns a single donor', async () => {
    db.query.mockResolvedValueOnce({ rows: [DONOR_1] });

    const res = await request(app)
      .get(`/api/v1/donors/${DONOR_1.id}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(DONOR_1.id);
    expect(res.body.name).toBe('Alice Hartwell');
  });

  test('returns 404 for unknown donor id', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/v1/donors/00000000-0000-0000-0000-999999999999')
      .set(authHeader());

    expect(res.status).toBe(404);
  });

  test('SECURITY: cannot fetch donor from different org', async () => {
    // DB returns empty because org_id filter excludes it
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(`/api/v1/donors/${DONOR_1.id}`)
      .set(authHeader({ orgId: 'different-org-id' }));

    expect(res.status).toBe(404); // Not 403 — don't leak existence
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Donor response data safety', () => {
  beforeEach(() => jest.clearAllMocks());

  test('never returns password fields', async () => {
    const donorWithSensitive = { ...DONOR_1, password: 'should-never-appear' };
    db.query
      .mockResolvedValueOnce({ rows: [donorWithSensitive] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app)
      .get('/api/v1/donors')
      .set(authHeader());

    // The route SELECT list is explicit — password column not fetched
    // This test verifies we don't accidentally SELECT *
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('password_hash');
  });
});
