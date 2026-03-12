'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ORBIT DONOR INTELLIGENCE ENGINE  v1.0
 *  "The 360° Brain"
 *
 *  Builds the most comprehensive possible donor intelligence profile,
 *  synthesizing every available data signal into a living psychographic
 *  model that updates in real time.
 *
 *  Produces:
 *    - Psychographic archetype (8 types)
 *    - Communication DNA (preferred style, tone, cadence, channel)
 *    - Giving motivation matrix (what actually drives this person)
 *    - Relationship health score + trajectory
 *    - Upgrade pathway model (next ask, timing, framing)
 *    - Planned giving readiness indicators
 *    - Full stewardship prescription
 *    - Red flags and risk signals
 *    - Personalized engagement calendar
 *    - AI officer brief (what a gift officer needs before a call)
 * ═══════════════════════════════════════════════════════════════════════════
 */

const logger   = require('../utils/logger');
const { callClaude } = require('./ai');
const db       = require('../db');

// ─── Psychographic Archetypes ─────────────────────────────────────────────────
const ARCHETYPES = {
  LEGACY_BUILDER: {
    id:          'LEGACY_BUILDER',
    label:       'Legacy Builder',
    icon:        '🏛️',
    description: 'Motivated by permanence and named recognition. Thinks in decades. Responds to endowment, naming opportunities, and multi-generational impact language.',
    giveStyle:   'Major and planned gifts. Prefers structured vehicles (CRTs, bequests, endowments).',
    tone:        'Formal, reverent, institutional',
    triggers:    ['naming rights', 'endowment', 'permanent impact', 'your name on...', 'legacy'],
    avoids:      ['urgency', 'peer pressure', 'small asks', 'annual fund framing'],
    pgReady:     0.85,
  },
  COMMUNITY_CHAMPION: {
    id:          'COMMUNITY_CHAMPION',
    label:       'Community Champion',
    icon:        '🤝',
    description: 'Driven by connection and belonging. Gives to feel part of something larger. Loves peer recognition and community membership language.',
    giveStyle:   'Consistent annual gifts, event sponsorships, peer-to-peer campaigns.',
    tone:        'Warm, inclusive, celebratory',
    triggers:    ['join us', 'community of donors', 'your peers', 'belong', 'together we'],
    avoids:      ['isolation', 'heavy data/stats', 'transactional language'],
    pgReady:     0.40,
  },
  IMPACT_INVESTOR: {
    id:          'IMPACT_INVESTOR',
    label:       'Impact Investor',
    icon:        '📊',
    description: 'Analytically driven. Wants ROI evidence, outcome metrics, and proof of impact before committing. Treats philanthropy as capital allocation.',
    giveStyle:   'Restricted gifts to measurable programs. Large gifts with reporting requirements.',
    tone:        'Data-forward, precise, evidence-based',
    triggers:    ['outcomes', 'ROI', 'metrics', 'per dollar invested', 'measurable'],
    avoids:      ['vague impact claims', 'emotional appeals without data', 'overhead guilt'],
    pgReady:     0.60,
  },
  LOYAL_ALUMNI: {
    id:          'LOYAL_ALUMNI',
    label:       'Loyal Alumnus',
    icon:        '🎓',
    description: 'Nostalgic, identity-driven connection to the institution. Gives from gratitude and pride. Class solidarity is a powerful motivator.',
    giveStyle:   'Consistent annual fund, reunion gifts, class challenges.',
    tone:        'Nostalgic, pride-forward, conversational',
    triggers:    ['when you were here', 'students like you', 'your class', 'tradition', 'gratitude'],
    avoids:      ['mercenary language', 'ignoring personal history', 'impersonal mass communications'],
    pgReady:     0.55,
  },
  MISSION_ZEALOT: {
    id:          'MISSION_ZEALOT',
    label:       'Mission Zealot',
    icon:        '🔥',
    description: 'Deeply values a specific cause area or program. Ignores institutional messaging unless tied to their passion area. Can become a major donor if engaged on their terms.',
    giveStyle:   'Designated restricted gifts, program endowments, advocacy.',
    tone:        'Passionate, specific, cause-language',
    triggers:    ['the specific program name', 'this cause', 'transformative change'],
    avoids:      ['generic annual fund', 'unrestricted asks without story', 'pivoting away from their cause'],
    pgReady:     0.65,
  },
  SOCIAL_CONNECTOR: {
    id:          'SOCIAL_CONNECTOR',
    label:       'Social Connector',
    icon:        '💫',
    description: 'Motivated by relationships and social status. Responds to exclusive access, peer networks, and being seen as a leader.',
    giveStyle:   'Leadership societies, naming opportunities, event-driven.',
    tone:        'Exclusive, relationship-first, aspirational',
    triggers:    ['exclusive', 'join our leadership circle', 'invitation-only', 'select group'],
    avoids:      ['mass-market language', 'public tallying without their consent'],
    pgReady:     0.50,
  },
  PRAGMATIC_PARTNER: {
    id:          'PRAGMATIC_PARTNER',
    label:       'Pragmatic Partner',
    icon:        '🔧',
    description: 'Transactional and efficient. Wants the giving process to be frictionless. Responds to clear, simple asks with easy execution paths.',
    giveStyle:   'Recurring automated gifts, online giving, matching gift activation.',
    tone:        'Efficient, clear, low-friction',
    triggers:    ['easy', 'automatic', 'set it and forget it', 'quick', 'one click'],
    avoids:      ['lengthy cultivation', 'complex stewardship', 'bureaucracy'],
    pgReady:     0.35,
  },
  FAITH_DRIVEN: {
    id:          'FAITH_DRIVEN',
    label:       'Faith-Driven Philanthropist',
    icon:        '🙏',
    description: 'Giving rooted in spiritual or values-based duty. Tithing mindset. Language of stewardship, responsibility, and moral obligation resonates deeply.',
    giveStyle:   'Regular disciplined giving, often structured (10% of income type thinking).',
    tone:        'Reverent, duty-forward, stewardship-language',
    triggers:    ['stewardship', 'responsibility', 'serving others', 'values', 'calling'],
    avoids:      ['purely transactional or investment language', 'secular framing when faith signals present'],
    pgReady:     0.70,
  },
};

