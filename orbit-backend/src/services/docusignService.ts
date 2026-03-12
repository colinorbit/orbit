/**
 * DocuSign Gift Agreement Service – eSignature REST API
 *
 * Integration notes from docs:
 *  • Auth: JWT Grant (server-to-server, no browser redirect)
 *    1. Generate RSA keypair in DocuSign Developer Center (Apps & Keys)
 *    2. Request JWT token: POST /oauth/token with signed assertion
 *    3. Token expires in 1 hour — cache and refresh proactively
 *  • Base URLs:
 *    Demo:       https://demo.docusign.net/restapi
 *    Production: https://na4.docusign.net/restapi  (region-specific)
 *  • Create Envelope endpoint: POST /v2.1/accounts/{accountId}/envelopes
 *  • Envelope can use a pre-built Template (DOCUSIGN_TMPL_*) with tab pre-fill
 *  • docusign.connect webhook notifies us on envelope status changes
 *
 * Gift agreement types:
 *  single  → single gift acknowledgment (no signing needed, just record)
 *  pledge  → multi-year pledge agreement (donor signs)
 *  planned → planned giving letter of intent (donor signs)
 */

import docusign from 'docusign-esign';
import { logger } from '../config/logger';

// ─── Auth token cache ────────────────────────────────────────────
let cachedAccessToken: string | null = null;
let tokenExpiresAt:    number        = 0;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  // Refresh 5 minutes before expiry
  if (cachedAccessToken && tokenExpiresAt - now > 5 * 60 * 1000) {
    return cachedAccessToken;
  }

  const apiClient = new docusign.ApiClient();
  apiClient.setOAuthBasePath(process.env.DOCUSIGN_OAUTH_BASE ?? 'https://account-d.docusign.com');

  // JWT Grant — requestJWTUserToken uses RSA private key to sign assertion
  // Scopes: signature (create/send envelopes) + impersonation (act as user)
  const privateKey = (process.env.DOCUSIGN_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');

  const resp = await apiClient.requestJWTUserToken(
    process.env.DOCUSIGN_INTEGRATION_KEY!,
    process.env.DOCUSIGN_USER_ID!,
    ['signature', 'impersonation'],
    Buffer.from(privateKey),
    3600  // token TTL in seconds
  );

  cachedAccessToken = resp.body.access_token;
  tokenExpiresAt    = now + resp.body.expires_in * 1000;

  logger.debug('[DocuSign] Access token refreshed');
  return cachedAccessToken!;
}

function buildApiClient(token: string): docusign.EnvelopesApi {
  const apiClient = new docusign.ApiClient();
  apiClient.setBasePath(process.env.DOCUSIGN_BASE_PATH ?? 'https://demo.docusign.net/restapi');
  apiClient.addDefaultHeader('Authorization', `Bearer ${token}`);
  return new docusign.EnvelopesApi(apiClient);
}

// ─── Envelope Creation ───────────────────────────────────────────

export interface GiftAgreementPayload {
  giftType:       'single' | 'pledge' | 'planned';
  donorFirstName: string;
  donorLastName:  string;
  donorEmail:     string;
  orgName:        string;
  amount:         number;     // in cents
  fundName:       string;
  years?:         number;     // for pledge only
  startDate:      string;     // ISO date string
  signerName?:    string;     // org signatory
  signerEmail?:   string;
}

export interface EnvelopeResult {
  envelopeId: string;
  status:     string;
  signingUrl?: string;   // embedded signing URL (optional — we email the link)
}

/**
 * Create a DocuSign envelope using a pre-configured template.
 * Templates handle the document layout; we pre-fill the merge tabs here.
 */
export async function createGiftAgreement(payload: GiftAgreementPayload): Promise<EnvelopeResult> {
  if (process.env.ENABLE_DOCUSIGN !== 'true') {
    logger.debug('[DocuSign] Disabled — mock envelope for', payload.donorEmail);
    return { envelopeId: `mock-${Date.now()}`, status: 'sent' };
  }

  const token = await getAccessToken();
  const envelopesApi = buildApiClient(token);
  const accountId    = process.env.DOCUSIGN_ACCOUNT_ID!;

  // Choose template based on gift type
  const templateMap = {
    single:  process.env.DOCUSIGN_TMPL_SINGLE_GIFT,
    pledge:  process.env.DOCUSIGN_TMPL_MULTI_YEAR_PLEDGE,
    planned: process.env.DOCUSIGN_TMPL_PLANNED_GIFT,
  };
  const templateId = templateMap[payload.giftType];
  if (!templateId) throw new Error(`No DocuSign template configured for gift type: ${payload.giftType}`);

  const amountFormatted = `$${(payload.amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  const yearlyAmount    = payload.years ? `$${((payload.amount / 100) / payload.years).toFixed(2)}/year` : '';

  // Build envelope from template with pre-filled tabs (merge fields)
  const envelopeDefinition: docusign.EnvelopeDefinition = {
    templateId,
    status: 'sent',   // 'sent' triggers delivery; 'created' saves as draft

    templateRoles: [
      {
        // Donor — primary signer
        roleName:  'Donor',
        name:      `${payload.donorFirstName} ${payload.donorLastName}`,
        email:     payload.donorEmail,
        tabs: {
          textTabs: [
            { tabLabel: 'DonorName',    value: `${payload.donorFirstName} ${payload.donorLastName}` },
            { tabLabel: 'OrgName',      value: payload.orgName },
            { tabLabel: 'GiftAmount',   value: amountFormatted },
            { tabLabel: 'FundName',     value: payload.fundName },
            { tabLabel: 'StartDate',    value: payload.startDate },
            ...(payload.years    ? [{ tabLabel: 'PledgeYears',   value: String(payload.years) }]     : []),
            ...(yearlyAmount     ? [{ tabLabel: 'YearlyAmount',  value: yearlyAmount }]               : []),
          ],
        },
      },
      // Org signatory (counter-signature) — only for pledge/planned
      ...(payload.giftType !== 'single' && payload.signerEmail ? [{
        roleName: 'OrgSignatory',
        name:     payload.signerName ?? payload.orgName,
        email:    payload.signerEmail,
      }] : []),
    ],

    emailSubject: `Your ${payload.giftType === 'pledge' ? 'Pledge Agreement' : 'Gift Confirmation'} — ${payload.orgName}`,
    emailBlurb:   `Hi ${payload.donorFirstName}, thank you for your generous commitment to ${payload.orgName}. Please review and sign your ${payload.giftType === 'pledge' ? 'pledge agreement' : 'gift letter'} below.`,
  };

  try {
    const result = await envelopesApi.createEnvelope(accountId, { envelopeDefinition });
    logger.info(`[DocuSign] Envelope created: ${result.envelopeId} | status: ${result.status}`);
    return {
      envelopeId: result.envelopeId!,
      status:     result.status!,
    };
  } catch (err: unknown) {
    const dsErr = err as { response?: { body?: { errorCode?: string; message?: string } } };
    logger.error('[DocuSign] createEnvelope failed', dsErr.response?.body);
    throw err;
  }
}

/**
 * Fetch the current status of an envelope.
 * Called by our Connect webhook handler and on-demand status checks.
 */
export async function getEnvelopeStatus(envelopeId: string): Promise<string> {
  const token = await getAccessToken();
  const envelopesApi = buildApiClient(token);
  const envelope = await envelopesApi.getEnvelope(process.env.DOCUSIGN_ACCOUNT_ID!, envelopeId, {});
  return envelope.status ?? 'unknown';
}
