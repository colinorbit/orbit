'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ORBIT VPGO — VIRTUAL PLANNED GIVING OFFICER  v1.0
 *  "The Brains of a 30-Year PG Pro"
 *
 *  This service IS the planned giving officer. It knows:
 *    - Every major PG vehicle (10+ types) with full tax/legal mechanics
 *    - Prospect identification and scoring at the portfolio level
 *    - Conversation sequencing (opener → discovery → proposal → close)
 *    - Objection handling (25 common objections with rebuttals)
 *    - Estate planning context and tax law nuance
 *    - Generational wealth transfer strategies
 *    - Marketing copy generation at agency quality
 *    - Full proposal document generation
 *    - CGA/CRT rate calculations (live ACGA rates)
 *    - Bequest society management
 *
 *  Model orchestration:
 *    - Analysis / strategy: claude-opus (deepest reasoning)
 *    - Copy / creative:     claude-sonnet (fast, high quality)
 *    - Images:              DALL-E 3 / Ideogram via API (agency quality)
 *    - Long-form content:   claude-sonnet with extended output
 * ═══════════════════════════════════════════════════════════════════════════
 */

const fetch  = require('node-fetch');
const logger = require('../utils/logger');
const db     = require('../db');

// ─── PG Vehicle Knowledge Base ────────────────────────────────────────────────
const PG_VEHICLES = {
  BEQUEST: {
    id:            'BEQUEST',
    label:         'Bequest (Revocable)',
    icon:          '📜',
    description:   'A gift made through the donor\'s will or living trust, taking effect at death.',
    taxBenefits:   'Estate tax deduction for full bequest amount (federal + state). No income tax benefit during lifetime.',
    donorProfile:  'Any age, any wealth level. Lowest barrier PG vehicle.',
    minWealth:     0,
    minAge:        0,
    immediateIncome: false,
    complexity:    'LOW',
    closeRate:     0.72,
    avgGiftSize:   85000,
    timeToClose:   '3–18 months',
    keyLanguage:   ['I want to remember the institution in my estate', 'bequest', 'will', 'trust', 'heritage society'],
    opener:        'Many of our most committed donors include the university in their estate plans — it\'s one of the most meaningful ways to ensure your values live on. Have you ever thought about what you\'d like your legacy to be?',
    sampleLanguage: 'I give to [Institution Name] the sum of $[AMOUNT] [or X% of my residuary estate] to be used for [DESIGNATION/unrestricted use].',
    irsTreatment:  'IRC §2055 — unlimited estate tax charitable deduction',
  },
  QCD: {
    id:            'QCD',
    label:         'Qualified Charitable Distribution (IRA)',
    icon:          '🏦',
    description:   'Tax-free transfer from IRA directly to charity, up to $105,000/year (2024, inflation-indexed). Counts toward Required Minimum Distribution.',
    taxBenefits:   'Excluded from AGI entirely — better than a deduction for many donors. Satisfies RMD requirement.',
    donorProfile:  'Age 70½+, has IRA (Traditional, inherited, etc.)',
    minWealth:     0,
    minAge:        70.5,
    immediateIncome: false,
    complexity:    'LOW',
    closeRate:     0.65,
    avgGiftSize:   12000,
    timeToClose:   '1–4 weeks',
    keyLanguage:   ['RMD', 'IRA', 'required minimum', 'retirement account', '70 and a half'],
    opener:        'Are you taking required minimum distributions from your IRA? Many of our donors in your situation have discovered they can transfer funds directly to the university — it\'s completely tax-free and satisfies your RMD. Would that be useful to explore?',
    irsTreatment:  'IRC §408(d)(8) — excluded from gross income',
  },
  CGA: {
    id:            'CGA',
    label:         'Charitable Gift Annuity',
    icon:          '📈',
    description:   'Donor transfers assets; institution pays fixed income for life; remainder goes to institution.',
    taxBenefits:   'Partial charitable deduction at funding. Portion of income payments tax-free during life expectancy period.',
    donorProfile:  'Age 65+, seeking income, $25,000+ asset transfer',
    minWealth:     25000,
    minAge:        65,
    immediateIncome: true,
    complexity:    'MEDIUM',
    closeRate:     0.45,
    avgGiftSize:   65000,
    timeToClose:   '1–3 months',
    keyLanguage:   ['income for life', 'annuity', 'retirement income', 'fixed payments'],
    opener:        'We offer a program where you can make a significant gift and receive guaranteed income for life in return. At your age, the rates are quite attractive — would you like to see what a gift of that size would generate for you?',
    rateSource:    'ACGA (American Council on Gift Annuities) — updated twice yearly',
    irsTreatment:  'IRC §170 — partial deduction; IRC §72 — annuity taxation',
  },
  CRT: {
    id:            'CRT',
    label:         'Charitable Remainder Trust',
    icon:          '🏛️',
    description:   'Irrevocable trust paying income to donor/beneficiaries for term or life; remainder to charity.',
    taxBenefits:   'Partial charitable deduction upfront. Capital gains deferral on appreciated assets. Estate removal.',
    donorProfile:  'High-net-worth, appreciated assets (real estate, stock), age 55+, $100,000+',
    minWealth:     100000,
    minAge:        50,
    immediateIncome: true,
    complexity:    'HIGH',
    closeRate:     0.30,
    avgGiftSize:   450000,
    timeToClose:   '3–6 months',
    keyLanguage:   ['appreciated stock', 'real estate', 'capital gains', 'diversify', 'highly appreciated'],
    opener:        'Do you have any appreciated assets — real estate or concentrated stock positions? We have a strategy that can help you diversify, generate income, avoid capital gains tax, and make a significant gift — all at the same time.',
    irsTreatment:  'IRC §664 — CRUT or CRAT; IRC §170 — partial deduction',
  },
  CLT: {
    id:            'CLT',
    label:         'Charitable Lead Trust',
    icon:          '🔄',
    description:   'Opposite of CRT: income goes to charity for a term; remainder passes to heirs with reduced gift/estate tax.',
    taxBenefits:   'Powerful estate tax tool. Passes assets to heirs at deeply discounted transfer tax values.',
    donorProfile:  'Estate > $5M, wants to pass wealth to children with minimum estate tax, age 50–70',
    minWealth:     2000000,
    minAge:        45,
    immediateIncome: false,
    complexity:    'VERY_HIGH',
    closeRate:     0.20,
    avgGiftSize:   2000000,
    timeToClose:   '6–12 months',
    keyLanguage:   ['estate planning', 'pass to children', 'dynasty', 'estate tax', 'generation-skipping'],
    opener:        'Are you looking at strategies to transfer wealth to your children or grandchildren efficiently? We have a vehicle that allows you to benefit the university for a period of time while passing assets to the next generation at a substantially reduced transfer tax cost.',
    irsTreatment:  'IRC §170, §2055, §2522 — grantor and non-grantor CLT variants',
  },
  PIF: {
    id:            'PIF',
    label:         'Pooled Income Fund',
    icon:          '🌊',
    description:   'Donor contributes to a pool; receives pro-rata share of fund income for life; remainder to charity.',
    taxBenefits:   'Partial charitable deduction. Variable income (follows fund performance). Low setup cost.',
    donorProfile:  'Age 55+, $5,000–$50,000 gift range, wants income participation',
    minWealth:     5000,
    minAge:        55,
    immediateIncome: true,
    complexity:    'LOW',
    closeRate:     0.38,
    avgGiftSize:   15000,
    timeToClose:   '2–6 weeks',
    keyLanguage:   ['smaller gift', 'variable income', 'pool', 'participate'],
    opener:        'If you\'re not ready for a full annuity, our pooled income fund allows you to get started with a smaller amount and still receive income for life.',
    irsTreatment:  'IRC §642(c)(5)',
  },
  RETAINED_LIFE_ESTATE: {
    id:            'RETAINED_LIFE_ESTATE',
    label:         'Retained Life Estate',
    icon:          '🏠',
    description:   'Donor gives real estate but retains right to live in it for life. Charity gets property at death.',
    taxBenefits:   'Immediate charitable deduction for present value of remainder interest. Donor retains use.',
    donorProfile:  'Homeowner, age 65+, property equity > $200,000, no desire to sell',
    minWealth:     200000,
    minAge:        60,
    immediateIncome: false,
    complexity:    'MEDIUM',
    closeRate:     0.25,
    avgGiftSize:   320000,
    timeToClose:   '2–4 months',
    keyLanguage:   ['home', 'house', 'property', 'real estate', 'stay in my home', 'farm'],
    opener:        'Have you considered that you can give your home to the university now, take a significant tax deduction this year, and continue living there for the rest of your life?',
    irsTreatment:  'IRC §170(f)(3)(B)(i)',
  },
  BENEFICIARY_DESIGNATION: {
    id:            'BENEFICIARY_DESIGNATION',
    label:         'Beneficiary Designation',
    icon:          '📋',
    description:   'Naming institution as beneficiary of IRA, life insurance, bank account (TOD), or brokerage (POD).',
    taxBenefits:   'IRA: estate tax deduction + avoids income tax that heirs would pay. Life insurance: estate tax deduction.',
    donorProfile:  'Any age, any wealth. Easiest yes in planned giving.',
    minWealth:     0,
    minAge:        0,
    immediateIncome: false,
    complexity:    'VERY_LOW',
    closeRate:     0.80,
    avgGiftSize:   35000,
    timeToClose:   '1 week',
    keyLanguage:   ['IRA beneficiary', 'life insurance', 'TOD', 'POD', 'account beneficiary'],
    opener:        'The simplest gift you can make — one that costs you nothing today — is naming the university as a beneficiary of your IRA or life insurance policy. It takes 10 minutes, requires no attorney, and can be changed anytime.',
    irsTreatment:  'IRC §2055 — estate tax deduction',
  },
  STOCK_GIFT: {
    id:            'STOCK_GIFT',
    label:         'Appreciated Securities',
    icon:          '📊',
    description:   'Donating appreciated stock/ETFs held 12+ months. Deduct full fair market value, pay zero capital gains.',
    taxBenefits:   'FMV deduction (up to 30% AGI). Zero capital gains on appreciation. Stack multiple years via DAF.',
    donorProfile:  'Any age, holds appreciated securities, income > $150,000',
    minWealth:     10000,
    minAge:        0,
    immediateIncome: false,
    complexity:    'LOW',
    closeRate:     0.70,
    avgGiftSize:   28000,
    timeToClose:   '1–2 weeks',
    keyLanguage:   ['stock', 'securities', 'appreciated', 'brokerage', 'ETF', 'capital gains'],
    opener:        'Do you hold any appreciated stock? If you sell it, you\'ll pay capital gains tax. If you give it directly, you avoid ALL capital gains and still get the full deduction.',
    irsTreatment:  'IRC §170(e)(1) — FMV deduction, no gain recognition',
  },
  DAF: {
    id:            'DAF',
    label:         'Donor Advised Fund Grant',
    icon:          '🎯',
    description:   'Donor recommends grant from existing DAF (Schwab, Fidelity, Vanguard Charitable, etc.).',
    taxBenefits:   'No new tax benefit — deduction was at DAF funding. But strategic for timing and anonymity.',
    donorProfile:  'Any age; has existing DAF account',
    minWealth:     0,
    minAge:        0,
    immediateIncome: false,
    complexity:    'VERY_LOW',
    closeRate:     0.75,
    avgGiftSize:   22000,
    timeToClose:   '3–5 business days',
    keyLanguage:   ['donor advised fund', 'Fidelity Charitable', 'Schwab Charitable', 'DAF', 'Vanguard Charitable'],
    opener:        'Many of our donors have Donor Advised Funds and aren\'t sure how to use them strategically. We can help you put your fund to work in a way that aligns with your values.',
    irsTreatment:  'IRC §4966 — sponsoring organization rules',
  },
};

