/**
 * Initial Migration – Full Orbit Schema
 * Run: npm run migrate
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {

  // ── Enable UUID extension ────────────────────────────────────
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  // ── Organizations (tenants) ──────────────────────────────────
  await knex.schema.createTable('organizations', t => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('name').notNullable();
    t.string('slug').notNullable().unique();
    t.string('website');
    t.string('mission', 1000);
    t.string('tax_id');        // EIN
    t.string('stripe_account_id');
    t.string('plan').defaultTo('essentials');   // essentials | growth | enterprise
    t.boolean('active').defaultTo(true);
    t.timestamps(true, true);
  });

  // ── Users ────────────────────────────────────────────────────
  await knex.schema.createTable('users', t => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('email').notNullable().unique();
    t.string('password_hash').notNullable();
    t.string('first_name').notNullable();
    t.string('last_name').notNullable();
    t.string('role').defaultTo('staff');      // admin | manager | staff
    t.string('avatar_url');
    t.timestamp('last_login_at');
    t.boolean('active').defaultTo(true);
    t.timestamps(true, true);
    t.index('org_id');
  });

  // ── Refresh tokens ───────────────────────────────────────────
  await knex.schema.createTable('refresh_tokens', t => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash').notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamps(true, true);
  });

  // ── Donors ───────────────────────────────────────────────────
  await knex.schema.createTable('donors', t => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('first_name').notNullable();
    t.string('last_name').notNullable();
    t.string('email').notNullable();
    t.string('phone');
    t.string('address_line1');
    t.string('address_line2');
    t.string('city');
    t.string('state');
    t.string('zip');
    t.string('country').defaultTo('US');
    // Giving data (synced from CRM or entered manually)
    t.bigInteger('total_giving_cents').defaultTo(0);
    t.bigInteger('last_gift_cents').defaultTo(0);
    t.date('last_gift_date');
    t.date('first_gift_date');
    t.integer('consecutive_giving_years').defaultTo(0);
    t.integer('lapsed_years').defaultTo(0);
    t.integer('number_of_gifts').defaultTo(0);
    // Wealth + propensity
    t.bigInteger('wealth_capacity_cents').defaultTo(0);
    t.integer('propensity_score').defaultTo(50);    // 0-100
    t.integer('bequeath_score').defaultTo(0);       // 0-100
    // Interests & preferences
    t.specificType('interests', 'text[]');
    t.string('communication_pref').defaultTo('email');   // email | sms | both
    t.boolean('email_opted_in').defaultTo(false);
    t.boolean('sms_opted_in').defaultTo(false);
    t.boolean('ai_opted_in').defaultTo(false);
    t.timestamp('ai_opted_in_at');
    // Journey state
    t.string('journey_stage').defaultTo('uncontacted');
    t.string('sentiment').defaultTo('unknown');
    t.integer('touchpoint_count').defaultTo(0);
    t.timestamp('last_contact_at');
    // CRM / external IDs
    t.string('salesforce_contact_id');
    t.string('salesforce_household_id');
    t.string('stripe_customer_id');
    t.jsonb('external_ids');     // { blackbaud_id, bloomerang_id, etc. }
    t.timestamps(true, true);
    t.unique(['org_id', 'email']);
    t.index('org_id');
    t.index('journey_stage');
    t.index('ai_opted_in');
  });

  // ── Agents ───────────────────────────────────────────────────
  await knex.schema.createTable('agents', t => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('type').notNullable();      // VEO | VSO | VPGO | VCO
    t.string('name').notNullable();      // internal name e.g. "VEO-1"
    t.string('persona').notNullable();   // name shown to donors e.g. "Alex"
    t.string('status').defaultTo('active');  // active | paused | archived
    t.jsonb('config');
    t.timestamps(true, true);
    t.index('org_id');
  });

  // ── Agent Assignments ────────────────────────────────────────
  await knex.schema.createTable('agent_assignments', t => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('agent_id').notNullable().references('id').inTable('agents').onDelete('CASCADE');
    t.uuid('donor_id').notNullable().references('id').inTable('donors').onDelete('CASCADE');
    t.uuid('org_id').notNullable();
    t.timestamp('assigned_at').defaultTo(knex.fn.now());
    t.timestamp('next_contact_at');
    t.unique(['agent_id', 'donor_id']);
    t.index('agent_id');
    t.index('donor_id');
    t.index('next_contact_at');
  });

  // ── Agent Decisions (log) ────────────────────────────────────
  await knex.schema.createTable('agent_decisions', t => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('agent_id').notNullable().references('id').inTable('agents').onDelete('CASCADE');
    t.uuid('donor_id').notNullable().references('id').inTable('donors').onDelete('CASCADE');
    t.uuid('org_id').notNullable();
    t.string('action_type').notNullable();
    t.jsonb('decision_payload');     // full AgentDecision JSON
    t.string('stage_before');
    t.string('stage_after');
    t.integer('next_contact_days');
    t.boolean('escalated').defaultTo(false);
    t.string('escalation_reason');
    t.timestamps(true, true);
    t.index(['agent_id', 'created_at']);
    t.index('donor_id');
  });

  // ── Touchpoints ──────────────────────────────────────────────
  await knex.schema.createTable('touchpoints', t => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id').notNullable();
    t.uuid('donor_id').notNullable().references('id').inTable('donors').onDelete('CASCADE');
    t.uuid('agent_id').references('id').inTable('agents').onDelete('SET NULL');
    t.string('channel').notNullable();   // email | sms | note | call
    t.string('direction').notNullable(); // outbound | inbound
    t.string('subject');
    t.text('body').notNullable();
    t.string('email_status');            // delivered | opened | clicked | bounced
    t.timestamp('email_opened_at');
    t.timestamp('email_clicked_at');
    t.string('sms_status');              // sent | delivered | failed
    t.string('twilio_message_sid');
    t.string('sendgrid_message_id');
    t.timestamps(true, true);
    t.index('donor_id');
    t.index('org_id');
    t.index('created_at');
  });

  // ── Gifts ────────────────────────────────────────────────────
  await knex.schema.createTable('gifts', t => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id').notNullable();
    t.uuid('donor_id').notNullable().references('id').inTable('donors').onDelete('CASCADE');
    t.uuid('agent_id').references('id').inTable('agents').onDelete('SET NULL');
    t.uuid('campaign_id').references('id').inTable('campaigns').onDelete('SET NULL');
    t.bigInteger('amount_cents').notNullable();
    t.string('fund_name');
    t.string('gift_type').defaultTo('one_time');  // one_time | pledge | planned
    t.date('gift_date').notNullable();
    t.string('status').defaultTo('confirmed');    // pending | confirmed | failed
    t.string('stripe_payment_intent_id').unique();
    t.string('salesforce_opportunity_id');
    t.timestamps(true, true);
    t.index('donor_id');
    t.index('org_id');
    t.index('gift_date');
  });

  // ── Gift Agreements (DocuSign) ───────────────────────────────
  await knex.schema.createTable('gift_agreements', t => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id').notNullable();
    t.uuid('gift_id').references('id').inTable('gifts').onDelete('CASCADE');
    t.uuid('donor_id').notNullable();
    t.string('docusign_envelope_id').unique();
    t.string('gift_type').notNullable();          // single | pledge | planned
    t.bigInteger('amount_cents').notNullable();
    t.string('fund_name');
    t.integer('pledge_years');
    t.string('status').defaultTo('sent');         // sent | delivered | completed | voided
    t.timestamp('signed_at');
    t.timestamps(true, true);
    t.index('donor_id');
  });

  // ── Pledges ──────────────────────────────────────────────────
  await knex.schema.createTable('pledges', t => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id').notNullable();
    t.uuid('donor_id').notNullable().references('id').inTable('donors').onDelete('CASCADE');
    t.uuid('gift_agreement_id').references('id').inTable('gift_agreements').onDelete('SET NULL');
    t.bigInteger('total_amount_cents').notNullable();
    t.integer('years').notNullable();
    t.string('frequency').defaultTo('annually');  // monthly | quarterly | annually
    t.date('start_date').notNullable();
    t.date('end_date');
    t.string('fund_name');
    t.string('status').defaultTo('active');       // active | completed | cancelled | lapsed
    t.string('stripe_subscription_id').unique();
    t.string('salesforce_opportunity_id');
    t.timestamps(true, true);
    t.index('donor_id');
    t.index('status');
  });

  // ── Pledge Installments ──────────────────────────────────────
  await knex.schema.createTable('pledge_installments', t => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('pledge_id').notNullable().references('id').inTable('pledges').onDelete('CASCADE');
    t.uuid('org_id').notNullable();
    t.bigInteger('amount_cents').notNullable();
    t.date('due_date').notNullable();
    t.string('status').defaultTo('pending');      // pending | paid | failed | forgiven
    t.timestamp('paid_at');
    t.string('stripe_invoice_id').unique();
    t.string('stripe_subscription_id');
    t.timestamps(true, true);
    t.index('pledge_id');
    t.index(['status', 'due_date']);
  });

  // ── Campaigns ────────────────────────────────────────────────
  await knex.schema.createTable('campaigns', t => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('name').notNullable();
    t.text('description');
    t.string('type').defaultTo('general');        // general | giving_tuesday | year_end | capital
    t.bigInteger('goal_cents');
    t.bigInteger('raised_cents').defaultTo(0);
    t.date('start_date').notNullable();
    t.date('end_date').notNullable();
    t.string('status').defaultTo('draft');        // draft | active | completed | cancelled
    t.uuid('vco_agent_id').references('id').inTable('agents').onDelete('SET NULL');
    t.string('salesforce_campaign_id');
    t.timestamps(true, true);
    t.index('org_id');
    t.index('status');
  });

  // ── Integrations (encrypted 3rd-party credentials per org) ──
  await knex.schema.createTable('integrations', t => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('provider').notNullable();           // salesforce | blackbaud | bloomerang | mailchimp
    t.text('credentials_encrypted').notNullable(); // AES-256-GCM encrypted JSON
    t.boolean('active').defaultTo(true);
    t.timestamp('last_sync_at');
    t.timestamps(true, true);
    t.unique(['org_id', 'provider']);
  });

  // ── Audit Logs (immutable) ───────────────────────────────────
  await knex.schema.createTable('audit_logs', t => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id');
    t.uuid('user_id');
    t.string('event_type').notNullable();
    t.jsonb('payload');
    t.string('ip_address');
    t.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    t.index(['org_id', 'created_at']);
    t.index('event_type');
  });
}

export async function down(knex: Knex): Promise<void> {
  const tables = [
    'audit_logs', 'integrations', 'campaigns',
    'pledge_installments', 'pledges', 'gift_agreements', 'gifts',
    'touchpoints', 'agent_decisions', 'agent_assignments', 'agents',
    'donors', 'refresh_tokens', 'users', 'organizations',
  ];
  for (const t of tables) await knex.schema.dropTableIfExists(t);
  await knex.raw('DROP EXTENSION IF EXISTS "uuid-ossp"');
}
