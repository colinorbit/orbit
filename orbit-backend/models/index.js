'use strict';
const { sequelize, DataTypes } = require('../config/database');

// ─── Organization ─────────────────────────────────────────────────────────────
const Org = sequelize.define('Org', {
  id:       { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name:     { type: DataTypes.STRING, allowNull: false },
  slug:     { type: DataTypes.STRING, unique: true },
  type:     { type: DataTypes.ENUM('university','hospital','nonprofit','school','other'), defaultValue: 'nonprofit' },
  plan:     { type: DataTypes.ENUM('trial','essentials','growth','enterprise'), defaultValue: 'trial' },
  stripeCustomerId:     DataTypes.STRING,
  stripeSubscriptionId: DataTypes.STRING,
  subscriptionStatus:   { type: DataTypes.ENUM('active','trialing','past_due','canceled'), defaultValue: 'trialing' },
  settings:   { type: DataTypes.JSONB, defaultValue: {} },
  crmType:    { type: DataTypes.ENUM('salesforce','blackbaud','none'), defaultValue: 'none' },
  crmConfig:  { type: DataTypes.JSONB, defaultValue: {} },   // encrypted tokens stored here
}, { tableName: 'orgs', timestamps: true, paranoid: true });

// ─── User ─────────────────────────────────────────────────────────────────────
const User = sequelize.define('User', {
  id:           { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  orgId:        { type: DataTypes.UUID, allowNull: false },
  email:        { type: DataTypes.STRING, allowNull: false, unique: true },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  firstName:    DataTypes.STRING,
  lastName:     DataTypes.STRING,
  role:         { type: DataTypes.ENUM('owner','admin','manager','viewer'), defaultValue: 'manager' },
  lastLoginAt:  DataTypes.DATE,
  isActive:     { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'users', timestamps: true, paranoid: true });

// ─── Donor ────────────────────────────────────────────────────────────────────
const Donor = sequelize.define('Donor', {
  id:     { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  orgId:  { type: DataTypes.UUID, allowNull: false },
  externalId: DataTypes.STRING,   // CRM ID
  firstName:  { type: DataTypes.STRING, allowNull: false },
  lastName:   { type: DataTypes.STRING, allowNull: false },
  email:      DataTypes.STRING,
  phone:      DataTypes.STRING,
  city: DataTypes.STRING, state: DataTypes.STRING, postalCode: DataTypes.STRING, country: { type: DataTypes.STRING, defaultValue: 'US' },
  addressLine1: DataTypes.STRING, addressLine2: DataTypes.STRING,
  // Giving profile
  lifetimeGiving:  { type: DataTypes.DECIMAL(14,2), defaultValue: 0 },
  largestGift:     { type: DataTypes.DECIMAL(14,2), defaultValue: 0 },
  lastGiftAmount:  { type: DataTypes.DECIMAL(14,2), defaultValue: 0 },
  lastGiftDate:    DataTypes.DATE,
  firstGiftDate:   DataTypes.DATE,
  giftCount:       { type: DataTypes.INTEGER, defaultValue: 0 },
  consecutiveYears:{ type: DataTypes.INTEGER, defaultValue: 0 },
  // Wealth / propensity
  wealthCapacity:         DataTypes.DECIMAL(16,2),
  majorGiftScore:         DataTypes.INTEGER,  // 0-100
  bequestScore:           DataTypes.INTEGER,  // 0-100
  // Orbit AI scores (updated by agents)
  engagementScore:  { type: DataTypes.DECIMAL(5,2), defaultValue: 0 },
  sentimentScore:   { type: DataTypes.DECIMAL(5,2), defaultValue: 50 },
  retentionRisk:    { type: DataTypes.ENUM('low','medium','high'), defaultValue: 'low' },
  upgradeReadiness: { type: DataTypes.ENUM('not_ready','warming','ready','hot'), defaultValue: 'not_ready' },
  // Communication
  emailOptIn: { type: DataTypes.BOOLEAN, defaultValue: false },
  smsOptIn:   { type: DataTypes.BOOLEAN, defaultValue: false },
  doNotContact: { type: DataTypes.BOOLEAN, defaultValue: false },
  preferredChannel: { type: DataTypes.ENUM('email','sms','mail'), defaultValue: 'email' },
  // Stage
  stage: { type: DataTypes.ENUM('prospect','cultivation','solicitation','stewardship','lapsed','deceased'), defaultValue: 'prospect' },
  portfolioStatus: { type: DataTypes.ENUM('unmanaged','orbit_managed','human_managed'), defaultValue: 'unmanaged' },
  assignedAgentId: DataTypes.UUID,
  assignedUserId:  DataTypes.UUID,
  interests: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
  tags:       { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
  notes:      DataTypes.TEXT,
  customFields: { type: DataTypes.JSONB, defaultValue: {} },
}, { tableName: 'donors', timestamps: true, paranoid: true,
    indexes: [{ fields:['orgId'] },{ fields:['email'] },{ fields:['stage'] },{ fields:['assignedAgentId'] }] });

// ─── Agent ────────────────────────────────────────────────────────────────────
const Agent = sequelize.define('Agent', {
  id:    { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  orgId: { type: DataTypes.UUID, allowNull: false },
  name:  { type: DataTypes.STRING, allowNull: false },
  type:  { type: DataTypes.ENUM('veo','vso','vpgo','vco'), allowNull: false },
  isActive:      { type: DataTypes.BOOLEAN, defaultValue: true },
  portfolioSize: { type: DataTypes.INTEGER, defaultValue: 0 },
  totalRaised:   { type: DataTypes.DECIMAL(14,2), defaultValue: 0 },
  giftsSecured:  { type: DataTypes.INTEGER, defaultValue: 0 },
  messagesSent:  { type: DataTypes.INTEGER, defaultValue: 0 },
  persona:  { type: DataTypes.JSONB, defaultValue: {} },
  config:   { type: DataTypes.JSONB, defaultValue: {} },
  lastRunAt: DataTypes.DATE,
  nextRunAt: DataTypes.DATE,
}, { tableName: 'agents', timestamps: true });

// ─── DonorJourney ─────────────────────────────────────────────────────────────
const Journey = sequelize.define('Journey', {
  id:      { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  orgId:   { type: DataTypes.UUID, allowNull: false },
  donorId: { type: DataTypes.UUID, allowNull: false },
  agentId: { type: DataTypes.UUID, allowNull: false },
  phase:   { type: DataTypes.ENUM('introduction','cultivation','discovery','solicitation','close','stewardship'), defaultValue: 'introduction' },
  step:    { type: DataTypes.INTEGER, defaultValue: 0 },
  isActive:{ type: DataTypes.BOOLEAN, defaultValue: true },
  nextActionAt:   DataTypes.DATE,
  nextActionType: DataTypes.STRING,
  context:  { type: DataTypes.JSONB, defaultValue: {} },
  outcomeGiftId: DataTypes.UUID,
  completedAt: DataTypes.DATE,
}, { tableName: 'journeys', timestamps: true,
    indexes: [{ fields:['donorId'] },{ fields:['agentId'] },{ fields:['nextActionAt'] }] });

// ─── Outreach (every message sent) ───────────────────────────────────────────
const Outreach = sequelize.define('Outreach', {
  id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  orgId:      { type: DataTypes.UUID, allowNull: false },
  donorId:    { type: DataTypes.UUID, allowNull: false },
  agentId:    DataTypes.UUID,
  campaignId: DataTypes.UUID,
  journeyId:  DataTypes.UUID,
  channel:    { type: DataTypes.ENUM('email','sms','phone','mail'), allowNull: false },
  type:       { type: DataTypes.ENUM('introduction','impact','cultivation','solicitation','stewardship','reminder','thank_you','lapsed','planned_giving','campaign'), allowNull: false },
  subject:    DataTypes.STRING,
  body:       DataTypes.TEXT,
  templateId: DataTypes.STRING,
  dynamicData:{ type: DataTypes.JSONB, defaultValue: {} },
  status:     { type: DataTypes.ENUM('queued','sent','delivered','opened','clicked','replied','bounced','failed','opted_out'), defaultValue: 'queued' },
  scheduledAt:DataTypes.DATE,
  sentAt:     DataTypes.DATE,
  deliveredAt:DataTypes.DATE,
  openedAt:   DataTypes.DATE,
  repliedAt:  DataTypes.DATE,
  replyBody:  DataTypes.TEXT,
  twilioSid:  DataTypes.STRING,
  sgMessageId:DataTypes.STRING,
  metadata:   { type: DataTypes.JSONB, defaultValue: {} },
}, { tableName: 'outreaches', timestamps: true,
    indexes: [{ fields:['donorId'] },{ fields:['agentId'] },{ fields:['campaignId'] },{ fields:['scheduledAt'] }] });

// ─── Gift ─────────────────────────────────────────────────────────────────────
const Gift = sequelize.define('Gift', {
  id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  orgId:      { type: DataTypes.UUID, allowNull: false },
  donorId:    { type: DataTypes.UUID, allowNull: false },
  agentId:    DataTypes.UUID,
  campaignId: DataTypes.UUID,
  amount:     { type: DataTypes.DECIMAL(14,2), allowNull: false },
  currency:   { type: DataTypes.STRING(3), defaultValue: 'USD' },
  type:       { type: DataTypes.ENUM('one_time','pledge','recurring','matching','planned','in_kind'), allowNull: false },
  fund:       DataTypes.STRING,
  designation:DataTypes.STRING,
  status:     { type: DataTypes.ENUM('verbal','pledged','received','failed','refunded'), defaultValue: 'pledged' },
  // Pledge fields
  pledgeStart: DataTypes.DATE,
  pledgeEnd:   DataTypes.DATE,
  installments:DataTypes.INTEGER,
  installmentAmount: DataTypes.DECIMAL(14,2),
  installmentFreq:   DataTypes.ENUM('monthly','quarterly','annually'),
  // Stripe
  stripePaymentIntentId: DataTypes.STRING,
  stripeCustomerId:      DataTypes.STRING,
  stripeSubscriptionId:  DataTypes.STRING,
  receivedAt: DataTypes.DATE,
  externalId: DataTypes.STRING,
  notes:      DataTypes.TEXT,
  metadata:   { type: DataTypes.JSONB, defaultValue: {} },
}, { tableName: 'gifts', timestamps: true,
    indexes: [{ fields:['donorId'] },{ fields:['status'] },{ fields:['orgId'] }] });

// ─── GiftAgreement (DocuSign) ─────────────────────────────────────────────────
const Agreement = sequelize.define('Agreement', {
  id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  orgId:      { type: DataTypes.UUID, allowNull: false },
  donorId:    { type: DataTypes.UUID, allowNull: false },
  giftId:     DataTypes.UUID,
  agentId:    DataTypes.UUID,
  type:       { type: DataTypes.ENUM('gift_agreement','pledge','planned_giving'), defaultValue: 'gift_agreement' },
  amount:     DataTypes.DECIMAL(14,2),
  envelopeId: DataTypes.STRING,
  dsStatus:   { type: DataTypes.ENUM('created','sent','delivered','signed','completed','declined','voided'), defaultValue: 'created' },
  signerEmail:DataTypes.STRING,
  signerName: DataTypes.STRING,
  sentAt:     DataTypes.DATE,
  signedAt:   DataTypes.DATE,
  completedAt:DataTypes.DATE,
  documentUrl:DataTypes.STRING,
  templateData:{ type: DataTypes.JSONB, defaultValue: {} },
}, { tableName: 'agreements', timestamps: true });

// ─── Campaign ─────────────────────────────────────────────────────────────────
const Campaign = sequelize.define('Campaign', {
  id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  orgId:      { type: DataTypes.UUID, allowNull: false },
  agentId:    DataTypes.UUID,
  name:       { type: DataTypes.STRING, allowNull: false },
  description:DataTypes.TEXT,
  type:       { type: DataTypes.ENUM('giving_day','year_end','capital','annual_fund','matching','lapsed','custom'), allowNull: false },
  goal:       DataTypes.DECIMAL(14,2),
  raised:     { type: DataTypes.DECIMAL(14,2), defaultValue: 0 },
  donorCount: { type: DataTypes.INTEGER, defaultValue: 0 },
  startDate:  DataTypes.DATE,
  endDate:    DataTypes.DATE,
  status:     { type: DataTypes.ENUM('draft','scheduled','active','paused','completed','canceled'), defaultValue: 'draft' },
  hasMatchingGift:  { type: DataTypes.BOOLEAN, defaultValue: false },
  matchingDonor:    DataTypes.STRING,
  matchingRatio:    DataTypes.STRING,
  matchingCap:      DataTypes.DECIMAL(14,2),
  matchingUsed:     { type: DataTypes.DECIMAL(14,2), defaultValue: 0 },
  segments:   { type: DataTypes.JSONB, defaultValue: [] },
  messaging:  { type: DataTypes.JSONB, defaultValue: {} },
  schedule:   { type: DataTypes.JSONB, defaultValue: [] },
  analytics:  { type: DataTypes.JSONB, defaultValue: {} },
}, { tableName: 'campaigns', timestamps: true });

// ─── PledgeInstallment ────────────────────────────────────────────────────────
const Installment = sequelize.define('Installment', {
  id:       { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  orgId:    { type: DataTypes.UUID, allowNull: false },
  giftId:   { type: DataTypes.UUID, allowNull: false },
  donorId:  { type: DataTypes.UUID, allowNull: false },
  num:      { type: DataTypes.INTEGER, allowNull: false },
  amount:   { type: DataTypes.DECIMAL(14,2), allowNull: false },
  dueDate:  { type: DataTypes.DATE, allowNull: false },
  status:   { type: DataTypes.ENUM('upcoming','reminded','received','failed','waived'), defaultValue: 'upcoming' },
  stripePaymentIntentId: DataTypes.STRING,
  receivedAt:   DataTypes.DATE,
  reminderSentAt: DataTypes.DATE,
}, { tableName: 'installments', timestamps: true });

// ─── AgentAction (audit log of every AI decision) ─────────────────────────────
const AgentAction = sequelize.define('AgentAction', {
  id:       { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  orgId:    DataTypes.UUID,
  agentId:  DataTypes.UUID,
  donorId:  DataTypes.UUID,
  journeyId:DataTypes.UUID,
  outreachId:DataTypes.UUID,
  action:   DataTypes.STRING,
  reasoning:DataTypes.TEXT,
  inputCtx: { type: DataTypes.JSONB, defaultValue: {} },
  output:   { type: DataTypes.JSONB, defaultValue: {} },
  tokens:   DataTypes.INTEGER,
  success:  { type: DataTypes.BOOLEAN, defaultValue: true },
  error:    DataTypes.TEXT,
}, { tableName: 'agent_actions', timestamps: true,
    indexes: [{ fields:['agentId'] },{ fields:['donorId'] },{ fields:['createdAt'] }] });

// ─── Associations ─────────────────────────────────────────────────────────────
Org.hasMany(User,    { foreignKey:'orgId', as:'users' });
Org.hasMany(Donor,   { foreignKey:'orgId', as:'donors' });
Org.hasMany(Agent,   { foreignKey:'orgId', as:'agents' });
Org.hasMany(Campaign,{ foreignKey:'orgId', as:'campaigns' });
Org.hasMany(Gift,    { foreignKey:'orgId', as:'gifts' });

Donor.belongsTo(Org,   { foreignKey:'orgId' });
Donor.hasMany(Outreach,{ foreignKey:'donorId', as:'outreaches' });
Donor.hasMany(Gift,    { foreignKey:'donorId', as:'gifts' });
Donor.hasMany(Journey, { foreignKey:'donorId', as:'journeys' });
Donor.hasMany(Agreement,{ foreignKey:'donorId', as:'agreements' });

Agent.belongsTo(Org,   { foreignKey:'orgId' });
Agent.hasMany(Journey, { foreignKey:'agentId', as:'journeys' });
Agent.hasMany(Outreach,{ foreignKey:'agentId', as:'outreaches' });
Agent.hasMany(AgentAction,{ foreignKey:'agentId', as:'actions' });

Gift.belongsTo(Donor,  { foreignKey:'donorId' });
Gift.hasOne(Agreement, { foreignKey:'giftId', as:'agreement' });
Gift.hasMany(Installment,{ foreignKey:'giftId', as:'installments' });

Journey.belongsTo(Donor, { foreignKey:'donorId' });
Journey.belongsTo(Agent, { foreignKey:'agentId' });

Campaign.hasMany(Gift,    { foreignKey:'campaignId', as:'gifts' });
Campaign.hasMany(Outreach,{ foreignKey:'campaignId', as:'outreaches' });

module.exports = { Org, User, Donor, Agent, Journey, Outreach, Gift, Agreement, Campaign, Installment, AgentAction };
