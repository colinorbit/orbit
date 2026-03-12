/**
 * SMS Service – Twilio Programmable Messaging API
 *
 * Integration notes from docs:
 *  • Base URL: https://api.twilio.com/2010-04-01
 *  • Auth: HTTP Basic — Account SID (username) + Auth Token (password)
 *  • Recommended: use Messaging Service SID (not From number) for A2P 10DLC compliance
 *  • Twilio recommends API keys (not raw auth token) in production
 *  • SMS body max: 1,600 chars; standard SMS segment: 160 GSM-7 chars
 *  • Outbound status delivered via statusCallback webhook
 *  • Rate limits vary by number type; Messaging Services handle opt-out compliance
 *
 * Compliance:
 *  • All SMS outreach requires donor opt-in (TCPA)
 *  • Messaging Service automatically handles STOP/HELP replies
 *  • For A2P 10DLC: brand + campaign registration required (Twilio console)
 */

import twilio from 'twilio';
import { logger } from '../config/logger';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID;
const FROM_NUMBER            = process.env.TWILIO_FROM_NUMBER;

interface SendSMSOptions {
  to:              string;   // E.164 format: +15551234567
  body:            string;   // max 160 chars for single segment
  donorId:         string;   // stored in message metadata for tracking
  touchpointId?:   string;
}

interface SMSResult {
  sid:    string;
  status: string;
}

export async function sendSMS(opts: SendSMSOptions): Promise<SMSResult | null> {
  if (process.env.ENABLE_SMS !== 'true') {
    logger.debug('[SMS] Disabled — would have sent to:', opts.to);
    return null;
  }

  // Truncate to 160 chars to keep it single-segment (cost + deliverability)
  const body = opts.body.slice(0, 160);

  try {
    const message = await client.messages.create({
      body,
      // Prefer Messaging Service (handles compliance, retry logic, number pooling)
      // Fall back to direct number if MSS not configured
      ...(MESSAGING_SERVICE_SID
        ? { messagingServiceSid: MESSAGING_SERVICE_SID }
        : { from: FROM_NUMBER }
      ),
      to: opts.to,
      // Status callback for delivery tracking
      statusCallback: `${process.env.API_URL}/api/webhooks/twilio/status`,
      // Tag with donor ID for analytics
      provideFeedback: false,
    });

    logger.info(`[SMS] Sent to ${opts.to} | SID: ${message.sid} | Status: ${message.status}`);
    return { sid: message.sid, status: message.status };

  } catch (err: unknown) {
    const twilioErr = err as { code?: number; message?: string; status?: number };
    // 21211 = invalid 'To' number | 21408 = permission not enabled for region
    logger.error('[SMS] Twilio error', {
      to:      opts.to,
      code:    twilioErr.code,
      message: twilioErr.message,
      status:  twilioErr.status,
    });
    throw err;
  }
}

/**
 * Fetch message status (for polling if webhook not received)
 * GET /2010-04-01/Accounts/{SID}/Messages/{MessageSID}
 */
export async function getSMSStatus(messageSid: string): Promise<string> {
  const msg = await client.messages(messageSid).fetch();
  return msg.status;
}

/**
 * Validate an incoming Twilio webhook signature.
 * Must be called on every inbound Twilio webhook to prevent spoofing.
 *
 * @param url       Full URL of the webhook endpoint
 * @param params    Parsed POST body params
 * @param signature X-Twilio-Signature header value
 */
export function validateTwilioSignature(
  url:       string,
  params:    Record<string, string>,
  signature: string
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? '';
  return twilio.validateRequest(authToken, signature, url, params);
}
