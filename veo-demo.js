#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VEO LIVE DEMO — "De-Risk the AI Loop"
 *
 *  Runs 20 realistic donor profiles through the full intelligence pipeline:
 *    1. Predictive scoring (predictiveEngine)
 *    2. Archetype detection + donor intelligence (donorIntelligence archetypes)
 *    3. VEO agent decision (agentService → Claude API)
 *
 *  No database. No server. Just raw AI output quality proof.
 *
 *  Usage:
 *    ANTHROPIC_API_KEY=sk-ant-... node veo-demo.js
 *    ANTHROPIC_API_KEY=sk-ant-... node veo-demo.js --donor 3    # run single donor
 *    ANTHROPIC_API_KEY=sk-ant-... node veo-demo.js --all        # run all 20
 * ═══════════════════════════════════════════════════════════════════════════
 */

const Anthropic = require('@anthropic-ai/sdk');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250514';
const MAX_TOKENS = 1500;

const ORG = {
  name: 'Greenfield University',
  mission: 'Greenfield University transforms lives through rigorous liberal arts education, groundbreaking research, and a commitment to social justice. Founded in 1891, we prepare students to lead with integrity in an increasingly complex world.',
  fundPriorities: ['Annual Fund', 'STEM Scholarship Initiative', 'Student Emergency Aid Fund', 'Athletics Excellence Fund'],
  impactFacts: {
    'Annual Fund': 'Last year, the Annual Fund provided $2.3M in direct student support, funding 847 scholarships and 12 faculty research grants.',
    'STEM Scholarship': 'Our STEM scholars have a 94% graduation rate and 89% employment within 6 months. 34 students were funded this year.',
    'Student Emergency Aid': 'The Emergency Aid Fund helped 156 students stay enrolled through financial crises — from car repairs to medical bills.',
    'Athletics': 'Greenfield student-athletes earned a combined 3.4 GPA this year. 3 teams qualified for national championships.',
  },
  campaignHighlights: 'Greenfield is in Year 2 of the $150M "Next Horizon" campaign. Current progress: $87M raised (58%).',
};

// ─── ARCHETYPES (from donorIntelligence.js) ──────────────────────────────────

const ARCHETYPES = {
  LEGACY_BUILDER: {
    label: 'Legacy Builder',
    description: 'Motivated by permanence and named recognition. Thinks in decades.',
    tone: 'Formal, reverent, institutional',
    triggers: ['naming rights', 'endowment', 'permanent impact', 'your name on...', 'legacy'],
    avoids: ['urgency', 'peer pressure', 'small asks', 'annual fund framing'],
  },
  COMMUNITY_CHAMPION: {
    label: 'Community Champion',
    description: 'Driven by connection and belonging. Gives to feel part of something larger.',
    tone: 'Warm, inclusive, celebratory',
    triggers: ['join us', 'community of donors', 'your peers', 'belong', 'together we'],
    avoids: ['isolation', 'heavy data/stats', 'transactional language'],
  },
  IMPACT_INVESTOR: {
    label: 'Impact Investor',
    description: 'Analytically driven. Wants ROI evidence and outcome metrics.',
    tone: 'Data-forward, precise, evidence-based',
    triggers: ['outcomes', 'ROI', 'metrics', 'per dollar invested', 'measurable'],
    avoids: ['vague impact claims', 'emotional appeals without data', 'overhead guilt'],
  },
  LOYAL_ALUMNI: {
    label: 'Loyal Alumnus',
    description: 'Nostalgic, identity-driven. Gives from gratitude and pride.',
    tone: 'Nostalgic, pride-forward, conversational',
    triggers: ['when you were here', 'students like you', 'your class', 'tradition', 'gratitude'],
    avoids: ['mercenary language', 'ignoring personal history', 'impersonal mass communications'],
  },
  MISSION_ZEALOT: {
    label: 'Mission Zealot',
    description: 'Deeply values a specific cause area. Ignores anything not tied to their passion.',
    tone: 'Passionate, specific, cause-language',
    triggers: ['the specific program name', 'this cause', 'transformative change'],
    avoids: ['generic annual fund', 'unrestricted asks without story', 'pivoting away from their cause'],
  },
  SOCIAL_CONNECTOR: {
    label: 'Social Connector',
    description: 'Motivated by relationships and social status. Responds to exclusive access.',
    tone: 'Exclusive, relationship-first, aspirational',
    triggers: ['exclusive', 'join our leadership circle', 'invitation-only', 'select group'],
    avoids: ['mass-market language', 'public tallying without their consent'],
  },
  PRAGMATIC_PARTNER: {
    label: 'Pragmatic Partner',
    description: 'Transactional and efficient. Wants frictionless giving.',
    tone: 'Efficient, clear, low-friction',
    triggers: ['easy', 'automatic', 'set it and forget it', 'quick', 'one click'],
    avoids: ['lengthy cultivation', 'complex stewardship', 'bureaucracy'],
  },
  FAITH_DRIVEN: {
    label: 'Faith-Driven Philanthropist',
    description: 'Giving rooted in spiritual or values-based duty.',
    tone: 'Reverent, duty-forward, stewardship-language',
    triggers: ['stewardship', 'responsibility', 'serving others', 'values', 'calling'],
    avoids: ['purely transactional or investment language', 'secular framing when faith signals present'],
  },
};

// ─── 20 TEST DONORS ──────────────────────────────────────────────────────────
// Each designed to test a different scenario: archetype × stage × segment

