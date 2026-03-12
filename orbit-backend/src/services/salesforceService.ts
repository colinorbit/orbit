/**
 * Salesforce NPSP CRM Sync Service
 *
 * Integration notes from docs:
 *  • Auth: OAuth 2.0 Connected App (Username-Password flow for server-to-server)
 *    NOTE: Username-Password flow must be enabled for orgs created after Summer 2023
 *    Alternative: JWT Bearer flow (recommended for prod — no stored password)
 *  • After auth: store access_token + instance_url from response
 *  • REST API base: {instance_url}/services/data/{API_VERSION}/
 *  • SOQL queries:  GET /query?q=SELECT+...
 *  • NPSP namespaces: npe01__ (contacts/donations), npsp__ (GAU/allocations), npe03__ (recurring)
 *
 * Objects we sync:
 *  Contact              → donor record (FirstName, LastName, Email, npe01__WorkEmail__c)
 *  Account (Household)  → donor household (NPSP Household Account record type)
 *  Opportunity          → gift / pledge (Amount, CloseDate, StageName, RecordTypeId)
 *  npe01__OppPayment__c → individual payments on an opportunity
 *  npsp__General_Accounting_Unit__c → fund designations
 *  npsp__Allocation__c  → links Opp to GAU with percentage/amount
 *
 * Sync strategy: Orbit is the source of truth for AI decisions.
 *  CRM is written to for confirmed gifts only.
 *  We read donor giving history from CRM during onboarding.
 */

import axios, { type AxiosInstance } from 'axios';
import { logger } from '../config/logger';
import { getDB } from './database';   // we cache tokens in DB per org

const API_VERSION = process.env.SF_API_VERSION ?? 'v61.0';

// ─── Token management ────────────────────────────────────────────

interface SFTokens {
  accessToken:  string;
  instanceUrl:  string;
  expiresAt:    number;
}

async function authenticate(): Promise<SFTokens> {
  const params = new URLSearchParams({
    grant_type: 'password',
    client_id:     process.env.SF_CLIENT_ID!,
    client_secret: process.env.SF_CLIENT_SECRET!,
    username:      process.env.SF_USERNAME!,
    password:      process.env.SF_PASSWORD!,  // password + security token concatenated
  });

  const resp = await axios.post(
    `${process.env.SF_LOGIN_URL}/services/oauth2/token`,
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  return {
    accessToken: resp.data.access_token,
    instanceUrl: resp.data.instance_url,
    expiresAt:   Date.now() + 2 * 60 * 60 * 1000,   // SF tokens last ~2 hours
  };
}

let sfTokenCache: SFTokens | null = null;

async function getSFClient(): Promise<AxiosInstance> {
  if (!sfTokenCache || Date.now() > sfTokenCache.expiresAt - 5 * 60 * 1000) {
    sfTokenCache = await authenticate();
    logger.debug('[SF] Access token refreshed');
  }
  return axios.create({
    baseURL: `${sfTokenCache.instanceUrl}/services/data/${API_VERSION}`,
    headers: { Authorization: `Bearer ${sfTokenCache.accessToken}` },
  });
}

// ─── Read: Donor import from NPSP ────────────────────────────────

export interface NPSPContact {
  sfId:            string;
  firstName:       string;
  lastName:        string;
  email:           string;
  phone?:          string;
  totalGivingCents: number;
  lastGiftCents:   number;
  lastGiftDate:    string | null;
  firstGiftYear:   number | null;
  numberOfGifts:   number;
  householdId:     string;
}

/**
 * Pull all active donors from NPSP and return for import into Orbit DB.
 * SOQL query joins Contact with npo02__Households_Settings__c aggregates.
 */
export async function importDonorsFromNPSP(lastModified?: string): Promise<NPSPContact[]> {
  if (process.env.ENABLE_SALESFORCE !== 'true') {
    logger.debug('[SF] Disabled — skipping donor import');
    return [];
  }

  const client = await getSFClient();

  // npo02__NumberOfClosedOpps__c, npo02__TotalOppAmount__c etc. are NPSP rollup fields
  const whereClause = lastModified
    ? `WHERE LastModifiedDate >= ${lastModified}`
    : `WHERE npo02__TotalOppAmount__c > 0`;

  const soql = `
    SELECT Id, FirstName, LastName, Email, Phone,
      npo02__TotalOppAmount__c,
      npo02__LastOppAmount__c,
      npo02__LastCloseDate__c,
      npo02__FirstCloseDate__c,
      npo02__NumberOfClosedOpps__c,
      AccountId
    FROM Contact
    ${whereClause}
    LIMIT 2000
  `.replace(/\s+/g, ' ').trim();

  const resp = await client.get<{ records: Record<string, unknown>[] }>(
    `/query?q=${encodeURIComponent(soql)}`
  );

  return resp.data.records.map(r => ({
    sfId:            r.Id as string,
    firstName:       (r.FirstName as string) ?? '',
    lastName:        (r.LastName  as string) ?? '',
    email:           (r.Email     as string) ?? '',
    phone:           r.Phone      as string | undefined,
    totalGivingCents: Math.round(((r.npo02__TotalOppAmount__c as number) ?? 0) * 100),
    lastGiftCents:    Math.round(((r.npo02__LastOppAmount__c  as number) ?? 0) * 100),
    lastGiftDate:     r.npo02__LastCloseDate__c  as string | null,
    firstGiftYear:    r.npo02__FirstCloseDate__c
                        ? new Date(r.npo02__FirstCloseDate__c as string).getFullYear()
                        : null,
    numberOfGifts:    (r.npo02__NumberOfClosedOpps__c as number) ?? 0,
    householdId:      r.AccountId as string,
  }));
}

// ─── Write: Record confirmed gift back to NPSP ───────────────────

export interface NPSPOpportunity {
  contactId:   string;       // Salesforce Contact ID
  accountId:   string;       // Household Account ID
  amount:      number;       // in cents
  closeDate:   string;       // ISO date YYYY-MM-DD
  stageName:   'Closed Won'; // for completed gifts
  name:        string;       // e.g., "John Smith - Annual Fund 2026"
  fundGauId?:  string;       // npsp__General_Accounting_Unit__c ID
  recordTypeId?: string;     // Donation record type ID for your org
  campaignId?: string;
}

export async function createOpportunity(opp: NPSPOpportunity): Promise<string> {
  if (process.env.ENABLE_SALESFORCE !== 'true') {
    logger.debug('[SF] Disabled — mock Opp creation');
    return `mock-opp-${Date.now()}`;
  }

  const client = await getSFClient();

  const body: Record<string, unknown> = {
    Name:        opp.name,
    Amount:      opp.amount / 100,
    CloseDate:   opp.closeDate,
    StageName:   opp.stageName,
    AccountId:   opp.accountId,
    npsp__Primary_Contact__c: opp.contactId,
    ...(opp.recordTypeId && { RecordTypeId: opp.recordTypeId }),
    ...(opp.campaignId   && { CampaignId:   opp.campaignId }),
  };

  const resp = await client.post<{ id: string }>('/sobjects/Opportunity', body);
  const oppId = resp.data.id;
  logger.info(`[SF] Opportunity created: ${oppId}`);

  // If a GAU (fund) is specified, create the Allocation record
  if (opp.fundGauId) {
    await client.post('/sobjects/npsp__Allocation__c', {
      npsp__Opportunity__c:              oppId,
      npsp__General_Accounting_Unit__c:  opp.fundGauId,
      npsp__Percent__c:                  100,
    });
    logger.debug(`[SF] GAU Allocation created for Opp ${oppId}`);
  }

  return oppId;
}