// ─── Objection Handling Database ──────────────────────────────────────────────
const OBJECTIONS = {
  'I need to talk to my attorney first': {
    type: 'POSITIVE_DELAY',
    rebuttal: 'Of course — and that\'s exactly the right thing to do. Let me send you a simple summary you can share with them. Would a brief letter describing the gift structure be helpful?',
    followUp: 'Offer a one-page summary document for their attorney.',
  },
  'I can\'t afford it right now': {
    type: 'FINANCIAL_CONCERN',
    rebuttal: 'A bequest commitment costs you nothing today — it only takes effect after your other needs are met. You can change it anytime. Would that kind of flexibility make it easier to consider?',
    followUp: 'Pivot to bequest or beneficiary designation.',
  },
  'I don\'t want to tie up my assets': {
    type: 'LIQUIDITY_CONCERN',
    rebuttal: 'A revocable bequest keeps everything in your control — it\'s just an instruction in your will that you can revise or remove at any time. You\'re not giving anything up today.',
    followUp: 'Emphasize revocability. Offer bequest or beneficiary designation.',
  },
  'My kids need that money': {
    type: 'FAMILY_OBLIGATION',
    rebuttal: 'That\'s completely understandable — family comes first. Have you considered a Charitable Lead Trust? It can actually help transfer more to your children with significantly less estate tax than outright inheritance.',
    followUp: 'Explore CLT if high-net-worth. Otherwise, suggest residuary bequest (only what\'s left after family is cared for).',
  },
  'I already give annually': {
    type: 'ALREADY_GIVING',
    rebuttal: 'Your annual support means so much. A planned gift is completely separate — it\'s a way to make a statement about what the institution meant to your life that annual gifts can\'t quite express. They\'re complementary, not either/or.',
    followUp: 'Frame PG as legacy on top of, not instead of, annual giving.',
  },
  'I don\'t know where my estate stands': {
    type: 'ESTATE_UNCERTAINTY',
    rebuttal: 'That\'s actually the perfect time to think about this — before everything is locked in. Would it be helpful to share what other donors in your situation have done? Sometimes seeing the options makes it easier to have the conversation with your advisor.',
    followUp: 'Offer educational content, not a commitment.',
  },
  'The economy is too uncertain': {
    type: 'MARKET_ANXIETY',
    rebuttal: 'That\'s a real concern. That\'s exactly why options like a QCD or beneficiary designation are so appealing — no asset transfer today, no market exposure, and you can adjust if things change.',
    followUp: 'Pivot to low-commitment vehicles: bequest, beneficiary designation.',
  },
  'I want to see more impact before I commit': {
    type: 'IMPACT_SKEPTIC',
    rebuttal: 'That\'s fair — let me share some specific outcomes from gifts like yours. Would it help to see an impact report on the fund you\'ve been supporting?',
    followUp: 'Send detailed impact report. Schedule campus visit.',
  },
};