// ─── Giving Motivation Matrix dimensions ──────────────────────────────────────
const MOTIVATION_DIMENSIONS = [
  'recognition',        // Named gifts, public acknowledgment
  'impact_proof',       // Needs evidence of outcomes
  'personal_connection',// Relationship with staff/students
  'peer_influence',     // Moves when peers move
  'nostalgia',          // Emotional connection to past experience
  'legacy',             // Permanence and multi-generational thinking
  'tax_efficiency',     // Responds to planned giving vehicles
  'social_status',      // Visibility in donor circles
  'cause_passion',      // Specific program or mission area
  'duty_gratitude',     // Obligation to give back
  'matching_leverage',  // Motivated by matches and challenges
  'exclusivity',        // Invitation-only access and leadership
];

// ─── Communication DNA profiles ───────────────────────────────────────────────
const COMM_STYLES = {
  formal_long:      { label:'Formal / Long-form',      desc:'Prefers detailed letters, formal salutations, full context before the ask' },
  warm_personal:    { label:'Warm / Personal',         desc:'Responds to first-name intimacy, personal stories, officer-to-donor voice' },
  data_brief:       { label:'Data-Forward / Brief',    desc:'Bullet points, metrics, quick reads. Gets to the point fast.' },
  narrative_story:  { label:'Narrative / Storytelling',desc:'Responds to student stories, emotional arcs, show-don\'t-tell content' },
  peer_social:      { label:'Peer / Social',           desc:'Moves when seeing what classmates or community members do' },
};

