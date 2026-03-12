/**
 * services/twilio.js
 *
 * Twilio Programmable Messaging
 * Docs: https://www.twilio.com/docs/messaging/api/message-resource
 *
 * Key patterns from docs research:
 * - All phones must be E.164: +12125551234
 * - Inbound webhooks POST urlencoded to your URL — use express.urlencoded() NOT express.json()
 * - Validate signature with twilio.validateRequest(authToken, signature, url, params)
 * - TwiML response: Content-Type: text/xml, even if empty <Response/>
 * - Status callbacks arrive at statusCallback URL (separate from inbound webhook)
 * - STOP/START are handled automatically by Twilio but you must update opt-in in your DB
 */
'use strict';
const twilio = require('twilio');
const logger = require('../config/logger');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const FROM   = process.env.TWILIO_PHONE_NUMBER;

// Convert any US phone format to E.164
function toE164(phone) {
  const d = phone.replace(/\D/g, '');
  if (d.length === 10)                    return `+1${d}`;
  if (d.length === 11 && d[0] === '1')    return `+${d}`;
  return `+${d}`;
}

// Send a single SMS
async function sendSMS({ to, body, statusCallbackUrl }) {
  const params = { body, to: toE164(to), from: FROM };
  if (statusCallbackUrl) params.statusCallback = statusCallbackUrl;
  const msg = await client.messages.create(params);
  logger.info(`SMS → ${to} [${msg.sid}] ${msg.status}`);
  return { sid: msg.sid, status: msg.status };
}

// Send bulk SMS with 100ms spacing
async function sendBulkSMS(messages) {
  const results = [];
  for (const m of messages) {
    try {
      const r = await sendSMS(m);
      results.push({ ...m, ...r });
    } catch (e) {
      results.push({ ...m, error: e.message, status: 'failed' });
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return results;
}

// Express middleware: validate X-Twilio-Signature
// Place BEFORE route handler on inbound SMS route
function validateSignature(req, res, next) {
  const sig = req.headers['x-twilio-signature'];
  // Reconstruct full URL exactly as Twilio sees it
  const url = `${process.env.NODE_ENV === 'production' ? 'https' : 'http'}://${req.hostname}${req.originalUrl}`;
  const valid = twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, sig, url, req.body);
  if (!valid && process.env.NODE_ENV === 'production') {
    logger.warn(`Invalid Twilio sig from ${req.ip}`);
    return res.status(403).send('Forbidden');
  }
  next();
}

// Parse inbound SMS webhook body (urlencoded)
function parseInbound(body) {
  return {
    sid:       body.MessageSid,
    from:      body.From,
    to:        body.To,
    text:      (body.Body || '').trim(),
    numMedia:  parseInt(body.NumMedia) || 0,
    fromCity:  body.FromCity,
    fromState: body.FromState,
  };
}

// Build TwiML reply (pass null for silent ack)
function twimlReply(text) {
  const R = twilio.twiml.MessagingResponse;
  const twiml = new R();
  if (text) twiml.message(text);
  return twiml.toString();
}

// Fetch message delivery status
async function getStatus(sid) {
  const m = await client.messages(sid).fetch();
  return { sid: m.sid, status: m.status, errorCode: m.errorCode };
}

// Opt-out / opt-in detection (Twilio handles STOP automatically but we mirror in DB)
const OPT_OUT = /^(stop|stopall|unsubscribe|cancel|end|quit)$/i;
const OPT_IN  = /^(start|yes|unstop)$/i;
const isOptOut = (text) => OPT_OUT.test(text.trim());
const isOptIn  = (text) => OPT_IN.test(text.trim());

module.exports = { sendSMS, sendBulkSMS, validateSignature, parseInbound, twimlReply, getStatus, isOptOut, isOptIn, toE164 };