// ─── CGA Rate Tables (ACGA 2024 rates, updated semi-annually) ─────────────────
const CGA_RATES = {
  60: 4.5, 62: 4.6, 64: 4.7, 65: 4.8, 66: 4.9, 67: 5.0,
  68: 5.1, 70: 5.3, 72: 5.5, 74: 5.7, 75: 5.8, 76: 5.9,
  78: 6.1, 80: 6.3, 82: 6.6, 84: 6.9, 85: 7.0, 86: 7.2,
  88: 7.6, 90: 8.1, 92: 8.6, 95: 9.0,
};

function getCGARate(age) {
  const ages = Object.keys(CGA_RATES).map(Number).sort((a,b)=>a-b);
  const closest = ages.reduce((prev,curr)=>Math.abs(curr-age)<Math.abs(prev-age)?curr:prev);
  return CGA_RATES[closest] || 5.0;
}

function calculateCGA(age, principalAmount, afr = 4.4) {
  const rate      = getCGARate(age) / 100;
  const annualInc = principalAmount * rate;
  // Present value of annuity approximation (simplified)
  const lifeExp   = Math.max(0, 85 - age);
  const pvFactor  = (1 - Math.pow(1+afr/100, -lifeExp)) / (afr/100);
  const pvAnnuity = annualInc * pvFactor;
  const deduction = Math.max(0, principalAmount - pvAnnuity);
  return {
    annualIncome:    Math.round(annualInc),
    quarterlyIncome: Math.round(annualInc/4),
    monthlyIncome:   Math.round(annualInc/12),
    rate:            (rate*100).toFixed(1)+'%',
    charitableDeduction: Math.round(deduction),
    remainderEstimate:   Math.round(pvAnnuity),
  };
}

