'use strict';
/**
 * Delivery Service
 * ─────────────────────────────────────────────────────────────────────────────
 * The single source of truth for actually sending messages.
 * Called by the outreach worker (scheduled) and the /outreach/:id/send endpoint.
 *
 * Architecture:
 *   outreach_messages (status=scheduled)
 *     → deliverMessage()
 *       → sendViaEmail() / sendViaSMS()
 *         → SendGrid / Twilio API
 *     → update status=sent|failed in DB
 *     → update donor last_contact_at
 *
 * All external calls are guarded by feature flags (ENABLE_EMAIL, ENABLE_SMS).
 * In demo/staging mode they log-only — zero real messages sent.
 */

const db     = require('../db');
const logger = require('../utils/logger');

// ── Lazy-load SDK clients (only initialized if keys present) ──────────────────
let sgMail  = null;
let twilio  = null;

function getSendGrid() {
  if (sgMail) return sgMail;
  const sg = require('@sendgrid/mail');
  sg.setApiKey(process.env.SENDGRID_API_KEY);
  sgMail = sg;
  return sgMail;
}

function getTwilio() {
  if (twilio) return twilio;
  const Twilio = require('twilio');
  twilio = new Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return twilio;
}

// ── Core: deliver a single outreach message by DB id ─────────────────────────
async function deliverMessage(messageId) {
  // Load full message + donor context
  const { rows } = await db.query(
    `SELECT m.*, d.email, d.mobile, d.name as donor_name, d.first_name,
            d.email_opt_out, d.sms_opt_in, d.do_not_contact
     FROM outreach_messages m
     JOIN donors d ON d.id = m.donor_id
     WHERE m.id = $1 AND m.status = 'scheduled'`,
    [messageId]
  );

  const msg = rows[0];
  if (!msg) {
    logger.warn('[Delivery] Message not found or not scheduled', { messageId });
    return { ok: false, reason: 'not_found' };
  }

  // Final compliance checks before send
  if (msg.do_not_contact) {
    await markFailed(messageId, 'do_not_contact');
    return { ok: false, reason: 'do_not_contact' };
  }
  if (msg.channel === 'Email' && msg.email_opt_out) {
    await markFailed(messageId, 'email_opt_out');
    return { ok: false, reason: 'email_opt_out' };
  }
  if (msg.channel === 'SMS' && !msg.sms_opt_in) {
    await markFailed(messageId, 'sms_not_opted_in');
    return { ok: false, reason: 'sms_not_opted_in' };
  }

  try {
    let result;

    if (msg.channel === 'Email') {
      result = await sendViaEmail(msg);
    } else if (msg.channel === 'SMS') {
      result = await sendViaSMS(msg);
    } else {
      // Phone/Note — mark sent (human action, no API call)
      result = { provider_id: null, status: 'sent' };
    }

    // Mark sent in DB
    await db.query(
      `UPDATE outreach_messages
       SET status = 'sent',
           sent_at = NOW(),
           metadata = metadata || $1,
           updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify({ provider_id: result.provider_id, provider_status: result.status }), messageId]
    );

    // Update donor last_contact_at
    await db.query(
      'UPDATE donors SET last_contact_at = NOW(), updated_at = NOW() WHERE id = $1',
      [msg.donor_id]
    );

    // Log agent activity
    await db.query(
      `INSERT INTO agent_activities
         (org_id, agent_key, donor_id, donor_name, type, title, detail, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        msg.org_id, msg.agent_key, msg.donor_id, msg.donor_name,
        `${msg.channel.toLowerCase()}_sent`,
        `${msg.channel} sent to ${msg.donor_name}`,
        msg.subject || msg.body.slice(0, 100),
        JSON.stringify({ messageId, channel: msg.channel, provider_id: result.provider_id }),
      ]
    );

    logger.info('[Delivery] Message sent', {
      messageId, channel: msg.channel, donorId: msg.donor_id,
      provider_id: result.provider_id,
    });

    return { ok: true, provider_id: result.provider_id };

  } catch (err) {
    const reason = classifyError(err);
    await markFailed(messageId, reason, err.message);
    logger.error('[Delivery] Send failed', { messageId, channel: msg.channel, reason, err: err.message });
    return { ok: false, reason, error: err.message };
  }
}

// ── Email via SendGrid ────────────────────────────────────────────────────────
async function sendViaEmail(msg) {
  if (process.env.ENABLE_EMAIL !== 'true') {
    logger.info('[Delivery:Email] Demo mode — would send to:', msg.email);
    return { provider_id: `demo_${Date.now()}`, status: 'demo' };
  }

  if (!msg.email) throw new Error('Donor has no email address');

  const sg = getSendGrid();

  const payload = {
    to:      { email: msg.email, name: msg.donor_name },
    from:    { email: process.env.SENDGRID_FROM_EMAIL || 'noreply@orbit.ai', name: process.env.SENDGRID_FROM_NAME || 'Orbit Advancement' },
    subject: msg.subject || '(no subject)',
    text:    msg.body,
    html:    emailBodyToHtml(msg.body, msg.donor_name),
    trackingSettings: {
      clickTracking: { enable: true, enableText: false },
      openTracking:  { enable: true },
    },
    customArgs: {
      orbit_message_id: msg.id,
      orbit_donor_id:   msg.donor_id,
      orbit_org_id:     msg.org_id,
      orbit_agent:      msg.agent_key,
    },
  };

  const [response] = await sg.send(payload);
  const messageId  = response.headers['x-message-id'] || null;
  return { provider_id: messageId, status: 'sent' };
}