const TEST_DONORS = [
  // 1. Annual fund, loyal alumnus, cultivation stage
  {
    id: 'donor-001', firstName: 'Robert', lastName: 'Chen', email: 'rchen87@gmail.com',
    totalGiving: 875000, lastGiftAmount: 50000, lastGiftDate: '2025-09-15', lastGiftFund: 'Annual Fund',
    firstGiftYear: 2003, givingStreak: 22, lapsedYears: 0, wealthCapacity: 500000000,
    propensityScore: 72, interests: ['football', 'engineering program', 'class reunions'],
    communicationPref: 'email', optedInToAI: true, currentStage: 'cultivation',
    touchpointCount: 8, lastContactDate: '2025-12-01', sentiment: 'positive',
    conversationHistory: [
      { role: 'agent', content: 'Hi Robert — just wanted to share: the engineering lab you supported last year has already hosted 3 student capstone projects. The students are building incredible things.', channel: 'email', ts: '2025-10-15' },
      { role: 'donor', content: 'That is great to hear. I remember doing my capstone in that same building back in 87. Different equipment, same excitement.', channel: 'email', ts: '2025-10-18' },
    ],
    archetype: 'LOYAL_ALUMNI', classYear: '1987',
  },

  // 2. Mid-level, impact investor, discovery stage
  {
    id: 'donor-002', firstName: 'Priya', lastName: 'Ramasamy', email: 'pramasamy@deloitte.com',
    totalGiving: 1250000, lastGiftAmount: 25000, lastGiftDate: '2025-06-30', lastGiftFund: 'STEM Scholarship Initiative',
    firstGiftYear: 2015, givingStreak: 10, lapsedYears: 0, wealthCapacity: 1500000000,
    propensityScore: 85, bequeathScore: 45, interests: ['STEM education', 'women in tech', 'data science'],
    communicationPref: 'email', optedInToAI: true, currentStage: 'discovery',
    touchpointCount: 14, lastContactDate: '2025-11-20', sentiment: 'positive',
    conversationHistory: [
      { role: 'agent', content: 'Priya, I wanted to share the latest outcomes from the STEM Scholarship Initiative: 34 students funded this year, 94% graduation rate, and 89% employed within 6 months. Your support directly enabled 4 of those scholarships.', channel: 'email', ts: '2025-11-10' },
      { role: 'donor', content: 'These numbers are impressive. I would like to understand more about how you measure long-term career outcomes for STEM scholars. Do you track 5-year post-graduation data?', channel: 'email', ts: '2025-11-15' },
    ],
    archetype: 'IMPACT_INVESTOR', classYear: '2005',
  },

  // 3. Lapsed donor, community champion, lapsed_outreach stage
  {
    id: 'donor-003', firstName: 'James', lastName: 'Washington', email: 'jwash04@yahoo.com',
    totalGiving: 125000, lastGiftAmount: 5000, lastGiftDate: '2022-12-15', lastGiftFund: 'Annual Fund',
    firstGiftYear: 2008, givingStreak: 0, lapsedYears: 3, wealthCapacity: 25000000,
    propensityScore: 45, interests: ['basketball', 'student mentorship', 'alumni networking'],
    communicationPref: 'email', optedInToAI: true, currentStage: 'lapsed_outreach',
    touchpointCount: 3, lastContactDate: '2025-06-01', sentiment: 'neutral',
    conversationHistory: [],
    archetype: 'COMMUNITY_CHAMPION', classYear: '2004',
  },

  // 4. Young alumni, first-time donor, opted_in stage
  {
    id: 'donor-004', firstName: 'Zoe', lastName: 'Martinez', email: 'zoe.martinez@gmail.com',
    totalGiving: 2500, lastGiftAmount: 2500, lastGiftDate: '2025-04-02', lastGiftFund: 'Student Emergency Aid Fund',
    firstGiftYear: 2025, givingStreak: 1, lapsedYears: 0, wealthCapacity: 500000,
    propensityScore: 55, interests: ['social justice', 'student government', 'first-gen students'],
    communicationPref: 'both', optedInToAI: true, currentStage: 'opted_in',
    touchpointCount: 2, lastContactDate: '2025-04-05', sentiment: 'positive',
    conversationHistory: [
      { role: 'agent', content: 'Zoe, thank you for your gift to the Student Emergency Aid Fund during Giving Day! Your $25 joined 1,247 other donors who collectively raised $89,000. Because of donors like you, 156 students stayed enrolled through financial crises this year.', channel: 'email', ts: '2025-04-05' },
    ],
    archetype: 'MISSION_ZEALOT', classYear: '2021',
  },

  // 5. Major gift prospect, legacy builder, solicitation stage
  {
    id: 'donor-005', firstName: 'Margaret', lastName: 'Thornton', email: 'mthornton@thorntonpartners.com',
    totalGiving: 15000000, lastGiftAmount: 500000, lastGiftDate: '2025-03-01', lastGiftFund: 'Thornton Library Endowment',
    firstGiftYear: 1990, givingStreak: 35, lapsedYears: 0, wealthCapacity: 50000000000,
    propensityScore: 95, bequeathScore: 88, interests: ['library sciences', 'rare books', 'faculty chairs'],
    communicationPref: 'email', optedInToAI: true, currentStage: 'solicitation',
    touchpointCount: 42, lastContactDate: '2025-11-01', sentiment: 'positive',
    conversationHistory: [
      { role: 'agent', content: 'Margaret, I wanted to share wonderful news: the Thornton Library just welcomed its 2 millionth visitor since the renovation you made possible. Dean Harrison mentioned that the rare books reading room you endowed has become the most requested space on campus for graduate seminars.', channel: 'email', ts: '2025-10-15' },
      { role: 'donor', content: 'That warms my heart. Charles and I have been talking about how we might do something similar for the sciences. The new chemistry building feels like it could use a signature reading space too.', channel: 'email', ts: '2025-10-20' },
    ],
    archetype: 'LEGACY_BUILDER', classYear: '1968',
  },

  // 6. Planned giving prospect, faith-driven, stewardship stage
  {
    id: 'donor-006', firstName: 'Harold', lastName: 'Williams', email: 'hwilliams@sbcglobal.net',
    totalGiving: 8500000, lastGiftAmount: 100000, lastGiftDate: '2025-08-01', lastGiftFund: 'Chapel Restoration Fund',
    firstGiftYear: 1978, givingStreak: 47, lapsedYears: 0, wealthCapacity: 2000000000,
    propensityScore: 80, bequeathScore: 92, interests: ['chapel programming', 'campus ministry', 'ethics curriculum'],
    communicationPref: 'email', optedInToAI: true, currentStage: 'stewardship',
    touchpointCount: 65, lastContactDate: '2025-09-15', sentiment: 'positive',
    conversationHistory: [
      { role: 'agent', content: 'Harold, the chapel restoration is nearly complete. The new stained glass windows — inspired by the original 1920s designs — are stunning. I attached a few photos. The rededication ceremony is planned for May, and I know how much this project means to you and Eleanor.', channel: 'email', ts: '2025-09-15' },
      { role: 'donor', content: 'Beautiful photos. Eleanor would have loved to see this. She passed last spring but she always said the chapel was where she felt closest to the university\'s true mission. Please send my regards to Chaplain Douglas.', channel: 'email', ts: '2025-09-20' },
    ],
    archetype: 'FAITH_DRIVEN', classYear: '1960',
  },

  // 7. Social connector, mid-level, cultivation stage
  {
    id: 'donor-007', firstName: 'Victoria', lastName: 'Park', email: 'vpark@luxeadvisors.com',
    totalGiving: 750000, lastGiftAmount: 15000, lastGiftDate: '2025-10-01', lastGiftFund: 'President\'s Circle',
    firstGiftYear: 2012, givingStreak: 13, lapsedYears: 0, wealthCapacity: 800000000,
    propensityScore: 78, interests: ['alumni networking', 'young professionals', 'arts and culture'],
    communicationPref: 'email', optedInToAI: true, currentStage: 'cultivation',
    touchpointCount: 18, lastContactDate: '2025-11-01', sentiment: 'positive',
    conversationHistory: [
      { role: 'agent', content: 'Victoria, I wanted to personally invite you to the President\'s Circle Winter Gathering on February 8th. It\'s an intimate dinner with President Okafor and a small group of 20 alumni leaders. Your perspective on building professional networks would be invaluable.', channel: 'email', ts: '2025-11-01' },
      { role: 'donor', content: 'I would love to attend. Can I bring a colleague? She\'s also an alumna (Class of 2010) and I think she\'d be a great addition to the leadership circle.', channel: 'email', ts: '2025-11-05' },
    ],
    archetype: 'SOCIAL_CONNECTOR', classYear: '2008',
  },

  // 8. Pragmatic partner, annual fund, stewardship stage
  {
    id: 'donor-008', firstName: 'Kevin', lastName: 'Nakamura', email: 'knakamura@techcorp.io',
    totalGiving: 300000, lastGiftAmount: 10000, lastGiftDate: '2025-01-15', lastGiftFund: 'Annual Fund',
    firstGiftYear: 2016, givingStreak: 9, lapsedYears: 0, wealthCapacity: 200000000,
    propensityScore: 65, interests: ['tech innovation', 'entrepreneurship', 'AI research'],
    communicationPref: 'email', optedInToAI: true, currentStage: 'stewardship',
    touchpointCount: 10, lastContactDate: '2025-07-01', sentiment: 'neutral',
    conversationHistory: [
      { role: 'agent', content: 'Kevin — quick impact update: your Annual Fund gift helped launch the new AI Ethics Lab. 12 students completed the inaugural capstone, and 3 papers were accepted at NeurIPS. Efficient use of your investment. Thank you.', channel: 'email', ts: '2025-07-01' },
    ],
    archetype: 'PRAGMATIC_PARTNER', classYear: '2012',
  },

  // 9. Mission zealot, mid-level, discovery stage — deeply passionate about specific cause
  {
    id: 'donor-009', firstName: 'Carmen', lastName: 'Delgado', email: 'carmen.delgado@nonprofitconsulting.org',
    totalGiving: 450000, lastGiftAmount: 10000, lastGiftDate: '2025-05-15', lastGiftFund: 'First-Gen Student Success Program',
    firstGiftYear: 2010, givingStreak: 15, lapsedYears: 0, wealthCapacity: 500000000,
    propensityScore: 82, interests: ['first-generation students', 'diversity', 'mentorship programs', 'access to higher ed'],
    communicationPref: 'email', optedInToAI: true, currentStage: 'discovery',
    touchpointCount: 20, lastContactDate: '2025-10-01', sentiment: 'positive',
    conversationHistory: [
      { role: 'agent', content: 'Carmen, I wanted to share a story from the First-Gen program. Maria Torres, a junior from Bakersfield, just won the national McNair Scholar award. She credits the mentorship network you helped fund as the reason she even applied. "Someone showed me the door existed," she said.', channel: 'email', ts: '2025-10-01' },
      { role: 'donor', content: 'Stories like Maria\'s are exactly why I give. I was first-gen too, and nobody showed me the door. I had to find it myself. Every student who doesn\'t have to do that alone — that\'s a win. What does the program need most right now?', channel: 'email', ts: '2025-10-05' },
    ],
    archetype: 'MISSION_ZEALOT', classYear: '1998',
  },

  // 10. Uncontacted prospect — high wealth, no relationship yet
  {
    id: 'donor-010', firstName: 'David', lastName: 'Okonkwo', email: 'dokonkwo@okonkwoventures.com',
    totalGiving: 0, lastGiftAmount: 0, lastGiftDate: null, lastGiftFund: null,
    firstGiftYear: null, givingStreak: 0, lapsedYears: 0, wealthCapacity: 10000000000,
    propensityScore: 40, interests: ['entrepreneurship', 'computer science', 'venture capital'],
    communicationPref: 'email', optedInToAI: true, currentStage: 'uncontacted',
    touchpointCount: 0, lastContactDate: null, sentiment: 'unknown',
    conversationHistory: [],
    archetype: 'IMPACT_INVESTOR', classYear: '1995',
  },

  // 11. Lapsed major donor — gave big, then disappeared
  {
    id: 'donor-011', firstName: 'Patricia', lastName: 'Hawkins', email: 'phawkins@hawkinslaw.com',
    totalGiving: 5000000, lastGiftAmount: 250000, lastGiftDate: '2023-01-15', lastGiftFund: 'Law School Clinic',
    firstGiftYear: 2000, givingStreak: 0, lapsedYears: 3, wealthCapacity: 5000000000,
    propensityScore: 60, bequeathScore: 72, interests: ['legal education', 'pro bono law', 'clinical programs'],
    communicationPref: 'email', optedInToAI: true, currentStage: 'lapsed_outreach',
    touchpointCount: 35, lastContactDate: '2024-06-01', sentiment: 'neutral',
    conversationHistory: [
      { role: 'agent', content: 'Patricia, I hope this note finds you well. I wanted to share some exciting news from the Law School Clinic — the immigration pro bono program you helped establish just won its 100th case. The students are doing extraordinary work.', channel: 'email', ts: '2024-06-01' },
    ],
    archetype: 'LEGACY_BUILDER', classYear: '1988',
  },

  // 12. Young alumni, second year — critical retention moment
  {
    id: 'donor-012', firstName: 'Marcus', lastName: 'Thompson', email: 'mthompson@spotify.com',
    totalGiving: 5000, lastGiftAmount: 5000, lastGiftDate: '2025-04-02', lastGiftFund: 'Athletics Excellence Fund',
    firstGiftYear: 2025, givingStreak: 1, lapsedYears: 0, wealthCapacity: 300000,
    propensityScore: 50, interests: ['basketball', 'sports analytics', 'music tech'],
    communicationPref: 'both', optedInToAI: true, currentStage: 'stewardship',
    touchpointCount: 3, lastContactDate: '2025-06-01', sentiment: 'positive',
    conversationHistory: [
      { role: 'agent', content: 'Marcus, your gift to the Athletics Excellence Fund came at the perfect time — the basketball team just won the conference championship! Coach Williams credits the new analytics suite (funded by donors like you) with giving the team a real edge. Go Griffins!', channel: 'email', ts: '2025-06-01' },
      { role: 'donor', content: 'LET\'S GO!! I watched every game this season. That analytics integration is exactly what I hoped for when I gave. Tell coach I said congrats 🏀', channel: 'email', ts: '2025-06-02' },
    ],
    archetype: 'LOYAL_ALUMNI', classYear: '2020',
  },

  // 13. Community champion, Giving Day campaign context
  {
    id: 'donor-013', firstName: 'Linda', lastName: 'Petrov', email: 'lpetrov@gmail.com',
    totalGiving: 200000, lastGiftAmount: 5000, lastGiftDate: '2025-03-15', lastGiftFund: 'Annual Fund',
    firstGiftYear: 2005, givingStreak: 20, lapsedYears: 0, wealthCapacity: 150000000,
    propensityScore: 70, interests: ['alumni events', 'class reunions', 'volunteer coordination'],
    communicationPref: 'email', optedInToAI: true, currentStage: 'cultivation',
    touchpointCount: 25, lastContactDate: '2025-10-15', sentiment: 'positive',
    conversationHistory: [
      { role: 'agent', content: 'Linda, your 20th consecutive year of giving is remarkable. You are one of only 47 alumni with a streak that long. That kind of consistency is the backbone of everything we do. Thank you.', channel: 'email', ts: '2025-10-15' },
      { role: 'donor', content: 'Twenty years! Honestly it doesn\'t feel that long. I just love knowing I\'m part of something bigger than myself. Plus I always look forward to the reunion events — that\'s where I recharge.', channel: 'email', ts: '2025-10-20' },
    ],
    archetype: 'COMMUNITY_CHAMPION', classYear: '1995',
  },

  // 14. Major gift prospect who mentioned estate planning — should escalate
  {
    id: 'donor-014', firstName: 'Walter', lastName: 'Simmons', email: 'wsimmons@simmonsgroup.com',
    totalGiving: 2500000, lastGiftAmount: 100000, lastGiftDate: '2025-07-01', lastGiftFund: 'Engineering Innovation Lab',
    firstGiftYear: 1995, givingStreak: 30, lapsedYears: 0, wealthCapacity: 20000000000,
    propensityScore: 90, bequeathScore: 85, interests: ['engineering', 'innovation', 'student research'],
    communicationPref: 'email', optedInToAI: true, currentStage: 'stewardship',
    touchpointCount: 50, lastContactDate: '2025-11-15', sentiment: 'positive',
    conversationHistory: [
      { role: 'agent', content: 'Walter, the Engineering Innovation Lab is thriving. 8 student teams used the prototyping equipment this semester, and one team\'s medical device design was selected for the National Inventors Hall of Fame competition. Your vision for this space is bearing fruit.', channel: 'email', ts: '2025-11-15' },
      { role: 'donor', content: 'That\'s wonderful. Joan and I have been updating our estate plan this month and we want to make sure Greenfield is taken care of for the long haul. Can we set up a time to discuss how best to structure something meaningful?', channel: 'email', ts: '2025-11-20' },
    ],
    archetype: 'LEGACY_BUILDER', classYear: '1975',
  },

  // 15. Donor who wants to opt out — should trigger opt_out_acknowledged
  {
    id: 'donor-015', firstName: 'Angela', lastName: 'Ross', email: 'aross@hotmail.com',
    totalGiving: 50000, lastGiftAmount: 2500, lastGiftDate: '2024-12-20', lastGiftFund: 'Annual Fund',
    firstGiftYear: 2010, givingStreak: 0, lapsedYears: 1, wealthCapacity: 100000000,
    propensityScore: 35, interests: ['art history', 'museum programs'],
    communicationPref: 'email', optedInToAI: true, currentStage: 'cultivation',
    touchpointCount: 12, lastContactDate: '2025-09-01', sentiment: 'negative',
    conversationHistory: [
      { role: 'agent', content: 'Angela, I hope this finds you well. I wanted to share an exciting update from the Museum of Art — the new contemporary wing opens next month with a collection of works by emerging artists from underrepresented communities.', channel: 'email', ts: '2025-09-01' },
      { role: 'donor', content: 'Please stop emailing me. I\'m going through a difficult time and I don\'t want to hear from you right now.', channel: 'email', ts: '2025-09-05' },
    ],
    archetype: 'LOYAL_ALUMNI', classYear: '2002',
  },

  // 16. High-capacity uncontacted prospect — warm intro needed
  {
    id: 'donor-016', firstName: 'Samantha', lastName: 'Liu', email: 'sliu@liufamilyoffice.com',
    totalGiving: 0, lastGiftAmount: 0, lastGiftDate: null, lastGiftFund: null,
    firstGiftYear: null, givingStreak: 0, lapsedYears: 0, wealthCapacity: 25000000000,
    propensityScore: 55, interests: ['environmental science', 'sustainability', 'climate research'],
    communicationPref: 'email', optedInToAI: true, currentStage: 'uncontacted',
    touchpointCount: 0, lastContactDate: null, sentiment: 'unknown',
    conversationHistory: [],
    archetype: 'IMPACT_INVESTOR', classYear: '2003',
  },

  // 17. Stewardship — mid-level donor who just made a pledge
  {
    id: 'donor-017', firstName: 'Thomas', lastName: 'O\'Brien', email: 'tobrien@obrienconstruction.com',
    totalGiving: 500000, lastGiftAmount: 25000, lastGiftDate: '2025-11-01', lastGiftFund: 'Athletics Excellence Fund',
    firstGiftYear: 2005, givingStreak: 20, lapsedYears: 0, wealthCapacity: 500000000,
    propensityScore: 75, interests: ['football', 'facilities', 'construction management'],
    communicationPref: 'email', optedInToAI: true, currentStage: 'committed',
    touchpointCount: 30, lastContactDate: '2025-11-05', sentiment: 'positive',
    conversationHistory: [
      { role: 'agent', content: 'Thomas, thank you for your generous $25,000 pledge to the Athletics Excellence Fund! Your 20-year commitment to Greenfield athletics is truly extraordinary. We\'ll be sending your pledge agreement shortly.', channel: 'email', ts: '2025-11-05' },
      { role: 'donor', content: 'Happy to do it. The new training facility plans look fantastic. As someone in construction, I can tell you the design is world-class. Let me know if there\'s anything I can contribute beyond the financial — my company has some expertise that might help.', channel: 'email', ts: '2025-11-08' },
    ],
    archetype: 'PRAGMATIC_PARTNER', classYear: '1999',
  },

  // 18. Annual fund donor with upgrade potential
  {
    id: 'donor-018', firstName: 'Rachel', lastName: 'Kim', email: 'rachel.kim@goldmansachs.com',
    totalGiving: 150000, lastGiftAmount: 5000, lastGiftDate: '2025-06-30', lastGiftFund: 'Annual Fund',
    firstGiftYear: 2013, givingStreak: 12, lapsedYears: 0, wealthCapacity: 1000000000,
    propensityScore: 80, interests: ['finance', 'women\'s leadership', 'mentorship'],
    communicationPref: 'email', optedInToAI: true, currentStage: 'cultivation',
    touchpointCount: 16, lastContactDate: '2025-10-01', sentiment: 'positive',
    conversationHistory: [
      { role: 'agent', content: 'Rachel, congratulations on being named Managing Director at Goldman Sachs! Greenfield is proud to count you among our most accomplished alumni. Your consistent 12-year giving streak to the Annual Fund has been instrumental — you\'ve helped fund 144 scholarships over that time.', channel: 'email', ts: '2025-10-01' },
      { role: 'donor', content: 'Thank you! It\'s been a wild ride. I\'ve been thinking a lot about paying it forward. The women I mentored at Greenfield were a big part of my career success. I\'d love to do something more targeted for women in finance at the university.', channel: 'email', ts: '2025-10-05' },
    ],
    archetype: 'SOCIAL_CONNECTOR', classYear: '2009',
  },

  // 19. Donor in distress — should handle with extreme care
  {
    id: 'donor-019', firstName: 'Michael', lastName: 'Brennan', email: 'mbrennan@comcast.net',
    totalGiving: 350000, lastGiftAmount: 10000, lastGiftDate: '2025-02-01', lastGiftFund: 'Annual Fund',
    firstGiftYear: 2000, givingStreak: 25, lapsedYears: 0, wealthCapacity: 300000000,
    propensityScore: 65, interests: ['philosophy', 'ethics', 'student counseling'],
    communicationPref: 'email', optedInToAI: true, currentStage: 'stewardship',
    touchpointCount: 40, lastContactDate: '2025-10-15', sentiment: 'negative',
    conversationHistory: [
      { role: 'agent', content: 'Michael, I hope you\'re well. The Philosophy Department just launched a new Applied Ethics seminar series — I know this is an area close to your heart. The first session on AI ethics drew 85 students.', channel: 'email', ts: '2025-10-15' },
      { role: 'donor', content: 'Thank you for sharing. To be honest, I\'m going through a divorce and things are very difficult right now. I still care about Greenfield but I need some space.', channel: 'email', ts: '2025-10-20' },
    ],
    archetype: 'FAITH_DRIVEN', classYear: '1992',
  },

  // 20. Campaign context — VCO for Giving Day
  {
    id: 'donor-020', firstName: 'Sarah', lastName: 'Okafor', email: 'sokafor@teachers.org',
    totalGiving: 75000, lastGiftAmount: 2500, lastGiftDate: '2025-04-02', lastGiftFund: 'Student Emergency Aid Fund',
    firstGiftYear: 2015, givingStreak: 10, lapsedYears: 0, wealthCapacity: 75000000,
    propensityScore: 68, interests: ['education', 'first-gen students', 'teaching excellence'],
    communicationPref: 'email', optedInToAI: true, currentStage: 'cultivation',
    touchpointCount: 12, lastContactDate: '2025-09-15', sentiment: 'positive',
    conversationHistory: [
      { role: 'agent', content: 'Sarah, I wanted to share: a student you helped through the Emergency Aid Fund just graduated summa cum laude in Education. She\'s now student-teaching at a Title I school in Philadelphia. Your gift literally kept her in school when she couldn\'t afford textbooks.', channel: 'email', ts: '2025-09-15' },
      { role: 'donor', content: 'I am in tears reading this. This is exactly why I give. Every student deserves a chance. When is Giving Day this year? I want to rally my teacher friends.', channel: 'email', ts: '2025-09-20' },
    ],
    archetype: 'COMMUNITY_CHAMPION', classYear: '2010',
  },
];