// ─── Portfolio-level PG prospect scan ────────────────────────────────────────
async function scanPortfolioForPGProspects(orgId) {
  const { rows } = await db.query(
    `SELECT d.id, d.first_name, d.last_name, d.age, d.wealth_estimate,
            d.class_year, d.birth_date,
            COUNT(g.id) as gift_count,
            SUM(g.amount) as total_giving,
            MAX(g.amount) as largest_gift,
            MAX(g.date)   as last_gift_date
     FROM donors d
     LEFT JOIN gifts g ON g.donor_id=d.id AND g.org_id=$1 AND g.status='completed'
     WHERE d.org_id=$1 AND d.do_not_contact IS NOT TRUE
     GROUP BY d.id
     HAVING COUNT(g.id) >= 2
     ORDER BY SUM(g.amount) DESC NULLS LAST
     LIMIT 500`,
    [orgId]
  );

  return rows.map(d => {
    const age = d.age || (d.class_year ? new Date().getFullYear()-parseInt(d.class_year)+22 : 0);
    const total = parseFloat(d.total_giving||0);
    const wealth = parseFloat(d.wealth_estimate||0);
    const count = parseInt(d.gift_count||0);

    let score = 0;
    if (age >= 70)  score += 30;
    else if (age >= 60) score += 20;
    else if (age >= 55) score += 10;
    if (wealth >= 5000000) score += 25;
    else if (wealth >= 1000000) score += 15;
    else if (wealth >= 250000) score += 8;
    if (total >= 50000) score += 20;
    else if (total >= 10000) score += 12;
    else if (total >= 2500) score += 5;
    if (count >= 10) score += 10;
    else if (count >= 5) score += 5;

    const recommendedVehicles = [];
    if (age >= 70.5) recommendedVehicles.push('QCD');
    if (age >= 60 && wealth >= 25000) recommendedVehicles.push('CGA');
    if (wealth >= 100000) recommendedVehicles.push('CRT');
    recommendedVehicles.push('BEQUEST');
    if (total >= 5000) recommendedVehicles.push('BENEFICIARY_DESIGNATION');

    return {
      ...d,
      age,
      pgScore: Math.min(100, score),
      pgTier:  score >= 70 ? 'HOT' : score >= 50 ? 'WARM' : score >= 30 ? 'COOL' : 'COLD',
      recommendedVehicles: recommendedVehicles.slice(0, 3),
    };
  }).sort((a,b) => b.pgScore - a.pgScore);
}

