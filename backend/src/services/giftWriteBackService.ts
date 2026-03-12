/**
 * Gift Write-Back Service
 *
 * Orchestrates the full post-payment pipeline:
 *
 *  1. Resolve donor → find or create SF Contact + Household Account
 *  2. Create SF Opportunity (NPSP Closed Won) with fund allocation
 *  3. Create npe01__OppPayment__c record linked to the Opp
 *  4. Update Orbit donor record (lifetime giving, last gift, streak)
 *  5. Trigger VSO stewardship email via SendGrid
 *  6. Enqueue matching gift reminder (24h delay) if employer detected
 *  7. Log every step to audit trail
 *
 * This service is called by the Stripe webhook queue job after
 * payment_intent.succeeded is verified.
 *
 * All external calls are guarded by ENABLE_* env flags so the
 * service is fully testable without live credentials.
 *
 * Error strategy: each step has an independent try/catch so a CRM
 * failure does NOT block the receipt email. Steps are retried via
 * Bull queue with exponential backoff.
 */

import { logger }            from '../config/logger';
import { getDB }             from '../config/database';
import { createOpportunity } from './salesforceService';
import { sendTemplateEmail } from './emailService';
import { runAgentForDonor }  from './agentService';
import { getSFClient }       from './salesforceService';

// ─── Types ───────────────────────────────────────────────────────

export interface IncomingGift {
  /** Orbit internal payment record ID */
  paymentId:        string;
  /** Stripe PaymentIntent ID */
  stripeIntentId:   string;
  /** Orbit donor ID (may be null for new/anonymous donors) */
  donorId:          string | null;
  /** Orbit org ID */
  orgId:            string;
  /** Amount in cents */
  amountCents:      number;
  /** Recurring or one-time */
  frequency:        'once' | 'monthly' | 'quarterly' | 'annual';
  /** Fund designation slug */
  designation:      string;
  /** Employer name for matching gift follow-up (nullable) */
  employerName:     string | null;
  /** ISO timestamp of payment confirmation */
  confirmedAt:      string;
  /** Form ID the gift came through */
  formId?:          string;
  /** Donor personal info (from form submission) */
  donor: {
    firstName:  string;
    lastName:   string;
    email:      string;
    phone?:     string;
    address?:   string;
    city?:      string;
    state?:     string;
    zip?:       string;
    country?:   string;
    anonymous?: boolean;
  };
}

export interface WriteBackResult {
  paymentId:        string;
  success:          boolean;
  steps: {
    donorResolved:    StepResult;
    sfOpportunity:    StepResult;
    sfPayment:        StepResult;
    orbitDonorUpdate: StepResult;
    stewardshipEmail: StepResult;
    matchReminder:    StepResult;
  };
  sfOpportunityId?: string;
  totalDurationMs:  number;
}

interface StepResult {
  status:   'success' | 'skipped' | 'error';
  detail?:  string;
  durationMs: number;
}

// ─── Main orchestrator ───────────────────────────────────────────