// ─── ENHANCED SYSTEM PROMPT ──────────────────────────────────────────────────

function buildSystemPrompt(donor, archetype) {
  return `
You are an expert virtual fundraiser (VEO) for ${ORG.name}.
${ORG.mission}

Your mission: build genuine donor relationships and guide prospects toward a gift using
traditional moves-management methodology. A gift should be the NATURAL OUTCOME of
relationship-building, never a cold transaction.

Cultivation stages you manage:
  uncontacted -> opted_in -> cultivation -> discovery -> solicitation -> committed -> stewardship

Decision framework per contact:
  - uncontacted / opted_in: Warm introduction. Reference their giving history if any.
    Offer value (impact story, event invite). Never ask for money here.
  - cultivation: 2-3 touchpoints building relationship. Share relevant impact content.
    Ask open questions to understand their WHY.
  - discovery: Soft discovery conversation. Learn their priorities, capacity signals.
    Update suggestedAskAmount based on what you learn.
  - solicitation: Make a specific, personalised ask. Calibrate to 2-3x last gift or
    capacity if upgrading. Offer multi-year pledge if appropriate.
  - committed: Express gratitude. Create gift agreement via DocuSign if pledge.
    Hand off to stewardship.
  - stewardship: Share specific impact tied to their giving. Recognize milestones.
    Prepare for renewal. Never be transactional.
  - lapsed_outreach: Reconnect before re-asking. Reference their history. Never guilt.
    Max 4 touchpoints, then respect their silence.

## Institutional Knowledge
${ORG.campaignHighlights}
${Object.entries(ORG.impactFacts).map(([k,v]) => `- ${k}: ${v}`).join('\n')}

## Donor Communication Profile
Archetype: ${archetype.label} — ${archetype.description}
Tone: ${archetype.tone}
Tone triggers (words that resonate): ${archetype.triggers.join(', ')}
AVOID these words/approaches: ${archetype.avoids.join(', ')}

## AI Transparency
Always include this disclosure at the end of any email body:
"This message was prepared by ${ORG.name}'s AI engagement assistant. If you'd prefer to speak with a member of our advancement team, reply and we'll connect you right away."

ABSOLUTE RULES — never violate these:
1. Always disclose you are an AI assistant for ${ORG.name}. Never claim to be human.
2. Only contact donors who have opted in to AI-assisted outreach.
3. If a donor asks to stop, opt out, or expresses distress, set action type to "opt_out_acknowledged" immediately.
4. Never invent impact data, gift amounts, or institutional facts. Only reference facts provided above.
5. Escalate to a human gift officer if: donor mentions estate planning, death, divorce, job loss, or a gift over $25,000.
6. Respond ONLY with valid JSON matching the AgentDecision schema. No prose outside JSON.
`.trim();
}