// ─── Full profile builder ─────────────────────────────────────────────────────
async function buildDonorProfile(donorId, orgId) {
  try {
    // Pull all raw data from DB
    const [donorRow, gifts, outreach, signals] = await Promise.all([
      db.query(`SELECT * FROM donors WHERE id=$1 AND org_id=$2`, [donorId, orgId]),
      db.query(`SELECT * FROM gifts WHERE donor_id=$1 AND org_id=$2 ORDER BY date DESC LIMIT 50`, [donorId, orgId]),
      db.query(`SELECT * FROM outreach_activities WHERE donor_id=$1 AND org_id=$2 ORDER BY created_at DESC LIMIT 30`, [donorId, orgId]),
      db.query(`SELECT * FROM donor_signals WHERE donor_id=$1 AND org_id=$2 ORDER BY signal_date DESC LIMIT 20`, [donorId, orgId]).catch(()=>({rows:[]})),
    ]);

    const donor = donorRow.rows[0];
    if (!donor) throw new Error('Donor not found');

    const giftHistory  = gifts.rows;
    const outreachLog  = outreach.rows;
    const signalLog    = signals.rows;

    // ── Compute raw metrics ──────────────────────────────────────────────────
    const totalGiving      = giftHistory.reduce((s,g)=>s+parseFloat(g.amount||0),0);
    const giftCount        = giftHistory.length;
    const avgGift          = giftCount ? totalGiving/giftCount : 0;
    const largestGift      = giftHistory.reduce((max,g)=>Math.max(max,parseFloat(g.amount||0)),0);
    const recurringGifts   = giftHistory.filter(g=>g.is_recurring);
    const lastGiftDate     = giftHistory[0]?.date;
    const daysSinceLast    = lastGiftDate
      ? Math.floor((Date.now()-new Date(lastGiftDate))/(1000*60*60*24)) : 9999;
    const giftYears        = [...new Set(giftHistory.map(g=>new Date(g.date).getFullYear()))];
    const consecutiveYears = computeConsecutiveYears(giftYears);
    const emailOpens       = outreachLog.filter(o=>o.type==='email'&&o.status==='opened').length;
    const emailSent        = outreachLog.filter(o=>o.type==='email').length;
    const openRate         = emailSent ? emailOpens/emailSent : 0;
    const callsAnswered    = outreachLog.filter(o=>o.type==='call'&&o.outcome==='connected').length;
    const callsAttempted   = outreachLog.filter(o=>o.type==='call').length;
    const callConnectRate  = callsAttempted ? callsAnswered/callsAttempted : 0;
    const wealthEstimate   = parseFloat(donor.wealth_estimate||0);
    const capacityScore    = Math.min(100, Math.round((wealthEstimate/10000)*0.3 + (largestGift/500)*0.4 + (totalGiving/2000)*0.3));

    // ── Archetype detection ──────────────────────────────────────────────────
    const archetype = detectArchetype(donor, giftHistory, outreachLog, signalLog);

    // ── Motivation matrix ────────────────────────────────────────────────────
    const motivationMatrix = scoreMotivations(donor, giftHistory, outreachLog, signalLog);

    // ── Communication DNA ────────────────────────────────────────────────────
    const commDNA = buildCommDNA(donor, outreachLog, openRate);

    // ── Relationship health ──────────────────────────────────────────────────
    const relationshipHealth = scoreRelationshipHealth({
      daysSinceLast, consecutiveYears, openRate, callConnectRate,
      hasPersonalNotes: outreachLog.some(o=>o.type==='note'),
      recentGifts: giftHistory.filter(g=>daysSinceLast<365).length,
    });

    // ── Planned giving readiness ─────────────────────────────────────────────
    const pgReadiness = scorePGReadiness(donor, giftHistory, archetype);

    // ── Upgrade pathway ──────────────────────────────────────────────────────
    const upgradePath = computeUpgradePath(totalGiving, avgGift, largestGift, wealthEstimate, giftCount);

    // ── Red flags ────────────────────────────────────────────────────────────
    const redFlags = detectRedFlags(donor, giftHistory, outreachLog);

    // ── AI narrative brief ───────────────────────────────────────────────────
    const aiBrief = await generateAIBrief(donor, {
      totalGiving, avgGift, largestGift, giftCount, daysSinceLast,
      consecutiveYears, archetype, motivationMatrix, pgReadiness,
      redFlags, capacityScore, openRate,
    });

    // ── Engagement calendar ──────────────────────────────────────────────────
    const engagementCalendar = buildEngagementCalendar(donor, archetype, pgReadiness, daysSinceLast);

    return {
      donorId,
      generatedAt:  new Date().toISOString(),
      // Raw metrics
      metrics: {
        totalGiving, giftCount, avgGift, largestGift,
        daysSinceLast, consecutiveYears, openRate, callConnectRate,
        wealthEstimate, capacityScore, recurringCount: recurringGifts.length,
      },
      // Intelligence layers
      archetype:         { ...ARCHETYPES[archetype], current: true },
      motivationMatrix,
      commDNA,
      relationshipHealth,
      pgReadiness,
      upgradePath,
      redFlags,
      engagementCalendar,
      // AI narrative (expensive — cached 24h)
      aiBrief,
    };
  } catch(e) {
    logger.error('buildDonorProfile failed', { donorId, err: e.message });
    throw e;
  }
}

function computeConsecutiveYears(years) {
  if (!years.length) return 0;
  const sorted = [...years].sort((a,b)=>b-a);
  let streak = 1;
  for (let i=1; i<sorted.length; i++) {
    if (sorted[i-1]-sorted[i]===1) streak++;
    else break;
  }
  return streak;
}

