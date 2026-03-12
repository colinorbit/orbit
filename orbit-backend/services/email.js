/**
 * services/email.js
 *
 * SendGrid v3 Dynamic Transactional Templates
 * Docs: https://docs.sendgrid.com/api-reference/mail-send/mail-send
 *
 * Key patterns from docs research:
 * - Dynamic templates use Handlebars: {{variable}}, {{#if}}, {{#each}}
 * - Template IDs are d-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 * - Personalizations allow 1 API call for up to 1000 recipients with individual data
 * - Event Webhook fires on: delivered, open, click, bounce, spam, unsubscribe
 * - Must ALWAYS return 200 to webhook or SendGrid retries (back-off up to 72h)
 */
'use strict';
const sgMail = require('@sendgrid/mail');
const logger = require('../config/logger');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM = { email: process.env.SENDGRID_FROM_EMAIL, name: process.env.SENDGRID_FROM_NAME };

// Template registry — IDs come from env so they differ between environments
const T = {
  WELCOME:           process.env.SENDGRID_TMPL_WELCOME,
  IMPACT:            process.env.SENDGRID_TMPL_IMPACT,
  GIFT_ASK:          process.env.SENDGRID_TMPL_GIFT_ASK,
  PLEDGE_CONFIRM:    process.env.SENDGRID_TMPL_PLEDGE_CONFIRM,
  PLEDGE_REMINDER:   process.env.SENDGRID_TMPL_PLEDGE_REMINDER,
  STEWARDSHIP:       process.env.SENDGRID_TMPL_STEWARDSHIP,
  THANK_YOU:         process.env.SENDGRID_TMPL_THANK_YOU,
  PLANNED_GIVING:    process.env.SENDGRID_TMPL_PLANNED_GIVING,
  LAPSED:            process.env.SENDGRID_TMPL_LAPSED,
  CAMPAIGN_LAUNCH:   process.env.SENDGRID_TMPL_CAMPAIGN_LAUNCH,
  CAMPAIGN_REMINDER: process.env.SENDGRID_TMPL_CAMPAIGN_REMINDER,
};

// ── Core send (single recipient) ──────────────────────────────────────────────
async function sendTemplate({ to, toName, templateId, data = {}, replyTo }) {
  const msg = {
    to: { email: to, name: toName },
    from: FROM,
    templateId,
    dynamicTemplateData: {
      ...data,
      current_year: new Date().getFullYear(),
    },
    trackingSettings: {
      clickTracking: { enable: true },
      openTracking:  { enable: true },
    },
  };
  if (replyTo) msg.replyTo = replyTo;

  const [res] = await sgMail.send(msg);
  const mid = res.headers['x-message-id'];
  logger.info(`Email → ${to} [${mid}] tmpl:${templateId}`);
  return { messageId: mid };
}

// ── Bulk send (personalizations) — 1 API call, up to 1000 recipients ─────────
async function sendBulk(templateId, recipients, sharedData = {}) {
  const BATCH = 1000;
  const results = [];
  for (let i = 0; i < recipients.length; i += BATCH) {
    const batch = recipients.slice(i, i + BATCH);
    const msg = {
      from: FROM,
      templateId,
      personalizations: batch.map(r => ({
        to: [{ email: r.to, name: r.toName }],
        dynamicTemplateData: { ...sharedData, ...r.data, current_year: new Date().getFullYear() },
      })),
    };
    const [res] = await sgMail.send(msg);
    results.push({ count: batch.length, messageId: res.headers['x-message-id'] });
    logger.info(`Bulk email batch: ${batch.length} recipients`);
  }
  return results;
}

// ── Pre-built email helpers ────────────────────────────────────────────────────

// Agent-driven donor outreach
async function sendAgentEmail({ donor, agent, orgName, emailType, customData = {} }) {
  const MAP = {
    introduction:   T.WELCOME,
    impact:         T.IMPACT,
    gift_ask:       T.GIFT_ASK,
    stewardship:    T.STEWARDSHIP,
    planned_giving: T.PLANNED_GIVING,
    lapsed:         T.LAPSED,
    thank_you:      T.THANK_YOU,
  };
  const templateId = MAP[emailType];
  if (!templateId) throw new Error(`Unknown emailType: ${emailType}`);

  return sendTemplate({
    to: donor.email,
    toName: `${donor.firstName} ${donor.lastName}`,
    templateId,
    data: {
      donor_first_name: donor.firstName,
      donor_last_name:  donor.lastName,
      donor_full_name:  `${donor.firstName} ${donor.lastName}`,
      agent_name:       agent.name,
      org_name:         orgName,
      lifetime_giving:  donor.lifetimeGiving,
      last_gift_amount: donor.lastGiftAmount,
      last_gift_year:   donor.lastGiftDate ? new Date(donor.lastGiftDate).getFullYear() : null,
      interests:        (donor.interests || []).join(', '),
      unsubscribe_url:  `${process.env.CLIENT_URL}/unsubscribe?token=__PLACEHOLDER__`,
      ...customData,
    },
  });
}

// Pledge confirmation
async function sendPledgeConfirm({ donor, gift, agreementUrl, orgName }) {
  const fmt = (n) => parseFloat(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return sendTemplate({
    to: donor.email, toName: `${donor.firstName} ${donor.lastName}`,
    templateId: T.PLEDGE_CONFIRM,
    data: {
      donor_first_name: donor.firstName,
      gift_amount:      fmt(gift.amount),
      fund_name:        gift.fund || 'General Fund',
      agreement_url:    agreementUrl,
      pledge_start:     gift.pledgeStart ? new Date(gift.pledgeStart).toLocaleDateString() : null,
      org_name: orgName,
    },
  });
}

// Pledge installment reminder
async function sendPledgeReminder({ donor, installment, gift, orgName, agentName }) {
  const fmt = (n) => parseFloat(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return sendTemplate({
    to: donor.email, toName: `${donor.firstName} ${donor.lastName}`,
    templateId: T.PLEDGE_REMINDER,
    data: {
      donor_first_name:   donor.firstName,
      installment_amount: fmt(installment.amount),
      due_date: new Date(installment.dueDate).toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' }),
      installment_num:    installment.num,
      total_installments: gift.installments,
      payment_url:        `${process.env.CLIENT_URL}/give/pledge/${gift.id}`,
      agent_name:         agentName,
      org_name:           orgName,
    },
  });
}

module.exports = { sendTemplate, sendBulk, sendAgentEmail, sendPledgeConfirm, sendPledgeReminder, T };
