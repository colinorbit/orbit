/**
 * Migration 002 — Campaign Donors Join Table
 *
 * Adds the campaign_donors junction table referenced in campaigns.ts.
 * This enables assigning donors to campaigns and tracking enrollment.
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('campaign_donors', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('campaign_id')
      .notNullable()
      .references('id')
      .inTable('campaigns')
      .onDelete('CASCADE');
    t.uuid('donor_id')
      .notNullable()
      .references('id')
      .inTable('donors')
      .onDelete('CASCADE');
    t.uuid('org_id').notNullable();
    t.timestamp('assigned_at').defaultTo(knex.fn.now());
    t.unique(['campaign_id', 'donor_id']);
    t.index('campaign_id');
    t.index('donor_id');
    t.index('org_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('campaign_donors');
}