function detectArchetype(donor, gifts, outreach, signals) {
  const scores = {};
  for (const key of Object.keys(ARCHETYPES)) scores[key] = 0;

  // Designation analysis
  for (const g of gifts) {
    const fund = (g.fund||'').toLowerCase();
    if (/endow|name|legacy|permanent/.test(fund))      scores.LEGACY_BUILDER   += 3;
    if (/annual|unrestrict/.test(fund))                scores.LOYAL_ALUMNI     += 2;
    if (/scholar|student|program/.test(fund))          scores.MISSION_ZEALOT   += 2;
    if (/recurring|monthly|auto/.test(g.payment_method||'')) scores.PRAGMATIC_PARTNER += 2;
  }

  // Wealth signals
  const wealth = parseFloat(donor.wealth_estimate||0);
  if (wealth > 1000000)  { scores.LEGACY_BUILDER += 3; scores.IMPACT_INVESTOR += 2; }
  if (wealth > 5000000)  { scores.LEGACY_BUILDER += 3; }

  // Age signals
  const age = donor.age || (donor.class_year ? new Date().getFullYear()-parseInt(donor.class_year)+22 : 0);
  if (age > 60)  { scores.LEGACY_BUILDER += 2; scores.LOYAL_ALUMNI += 1; }
  if (age > 70)  { scores.LEGACY_BUILDER += 3; scores.FAITH_DRIVEN += 1; }
  if (age < 45)  { scores.IMPACT_INVESTOR += 2; scores.PRAGMATIC_PARTNER += 2; }

  // Signal analysis
  for (const s of signals) {
    const st = (s.signal_type||'').toLowerCase();
    if (/bequest|estate|will|planned/.test(st))    scores.LEGACY_BUILDER  += 5;
    if (/board|leadership|gala/.test(st))          scores.SOCIAL_CONNECTOR += 3;
    if (/match|challenge|peer/.test(st))           scores.COMMUNITY_CHAMPION += 2;
    if (/research|outcome|report/.test(st))        scores.IMPACT_INVESTOR  += 2;
  }

  // Communication patterns
  const positiveOutreach = outreach.filter(o=>o.sentiment==='positive'||o.status==='replied');
  for (const o of positiveOutreach) {
    const content = (o.content||'').toLowerCase();
    if (/legacy|endow|permanent/.test(content))   scores.LEGACY_BUILDER  += 2;
    if (/student|impact|change/.test(content))    scores.MISSION_ZEALOT  += 2;
    if (/together|community|join/.test(content))  scores.COMMUNITY_CHAMPION += 2;
  }

  // Pick highest
  return Object.entries(scores).sort((a,b)=>b[1]-a[1])[0][0];
}

function scoreMotivations(donor, gifts, outreach, signals) {
  const matrix = {};
  for (const dim of MOTIVATION_DIMENSIONS) {
    matrix[dim] = { score: 0, evidence: [] };
  }

  // Recognition
  if (gifts.some(g=>/named|naming|honor|memorial/.test((g.designation||'').toLowerCase()))) {
    matrix.recognition.score += 40;
    matrix.recognition.evidence.push('Has made named/memorial gifts');
  }
  if (signals.some(s=>/plaque|recognition|honor/.test((s.signal_type||'').toLowerCase()))) {
    matrix.recognition.score += 20;
    matrix.recognition.evidence.push('Recognition signal in record');
  }

  // Impact proof
  if (signals.some(s=>/outcome|metric|report|roi/.test((s.signal_type||'').toLowerCase()))) {
    matrix.impact_proof.score += 40;
    matrix.impact_proof.evidence.push('Has requested impact reports');
  }
  if (gifts.some(g=>g.has_reporting_requirement)) {
    matrix.impact_proof.score += 30;
    matrix.impact_proof.evidence.push('Gifts with reporting requirements');
  }

  // Personal connection
  if (outreach.some(o=>o.type==='call'&&o.outcome==='connected')) {
    matrix.personal_connection.score += 30;
    matrix.personal_connection.evidence.push('Has spoken with gift officers');
  }
  if (outreach.some(o=>o.type==='visit'||o.type==='meeting')) {
    matrix.personal_connection.score += 50;
    matrix.personal_connection.evidence.push('In-person meetings on record');
  }

  // Nostalgia
  if (donor.class_year) {
    matrix.nostalgia.score += 30;
    matrix.nostalgia.evidence.push(`Class of ${donor.class_year} alumnus`);
  }
  if (outreach.some(o=>/reunion|homecoming|class/.test((o.content||'').toLowerCase()))) {
    matrix.nostalgia.score += 20;
    matrix.nostalgia.evidence.push('Engaged with reunion/class content');
  }

  // Legacy
  const age = donor.age||(donor.class_year ? new Date().getFullYear()-parseInt(donor.class_year)+22:0);
  if (age > 65) { matrix.legacy.score += 40; matrix.legacy.evidence.push(`Age ${age} — estate planning prime`); }
  if (signals.some(s=>/bequest|estate|will|planned/.test((s.signal_type||'').toLowerCase()))) {
    matrix.legacy.score += 60;
    matrix.legacy.evidence.push('Planned giving signal detected');
  }

  // Tax efficiency
  if (signals.some(s=>/qcd|ira|charitable|crt|cga|trust/.test((s.signal_type||'').toLowerCase()))) {
    matrix.tax_efficiency.score += 60;
    matrix.tax_efficiency.evidence.push('Tax-advantaged giving vehicle signal');
  }
  if (donor.wealth_estimate > 2000000) {
    matrix.tax_efficiency.score += 20;
    matrix.tax_efficiency.evidence.push('High-net-worth — tax planning relevant');
  }

  // Peer influence
  if (signals.some(s=>/challenge|match|peer|class/.test((s.signal_type||'').toLowerCase()))) {
    matrix.peer_influence.score += 40;
    matrix.peer_influence.evidence.push('Responds to class/peer campaigns');
  }

  // Cause passion
  const designations = gifts.map(g=>(g.fund||'').toLowerCase());
  const topDesig = [...new Set(designations)].slice(0,3);
  if (topDesig.length===1) {
    matrix.cause_passion.score += 50;
    matrix.cause_passion.evidence.push(`Exclusively gives to: ${topDesig[0]}`);
  }

  // Duty/gratitude
  if (donor.class_year && gifts.length > 5) {
    matrix.duty_gratitude.score += 30;
    matrix.duty_gratitude.evidence.push('Consistent alumni giving — gratitude pattern');
  }

  // Matching
  if (gifts.some(g=>g.matching_gift_id)) {
    matrix.matching_leverage.score += 50;
    matrix.matching_leverage.evidence.push('Has activated employer matching');
  }

  // Normalize 0–100
  for (const dim of MOTIVATION_DIMENSIONS) {
    matrix[dim].score = Math.min(100, matrix[dim].score);
  }

  return matrix;
}

