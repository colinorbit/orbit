/**
 * services/salesforce.js
 *
 * Salesforce NPSP Integration via jsforce
 * npm: jsforce  |  Docs: https://jsforce.github.io/
 *
 * NPSP (Nonprofit Success Pack) objects used:
 *   Contact          → Donor record
 *   npe01__OppPayment__c → Pledge installment
 *   Opportunity      → Gift/donation
 *   npsp__Account_Soft_Credit__c → Matching gifts
 *   Campaign         → Fundraising campaign
 *
 * Auth: Username + Password + Security Token
 * - Append security token to password: password+token
 * - Get token: Setup → Reset My Security Token
 *
 * NOTE: SOAP login() is being retired in Summer 2027 (API v65).
 * Migration path: OAuth 2.0 Username-Password Flow (same credentials, new endpoints)
 */
'use strict';
const jsforce = require('jsforce');
const logger  = require('../config/logger');

let _conn = null;
let _connectedAt = 0;
const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function getConnection() {
  const age = Date.now() - _connectedAt;
  if (_conn && age < SESSION_TIMEOUT_MS) return _conn;

  const conn = new jsforce.Connection({
    loginUrl:   process.env.SF_LOGIN_URL || 'https://login.salesforce.com',
    version:    process.env.SF_API_VERSION || 'v59.0',
  });

  await conn.login(process.env.SF_USERNAME, process.env.SF_PASSWORD);
  _conn = conn;
  _connectedAt = Date.now();
  logger.info(`Salesforce connected as ${process.env.SF_USERNAME}`);
  return conn;
}

// ── Sync a donor (Contact) from Salesforce → Orbit ───────────────────────────
async function syncContactToOrbit(sfContactId) {
  const conn = await getConnection();
  const contact = await conn.sobject('Contact').retrieve(sfContactId);
  return {
    externalId:    contact.Id,
    firstName:     contact.FirstName,
    lastName:      contact.LastName,
    email:         contact.Email,
    phone:         contact.Phone || contact.MobilePhone,
    addressLine1:  contact.MailingStreet,
    city:          contact.MailingCity,
    state:         contact.MailingState,
    postalCode:    contact.MailingPostalCode,
    country:       contact.MailingCountry || 'US',
    lifetimeGiving: parseFloat(contact.npo02__TotalOppAmount__c || 0),
    largestGift:   parseFloat(contact.npo02__LargestAmount__c || 0),
    lastGiftAmount: parseFloat(contact.npo02__LastOppAmount__c || 0),
    lastGiftDate:  contact.npo02__LastCloseDate__c ? new Date(contact.npo02__LastCloseDate__c) : null,
    giftCount:     parseInt(contact.npo02__NumberOfClosedOpps__c || 0),
    consecutiveYears: parseInt(contact.npo02__NumberOfMembershipOpps__c || 0),
  };
}

// ── Pull new/updated contacts since a given date ──────────────────────────────
async function pullContactsSince(since) {
  const conn = await getConnection();
  const isoDate = since.toISOString();
  const result = await conn.query(
    `SELECT Id, FirstName, LastName, Email, Phone, MobilePhone,
            MailingStreet, MailingCity, MailingState, MailingPostalCode, MailingCountry,
            npo02__TotalOppAmount__c, npo02__LargestAmount__c, npo02__LastOppAmount__c,
            npo02__LastCloseDate__c, npo02__NumberOfClosedOpps__c
     FROM Contact
     WHERE SystemModstamp > ${isoDate}
     LIMIT 1000`
  );
  return result.records.map(c => ({
    externalId:    c.Id,
    firstName:     c.FirstName,
    lastName:      c.LastName,
    email:         c.Email,
    phone:         c.Phone || c.MobilePhone,
    city:          c.MailingCity,
    state:         c.MailingState,
    postalCode:    c.MailingPostalCode,
    country:       c.MailingCountry || 'US',
    lifetimeGiving: parseFloat(c.npo02__TotalOppAmount__c || 0),
    lastGiftAmount: parseFloat(c.npo02__LastOppAmount__c || 0),
    lastGiftDate:  c.npo02__LastCloseDate__c ? new Date(c.npo02__LastCloseDate__c) : null,
    giftCount:     parseInt(c.npo02__NumberOfClosedOpps__c || 0),
  }));
}

// ── Push a gift (Opportunity) to Salesforce ───────────────────────────────────
async function pushGiftToSF({ donor, gift, orgName }) {
  const conn = await getConnection();
  const data = {
    Name:          `${donor.firstName} ${donor.lastName} — ${new Date().getFullYear()} Gift`,
    StageName:     gift.status === 'received' ? 'Closed Won' : 'Pledged',
    CloseDate:     gift.receivedAt ? new Date(gift.receivedAt).toISOString().slice(0,10) : new Date().toISOString().slice(0,10),
    Amount:        parseFloat(gift.amount),
    npsp__Primary_Contact__c: donor.externalId || null,
    Description:   gift.notes || `Created by Orbit AI Agent`,
    CampaignId:    null,
  };
  if (gift.fund) data.npsp__Fund__c = gift.fund;

  const result = await conn.sobject('Opportunity').create(data);
  if (!result.success) throw new Error(`SF push failed: ${result.errors?.join(', ')}`);
  logger.info(`Gift pushed to SF: ${result.id}`);
  return { sfOpportunityId: result.id };
}

// ── Get campaign stats from Salesforce ────────────────────────────────────────
async function getCampaignStats(sfCampaignId) {
  const conn = await getConnection();
  const c = await conn.sobject('Campaign').retrieve(sfCampaignId);
  return {
    name:        c.Name,
    goal:        c.ExpectedRevenue,
    raised:      c.AmountWonOpportunities,
    respondents: c.NumberOfResponses,
    status:      c.Status,
  };
}

module.exports = { getConnection, syncContactToOrbit, pullContactsSince, pushGiftToSF, getCampaignStats };