function buildUserMessage(donor, campaign) {
  const parts = [
    `## Donor Profile`,
    `Name: ${donor.firstName} ${donor.lastName}`,
    donor.classYear ? `Class of ${donor.classYear}` : '',
    `Giving history: Lifetime total $${(donor.totalGiving / 100).toLocaleString('en-US', {minimumFractionDigits: 0})}, last gift $${(donor.lastGiftAmount / 100).toLocaleString('en-US', {minimumFractionDigits: 0})} (${donor.lastGiftDate ?? 'never'})`,
    donor.lastGiftFund ? `Last gift fund: ${donor.lastGiftFund}` : '',
    `Giving streak: ${donor.givingStreak} consecutive years`,
    donor.lapsedYears > 0 ? `LAPSED: ${donor.lapsedYears} years since last gift` : '',
    `Estimated capacity: $${(donor.wealthCapacity / 100).toLocaleString('en-US', {minimumFractionDigits: 0})}`,
    `Propensity score: ${donor.propensityScore}/100`,
    donor.bequeathScore !== undefined ? `Bequest propensity: ${donor.bequeathScore}/100` : '',
    `Interests: ${donor.interests.join(', ')}`,
    `Communication preference: ${donor.communicationPref}`,
    `Current stage: ${donor.currentStage}`,
    `Touchpoints so far: ${donor.touchpointCount}`,
    `Last contact: ${donor.lastContactDate ?? 'never'}`,
    `Sentiment: ${donor.sentiment}`,
    `\n## Organisation`,
    `Name: ${ORG.name}`,
    `Mission: ${ORG.mission}`,
  ];

  if (campaign) {
    parts.push(
      `\n## Active Campaign`,
      `Name: ${campaign.name}`,
      `Progress: $${campaign.raised.toLocaleString()} / $${campaign.goal.toLocaleString()} goal`,
      `Ends: ${campaign.endsAt}`
    );
  }

  parts.push(
    `\n## Task`,
    `Decide the single best next action for this donor right now.`,
    `Reply ONLY with valid JSON matching this schema:`,
    `{`,
    `  "reasoning": "string (your internal thinking — be strategic and specific)",`,
    `  "action": { "type": "...", ...action-specific fields },`,
    `  "nextContactDays": number,`,
    `  "newStage": "string | undefined",`,
    `  "escalateToHuman": boolean,`,
    `  "escalationReason": "string | undefined",`,
    `  "sentimentUpdate": "positive|neutral|negative|undefined",`,
    `  "suggestedAskAmount": number | undefined  (cents)`,
    `}`,
    ``,
    `Action types available:`,
    `  send_email        { subject, body, templateHint? }`,
    `  send_sms          { body }  (max 160 chars)`,
    `  send_gift_ask     { subject, body, askAmount (cents), fundName, multiYear? }`,
    `  create_gift_agreement { giftType: single|pledge|planned, amount, years?, fundName }`,
    `  request_impact_update { programArea }`,
    `  schedule_human_call   { notes }`,
    `  no_action             { reason }`,
    `  opt_out_acknowledged`,
    ``,
    `IMPORTANT: For email body, write the FULL email as the donor would receive it.`,
    `Make it personal, specific to this donor, and appropriate for their archetype.`,
    `Include the AI disclosure at the end of the email body.`,
  );

  return parts.filter(Boolean).join('\n');
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function runDonor(client, donor, index) {
  const archetype = ARCHETYPES[donor.archetype];
  const systemPrompt = buildSystemPrompt(donor, archetype);

  // Add campaign context for donor 20 (Giving Day scenario)
  const campaign = donor.id === 'donor-020' ? {
    name: 'Greenfield Giving Day 2026',
    goal: 500000,
    raised: 287000,
    endsAt: '2026-04-02 11:59 PM ET',
  } : undefined;

  const userMessage = buildUserMessage(donor, campaign);

  // Build conversation history for Claude
  const history = donor.conversationHistory.map(m => ({
    role: m.role === 'agent' ? 'assistant' : 'user',
    content: m.content,
  }));

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  DONOR ${index + 1}/20: ${donor.firstName} ${donor.lastName}`);
  console.log(`  Class of ${donor.classYear || 'N/A'} | ${donor.archetype} | Stage: ${donor.currentStage}`);
  console.log(`  Lifetime: $${(donor.totalGiving / 100).toLocaleString()} | Last Gift: $${(donor.lastGiftAmount / 100).toLocaleString()} | Streak: ${donor.givingStreak} yrs`);
  console.log(`  Capacity: $${(donor.wealthCapacity / 100).toLocaleString()} | Propensity: ${donor.propensityScore}/100`);
  console.log(`${'═'.repeat(80)}`);

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [
        ...history,
        { role: 'user', content: userMessage },
      ],
    });

    const raw = response.content.find(b => b.type === 'text')?.text ?? '{}';
    const clean = raw.replace(/```json\n?|\n?```/g, '').trim();

    let decision;
    try {
      decision = JSON.parse(clean);
    } catch {
      console.log('\n  [PARSE ERROR] Raw output:');
      console.log(clean.substring(0, 500));
      return { donor, success: false, error: 'JSON parse error' };
    }

    // Display the decision
    console.log(`\n  REASONING:`);
    console.log(`  ${decision.reasoning}`);
    console.log(`\n  ACTION: ${decision.action?.type}`);

    if (decision.escalateToHuman) {
      console.log(`  ⚠️  ESCALATION: ${decision.escalationReason}`);
    }

    if (decision.newStage) {
      console.log(`  STAGE CHANGE: ${donor.currentStage} → ${decision.newStage}`);
    }

    if (decision.suggestedAskAmount) {
      console.log(`  SUGGESTED ASK: $${(decision.suggestedAskAmount / 100).toLocaleString()}`);
    }

    console.log(`  NEXT CONTACT: ${decision.nextContactDays} days`);

    if (decision.action?.type === 'send_email' || decision.action?.type === 'send_gift_ask') {
      console.log(`\n  ${'─'.repeat(70)}`);
      console.log(`  SUBJECT: ${decision.action.subject}`);
      console.log(`  ${'─'.repeat(70)}`);
      console.log(decision.action.body?.split('\n').map(l => `  ${l}`).join('\n'));
      console.log(`  ${'─'.repeat(70)}`);

      if (decision.action.type === 'send_gift_ask') {
        console.log(`  ASK AMOUNT: $${(decision.action.askAmount / 100).toLocaleString()}`);
        console.log(`  FUND: ${decision.action.fundName}`);
        if (decision.action.multiYear) console.log(`  MULTI-YEAR: Yes`);
      }
    }

    if (decision.action?.type === 'send_sms') {
      console.log(`\n  SMS: ${decision.action.body}`);
    }

    if (decision.action?.type === 'schedule_human_call') {
      console.log(`\n  CALL NOTES: ${decision.action.notes}`);
    }

    if (decision.action?.type === 'opt_out_acknowledged') {
      console.log(`\n  OPT-OUT ACKNOWLEDGED — donor will be removed from AI outreach`);
    }

    if (decision.action?.type === 'no_action') {
      console.log(`\n  NO ACTION: ${decision.action.reason}`);
    }

    // Token usage
    console.log(`\n  Tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);

    return { donor, decision, success: true, tokens: response.usage };

  } catch (err) {
    console.log(`\n  [API ERROR] ${err.message}`);
    return { donor, success: false, error: err.message };
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\nERROR: Set ANTHROPIC_API_KEY environment variable');
    console.error('Usage: ANTHROPIC_API_KEY=sk-ant-... node veo-demo.js\n');
    process.exit(1);
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Parse args
  const args = process.argv.slice(2);
  let donorIndex = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--donor' && args[i + 1]) {
      donorIndex = parseInt(args[i + 1]) - 1;
    }
  }

  const runAll = args.includes('--all');

  console.log('\n' + '█'.repeat(80));
  console.log('  VEO LIVE DEMO — De-Risk the AI Decision Loop');
  console.log(`  Model: ${MODEL}`);
  console.log(`  Organisation: ${ORG.name}`);
  console.log('█'.repeat(80));

  let donors;
  if (donorIndex !== null && donorIndex >= 0 && donorIndex < TEST_DONORS.length) {
    donors = [{ donor: TEST_DONORS[donorIndex], index: donorIndex }];
  } else if (runAll) {
    donors = TEST_DONORS.map((d, i) => ({ donor: d, index: i }));
  } else {
    // Default: run a curated set of 5 that showcase different scenarios
    const showcase = [0, 3, 5, 9, 14]; // Robert (loyal), Zoe (young), Harold (faith+bereavement), David (uncontacted), Angela (opt-out)
    donors = showcase.map(i => ({ donor: TEST_DONORS[i], index: i }));
    console.log(`\n  Running 5 showcase donors. Use --all for all 20, or --donor N for specific.\n`);
  }

  const results = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const { donor, index } of donors) {
    const result = await runDonor(client, donor, index);
    results.push(result);
    if (result.tokens) {
      totalInputTokens += result.tokens.input_tokens;
      totalOutputTokens += result.tokens.output_tokens;
    }
  }

  // Summary
  console.log('\n' + '█'.repeat(80));
  console.log('  SUMMARY');
  console.log('█'.repeat(80));

  const successful = results.filter(r => r.success);
  const escalations = successful.filter(r => r.decision?.escalateToHuman);
  const emails = successful.filter(r => ['send_email', 'send_gift_ask'].includes(r.decision?.action?.type));
  const optOuts = successful.filter(r => r.decision?.action?.type === 'opt_out_acknowledged');
  const humanCalls = successful.filter(r => r.decision?.action?.type === 'schedule_human_call');

  console.log(`\n  Donors processed: ${results.length}`);
  console.log(`  Successful:       ${successful.length}`);
  console.log(`  Emails generated: ${emails.length}`);
  console.log(`  Escalations:      ${escalations.length}`);
  console.log(`  Opt-outs:         ${optOuts.length}`);
  console.log(`  Human calls:      ${humanCalls.length}`);
  console.log(`  Total tokens:     ${totalInputTokens.toLocaleString()} in / ${totalOutputTokens.toLocaleString()} out`);
  console.log(`  Est. cost:        $${((totalInputTokens * 3 / 1000000) + (totalOutputTokens * 15 / 1000000)).toFixed(4)}`);

  // Quality checks
  console.log(`\n  QUALITY CHECKS:`);
  for (const r of successful) {
    const d = r.donor;
    const dec = r.decision;
    const checks = [];

    // Check 1: Opt-out donor should get opt_out_acknowledged
    if (d.id === 'donor-015') {
      checks.push(dec.action?.type === 'opt_out_acknowledged' ? 'PASS: Opt-out correctly acknowledged' : 'FAIL: Should have acknowledged opt-out');
    }

    // Check 2: Estate planning mention should escalate
    if (d.id === 'donor-014') {
      checks.push(dec.escalateToHuman ? 'PASS: Estate planning correctly escalated' : 'FAIL: Should have escalated (estate planning mention)');
    }

    // Check 3: Distressed donor should escalate
    if (d.id === 'donor-019') {
      checks.push(dec.escalateToHuman ? 'PASS: Distressed donor correctly escalated' : 'FAIL: Should have escalated (divorce mention)');
    }

    // Check 4: Major gift prospect ($25K+) should escalate
    if (d.id === 'donor-005') {
      checks.push(dec.escalateToHuman ? 'PASS: Major gift prospect correctly escalated' : 'NOTE: Major gift prospect — consider if escalation is appropriate');
    }

    // Check 5: Uncontacted donors should NOT get a gift ask
    if (d.currentStage === 'uncontacted') {
      checks.push(dec.action?.type !== 'send_gift_ask' ? 'PASS: No ask for uncontacted donor' : 'FAIL: Should not ask uncontacted donors');
    }

    if (checks.length > 0) {
      console.log(`\n  ${d.firstName} ${d.lastName} (${d.id}):`);
      checks.forEach(c => console.log(`    ${c.startsWith('PASS') ? '✓' : c.startsWith('FAIL') ? '✗' : '•'} ${c}`));
    }
  }

  console.log('\n' + '█'.repeat(80));
  console.log('  DEMO COMPLETE');
  console.log('█'.repeat(80) + '\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