export async function processGiftWriteBack(gift: IncomingGift): Promise<WriteBackResult> {
  const start = Date.now();
  const db    = getDB();

  logger.info(`[GiftWriteBack] Starting write-back for payment ${gift.paymentId}`, {
    orgId:      gift.orgId,
    amountCents: gift.amountCents,
    donor:      `${gift.donor.firstName} ${gift.donor.lastName}`,
  });

  await auditLog(db, gift.orgId, 'GIFT_WRITEBACK_STARTED', gift.paymentId, {
    amountCents: gift.amountCents,
    donor:       `${gift.donor.firstName} ${gift.donor.lastName}`,
    designation: gift.designation,
  });

  const result: WriteBackResult = {
    paymentId: gift.paymentId,
    success:   false,
    steps: {
      donorResolved:    { status:'skipped', durationMs:0 },
      sfOpportunity:    { status:'skipped', durationMs:0 },
      sfPayment:        { status:'skipped', durationMs:0 },
      orbitDonorUpdate: { status:'skipped', durationMs:0 },
      stewardshipEmail: { status:'skipped', durationMs:0 },
      matchReminder:    { status:'skipped', durationMs:0 },
    },
    totalDurationMs: 0,
  };

  // ── Step 1: Resolve / create donor record ────────────────────
  const t1 = Date.now();
  let donorRecord: DonorRecord | null = null;
  try {
    donorRecord = await resolveDonor(db, gift);
    result.steps.donorResolved = {
      status: 'success',
      detail: `Resolved donor ID: ${donorRecord.id}`,
      durationMs: Date.now() - t1,
    };
    logger.info(`[GiftWriteBack] Donor resolved: ${donorRecord.id}`);
  } catch (err: unknown) {
    result.steps.donorResolved = {
      status: 'error',
      detail: String(err),
      durationMs: Date.now() - t1,
    };
    logger.error('[GiftWriteBack] Donor resolution failed', err);
    // Can't proceed without a donor
    result.totalDurationMs = Date.now() - start;
    await finalizeAudit(db, gift, result);
    return result;
  }

  // ── Step 2: Create Salesforce Opportunity ───────────────────
  const t2 = Date.now();
  let sfOppId: string | null = null;
  if (donorRecord.sfContactId) {
    try {
      const closeDate = new Date(gift.confirmedAt).toISOString().split('T')[0];
      const fundGauId = await resolveGAUId(db, gift.orgId, gift.designation);
      const oppName   = `${gift.donor.firstName} ${gift.donor.lastName} – ${formatDesig(gift.designation)} ${new Date().getFullYear()}`;

      sfOppId = await createOpportunity({
        contactId:   donorRecord.sfContactId,
        accountId:   donorRecord.sfAccountId ?? donorRecord.sfContactId,
        amount:      gift.amountCents,
        closeDate,
        stageName:   'Closed Won',
        name:        oppName,
        fundGauId:   fundGauId ?? undefined,
        campaignId:  donorRecord.activeCampaignId ?? undefined,
      });

      result.sfOpportunityId = sfOppId;
      result.steps.sfOpportunity = {
        status: 'success',
        detail: `Opp created: ${sfOppId}`,
        durationMs: Date.now() - t2,
      };

      // Store SF Opp ID back on payment record
      await db('payments')
        .where({ id: gift.paymentId })
        .update({ sf_opportunity_id: sfOppId, synced_to_crm_at: new Date() });

      logger.info(`[GiftWriteBack] SF Opportunity created: ${sfOppId}`);
    } catch (err: unknown) {
      result.steps.sfOpportunity = {
        status: 'error',
        detail: String(err),
        durationMs: Date.now() - t2,
      };
      logger.error('[GiftWriteBack] SF Opportunity creation failed', err);
      // Non-fatal — continue with remaining steps
    }
  } else {
    result.steps.sfOpportunity = {
      status: 'skipped',
      detail: 'No SF Contact ID — CRM sync disabled or donor not yet matched',
      durationMs: 0,
    };
  }

  // ── Step 3: Create npe01__OppPayment__c record ───────────────
  const t3 = Date.now();
  if (sfOppId && process.env.ENABLE_SALESFORCE === 'true') {
    try {
      const client = await getSFClient();
      const paymentBody = {
        npe01__Opportunity__c:  sfOppId,
        npe01__Payment_Amount__c: gift.amountCents / 100,
        npe01__Payment_Date__c:   new Date(gift.confirmedAt).toISOString().split('T')[0],
        npe01__Paid__c:           true,
        npe01__Payment_Method__c: 'Credit Card',
        Orbit_Payment_ID__c:      gift.paymentId,
        Orbit_Stripe_Intent__c:   gift.stripeIntentId,
      };
      await client.post('/sobjects/npe01__OppPayment__c', paymentBody);
      result.steps.sfPayment = {
        status: 'success',
        detail: `OppPayment linked to ${sfOppId}`,
        durationMs: Date.now() - t3,
      };
      logger.info(`[GiftWriteBack] OppPayment created for Opp ${sfOppId}`);
    } catch (err: unknown) {
      result.steps.sfPayment = {
        status: 'error',
        detail: String(err),
        durationMs: Date.now() - t3,
      };
      logger.warn('[GiftWriteBack] OppPayment creation failed (non-fatal)', err);
    }
  } else {
    result.steps.sfPayment = {
      status: 'skipped',
      detail: sfOppId ? 'SF disabled' : 'No Opp ID to link',
      durationMs: 0,
    };
  }

  // ── Step 4: Update Orbit donor record ───────────────────────
  const t4 = Date.now();
  try {
    await updateOrbitDonor(db, donorRecord.id, gift);
    result.steps.orbitDonorUpdate = {
      status: 'success',
      detail: 'Lifetime giving, last_gift, streak updated',
      durationMs: Date.now() - t4,
    };
    logger.info(`[GiftWriteBack] Orbit donor ${donorRecord.id} updated`);
  } catch (err: unknown) {
    result.steps.orbitDonorUpdate = {
      status: 'error',
      detail: String(err),
      durationMs: Date.now() - t4,
    };
    logger.error('[GiftWriteBack] Orbit donor update failed', err);
  }

  // ── Step 5: Trigger VSO stewardship email ───────────────────
  const t5 = Date.now();
  if (!gift.donor.anonymous) {
    try {
      await triggerStewardshipEmail(gift, donorRecord);
      result.steps.stewardshipEmail = {
        status: 'success',
        detail: `Stewardship email queued to ${gift.donor.email}`,
        durationMs: Date.now() - t5,
      };
      logger.info(`[GiftWriteBack] Stewardship email queued for ${gift.donor.email}`);
    } catch (err: unknown) {
      result.steps.stewardshipEmail = {
        status: 'error',
        detail: String(err),
        durationMs: Date.now() - t5,
      };
      logger.warn('[GiftWriteBack] Stewardship email failed (non-fatal)', err);
    }
  } else {
    result.steps.stewardshipEmail = {
      status: 'skipped',
      detail: 'Anonymous donor — no email sent',
      durationMs: 0,
    };
  }

  // ── Step 6: Matching gift reminder (24h delay) ───────────────
  const t6 = Date.now();
  if (gift.employerName && !gift.donor.anonymous) {
    try {
      await scheduleMatchingGiftReminder(db, gift, donorRecord);
      result.steps.matchReminder = {
        status: 'success',
        detail: `24h match reminder scheduled for ${gift.employerName}`,
        durationMs: Date.now() - t6,
      };
      logger.info(`[GiftWriteBack] Match reminder scheduled for ${gift.employerName}`);
    } catch (err: unknown) {
      result.steps.matchReminder = {
        status: 'error',
        detail: String(err),
        durationMs: Date.now() - t6,
      };
      logger.warn('[GiftWriteBack] Match reminder scheduling failed', err);
    }
  } else {
    result.steps.matchReminder = {
      status: 'skipped',
      detail: gift.employerName ? 'Anonymous donor' : 'No employer detected',
      durationMs: 0,
    };
  }

  // ── Finalize ─────────────────────────────────────────────────
  const criticalFailed =
    result.steps.donorResolved.status === 'error' ||
    result.steps.orbitDonorUpdate.status === 'error';

  result.success         = !criticalFailed;
  result.totalDurationMs = Date.now() - start;

  await finalizeAudit(db, gift, result);
  logger.info(`[GiftWriteBack] Completed in ${result.totalDurationMs}ms. Success: ${result.success}`, {
    steps: Object.fromEntries(
      Object.entries(result.steps).map(([k,v]) => [k, v.status])
    ),
  });

  return result;
}