function buildCommDNA(donor, outreach, openRate) {
  const emailOutreach = outreach.filter(o=>o.type==='email');
  const avgEmailLen   = emailOutreach.length
    ? emailOutreach.reduce((s,o)=>s+(o.content||'').length,0)/emailOutreach.length : 500;

  const style = avgEmailLen > 800 ? 'formal_long'
    : openRate > 0.5             ? 'warm_personal'
    : (donor.job_title||'').toLowerCase().match(/cfo|vp|director|exec/)
                                 ? 'data_brief'
    : donor.class_year           ? 'loyal_alumni'
    :                              'narrative_story';

  const preferredChannel = outreach.some(o=>o.type==='call'&&o.outcome==='connected') ? 'phone'
    : openRate > 0.4             ? 'email'
    : outreach.some(o=>o.type==='sms'&&o.status==='replied') ? 'sms'
    :                              'email';

  const optimalCadence = openRate > 0.6 ? 'monthly'
    : openRate > 0.3              ? 'quarterly'
    :                               'bi-annual';

  return {
    style:            COMM_STYLES[style] || COMM_STYLES.warm_personal,
    preferredChannel,
    optimalCadence,
    bestDayOfWeek:    'Tuesday',
    bestTimeOfDay:    '9:00 AM – 11:00 AM',
    salutation:       donor.preferred_name ? `Dear ${donor.preferred_name}` : `Dear ${donor.first_name}`,
    signaturePrefers: 'From a named officer, not generic institution',
    avoidsTimes:      ['Monday morning', 'Friday afternoon', 'Major holidays'],
  };
}

function scoreRelationshipHealth({ daysSinceLast, consecutiveYears, openRate, callConnectRate, hasPersonalNotes, recentGifts }) {
  let score = 0;
  const signals = [];

  // Recency
  if (daysSinceLast < 90)  { score += 25; signals.push({ type:'positive', text:'Recent gift within 90 days' }); }
  else if (daysSinceLast < 365) { score += 15; }
  else if (daysSinceLast > 730) { score -= 15; signals.push({ type:'risk', text:'No gift in 2+ years' }); }

  // Retention
  if (consecutiveYears >= 5) { score += 25; signals.push({ type:'positive', text:`${consecutiveYears}-year consecutive donor` }); }
  else if (consecutiveYears >= 2) score += 10;
  else if (consecutiveYears === 0) { score -= 20; signals.push({ type:'risk', text:'No consecutive year pattern' }); }

  // Engagement
  if (openRate > 0.5) { score += 20; signals.push({ type:'positive', text:'High email engagement (>50% open rate)' }); }
  else if (openRate < 0.1) { score -= 10; signals.push({ type:'risk', text:'Very low email engagement' }); }

  // Personal touch
  if (hasPersonalNotes) { score += 15; signals.push({ type:'positive', text:'Personal interaction notes on file' }); }

  // Call connectivity
  if (callConnectRate > 0.5) { score += 15; signals.push({ type:'positive', text:'Answers calls from development office' }); }

  const normalized = Math.max(0, Math.min(100, 50 + score));
  const tier = normalized >= 80 ? 'ENGAGED' : normalized >= 60 ? 'STABLE' : normalized >= 40 ? 'AT_RISK' : 'LAPSED';

  return { score: normalized, tier, signals };
}

