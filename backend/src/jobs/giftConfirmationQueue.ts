/**
 * Gift Confirmation Queue Worker
 *
 * Processes jobs from the 'gifts' Bull queue.
 * Jobs are enqueued by the Stripe webhook handler after
 * payment_intent.succeeded is verified.
 *
 * Queue: 'gifts'
 * Job name: 'confirm'
 * Payload: { paymentIntentId: string, donorId: string | null }
 *
 * Retry strategy:
 *   - 3 attempts
 *   - Exponential backoff: 1min, 5min, 30min
 *   - Failed jobs land in 'gifts:failed' for manual review
 */

import Queue from 'bull';
import { logger }              from '../config/logger';
import { getDB }               from '../config/database';
import { processGiftWriteBack } from '../services/giftWriteBackService';
import type { IncomingGift }   from '../services/giftWriteBackService';

// ─── Queue setup ─────────────────────────────────────────────────

const REDIS_CONFIG = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379'),
  password: process.env.REDIS_PASSWORD,
};

export const giftsQueue = new Queue('gifts', {
  redis: REDIS_CONFIG,
  defaultJobOptions: {
    attempts:     3,
    backoff: {
      type:  'exponential',
      delay: 60_000,         // 1 min initial, then 5 min, then 30 min
    },
    removeOnComplete: 100,   // Keep last 100 completed jobs for debugging
    removeOnFail:     500,   // Keep last 500 failed jobs for review
  },
});

// ─── Worker ──────────────────────────────────────────────────────

giftsQueue.process('confirm', 5, async (job) => {
  const { paymentIntentId, donorId } = job.data as {
    paymentIntentId: string;
    donorId:         string | null;
  };

  logger.info(`[GiftsQueue] Processing confirm job ${job.id}`, { paymentIntentId });
  job.progress(5);

  const db = getDB();

  // Load full payment record from DB
  const payment = await db('payments')
    .where({ stripe_payment_intent_id: paymentIntentId })
    .first();

  if (!payment) {
    throw new Error(`Payment record not found for intent ${paymentIntentId}`);
  }

  // Check idempotency — don't double-process
  if (payment.write_back_status === 'completed') {
    logger.info(`[GiftsQueue] Payment ${payment.id} already processed, skipping`);
    return { skipped: true, reason: 'already_processed' };
  }

  job.progress(15);

  // Load form submission data for this payment (donor info + designation)
  const formSubmission = await db('form_submissions')
    .where({ payment_id: payment.id })
    .first();

  // Build IncomingGift — merge payment + form data
  const gift: IncomingGift = {
    paymentId:       payment.id,
    stripeIntentId:  paymentIntentId,
    donorId:         donorId ?? payment.donor_id ?? null,
    orgId:           payment.org_id,
    amountCents:     payment.amount_cents,
    frequency:       (formSubmission?.frequency ?? 'once') as IncomingGift['frequency'],
    designation:     formSubmission?.designation ?? 'annual',
    employerName:    formSubmission?.employer_name ?? null,
    confirmedAt:     payment.paid_at?.toISOString() ?? new Date().toISOString(),
    formId:          formSubmission?.form_id ?? null,
    donor: {
      firstName:  formSubmission?.first_name  ?? payment.donor_first_name ?? 'Friend',
      lastName:   formSubmission?.last_name   ?? payment.donor_last_name  ?? '',
      email:      formSubmission?.email       ?? payment.donor_email      ?? '',
      phone:      formSubmission?.phone       ?? payment.donor_phone,
      address:    formSubmission?.address,
      city:       formSubmission?.city,
      state:      formSubmission?.state,
      zip:        formSubmission?.zip,
      country:    formSubmission?.country ?? 'US',
      anonymous:  formSubmission?.is_anonymous ?? false,
    },
  };

  job.progress(25);

  // Mark in-progress so we don't double-process on retry
  await db('payments').where({ id: payment.id }).update({
    write_back_status: 'in_progress',
    write_back_started_at: new Date(),
  });

  job.progress(30);

  // Run the full write-back pipeline
  const result = await processGiftWriteBack(gift);

  job.progress(95);

  // Update payment record with final status
  await db('payments').where({ id: payment.id }).update({
    write_back_status:       result.success ? 'completed' : 'partial',
    write_back_completed_at: new Date(),
    write_back_result:       JSON.stringify(result),
    sf_opportunity_id:       result.sfOpportunityId ?? null,
  });

  job.progress(100);

  logger.info(`[GiftsQueue] Write-back ${result.success ? 'succeeded' : 'partially failed'}`, {
    paymentId:       payment.id,
    totalDurationMs: result.totalDurationMs,
    sfOppId:         result.sfOpportunityId,
  });

  return result;
});

// ─── Event handlers ──────────────────────────────────────────────

giftsQueue.on('completed', (job, result) => {
  logger.info(`[GiftsQueue] Job ${job.id} completed`, {
    paymentId: job.data.paymentIntentId,
    success:   result?.success,
  });
});

giftsQueue.on('failed', (job, err) => {
  logger.error(`[GiftsQueue] Job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts})`, {
    paymentId: job.data?.paymentIntentId,
    error:     err.message,
    willRetry: job.attemptsMade < (job.opts.attempts ?? 3),
  });
});

giftsQueue.on('stalled', (job) => {
  logger.warn(`[GiftsQueue] Job ${job.id} stalled (worker crashed mid-processing)`);
});

// ─── Scheduled messages processor ────────────────────────────────
// Runs every 5 minutes to dispatch messages whose send_at has arrived

export const scheduledMsgQueue = new Queue('scheduled_messages', {
  redis: REDIS_CONFIG,
});

// Cron-style job to scan and enqueue due messages
export async function drainScheduledMessages(): Promise<void> {
  const db = getDB();
  const due = await db('scheduled_messages')
    .where('send_at', '<=', new Date())
    .where({ status: 'scheduled' })
    .limit(50);

  for (const msg of due) {
    await scheduledMsgQueue.add('send', msg, {
      attempts:  2,
      backoff:   { type: 'fixed', delay: 30_000 },
    });
    await db('scheduled_messages')
      .where({ id: msg.id })
      .update({ status: 'queued', queued_at: new Date() });
  }

  if (due.length) {
    logger.info(`[ScheduledMessages] Enqueued ${due.length} due messages`);
  }
}

scheduledMsgQueue.process('send', 10, async (job) => {
  const msg = job.data;
  const db  = getDB();

  // Dynamic import to avoid circular deps
  const { sendTemplateEmail } = await import('../services/emailService');
  await sendTemplateEmail({
    to:       msg.donor_email,
    toName:   msg.donor_name,
    template: msg.template,
    data:     JSON.parse(msg.template_data ?? '{}'),
  });

  await db('scheduled_messages')
    .where({ id: msg.id })
    .update({ status: 'sent', sent_at: new Date() });

  logger.info(`[ScheduledMessages] Sent ${msg.type} to donor ${msg.donor_id}`);
});