// ─── Donor resolution ────────────────────────────────────────────

interface DonorRecord {
  id:               string;
  sfContactId:      string | null;
  sfAccountId:      string | null;
  activeCampaignId: string | null;
  lifetimeGiving:   number;  // cents
  givingStreak:     number;
  firstGiftYear:    number | null;
  isFirstGift:      boolean;
}

async function resolveDonor(db: ReturnType<typeof getDB>, gift: IncomingGift): Promise<DonorRecord> {
  // 1. If we have an explicit donor ID, use it
  if (gift.donorId) {
    const row = await db('donors').where({ id: gift.donorId, org_id: gift.orgId }).first();
    if (row) return mapDonorRow(row, false);
  }

  // 2. Look up by email (exact match)
  if (gift.donor.email) {
    const row = await db('donors')
      .where({ org_id: gift.orgId })
      .whereRaw('LOWER(email) = ?', [gift.donor.email.toLowerCase()])
      .first();
    if (row) return mapDonorRow(row, false);
  }

  // 3. Create new donor record
  const [newRow] = await db('donors').insert({
    org_id:          gift.orgId,
    first_name:      gift.donor.firstName,
    last_name:       gift.donor.lastName,
    email:           gift.donor.email || null,
    phone:           gift.donor.phone || null,
    address:         gift.donor.address || null,
    city:            gift.donor.city || null,
    state:           gift.donor.state || null,
    zip:             gift.donor.zip || null,
    country:         gift.donor.country || 'US',
    stage:           'stewarded',
    lifetime_giving: 0,
    last_gift_amount: 0,
    last_gift_date:  null,
    giving_streak:   0,
    created_at:      new Date(),
    updated_at:      new Date(),
    source:          'orbit_giving_form',
    form_id:         gift.formId || null,
  }).returning('*');

  logger.info(`[GiftWriteBack] New donor created: ${newRow.id} (${gift.donor.email})`);
  return mapDonorRow(newRow, true);
}

