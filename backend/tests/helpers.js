/**
 * Orbit Test Helpers — shared utilities for all test suites
 */
'use strict';
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db     = require('../src/db');

const TEST_PASSWORD = 'TestPass123!';
const JWT_SECRET    = process.env.JWT_SECRET || 'test-secret-orbit-2024';

// ── Org helpers ───────────────────────────────────────────────────────────────
async function createTestOrg(overrides = {}) {
  const id = uuidv4();
  const result = await db.query(
    `INSERT INTO orgs (id, name, plan, billing_status, slug)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [
      id,
      overrides.name  || `Test Org ${id.slice(0, 8)}`,
      overrides.plan  || 'growth',
      overrides.billing_status || 'active',
      overrides.slug  || `test-org-${id.slice(0, 8)}`,
    ]
  );
  return result.rows[0];
}

async function cleanupOrg(orgId) {
  if (!orgId) return;
  // Cascade delete — all org data removed
  await db.query('DELETE FROM orgs WHERE id = $1', [orgId]);
}

// ── User helpers ──────────────────────────────────────────────────────────────
async function createTestUser(overrides = {}) {
  const id   = uuidv4();
  const hash = await bcrypt.hash(overrides.password || TEST_PASSWORD, 10);

  const result = await db.query(
    `INSERT INTO users (id, org_id, email, password_hash, role, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      id,
      overrides.orgId || null,
      overrides.email || `test-${id.slice(0, 8)}@orbitgives.com`,
      hash,
      overrides.role  || 'officer',
      overrides.firstName || 'Test',
      overrides.lastName  || 'User',
    ]
  );

  return {
    ...result.rows[0],
    plainPassword: overrides.password || TEST_PASSWORD,
  };
}

async function getAuthToken(user) {
  return generateTestJWT({
    sub:   user.id,
    orgId: user.org_id,
    email: user.email,
    role:  user.role,
  });
}

function generateTestJWT(payload, expiresIn = '1h') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

// ── Donor helpers ─────────────────────────────────────────────────────────────
async function createTestDonor(overrides = {}) {
  const id = uuidv4();
  const result = await db.query(
    `INSERT INTO donors (id, org_id, name, email, capacity, class_year, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      id,
      overrides.orgId,
      overrides.name   || `Donor ${id.slice(0, 8)}`,
      overrides.email  || `donor-${id.slice(0, 8)}@test.com`,
      overrides.capacity  || 10000,
      overrides.class_year || 2005,
      overrides.status || 'active',
    ]
  );
  return result.rows[0];
}

// ── Gift helpers ──────────────────────────────────────────────────────────────
async function createTestGift(overrides = {}) {
  const id = uuidv4();
  const result = await db.query(
    `INSERT INTO gifts (id, org_id, donor_id, amount, currency, status, gift_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      id,
      overrides.orgId,
      overrides.donorId,
      overrides.amount   || 1000,
      overrides.currency || 'usd',
      overrides.status   || 'completed',
      overrides.giftType || 'one_time',
    ]
  );
  return result.rows[0];
}

// ── Cleanup helpers ───────────────────────────────────────────────────────────
async function cleanupTable(table, orgId) {
  await db.query(`DELETE FROM ${table} WHERE org_id = $1`, [orgId]);
}

module.exports = {
  createTestOrg,
  createTestUser,
  getAuthToken,
  generateTestJWT,
  createTestDonor,
  createTestGift,
  cleanupOrg,
  cleanupTable,
  TEST_PASSWORD,
};