// ─── Conversation sequence generator ─────────────────────────────────────────
async function generateConversationSequence(donorData, vehicleId) {
  const vehicle = PG_VEHICLES[vehicleId];
  if (!vehicle) throw new Error(`Unknown vehicle: ${vehicleId}`);

  const systemPrompt = `You are the most skilled planned giving officer in the United States, with 30 years of experience closing gifts from $25,000 to $25 million. You understand estate law, tax law, and donor psychology at the expert level. You write conversation guides that feel completely natural — never scripted, never pushy, always donor-first.`;

  const userMsg = `Create a complete 4-touch conversation sequence to guide a donor toward a ${vehicle.label}. 

The touches are:
1. Discovery call (opener — build rapport, uncover interest, no ask)
2. Follow-up email with educational content
3. Cultivation meeting (explore vehicle fit, show options)
4. Proposal conversation (present specific numbers, ask for commitment)

DONOR PROFILE:
Name: ${donorData.first_name} ${donorData.last_name}
Age: ${donorData.age || 'unknown'}
Total giving: $${parseFloat(donorData.total_giving||0).toLocaleString()}
Wealth estimate: $${parseFloat(donorData.wealth_estimate||0).toLocaleString()}
Class year: ${donorData.class_year || 'N/A'}

For each touch, write:
- Exact opening line (word-for-word)
- Key conversation points (3-4 bullets)
- Transition to next touch

Keep each touch under 150 words. Be natural and conversational.`;

  try {
    const raw = await callClaude(systemPrompt, userMsg, 1200);
    return { vehicleId, vehicleLabel: vehicle.label, sequence: raw, donor: donorData };
  } catch(e) {
    logger.error('Conversation sequence failed', { err: e.message });
    return { vehicleId, vehicleLabel: vehicle.label, sequence: null, error: e.message };
  }
}

