'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ORBIT PAYMENT GATEWAY ROUTES  v1.0
 *
 *  PCI DSS Compliance: SAQ-A
 *    - Orbit NEVER receives, stores, or logs raw card data
 *    - All card capture happens in gateway-hosted JS/iframe
 *    - Orbit only handles opaque tokens after client-side tokenization
 *    - Tokens are used once and never stored in Orbit's DB
 *
 *  Routes:
 *    GET  /payment/gateways                    → list all supported gateways + metadata
 *    GET  /payment/config                      → get this org's gateway config (public fields only)
 *    POST /payment/config                      → save/update gateway config (admin only)
 *    POST /payment/config/validate             → test gateway credentials live
 *    POST /payment/charge                      → process a tokenized payment
 *    POST /payment/session                     → create hosted session (TouchNet/CashNet redirect)
 *    POST /payment/recurring                   → set up recurring gift
 *    DELETE /payment/recurring/:subscriptionId → cancel recurring gift
 *    POST /payment/refund                      → refund a transaction (director+ only)
 *    POST /payment/webhook/:gateway            → inbound gateway webhooks (unauthenticated)
 *    GET  /payment/transactions                → transaction log for this org
 * ═══════════════════════════════════════════════════════════════════════════
 */

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const logger   = require('../utils/logger');
const crypto   = require('crypto');
const { authenticate, tenantScope, requireRole } = require('../middleware/auth');
const { GatewayRouter, GatewayError, GATEWAY_META } = require('../services/paymentGateway');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Load org gateway config from DB, decrypt sensitive fields */
async function loadGatewayConfig(orgId) {
  const { rows } = await db.query(
    `SELECT gateway, gateway_config_enc, gateway_config_public
     FROM orgs WHERE id = $1`,
    [orgId]
  );
  if (!rows.length) throw new Error('Org not found');
  const row = rows[0];

  let gatewayConfig = {};
  if (row.gateway_config_enc) {
    try {
      gatewayConfig = decrypt(row.gateway_config_enc);
    } catch(e) {
      logger.error('Failed to decrypt gateway config', { orgId, err: e.message });
    }
  }

  return {
    gateway:      row.gateway || 'stripe',
    gatewayConfig,
    publicConfig: row.gateway_config_public || {},
  };
}

/** AES-256-GCM encryption for gateway credentials at rest */
const ENCRYPTION_KEY = Buffer.from(
  process.env.GATEWAY_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex').slice(0,64),
  'hex'
);