function scorePGReadiness(donor, gifts, archetypeKey) {
  const archetype = ARCHETYPES[archetypeKey];
  let score = Math.round((archetype?.pgReady || 0.4) * 50);

  const age = donor.age||(donor.class_year ? new Date().getFullYear()-parseInt(donor.class_year)+22:0);
  const totalGiving = gifts.reduce((s,g)=>s+parseFloat(g.amount||0),0);
  const wealth = parseFloat(donor.wealth_estimate||0);

  if (age > 70)           score += 20;
  else if (age > 60)      score += 10;
  if (wealth > 5000000)   score += 15;
  else if (wealth > 1000000) score += 8;
  if (totalGiving > 50000) score += 10;
  if (gifts.length > 10)  score += 5;

  score = Math.min(100, score);

  const vehicles = suggestPGVehicles(age, wealth, totalGiving, archetypeKey);

  return {
    score,
    tier: score >= 75 ? 'HIGH' : score >= 50 ? 'MEDIUM' : 'LOW',
    age,
    suggestedVehicles: vehicles,
    conversationOpener: getPGOpener(score, age, archetypeKey),
  };
}

function suggestPGVehicles(age, wealth, totalGiving, archetype) {
  const vehicles = [];
  if (age >= 70 && wealth > 0) vehicles.push({ type:'QCD', label:'Qualified Charitable Distribution (IRA)', reason:'Age 70½+ — tax-free IRA transfer up to $105,000/year' });
  if (wealth > 500000) vehicles.push({ type:'CGA', label:'Charitable Gift Annuity', reason:'Income stream for donor, remainder to institution' });
  if (wealth > 1000000) vehicles.push({ type:'CRT', label:'Charitable Remainder Trust', reason:'Income + estate planning + major gift' });
  if (wealth > 2000000) vehicles.push({ type:'CLT', label:'Charitable Lead Trust', reason:'Estate tax mitigation with institutional benefit' });
  if (age > 55) vehicles.push({ type:'BEQUEST', label:'Bequest / Revocable Trust', reason:'Simplest PG vehicle — lowest ask threshold, high acceptance rate' });
  if (totalGiving > 10000) vehicles.push({ type:'ENDOWMENT', label:'Named Endowment', reason:'Permanent recognition — strongest retention mechanism' });
  vehicles.push({ type:'BENEFICIARY', label:'Beneficiary Designation', reason:'IRA, life insurance, bank account TOD — simplest conversation starter' });
  return vehicles;
}

function getPGOpener(score, age, archetype) {
  if (score >= 75) return `Given your extraordinary history of support, I'd love to share how other donors at your stage are ensuring their values live on permanently at the institution — when is a good time for a brief conversation?`;
  if (score >= 50) return `Many of our most committed donors are exploring ways to make their giving more tax-efficient while creating a lasting impact. I'd love to share some options that might make sense for you.`;
  return `As you think about your philanthropic priorities, I wanted to make sure you're aware of some giving vehicles that can make your dollars go further — would you be open to a conversation?`;
}

function computeUpgradePath(total, avg, largest, wealth, giftCount) {
  const nextAskMultiplier = avg > 5000 ? 2.0 : avg > 1000 ? 2.5 : 3.0;
  const nextAsk = Math.round((avg * nextAskMultiplier) / 50) * 50;
  const majorGiftThreshold = wealth > 1000000 ? Math.round(wealth * 0.005 / 1000) * 1000 : 25000;
  const upgradeReadiness = giftCount > 5 && avg > 500 ? 'HIGH' : giftCount > 2 ? 'MEDIUM' : 'LOW';

  return {
    currentAverage:     avg,
    suggestedNextAsk:   nextAsk,
    majorGiftTarget:    majorGiftThreshold,
    upgradeReadiness,
    timeToMajorGift:    upgradeReadiness==='HIGH' ? '6–12 months' : '12–24 months',
    framingStrategy:    avg > 1000
      ? 'Lead with impact data, then name a specific restricted opportunity'
      : 'Deepen relationship first — move to cultivation phase before upgrade ask',
  };
}

function detectRedFlags(donor, gifts, outreach) {
  const flags = [];
  const daysSince = gifts.length && gifts[0]?.date
    ? Math.floor((Date.now()-new Date(gifts[0].date))/(1000*60*60*24)) : 9999;

  if (daysSince > 730)         flags.push({ severity:'HIGH',   text:'No gift in 2+ years — lapsed risk', action:'Assign to VSO lapsed recovery track' });
  if (daysSince > 365)         flags.push({ severity:'MEDIUM', text:'No gift in 12+ months', action:'Reactivation outreach recommended' });

  const unsubscribed = outreach.some(o=>o.type==='email'&&o.status==='unsubscribed');
  if (unsubscribed)            flags.push({ severity:'HIGH',   text:'Email unsubscribe on record', action:'Phone outreach only — suppress all email' });

  const optedOut = donor.sms_opt_out;
  if (optedOut)                flags.push({ severity:'MEDIUM', text:'SMS opt-out on record', action:'Suppress SMS outreach' });

  const dnc = donor.do_not_contact;
  if (dnc)                     flags.push({ severity:'CRITICAL',text:'Do Not Contact flag active', action:'Zero outreach — compliance requirement' });

  const declining = gifts.length >= 3 && gifts[0]?.amount < gifts[2]?.amount;
  if (declining)               flags.push({ severity:'MEDIUM', text:'Gift amount declining over last 3 gifts', action:'Stewardship check-in — no ask' });

  const noResponse = outreach.filter(o=>o.type==='call'&&o.outcome==='no_answer').length >= 4;
  if (noResponse)              flags.push({ severity:'MEDIUM', text:'4+ consecutive unanswered calls', action:'Try email or handwritten note instead' });

  return flags;
}

