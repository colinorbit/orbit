/**
 * Database – Knex (PostgreSQL) connection & query builder
 *
 * Schema overview:
 *  organizations      – tenant record (nonprofit)
 *  users              – staff accounts per org
 *  donors             – constituent/donor records
 *  donor_segments     – categorisation (prospect, mid, major, lapsed…)
 *  agents             – AI agent instances (VEO / VSO / VPGO / VCO)
 *  agent_assignments  – which donors an agent manages
 *  touchpoints        – every outreach message sent/received
 *  donor_journeys     – the cultivation stage tracker per donor-agent pair
 *  gifts              – confirmed gifts
 *  gift_agreements    – DocuSign envelope records
 *  pledges            – multi-year pledge schedules
 *  pledge_installments– individual installment tracking
 *  campaigns          – time-bound fundraising campaigns
 *  campaign_donors    – donors assigned to a campaign
 *  payments           – Stripe payment records
 *  integrations       – per-org 3rd-party credentials (encrypted)
 *  audit_logs         – immutable event log
 */

import knex, { type Knex } from 'knex';
import { logger } from './logger';

let db: Knex;

export function getDB(): Knex {
  if (!db) throw new Error('DB not initialised – call connectDB() first');
  return db;
}

export async function connectDB(): Promise<void> {
  db = knex({
    client: 'pg',
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    },
    pool: {
      min: Number(process.env.DB_POOL_MIN ?? 2),
      max: Number(process.env.DB_POOL_MAX ?? 10),
    },
    migrations: { directory: '../migrations', extension: 'ts' },
    seeds:      { directory: '../seeds', extension: 'ts' },
  });

  // Verify connection
  await db.raw('SELECT 1');
  logger.info('✅ PostgreSQL connected');
}