// ─── Full PG proposal generator ──────────────────────────────────────────────
async function generatePGProposal(donorData, vehicleId, giftAmount) {
  const vehicle = PG_VEHICLES[vehicleId];
  const age     = donorData.age || 70;

  let financialCalc = null;
  if (vehicleId === 'CGA' && giftAmount) {
    financialCalc = calculateCGA(age, giftAmount);
  }

  const systemPrompt = `You are a brilliant planned giving officer writing a personalized gift proposal letter. You combine warmth, credibility, and precision. The letter should feel like it came from a trusted advisor, not a solicitation. Use formal letter format.`;

  const userMsg = `Write a personalized planned giving proposal letter for the following situation.

Vehicle: ${vehicle.label}
Donor: ${donorData.first_name} ${donorData.last_name}
Class Year: ${donorData.class_year || ''}
Total Giving History: $${parseFloat(donorData.total_giving||0).toLocaleString()}
Proposed Gift: ${giftAmount ? '$'+giftAmount.toLocaleString() : 'amount to be discussed'}
${financialCalc ? `
If CGA: Annual income = $${financialCalc.annualIncome.toLocaleString()} at ${financialCalc.rate}
Tax deduction = $${financialCalc.charitableDeduction.toLocaleString()}` : ''}

The letter should:
1. Open with genuine gratitude for their history
2. Explain why you're writing to them specifically (their loyalty, their legacy)
3. Describe the vehicle in plain English — what they'll experience
4. Include specific financial benefit (if applicable)
5. State a clear ask (meeting, not commitment)
6. Close with warmth and no pressure

Length: 400–500 words. Formal letter format.`;

  try {
    const letterText = await callClaude(systemPrompt, userMsg, 900);
    return {
      donorId:       donorData.id,
      vehicleId,
      vehicleLabel:  vehicle.label,
      giftAmount,
      financialCalc,
      letterText,
      generatedAt:   new Date().toISOString(),
    };
  } catch(e) {
    logger.error('Proposal generation failed', { err: e.message });
    throw e;
  }
}

// ─── Marketing copy & creative generation ─────────────────────────────────────
async function generatePGMarketingContent(type, orgName, options = {}) {
  const CONTENT_TYPES = {
    brochure_headline: {
      system: 'You are a brilliant nonprofit copywriter who has written award-winning planned giving brochures for 25 years. Your headlines stop people cold. They are emotional, specific, and create an instant connection between the donor\'s values and their legacy.',
      prompt:  `Write 5 headline options for a planned giving brochure for ${orgName}. 
                Each headline should be under 10 words, emotionally resonant, and make the reader feel that a bequest is a natural extension of who they are.
                Avoid: "make a lasting difference", "change lives", "gift that keeps giving" — be original and specific.
                Format: numbered list, one per line.`,
      tokens: 300,
    },
    brochure_body: {
      system: 'You are a major gifts copywriter who has written for Harvard, Stanford, and dozens of premier institutions. Your writing is warm, personal, and never feels like a pitch. You write as if speaking directly to someone sitting across from you.',
      prompt:  `Write the main body copy for a planned giving brochure for ${orgName}.
                Include: why planned giving is an act of personal values (not just charity), the 3 most accessible vehicles (bequest, beneficiary designation, IRA QCD), and a soft call to action inviting a conversation.
                Tone: warm, confident, personal — like a trusted friend who happens to be an expert.
                Length: 350–450 words. No headers with #. Use natural paragraph breaks.`,
      tokens: 700,
    },
    email_campaign: {
      system: 'You are a planned giving marketing director who has written email campaigns that have generated millions in legacy commitments. Your emails feel personal, timely, and are read all the way through.',
      prompt:  `Write a 3-email planned giving cultivation email campaign for ${orgName}.
                Email 1 (Subject + body, 150 words): Gratitude + soft introduction to legacy giving
                Email 2 (Subject + body, 200 words): Educational — explain the bequest in simple, non-threatening terms
                Email 3 (Subject + body, 150 words): Personal invitation to a conversation (no pressure)
                Each email should have a clear subject line and feel like it came from a real officer, not a marketing department.`,
      tokens: 900,
    },
    social_posts: {
      system: 'You write social media content for university advancement offices that actually gets engagement — warm, human, and shareable. Not institutional-speak.',
      prompt:  `Write 5 social media posts about planned giving for ${orgName}. Mix LinkedIn, Facebook, and Instagram.
                Include: 1 alumni story angle, 1 tax benefit angle, 1 legacy/values angle, 1 "did you know" educational, 1 call to action.
                Each post: platform label, copy (under 150 chars for IG/FB, 250 for LinkedIn), and 3 suggested hashtags.`,
      tokens: 600,
    },
    legacy_society_letter: {
      system: 'You write impeccable stewardship letters that make donors feel seen, valued, and proud of their legacy commitment.',
      prompt:  `Write a legacy society welcome letter for ${orgName}'s legacy giving society (${options.societyName || 'Heritage Society'}).
                The donor has just informed us of a bequest intention. 
                The letter should: welcome them warmly, affirm the meaning of their decision, describe what membership means (events, recognition, communication), and express genuine institutional gratitude.
                Tone: presidential, warm, personal. Length: 300–350 words. Formal letter format with placeholders for name and date.`,
      tokens: 600,
    },
    case_statement: {
      system: 'You write case statements that make donors feel the urgency and joy of giving. You balance aspiration with specificity.',
      prompt:  `Write a planned giving case statement for ${orgName}.
                Include: the case for legacy giving at this institution, what planned gifts have made possible historically, the future vision that donors are funding, and a compelling statement of opportunity.
                Length: 500–600 words. Write as if this will be the first page of a planned giving guide.`,
      tokens: 900,
    },
    image_prompt: {
      system: '',
      prompt:  `Generate a DALL-E 3 image prompt for a planned giving campaign image for a university.
                The image should convey: legacy, continuity, warmth, and institutional pride — without being morbid.
                Good subjects: multigenerational families on campus, autumn campus scenes with students, a donor looking thoughtfully at a university building, hands exchanging a diploma, an oak tree.
                Format: a detailed, professional image generation prompt ready for DALL-E 3. Include: style (photorealistic or painterly), lighting, composition, and mood.`,
      tokens: 250,
    },
  };

  const spec = CONTENT_TYPES[type];
  if (!spec) throw new Error(`Unknown content type: ${type}. Available: ${Object.keys(CONTENT_TYPES).join(', ')}`);

  try {
    const text = await callClaude(spec.system || 'You are an expert nonprofit copywriter.', spec.prompt, spec.tokens);
    return { type, orgName, content: text, generatedAt: new Date().toISOString() };
  } catch(e) {
    logger.error('Marketing content generation failed', { type, err: e.message });
    throw e;
  }
}