function encrypt(obj) {
  const iv         = crypto.randomBytes(12);
  const cipher     = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted  = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(enc) {
  const [ivHex, tagHex, dataHex] = enc.split(':');
  const iv       = Buffer.from(ivHex, 'hex');
  const authTag  = Buffer.from(tagHex, 'hex');
  const data     = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

/** Redact sensitive keys before returning config to client */
function redactConfig(config) {
  const sensitive = ['secretKey','transactionKey','password','clientSecret','accessToken','refreshToken','postingKey','subscriptionKey'];
  const redacted  = { ...config };
  for (const key of sensitive) {
    if (redacted[key]) redacted[key] = '••••••••' + String(redacted[key]).slice(-4);
  }
  return redacted;
}

/** Log a transaction to the orbit_transactions table */
async function logTransaction(orgId, tx) {
  try {
    await db.query(
      `INSERT INTO orbit_transactions
         (org_id, gateway, transaction_id, amount, currency, status,
          donor_id, gift_type, fund, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (gateway, transaction_id) DO NOTHING`,
      [
        orgId,
        tx.gateway,
        tx.transactionId,
        tx.amount,
        tx.currency || 'USD',
        tx.success ? 'completed' : 'failed',
        tx.donorId || null,
        tx.giftType || 'one_time',
        tx.fund     || null,
        JSON.stringify({ authCode: tx.authCode, last4: tx.last4, pciModel: tx.pciModel, note: tx.note }),
      ]
    );
  } catch(e) {
    logger.error('Failed to log transaction', { err: e.message, tx });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC: List all supported gateways (no auth required for giving forms)
// ═══════════════════════════════════════════════════════════════════════════
router.get('/gateways', (req, res) => {
  res.json({
    gateways: GatewayRouter.listGateways(),
    pciStatement: 'All Orbit-supported gateways use SAQ-A compliant hosted tokenization. Orbit never stores, transmits, or logs raw card numbers.',
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  GET /config — return this org's gateway type + public config
//  Returns redacted credentials (last 4 chars only) for display in admin UI
// ═══════════════════════════════════════════════════════════════════════════
router.get('/config', authenticate, tenantScope, async (req, res) => {
  try {
    const { gateway, gatewayConfig, publicConfig } = await loadGatewayConfig(req.user.orgId);
    res.json({
      gateway,
      config:       redactConfig(gatewayConfig),
      publicConfig,
      meta:         GATEWAY_META[gateway] || null,
      allGateways:  GatewayRouter.listGateways(),
    });
  } catch(e) {
    logger.error('GET /payment/config failed', { err: e.message });
    res.status(500).json({ error: 'ConfigLoadFailed', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  POST /config — save gateway credentials (admin/director only)
//  Sensitive fields encrypted with AES-256-GCM before DB write
// ═══════════════════════════════════════════════════════════════════════════
router.post('/config', authenticate, tenantScope, requireRole('admin', 'director'), async (req, res) => {
  const { gateway, config } = req.body;

  if (!GATEWAY_META[gateway]) {
    return res.status(400).json({ error: 'UnsupportedGateway', supported: Object.keys(GATEWAY_META) });
  }

  // Validate required fields before saving
  const adapter    = GatewayRouter.getAdapter({ gateway, gatewayConfig: config });
  const validation = await adapter.validateConfig();
  if (!validation.valid) {
    return res.status(400).json({
      error:   'InvalidConfig',
      message: `Missing required fields: ${validation.missing.join(', ')}`,
      missing: validation.missing,
    });
  }

  // Separate public config (safe to return to browser) from secret config
  const secretKeys = ['secretKey','transactionKey','password','clientSecret','accessToken','refreshToken','postingKey','subscriptionKey'];
  const publicConfig = {};
  const secretConfig = {};
  for (const [k, v] of Object.entries(config)) {
    if (secretKeys.includes(k)) secretConfig[k] = v;
    else                         publicConfig[k]  = v;
  }

  try {
    const encryptedSecret = encrypt(config); // encrypt full config (incl secrets)

    await db.query(
      `UPDATE orgs
       SET gateway = $1, gateway_config_enc = $2, gateway_config_public = $3, updated_at = NOW()
       WHERE id = $4`,
      [gateway, encryptedSecret, JSON.stringify(publicConfig), req.user.orgId]
    );

    logger.info('Gateway config updated', { orgId: req.user.orgId, gateway, actor: req.user.email });

    res.json({
      success:      true,
      gateway,
      publicConfig,
      meta:         GATEWAY_META[gateway],
    });
  } catch(e) {
    logger.error('POST /payment/config failed', { err: e.message });
    res.status(500).json({ error: 'SaveFailed', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  POST /config/validate — live credential test (admin/director only)
// ═══════════════════════════════════════════════════════════════════════════
router.post('/config/validate', authenticate, tenantScope, requireRole('admin', 'director'), async (req, res) => {
  const { gateway, config } = req.body;
  try {
    const adapter    = GatewayRouter.getAdapter({ gateway, gatewayConfig: config });
    const validation = await adapter.validateConfig();
    const clientConf = await adapter.getClientConfig();

    res.json({
      valid:        validation.valid,
      missing:      validation.missing,
      clientConfig: clientConf,
      pciModel:     adapter.pciModel,
      gateway:      adapter.name,
      displayName:  adapter.displayName,
    });
  } catch(e) {
    res.status(400).json({ valid: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  GET /config/client — public client config for giving forms (no auth)
//  Returns only the public-facing SDK config needed to render the payment form
//  NEVER returns secret keys
// ═══════════════════════════════════════════════════════════════════════════
router.get('/config/client/:orgSlug', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, gateway, gateway_config_public FROM orgs WHERE slug = $1 AND active = true`,
      [req.params.orgSlug]
    );
    if (!rows.length) return res.status(404).json({ error: 'OrgNotFound' });

    const org = rows[0];
    // Re-instantiate adapter using only public config (no secrets needed for client config)
    // Public config contains publishableKey, loginId, upaySiteId etc.
    const adapter    = GatewayRouter.getAdapter({ gateway: org.gateway, gatewayConfig: org.gateway_config_public || {} });
    const clientConf = await adapter.getClientConfig();

    res.json({
      gateway:      org.gateway,
      clientConfig: clientConf,
      meta:         GATEWAY_META[org.gateway] || null,
    });
  } catch(e) {
    res.status(500).json({ error: 'ConfigFailed', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  POST /charge — process a tokenized payment
//  body: { token, amount, currency?, donorId?, fund?, giftType?, metadata? }
//
//  PCI NOTE: `token` is an opaque reference from the gateway's JS SDK.
//  It is NOT a card number. Raw card data never reaches this endpoint.
// ═══════════════════════════════════════════════════════════════════════════
router.post('/charge', authenticate, tenantScope, async (req, res) => {
  const { token, amount, currency = 'USD', donorId, fund, giftType = 'one_time', metadata = {} } = req.body;

  if (!token)  return res.status(400).json({ error: 'MissingToken',  message: 'Payment token required' });
  if (!amount) return res.status(400).json({ error: 'MissingAmount', message: 'Amount required' });
  if (parseFloat(amount) <= 0) return res.status(400).json({ error: 'InvalidAmount' });

  try {
    const { gateway, gatewayConfig } = await loadGatewayConfig(req.user.orgId);
    const adapter = GatewayRouter.getAdapter({ gateway, gatewayConfig });

    const result = await adapter.chargeToken(token, amount, currency, {
      orgId:    req.user.orgId,
      donorId,
      fund,
      giftType,
      ...metadata,
    });

    // Log transaction (whether success or fail)
    await logTransaction(req.user.orgId, { ...result, donorId, fund, giftType, currency });

    // If successful, record gift in DB
    if (result.success && donorId) {
      try {
        await db.query(
          `INSERT INTO gifts
             (org_id, donor_id, amount, date, fund, payment_method, source,
              status, is_recurring, gateway_transaction_id, created_at)
           VALUES ($1,$2,$3,NOW(),$4,'credit_card','online','completed',$5,$6,NOW())`,
          [req.user.orgId, donorId, parseFloat(amount), fund || null, giftType === 'recurring', result.transactionId]
        );
      } catch(e) {
        logger.error('Failed to record gift in DB after successful charge', { err: e.message, txId: result.transactionId });
      }
    }

    if (result.success) {
      return res.json(result);
    } else {
      return res.status(402).json(result);
    }
  } catch(e) {
    logger.error('POST /payment/charge failed', { err: e.message, orgId: req.user.orgId });
    if (e instanceof GatewayError) return res.status(400).json({ success: false, error: e.message, code: e.code });
    res.status(500).json({ success: false, error: 'PaymentFailed', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  POST /session — create a hosted payment session for redirect gateways
//  Used by TouchNet and CashNet (they redirect to their own hosted pages)
// ═══════════════════════════════════════════════════════════════════════════
router.post('/session', authenticate, tenantScope, async (req, res) => {
  const { amount, donorId, fund, successUrl, cancelUrl, description } = req.body;
  if (!amount) return res.status(400).json({ error: 'MissingAmount' });

  try {
    const { gateway, gatewayConfig } = await loadGatewayConfig(req.user.orgId);
    const adapter = GatewayRouter.getAdapter({ gateway, gatewayConfig });

    if (typeof adapter.createPaymentSession !== 'function') {
      return res.status(400).json({
        error: 'HostedSessionNotSupported',
        message: `${gateway} does not use hosted payment sessions. Use POST /charge instead.`,
      });
    }

    const session = await adapter.createPaymentSession(amount, {
      orgId: req.user.orgId,
      donorId,
      fund,
      successUrl: successUrl || `${process.env.APP_URL}/giving/success`,
      cancelUrl:  cancelUrl  || `${process.env.APP_URL}/giving/cancel`,
      description,
    });

    res.json(session);
  } catch(e) {
    res.status(500).json({ error: 'SessionFailed', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  POST /recurring — set up a recurring gift subscription
// ═══════════════════════════════════════════════════════════════════════════
router.post('/recurring', authenticate, tenantScope, async (req, res) => {
  const { token, amount, interval = 'month', donorId, fund, startDate, description } = req.body;
  if (!token || !amount) return res.status(400).json({ error: 'MissingRequired' });

  try {
    const { gateway, gatewayConfig } = await loadGatewayConfig(req.user.orgId);
    const adapter = GatewayRouter.getAdapter({ gateway, gatewayConfig });

    const result = await adapter.createRecurring(token, {
      amount,
      interval,
      donorId,
      orgId:       req.user.orgId,
      fund,
      startDate,
      description: description || `Monthly gift — ${fund || 'General Fund'}`,
    });

    if (result.success && donorId && result.subscriptionId) {
      await db.query(
        `UPDATE donors SET recurring_gift_amount = $1, recurring_gift_interval = $2,
                           recurring_subscription_id = $3, updated_at = NOW()
         WHERE id = $4 AND org_id = $5`,
        [parseFloat(amount), interval, result.subscriptionId, donorId, req.user.orgId]
      );
    }

    res.json(result);
  } catch(e) {
    res.status(500).json({ error: 'RecurringFailed', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  DELETE /recurring/:subscriptionId — cancel a recurring gift
// ═══════════════════════════════════════════════════════════════════════════
router.delete('/recurring/:subscriptionId', authenticate, tenantScope, async (req, res) => {
  try {
    const { gateway, gatewayConfig } = await loadGatewayConfig(req.user.orgId);
    const adapter = GatewayRouter.getAdapter({ gateway, gatewayConfig });

    const result = await adapter.cancelRecurring(req.params.subscriptionId);

    if (result.success) {
      await db.query(
        `UPDATE donors SET recurring_gift_amount = NULL, recurring_gift_interval = NULL,
                           recurring_subscription_id = NULL, updated_at = NOW()
         WHERE recurring_subscription_id = $1 AND org_id = $2`,
        [req.params.subscriptionId, req.user.orgId]
      );
    }

    res.json(result);
  } catch(e) {
    res.status(500).json({ error: 'CancelFailed', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  POST /refund — refund a transaction (director+ only)
// ═══════════════════════════════════════════════════════════════════════════
router.post('/refund', authenticate, tenantScope, requireRole('director', 'admin'), async (req, res) => {
  const { transactionId, amount, reason } = req.body;
  if (!transactionId) return res.status(400).json({ error: 'MissingTransactionId' });

  try {
    const { gateway, gatewayConfig } = await loadGatewayConfig(req.user.orgId);
    const adapter = GatewayRouter.getAdapter({ gateway, gatewayConfig });
    const result  = await adapter.refund(transactionId, amount);

    if (result.success) {
      await db.query(
        `UPDATE gifts SET status = 'refunded', refund_reason = $1, updated_at = NOW()
         WHERE gateway_transaction_id = $2 AND org_id = $3`,
        [reason || null, transactionId, req.user.orgId]
      );
      logger.info('Refund processed', { orgId: req.user.orgId, transactionId, amount, actor: req.user.email });
    }

    res.json(result);
  } catch(e) {
    res.status(500).json({ error: 'RefundFailed', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  GET /transactions — transaction log for admin UI
// ═══════════════════════════════════════════════════════════════════════════
router.get('/transactions', authenticate, tenantScope, requireRole('director', 'admin', 'officer'), async (req, res) => {
  const { page = 1, limit = 50, status, gateway: gw } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where    = ['org_id = $1'];
  const params = [req.user.orgId];
  let p = 2;

  if (status) { where.push(`status = $${p++}`); params.push(status); }
  if (gw)     { where.push(`gateway = $${p++}`); params.push(gw); }

  const { rows } = await db.query(
    `SELECT id, gateway, transaction_id, amount, currency, status,
            donor_id, gift_type, fund, metadata, created_at
     FROM orbit_transactions
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${p++} OFFSET $${p}`,
    [...params, parseInt(limit), offset]
  );

  res.json({ data: rows, page: parseInt(page) });
});

// ═══════════════════════════════════════════════════════════════════════════
//  POST /webhook/:gateway — inbound webhook from payment gateways
//  UNAUTHENTICATED — signature verified per-gateway
//  Raw body required for HMAC verification
// ═══════════════════════════════════════════════════════════════════════════
router.post('/webhook/:gateway',
  express.raw({ type: ['application/json', 'application/x-www-form-urlencoded'] }),
  async (req, res) => {
    const { gateway } = req.params;
    const body        = req.body;

    // Acknowledge immediately to prevent gateway retries
    res.status(200).json({ received: true });

    const bodyStr = Buffer.isBuffer(body) ? body.toString('utf8') : JSON.stringify(body);

    try {
      if (gateway === 'stripe') {
        const sig    = req.headers['stripe-signature'];
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (sig && secret) {
          const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
          const event  = stripe.webhooks.constructEvent(body, sig, secret);
          await handleStripeWebhook(event);
        }
      } else if (gateway === 'authorize') {
        const payload = JSON.parse(bodyStr);
        await handleAuthorizeWebhook(payload);
      } else if (gateway === 'bbms') {
        // Blackbaud SKY webhook — verify signature
        const sig    = req.headers['x-blackbaud-signature'];
        const secret = process.env.BBMS_WEBHOOK_SECRET;
        if (sig && secret) {
          const expected = crypto.createHmac('sha256', secret).update(bodyStr).digest('base64');
          if (sig !== expected) {
            logger.warn('BBMS webhook signature mismatch');
            return;
          }
        }
        const payload = JSON.parse(bodyStr);
        await handleBBMSWebhook(payload);
      } else if (gateway === 'touchnet') {
        // TouchNet callback is a form POST
        const params = new URLSearchParams(bodyStr);
        await handleTouchNetCallback(params);
      } else if (gateway === 'cashnet') {
        const params = new URLSearchParams(bodyStr);
        await handleCashNetCallback(params);
      }
    } catch(e) {
      logger.error('Webhook processing failed', { gateway, err: e.message });
    }
  }
);

async function handleStripeWebhook(event) {
  const type = event.type;
  logger.info('Stripe webhook', { type });

  if (type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    await db.query(
      `UPDATE orbit_transactions SET status = 'completed', updated_at = NOW()
       WHERE gateway = 'stripe' AND transaction_id = $1`,
      [pi.id]
    );
  } else if (type === 'payment_intent.payment_failed') {
    const pi = event.data.object;
    await db.query(
      `UPDATE orbit_transactions SET status = 'failed', updated_at = NOW()
       WHERE gateway = 'stripe' AND transaction_id = $1`,
      [pi.id]
    );
  } else if (type === 'charge.dispute.created') {
    logger.warn('Stripe chargeback received', { charge: event.data.object.charge });
  }
}

async function handleAuthorizeWebhook(payload) {
  const { eventType, payload: data } = payload;
  logger.info('Authorize.Net webhook', { eventType });
  if (eventType === 'net.authorize.payment.authcapture.created') {
    const txId = data?.id;
    if (txId) {
      await db.query(
        `UPDATE orbit_transactions SET status = 'completed' WHERE gateway = 'authorize' AND transaction_id = $1`,
        [String(txId)]
      );
    }
  }
}

async function handleBBMSWebhook(payload) {
  logger.info('BBMS webhook', { type: payload.type });
  if (payload.type === 'payment.completed') {
    await db.query(
      `UPDATE orbit_transactions SET status = 'completed' WHERE gateway = 'bbms' AND transaction_id = $1`,
      [payload.data?.transaction_id]
    );
  }
}

async function handleTouchNetCallback(params) {
  const sysTrackingId = params.get('sys_tracking_id');
  const amount        = params.get('posting_amt') || params.get('AMT');
  logger.info('TouchNet callback', { sysTrackingId, amount });
  if (sysTrackingId) {
    await db.query(
      `INSERT INTO orbit_transactions (org_id, gateway, transaction_id, amount, status, created_at)
       VALUES ((SELECT id FROM orgs WHERE slug = $1 LIMIT 1), 'touchnet', $2, $3, 'completed', NOW())
       ON CONFLICT DO NOTHING`,
      [params.get('SITEKEY') || '', sysTrackingId, parseFloat(amount || '0')]
    );
  }
}

async function handleCashNetCallback(params) {
  const refNumber = params.get('refno') || params.get('ref');
  const amount    = params.get('amount') || params.get('AMT');
  logger.info('CashNet callback', { refNumber, amount });
  if (refNumber) {
    await db.query(
      `INSERT INTO orbit_transactions (org_id, gateway, transaction_id, amount, status, created_at)
       VALUES ((SELECT id FROM orgs WHERE slug = $1 LIMIT 1), 'cashnet', $2, $3, 'completed', NOW())
       ON CONFLICT DO NOTHING`,
      [params.get('SITEKEY') || '', refNumber, parseFloat(amount || '0')]
    );
  }
}

module.exports = router;