function buildEngagementCalendar(donor, archetypeKey, pgReadiness, daysSinceLast) {
  const today = new Date();
  const touches = [];

  // Touch 1: immediate if needed
  if (daysSinceLast > 180) {
    touches.push({ daysOut:3, type:'email', purpose:'re_engagement', label:'Re-engagement: check-in email', priority:'HIGH' });
  }

  // Stewardship touches (always)
  touches.push({ daysOut:30,  type:'email',       purpose:'stewardship',   label:'Impact update / stewardship report', priority:'MEDIUM' });
  touches.push({ daysOut:60,  type:'note',         purpose:'personal',      label:'Handwritten personal note', priority:'MEDIUM' });
  touches.push({ daysOut:90,  type:'call',         purpose:'cultivation',   label:'Cultivation call — no ask', priority:'MEDIUM' });
  touches.push({ daysOut:180, type:'email',        purpose:'ask',           label:'Soft ask — annual renewal', priority:'HIGH' });

  // PG-specific
  if (pgReadiness.score >= 50) {
    touches.push({ daysOut:45, type:'email', purpose:'pg_intro',   label:'PG conversation opener — no ask, just information', priority:'HIGH' });
    touches.push({ daysOut:75, type:'call',  purpose:'pg_meeting', label:'Request planned giving conversation', priority:'HIGH' });
  }

  // Birthday/anniversary
  if (donor.birth_date) {
    touches.push({ daysOut:Math.ceil((new Date(donor.birth_date)-today)/(1000*60*60*24)+365)%365||365, type:'note', purpose:'personal', label:'Birthday card (handwritten)', priority:'LOW' });
  }

  return touches.sort((a,b)=>a.daysOut-b.daysOut).map(t=>({
    ...t,
    scheduledDate: new Date(today.getTime()+t.daysOut*86400000).toISOString().split('T')[0],
  }));
}

async function generateAIBrief(donor, metrics) {
  const systemPrompt = `You are the most experienced gift officer at a top research university. You have 30 years of frontline fundraising experience and have closed thousands of gifts ranging from $500 to $50 million. You write gift officer briefing documents that are brilliant, specific, and actionable. Never generic. Never fluffy. Be the sharpest officer in the room.`;

  const userMsg = `Write a gift officer briefing document for this donor. Be specific, incisive, and strategic. Include: 
1. One-paragraph executive summary (what matters most about this donor RIGHT NOW)
2. The single most important thing to know before any contact
3. Three specific conversation talking points (not generic — tied to THIS donor's data)
4. The recommended next move (exact action, exact timing, exact framing)
5. One thing to absolutely avoid saying or doing

DONOR DATA:
Name: ${donor.first_name} ${donor.last_name}
Class year: ${donor.class_year || 'N/A'}
Total giving: $${metrics.totalGiving.toLocaleString()}
Largest gift: $${metrics.largestGift.toLocaleString()}
Average gift: $${metrics.avgGift.toFixed(0)}
Gift count: ${metrics.giftCount}
Days since last gift: ${metrics.daysSinceLast}
Consecutive giving years: ${metrics.consecutiveYears}
Email open rate: ${(metrics.openRate*100).toFixed(0)}%
Archetype: ${metrics.archetype}
PG Readiness score: ${metrics.pgReadiness.score}/100
Capacity estimate: ${metrics.capacityScore}/100
Red flags: ${metrics.redFlags.length > 0 ? metrics.redFlags.map(f=>f.text).join('; ') : 'None'}

Write 350 words max. No headers with #. Use short bold labels like "SUMMARY:", "WATCH OUT:", etc.`;

  try {
    return await callClaude(systemPrompt, userMsg, 600);
  } catch(e) {
    logger.warn('AI brief generation failed', { err: e.message });
    return null;
  }
}