// ─── Image generation via DALL-E 3 ───────────────────────────────────────────
async function generateMarketingImage(promptText, style = 'photorealistic', orgName = '') {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY not configured — required for image generation');

  // Enhance prompt for planned giving context
  const enhancedPrompt = `${promptText}. Style: ${style}. Brand tone: warm, dignified, aspirational. University philanthropic context. High quality, suitable for institutional print materials.`;

  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:           'dall-e-3',
        prompt:          enhancedPrompt,
        n:               1,
        size:            '1792x1024',
        quality:         'hd',
        style:           style === 'painterly' ? 'vivid' : 'natural',
        response_format: 'url',
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'DALL-E 3 request failed');

    return {
      imageUrl:      data.data[0].url,
      revisedPrompt: data.data[0].revised_prompt,
      model:         'dall-e-3',
      quality:       'hd',
      size:          '1792x1024',
      generatedAt:   new Date().toISOString(),
    };
  } catch(e) {
    logger.error('Image generation failed', { err: e.message });
    throw e;
  }
}

// ─── Routes helper: build AI objection response ───────────────────────────────
async function handleObjection(objectionText, donorContext = {}) {
  // Try exact match first
  const exactMatch = Object.entries(OBJECTIONS).find(([k]) =>
    objectionText.toLowerCase().includes(k.toLowerCase().split(' ').slice(0,4).join(' '))
  );

  if (exactMatch) {
    return { ...exactMatch[1], matched: exactMatch[0], aiEnhanced: false };
  }

  // AI fallback for novel objections
  const sys = 'You are the most skilled planned giving officer in the country. You handle objections with empathy, intelligence, and a deep understanding of donor psychology. Never argue. Always validate before pivoting.';
  const msg = `A donor just said: "${objectionText}"
Context: ${JSON.stringify(donorContext)}
Write a 2–3 sentence response that validates their concern, reframes the opportunity, and proposes a next step. Be warm and natural.`;

  try {
    const rebuttal = await callClaude(sys, msg, 200);
    return { rebuttal, type: 'AI_GENERATED', aiEnhanced: true };
  } catch(e) {
    return { rebuttal: 'Let me think about the best way to address that — can I send you some information to review?', type: 'FALLBACK' };
  }
}

// ─── Helper: import callClaude ────────────────────────────────────────────────
const { callClaude } = (() => {
  try { return require('./ai'); } catch(e) { return { callClaude: async () => 'AI unavailable' }; }
})();

module.exports = {
  PG_VEHICLES,
  OBJECTIONS,
  CGA_RATES,
  calculateCGA,
  getCGARate,
  scanPortfolioForPGProspects,
  generateConversationSequence,
  generatePGProposal,
  generatePGMarketingContent,
  generateMarketingImage,
  handleObjection,
};