function mapDonorRow(row: Record<string, unknown>, isNew: boolean): DonorRecord {
  return {
    id:               String(row.id),
    sfContactId:      (row.sf_contact_id as string) ?? null,
    sfAccountId:      (row.sf_account_id as string) ?? null,
    activeCampaignId: (row.active_campaign_id as string) ?? null,
    lifetimeGiving:   Number(row.lifetime_giving) || 0,
    givingStreak:     Number(row.giving_streak) || 0,
    firstGiftYear:    row.first_gift_year ? Number(row.first_gift_year) : null,
    isFirstGift:      isNew || Number(row.lifetime_giving) === 0,
  };
}

// ─── Orbit donor update ──────────────────────────────────────────

async function updateOrbitDonor(
  db: ReturnType<typeof getDB>,
  donorId: string,
  gift: IncomingGift,
): Promise<void> {
  const current = await db('donors').where({ id: donorId }).first();
  if (!current) throw new Error(`Donor ${donorId} not found for update`);

  const thisYear        = new Date().getFullYear();
  const lastGiftYear    = current.last_gift_date
    ? new Date(current.last_gift_date).getFullYear()
    : null;
  const newStreak       = lastGiftYear === thisYear - 1 || lastGiftYear === thisYear
    ? (Number(current.giving_streak) || 0) + 1
    : 1;
  const newLifetime     = (Number(current.lifetime_giving) || 0) + gift.amountCents;
  const isFirstGift     = !current.last_gift_date;

  await db('donors').where({ id: donorId }).update({
    lifetime_giving:   newLifetime,
    last_gift_amount:  gift.amountCents,
    last_gift_date:    new Date(gift.confirmedAt),
    last_gift_fund:    gift.designation,
    giving_streak:     newStreak,
    first_gift_year:   current.first_gift_year ?? thisYear,
    stage:             'stewarded',
    updated_at:        new Date(),
  });

  // Insert gift row
  await db('gifts').insert({
    donor_id:         donorId,
    org_id:           gift.orgId,
    amount:           gift.amountCents,
    date:             new Date(gift.confirmedAt),
    frequency:        gift.frequency,
    designation:      gift.designation,
    stripe_intent_id: gift.stripeIntentId,
    payment_id:       gift.paymentId,
    form_id:          gift.formId || null,
    employer_match:   gift.employerName || null,
    is_first_gift:    isFirstGift,
    created_at:       new Date(),
  });
}

// ─── Stewardship email ───────────────────────────────────────────

async function triggerStewardshipEmail(
  gift: IncomingGift,
  donor: DonorRecord,
): Promise<void> {
  const amtFormatted  = `$${(gift.amountCents / 100).toLocaleString()}`;
  const desigLabel    = formatDesig(gift.designation);
  const isFirstGift   = donor.isFirstGift;
  const isRecurring   = gift.frequency !== 'once';
  const matchNote     = gift.employerName
    ? `We noticed you listed ${gift.employerName} as your employer — check your HR portal to submit a matching gift request and potentially double your impact!`
    : '';

  // Choose template based on gift type
  const template = isFirstGift ? 'welcome' : isRecurring ? 'stewardship' : 'stewardship';

  await sendTemplateEmail({
    to:       gift.donor.email,
    toName:   `${gift.donor.firstName} ${gift.donor.lastName}`,
    template,
    subject:  isFirstGift
      ? `Welcome to the Greenfield family, ${gift.donor.firstName}!`
      : `Your ${amtFormatted} gift is making a difference`,
    data: {
      first_name:       gift.donor.firstName,
      last_name:        gift.donor.lastName,
      gift_amount:      amtFormatted,
      gift_frequency:   isRecurring ? `/${gift.frequency}` : ' one-time',
      designation:      desigLabel,
      is_first_gift:    isFirstGift,
      is_recurring:     isRecurring,
      giving_streak:    donor.givingStreak + 1,
      lifetime_giving:  `$${((donor.lifetimeGiving + gift.amountCents) / 100).toLocaleString()}`,
      match_note:       matchNote,
      receipt_date:     new Date(gift.confirmedAt).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
      }),
      // VSO will personalise impact story; for now use a template default
      impact_story:     getImpactStatement(gift.designation, gift.amountCents),
    },
    customArgs: {
      orbit_donor_id:  donor.id,
      orbit_payment_id: gift.paymentId,
      orbit_agent:     'VSO',
    },
  });

  // Trigger VSO to generate a personalised follow-up (async — fire and forget)
  if (process.env.ENABLE_AI_AGENTS === 'true') {
    runAgentForDonor('VSO', donor.id, gift.orgId, {
      triggerType: 'gift_received',
      giftAmount:  gift.amountCents,
      designation: gift.designation,
      isFirstGift: donor.isFirstGift,
    }).catch((err: unknown) =>
      logger.warn('[GiftWriteBack] VSO async trigger failed', err),
    );
  }
}