// ─── Stewardship prescription builder ────────────────────────────────────────
async function buildStewardshipPlan(donorId, orgId) {
  const profile = await buildDonorProfile(donorId, orgId);
  const { archetype, motivationMatrix, pgReadiness, upgradePath, commDNA } = profile;

  const topMotivations = Object.entries(motivationMatrix)
    .sort((a,b)=>b[1].score-a[1].score)
    .slice(0,3)
    .map(([dim,data])=>({ dimension: dim, score: data.score, evidence: data.evidence }));

  const plan = {
    donorId,
    archetype: archetype.label,
    stewardshipTier: profile.metrics.totalGiving > 50000 ? 'MAJOR'
      : profile.metrics.totalGiving > 10000 ? 'MID_LEVEL'
      : profile.metrics.totalGiving > 1000  ? 'ANNUAL'
      : 'PROSPECT',
    touchFrequency:  commDNA.optimalCadence,
    primaryChannel:  commDNA.preferredChannel,
    topMotivations,
    contentStrategy: buildContentStrategy(archetype.id, topMotivations),
    recognitionPath: buildRecognitionPath(profile.metrics.totalGiving, pgReadiness.score),
    upgradeStrategy: upgradePath,
    pgStrategy:      pgReadiness.score >= 40 ? pgReadiness : null,
    annualTouchPlan: profile.engagementCalendar,
    aiNarrative:     await generateStewardshipNarrative(profile),
  };

  return plan;
}

function buildContentStrategy(archetypeId, topMotivations) {
  const strategies = {
    LEGACY_BUILDER:     ['Named endowment updates', 'Architectural/permanent impact visuals', 'Multi-generational stories', 'Endowment performance reports'],
    COMMUNITY_CHAMPION: ['Class notes and alumni updates', 'Peer giving milestones', 'Reunion and event invitations', 'Community impact stories'],
    IMPACT_INVESTOR:    ['Outcome metrics dashboards', 'Annual impact report', 'Program-specific ROI data', 'Research and publication highlights'],
    LOYAL_ALUMNI:       ['Student success stories tied to their era', 'Campus tradition updates', 'Nostalgia-forward content', 'Class challenge framing'],
    MISSION_ZEALOT:     ['Deep dives on their cause area', 'Faculty spotlights in their interest area', 'Specific program milestones', 'Direct student voices'],
    SOCIAL_CONNECTOR:   ['Leadership society invitations', 'Exclusive campus access events', 'Peer leadership recognition', 'Board opportunity introduction'],
    PRAGMATIC_PARTNER:  ['Digital impact updates', 'Recurring gift impact summary', 'Low-friction upgrade paths', 'Matching gift activation prompts'],
    FAITH_DRIVEN:       ['Values-aligned mission content', 'Stewardship language', 'Community service impact', 'Gratitude-forward messaging'],
  };
  return strategies[archetypeId] || strategies.LOYAL_ALUMNI;
}

function buildRecognitionPath(totalGiving, pgScore) {
  const path = [];
  if (totalGiving >= 1000)   path.push({ level: 'Annual Fund Circle',    threshold: 1000,    perks: ['Name in annual report', 'Stewardship letter', 'Impact update'] });
  if (totalGiving >= 10000)  path.push({ level: 'Heritage Society',       threshold: 10000,   perks: ['Personalized stewardship', 'Campus event invitations', 'Dedicated liaison'] });
  if (totalGiving >= 50000)  path.push({ level: 'Benefactor Circle',      threshold: 50000,   perks: ['Named opportunity', 'President engagement', 'Annual stewardship meeting'] });
  if (totalGiving >= 250000) path.push({ level: 'Founders Society',       threshold: 250000,  perks: ['Named space or fund', 'Board nomination consideration', 'Naming ceremony'] });
  if (pgScore >= 50)         path.push({ level: 'Legacy Society',         threshold: 0,       perks: ['Bequest recognition', 'Legacy events', 'Heritage plaque', 'Life membership'] });
  return path;
}

async function generateStewardshipNarrative(profile) {
  const sys = `You are a brilliant major gifts officer writing a stewardship strategy memo. You think like the best fundraiser in the country. Be specific, strategic, and show you know this donor.`;
  const msg = `Write a 200-word stewardship strategy narrative for this donor. What is the ONE stewardship move that will deepen this relationship most? Be specific.

Archetype: ${profile.archetype.label}
Relationship health: ${profile.relationshipHealth.score}/100 (${profile.relationshipHealth.tier})
Top motivation: ${Object.entries(profile.motivationMatrix).sort((a,b)=>b[1].score-a[1].score)[0]?.[0]}
Total giving: $${profile.metrics.totalGiving.toLocaleString()}
PG readiness: ${profile.pgReadiness.tier}`;

  try {
    return await callClaude(sys, msg, 350);
  } catch(e) {
    return null;
  }
}

module.exports = {
  buildDonorProfile,
  buildStewardshipPlan,
  ARCHETYPES,
  MOTIVATION_DIMENSIONS,
  COMM_STYLES,
};
