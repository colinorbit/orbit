/**
 * Email Service – SendGrid v3 API
 *
 * Integration notes from docs:
 *  • Base URL: https://api.sendgrid.com/v3/mail/send
 *  • Auth: Bearer token (SENDGRID_API_KEY)
 *  • Dynamic templates use Handlebars syntax: {{variable}}
 *  • templateId must match an ACTIVE version in the SendGrid dashboard
 *  • dynamicTemplateData keys must match {{variables}} in your template exactly
 *  • For unsubscribe compliance, all templates MUST include an unsubscribe module
 *  • SendGrid Event Webhooks let us track opens/clicks/bounces (set up in Settings)
 */

import sgMail from '@sendgrid/mail';
import { logger } from '../config/logger';

sgMail.setApiKey(process.env.SENDGRID_API_KEY ?? '');

// ─── Template IDs (set in .env) ─────────────────────────────────

const TEMPLATES = {
  welcome:         process.env.SENDGRID_TMPL_WELCOME         ?? '',
  impactUpdate:    process.env.SENDGRID_TMPL_IMPACT_UPDATE   ?? '',
  giftAsk:         process.env.SENDGRID_TMPL_GIFT_ASK        ?? '',
  pledgeConfirm:   process.env.SENDGRID_TMPL_PLEDGE_CONFIRM  ?? '',
  pledgeReminder:  process.env.SENDGRID_TMPL_PLEDGE_REMINDER ?? '',
  stewardship:     process.env.SENDGRID_TMPL_STEWARDSHIP     ?? '',
  campaignLaunch:  process.env.SENDGRID_TMPL_CAMPAIGN_LAUNCH ?? '',
  legacyIntro:     process.env.SENDGRID_TMPL_LEGACY_INTRO    ?? '',
  giftReceipt:     process.env.SENDGRID_TMPL_GIFT_RECEIPT    ?? '',
} as const;

export type EmailTemplate = keyof typeof TEMPLATES;

// ─── Send helpers ────────────────────────────────────────────────

interface SendOptions {
  to:          string;
  toName?:     string;
  template:    EmailTemplate;
  data:        Record<string, unknown>;   // Handlebars variables
  /** Override subject if template doesn't set one */
  subject?:    string;
  /** Track opens/clicks with custom args for analytics */
  customArgs?: Record<string, string>;
}

export async function sendTemplateEmail(opts: SendOptions): Promise<void> {
  if (process.env.ENABLE_EMAIL !== 'true') {
    logger.debug('[Email] Disabled — would have sent:', opts.template, 'to', opts.to);
    return;
  }

  const templateId = TEMPLATES[opts.template];
  if (!templateId) {
    logger.warn(`[Email] No template ID configured for "${opts.template}"`);
    return;
  }

  const msg: sgMail.MailDataRequired = {
    to:   opts.toName ? { email: opts.to, name: opts.toName } : opts.to,
    from: { email: process.env.SENDGRID_FROM_EMAIL!, name: process.env.SENDGRID_FROM_NAME },
    templateId,
    dynamicTemplateData: {
      ...opts.data,
      // Ensure these keys are always available in templates
      currentYear: new Date().getFullYear(),
      unsubscribeUrl: `${process.env.CLIENT_URL}/unsubscribe?token={{unsubscribe_token}}`,
    },
    ...(opts.subject && { subject: opts.subject }),
    ...(opts.customArgs && { customArgs: opts.customArgs }),
    trackingSettings: {
      clickTracking:  { enable: true, enableText: false },
      openTracking:   { enable: true },
    },
  };

  try {
    const [response] = await sgMail.send(msg);
    logger.info(`[Email] Sent ${opts.template} to ${opts.to} — ${response.statusCode}`);
  } catch (err: unknown) {
    const sgErr = err as { response?: { body?: unknown }; message?: string };
    logger.error('[Email] SendGrid error', {
      template: opts.template,
      to:       opts.to,
      body:     sgErr.response?.body,
      message:  sgErr.message,
    });
    throw err;
  }
}

// ─── Convenience senders (used by agent action executor) ─────────

export async function sendWelcome(to: string, toName: string, data: {
  orgName:       string;
  agentName:     string;
  optInUrl:      string;
  optOutUrl:     string;
}): Promise<void> {
  await sendTemplateEmail({ to, toName, template: 'welcome', data });
}

export async function sendImpactUpdate(to: string, toName: string, data: {
  orgName:      string;
  agentName:    string;
  programName:  string;
  impactStory:  string;
  metrics?:     Array<{ label: string; value: string }>;
  giftAmount?:  string;
}): Promise<void> {
  await sendTemplateEmail({ to, toName, template: 'impactUpdate', data });
}

export async function sendGiftAsk(to: string, toName: string, data: {
  orgName:       string;
  agentName:     string;
  donorFirstName: string;
  askAmount:     string;
  fundName:      string;
  impactStatement: string;
  donateUrl:     string;
  isUpgrade:     boolean;
  multiYear:     boolean;
  subject:       string;
}): Promise<void> {
  await sendTemplateEmail({ to, toName, template: 'giftAsk', data, subject: data.subject });
}

export async function sendGiftReceipt(to: string, toName: string, data: {
  orgName:       string;
  donorFirstName: string;
  giftAmount:    string;
  giftDate:      string;
  fundName:      string;
  taxReceiptText: string;
  receiptNumber: string;
}): Promise<void> {
  await sendTemplateEmail({ to, toName, template: 'giftReceipt', data });
}

export async function sendPledgeReminder(to: string, toName: string, data: {
  orgName:           string;
  agentName:         string;
  donorFirstName:     string;
  installmentAmount: string;
  dueDate:           string;
  totalPledge:       string;
  payUrl:            string;
}): Promise<void> {
  await sendTemplateEmail({ to, toName, template: 'pledgeReminder', data });
}
