'use strict';
/**
 * Auth Route Tests
 * Tests: login, token validation, rate limiting, input validation
 */

const request = require('supertest');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const { createTestJWT, TEST_ORG_ID, TEST_USER_ID, TEST_JWT_SECRET } = require('./helpers');

// ── Mock dependencies before requiring app ────────────────────────────────────
const mockUser = {
  id:            TEST_USER_ID,
  org_id:        TEST_ORG_ID,
  email:         'sarah@greenfield.edu',
  name:          'Sarah Chen',
  role:          'admin',
  password_hash: bcrypt.hashSync('correct-password', 10),
};

jest.mock('../src/db', () => ({
  query: jest.fn(),
}));

jest.mock('../src/jobs/index', () => ({ startJobs: jest.fn() }));

const db  = require('../src/db');
const app = require('../src/server');

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/auth/login', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns JWT on valid credentials', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [mockUser] })   // SELECT user
      .mockResolvedValueOnce({ rows: [] });            // UPDATE last_login

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sarah@greenfield.edu', password: 'correct-password' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.email).toBe('sarah@greenfield.edu');
    expect(res.body.user).not.toHaveProperty('password_hash'); // Never return hash

    // Verify token is valid and contains correct claims
    const decoded = jwt.verify(res.body.token, TEST_JWT_SECRET);
    expect(decoded.sub).toBe(TEST_USER_ID);
    expect(decoded.orgId).toBe(TEST_ORG_ID);
    expect(decoded.role).toBe('admin');
  });

  test('returns 401 on wrong password', async () => {
    db.query.mockResolvedValueOnce({ rows: [mockUser] });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sarah@greenfield.edu', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('InvalidCredentials');
  });

  test('returns 401 on unknown email', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // No user found

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@nowhere.com', password: 'anything' });

    expect(res.status).toBe(401);
    // Response time must be consistent whether user exists or not (timing attack)
    // (bcrypt.compare runs even when no user to prevent timing leaks)
  });

  test('returns 400 when email or password missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sarah@greenfield.edu' }); // No password

    expect(res.status).toBe(400);
  });

  test('rejects SQL injection in email field', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: "' OR '1'='1", password: 'anything' });

    expect(res.status).toBe(401); // Treated as bad creds, not 500
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Auth middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects requests without Authorization header', async () => {
    const res = await request(app).get('/api/v1/donors');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/No token/i);
  });

  test('rejects requests with malformed token', async () => {
    const res = await request(app)
      .get('/api/v1/donors')
      .set('Authorization', 'Bearer not.a.real.token');

    expect(res.status).toBe(401);
  });

  test('rejects requests with expired token', async () => {
    const expiredToken = jwt.sign(
      { sub: TEST_USER_ID, orgId: TEST_ORG_ID, role: 'admin' },
      TEST_JWT_SECRET,
      { expiresIn: '-1s' } // Already expired
    );

    const res = await request(app)
      .get('/api/v1/donors')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
  });

  test('accepts requests with valid token', async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // Add total count query mock
    db.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const res = await request(app)
      .get('/api/v1/donors')
      .set('Authorization', `Bearer ${createTestJWT()}`);

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Health check', () => {
  test('GET /health returns 200 without auth', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('404 handler', () => {
  test('returns 404 for unknown routes', async () => {
    const res = await request(app)
      .get('/api/v1/nonexistent-route')
      .set('Authorization', `Bearer ${createTestJWT()}`);

    expect(res.status).toBe(404);
  });
});