// ── SMS via Twilio ────────────────────────────────────────────────────────────
async function sendViaSMS(msg) {
  if (process.env.ENABLE_SMS !== 'true') {
    logger.info('[Delivery:SMS] Demo mode — would send to:', msg.mobile);
    return { provider_id: `demo_${Date.now()}`, status: 'demo' };
  }

  if (!msg.mobile) throw new Error('Donor has no mobile number');

  const client = getTwilio();
  const body   = msg.body.slice(0, 160); // Single SMS segment

  const message = await client.messages.create({
    body,
    to: normalizePhone(msg.mobile),
    ...(process.env.TWILIO_MESSAGING_SERVICE_SID
      ? { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID }
      : { from: process.env.TWILIO_FROM_NUMBER }),
    statusCallback: `${process.env.API_URL || 'http://localhost:3001'}/api/v1/webhooks/twilio/status`,
    provideFeedback: false,
  });

  return { provider_id: message.sid, status: message.status };
}

// ── Batch delivery: send all due messages for an org ─────────────────────────
async function deliverBatch(orgId, limit = 50) {
  const { rows } = await db.query(
    `SELECT id FROM outreach_messages
     WHERE org_id = $1
       AND status = 'scheduled'
       AND (scheduled_at IS NULL OR scheduled_at <= NOW())
     ORDER BY scheduled_at ASC NULLS FIRST
     LIMIT $2
     FOR UPDATE SKIP LOCKED`,
    [orgId, limit]
  );

  if (!rows.length) return { sent: 0, failed: 0, skipped: 0 };

  const results = await Promise.allSettled(
    rows.map(r => deliverMessage(r.id))
  );

  const sent   = results.filter(r => r.status === 'fulfilled' && r.value?.ok).length;
  const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value?.ok)).length;

  logger.info('[Delivery] Batch complete', { orgId, sent, failed, total: rows.length });
  return { sent, failed, skipped: 0 };
}

// ── Global delivery worker: all orgs with pending messages ───────────────────
async function runDeliveryWorker() {
  const { rows } = await db.query(
    `SELECT DISTINCT org_id FROM outreach_messages
     WHERE status = 'scheduled'
       AND (scheduled_at IS NULL OR scheduled_at <= NOW())
     LIMIT 100`
  );

  if (!rows.length) return;

  logger.info('[Delivery] Worker running', { orgs: rows.length });

  for (const { org_id } of rows) {
    try {
      await deliverBatch(org_id);
    } catch (err) {
      logger.error('[Delivery] Batch error', { org_id, err: err.message });
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function markFailed(messageId, reason, detail = '') {
  await db.query(
    `UPDATE outreach_messages
     SET status = 'failed',
         metadata = metadata || $1,
         updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify({ failed_reason: reason, failed_detail: detail, failed_at: new Date().toISOString() }), messageId]
  );
}

function classifyError(err) {
  const msg = err.message?.toLowerCase() || '';
  if (msg.includes('invalid') && msg.includes('email')) return 'invalid_email';
  if (msg.includes('bounce') || msg.includes('unsubscribed')) return 'bounced';
  if (msg.includes('rate limit') || err.code === 429) return 'rate_limited';
  if (msg.includes('invalid number') || err.code === 21211) return 'invalid_phone';
  if (msg.includes('not opted in') || err.code === 21408) return 'sms_not_opted_in';
  return 'unknown_error';
}

function normalizePhone(phone) {
  // Strip non-digits, ensure E.164
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return `+${digits}`;
}

function emailBodyToHtml(body, donorName) {
  // Minimal HTML wrapper — preserves line breaks, safe for all email clients
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#1a1a1a;max-width:600px;margin:40px auto;padding:0 20px">
  <div style="border-bottom:2px solid #00D4B8;padding-bottom:16px;margin-bottom:28px">
    <img src="${process.env.API_URL || ''}/logo.png" alt="Orbit Advancement" height="32" style="opacity:0.8">
  </div>
  <div>${escaped}</div>
  <div style="margin-top:40px;padding-top:20px;border-top:1px solid #eee;font-size:12px;color:#888">
    <p>You are receiving this because you are a valued supporter.
    <a href="${process.env.CLIENT_URL || ''}/unsubscribe?email={{email}}" style="color:#888">Unsubscribe</a></p>
  </div>
</body>
</html>`;
}

module.exports = { deliverMessage, deliverBatch, runDeliveryWorker };
