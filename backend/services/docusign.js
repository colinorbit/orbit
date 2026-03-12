/**
 * services/docusign.js
 *
 * DocuSign eSignature REST API — Smart Gift Agreements
 * SDK: npm install docusign-esign
 * Docs: https://developers.docusign.com/docs/esign-rest-api/
 *
 * Auth flow (JWT Grant — server-to-server, no user login):
 * 1. Create Connected App in DocuSign Admin → Apps & Keys → Add App
 * 2. Enable JWT: toggle on, generate RSA keypair, copy private key to DOCUSIGN_PRIVATE_KEY_PATH
 * 3. Grant consent one-time: visit https://account-d.docusign.com/oauth/auth?
 *    response_type=code&scope=signature%20impersonation&client_id={key}&redirect_uri={uri}
 * 4. Tokens are cached; refresh before expiry (< 5 min remaining)
 *
 * Webhook (DocuSign Connect):
 * - Admin → Connect → Add Configuration
 * - Trigger URL: https://yourdomain.com/api/webhooks/docusign
 * - Events: envelope-sent, envelope-signed, envelope-completed, envelope-declined
 */
'use strict';
const fs       = require('fs');
const path     = require('path');
const docusign = require('docusign-esign');
const logger   = require('../config/logger');
const { Agreement, Gift } = require('../models');

let _token = null;
let _tokenExp = 0;

async function getToken() {
  const now = Date.now() / 1000;
  if (_token && _tokenExp > now + 300) return _token;

  const client = new docusign.ApiClient();
  client.setOAuthBasePath(
    process.env.NODE_ENV === 'production' ? 'account.docusign.com' : 'account-d.docusign.com'
  );

  const key = fs.readFileSync(path.resolve(process.env.DOCUSIGN_PRIVATE_KEY_PATH), 'utf8');
  const resp = await client.requestJWTUserToken(
    process.env.DOCUSIGN_INTEGRATION_KEY,
    process.env.DOCUSIGN_USER_ID,
    ['signature', 'impersonation'],
    Buffer.from(key),
    3600
  );

  _token    = resp.body.access_token;
  _tokenExp = now + resp.body.expires_in;
  return _token;
}

async function getEnvelopesApi() {
  const token = await getToken();
  const client = new docusign.ApiClient();
  client.setBasePath(process.env.DOCUSIGN_BASE_URL);
  client.addDefaultHeader('Authorization', `Bearer ${token}`);
  return new docusign.EnvelopesApi(client);
}

// ── Create envelope from template ─────────────────────────────────────────────
async function createAgreement({ donor, gift, org, agreementId }) {
  const api    = await getEnvelopesApi();
  const acctId = process.env.DOCUSIGN_ACCOUNT_ID;

  const tmplMap = {
    one_time:  process.env.DOCUSIGN_TMPL_GIFT_AGREEMENT,
    pledge:    process.env.DOCUSIGN_TMPL_PLEDGE,
    recurring: process.env.DOCUSIGN_TMPL_PLEDGE,
    planned:   process.env.DOCUSIGN_TMPL_PLANNED_GIFT,
  };
  const templateId = tmplMap[gift.type] || process.env.DOCUSIGN_TMPL_GIFT_AGREEMENT;

  const fmt = n => parseFloat(n).toLocaleString('en-US', { style:'currency', currency:'USD' });

  // Text tabs pre-fill the template fields (anchor text must match template)
  const textTabs = [
    { tabLabel: 'donor_full_name',   value: `${donor.firstName} ${donor.lastName}` },
    { tabLabel: 'donor_email',       value: donor.email },
    { tabLabel: 'gift_amount',       value: fmt(gift.amount) },
    { tabLabel: 'gift_type',         value: gift.type.replace(/_/g,' ') },
    { tabLabel: 'fund_designation',  value: gift.fund || 'General Fund' },
    { tabLabel: 'org_name',          value: org.name },
    { tabLabel: 'agreement_id',      value: agreementId },
    { tabLabel: 'date_prepared',     value: new Date().toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' }) },
  ].map(t => docusign.Text.constructFromObject(t));

  const signer = docusign.TemplateRole.constructFromObject({
    email:    donor.email,
    name:     `${donor.firstName} ${donor.lastName}`,
    roleName: 'Donor',
    tabs: docusign.Tabs.constructFromObject({
      textTabs,
      dateSignedTabs: [docusign.DateSigned.constructFromObject({ tabLabel: 'date_signed' })],
    }),
  });

  const def = docusign.EnvelopeDefinition.constructFromObject({
    templateId,
    templateRoles:  [signer],
    status:         'sent',
    emailSubject:   `Your Gift Agreement — ${org.name}`,
    customFields: docusign.CustomFields.constructFromObject({
      textCustomFields: [
        docusign.TextCustomField.constructFromObject({ name: 'agreementId', value: agreementId, show: 'false' }),
        docusign.TextCustomField.constructFromObject({ name: 'donorId',     value: donor.id,     show: 'false' }),
      ],
    }),
  });

  const { envelopeId } = await api.createEnvelope(acctId, { envelopeDefinition: def });
  logger.info(`DocuSign envelope created: ${envelopeId}`);
  return { envelopeId, status: 'sent', sentAt: new Date() };
}

// ── Embedded signing URL (for in-app signature ceremony) ─────────────────────
async function getSigningUrl(envelopeId, donor, returnUrl) {
  const api    = await getEnvelopesApi();
  const acctId = process.env.DOCUSIGN_ACCOUNT_ID;

  const viewReq = docusign.RecipientViewRequest.constructFromObject({
    returnUrl,
    authenticationMethod: 'none',
    email:    donor.email,
    userName: `${donor.firstName} ${donor.lastName}`,
    clientUserId: donor.id,
  });

  const { url } = await api.createRecipientView(acctId, envelopeId, { recipientViewRequest: viewReq });
  return url;
}

// ── Webhook handler (DocuSign Connect POST) ────────────────────────────────────
async function handleWebhook(payload) {
  // DocuSign sends JSON for modern Connect configs
  const { envelopeId, status } = payload;
  if (!envelopeId || !status) return;

  const map = { Completed:'completed', Declined:'declined', Voided:'voided', Delivered:'delivered', Sent:'sent' };
  const dsStatus = map[status];
  if (!dsStatus) return;

  const agreement = await Agreement.findOne({ where: { envelopeId } });
  if (!agreement) return logger.warn(`No agreement for envelope ${envelopeId}`);

  const updates = { dsStatus };
  if (dsStatus === 'completed') {
    updates.signedAt    = new Date();
    updates.completedAt = new Date();
    if (agreement.giftId) await Gift.update({ status: 'pledged' }, { where: { id: agreement.giftId } });
  }
  await agreement.update(updates);
  logger.info(`Agreement ${agreement.id} → ${dsStatus}`);
}

module.exports = { createAgreement, getSigningUrl, handleWebhook };