// ─── Matching gift reminder ──────────────────────────────────────

async function scheduleMatchingGiftReminder(
  db: ReturnType<typeof getDB>,
  gift: IncomingGift,
  donor: DonorRecord,
): Promise<void> {
  // Store a scheduled task for 24h from now
  const sendAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db('scheduled_messages').insert({
    org_id:      gift.orgId,
    donor_id:    donor.id,
    type:        'matching_gift_reminder',
    channel:     'email',
    send_at:     sendAt,
    template:    'matchingGiftReminder',
    template_data: JSON.stringify({
      first_name:    gift.donor.firstName,
      employer_name: gift.employerName,
      gift_amount:   `$${(gift.amountCents / 100).toLocaleString()}`,
      designation:   formatDesig(gift.designation),
    }),
    status:      'scheduled',
    created_at:  new Date(),
    created_by:  'VSO',
    reference_id: gift.paymentId,
  }).onConflict(['donor_id','type','reference_id']).ignore();
}

// ─── GAU resolution ──────────────────────────────────────────────

async function resolveGAUId(
  db: ReturnType<typeof getDB>,
  orgId: string,
  designation: string,
): Promise<string | null> {
  const row = await db('sf_gau_map')
    .where({ org_id: orgId, designation_slug: designation })
    .first();
  return row?.sf_gau_id ?? null;
}

// ─── Audit helpers ───────────────────────────────────────────────

async function auditLog(
  db: ReturnType<typeof getDB>,
  orgId: string,
  action: string,
  resourceId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await db('audit_log').insert({
      org_id:      orgId,
      action,
      actor:       'SYSTEM/giftWriteBack',
      resource:    'payment',
      resource_id: resourceId,
      detail:      JSON.stringify(detail),
      created_at:  new Date(),
    });
  } catch (err) {
    // Audit failures must never block business logic
    logger.warn('[GiftWriteBack] Audit log insert failed', err);
  }
}

async function finalizeAudit(
  db: ReturnType<typeof getDB>,
  gift: IncomingGift,
  result: WriteBackResult,
): Promise<void> {
  await auditLog(db, gift.orgId, 'GIFT_WRITEBACK_COMPLETED', gift.paymentId, {
    success:        result.success,
    sfOpportunityId: result.sfOpportunityId,
    totalDurationMs: result.totalDurationMs,
    stepStatuses: Object.fromEntries(
      Object.entries(result.steps).map(([k,v]) => [k, v.status])
    ),
  });
}

// ─── Utility helpers ─────────────────────────────────────────────

function formatDesig(slug: string): string {
  const map: Record<string, string> = {
    annual:      'Annual Fund',
    scholarship: 'Scholarship Fund',
    research:    'Research Excellence',
    athletics:   'Athletics Fund',
    endowment:   'Endowment',
    faculty:     'Faculty Support',
    arts:        'Arts & Culture',
    custom:      'General Giving',
  };
  return map[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

function getImpactStatement(designation: string, amountCents: number): string {
  const amt = amountCents / 100;
  const statements: Record<string, Record<number, string>> = {
    annual:      {25:'buys a textbook for a student in need',50:'covers a lab kit for one semester',100:'funds a student emergency grant',250:'supports one week of research assistant time',500:'provides a micro-scholarship for one month',1000:'funds a semester of peer tutoring for 10 students'},
    scholarship: {25:'covers one student meal',50:'pays for one credit hour',100:'covers textbooks for one course',250:'pays one semester fee',500:'covers two weeks of housing',1000:'funds one full course'},
  };
  const map = statements[designation] || statements.annual;
  const keys = Object.keys(map).map(Number).sort((a,b)=>a-b);
  let impact = map[keys[0]];
  for (const k of keys) { if (amt >= k) impact = map[k]; }
  return `Your gift of $${amt.toLocaleString()} ${impact}.`;
}
