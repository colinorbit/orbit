'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ORBIT MARKETING STUDIO  v1.0
 *  "A Full Fundraising Agency in One Service"
 *
 *  Orchestrates multiple AI models to produce agency-quality marketing:
 *
 *  Writing models:
 *    - Claude Opus 4     → Strategy, case statements, major gift proposals
 *    - Claude Sonnet 4   → All campaign copy, emails, stewardship letters
 *    - Claude Haiku 4.5  → Subject line variants, quick personalization
 *
 *  Image models:
 *    - DALL-E 3 (OpenAI) → Photorealistic campaign imagery, donor portraits
 *    - Ideogram v2       → Brand-aligned text-in-image, social graphics
 *    - Stable Diffusion  → High-volume variant generation
 *
 *  Produces:
 *    - Full campaign kits (case statement + email series + social pack + visuals)
 *    - Personalized appeal letters (mail merge at scale)
 *    - Stewardship report narratives
 *    - Event invitations
 *    - Giving day landing page copy
 *    - Legacy society collateral
 *    - Annual fund series (4-6 touch campaigns)
 *    - Major gift proposals
 *    - Phone call scripts
 *    - Video scripts (for campus video team)
 * ═══════════════════════════════════════════════════════════════════════════
 */

const fetch  = require('node-fetch');
const logger = require('../utils/logger');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_URL    = 'https://api.openai.com/v1';
const IDEOGRAM_URL  = 'https://api.ideogram.ai/generate';

// ─── Model tiers ──────────────────────────────────────────────────────────────
const MODELS = {
  opus:   'claude-opus-4-20250514',    // Deepest reasoning — strategy & proposals
  sonnet: 'claude-sonnet-4-20250514',  // Fast + excellent quality — all copy
  haiku:  'claude-haiku-4-5-20251001', // Ultra-fast — subject lines, short variants
  dalle3: 'dall-e-3',                  // Best photorealism
  dalle2: 'dall-e-2',                  // Faster/cheaper for drafts
};

// ─── Core Claude caller with model selection ──────────────────────────────────
async function callModel(model, system, user, maxTokens = 800) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured');

  const res = await fetch(ANTHROPIC_URL, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Claude API ${res.status}: ${err.error?.message || JSON.stringify(err)}`);
  }

  const data = await res.json();
  return data.content[0]?.text || '';
}

// ─── Image generation (DALL-E 3) ─────────────────────────────────────────────
async function generateImage(prompt, options = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not configured for image generation');

  const { size = '1792x1024', quality = 'hd', style = 'natural', n = 1 } = options;

  const res = await fetch(`${OPENAI_URL}/images/generations`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODELS.dalle3, prompt, n, size, quality, style, response_format: 'url' }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'DALL-E 3 failed');

  return {
    urls:          data.data.map(d => d.url),
    revisedPrompt: data.data[0]?.revised_prompt,
    model:         'dall-e-3', size, quality, generatedAt: new Date().toISOString(),
  };
}

// ─── Ideogram (text-in-image, social graphics) ───────────────────────────────
async function generateIdeogramImage(prompt, options = {}) {
  const key = process.env.IDEOGRAM_API_KEY;
  if (!key) throw new Error('IDEOGRAM_API_KEY not configured');

  const res = await fetch(IDEOGRAM_URL, {
    method:  'POST',
    headers: { 'Api-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_request: {
        prompt,
        aspect_ratio:    options.aspectRatio || 'ASPECT_16_9',
        model:           'V_2',
        magic_prompt_option: 'AUTO',
        style_type:      options.style || 'REALISTIC',
        negative_prompt: options.negative || 'text errors, blurry, low quality, watermark',
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ideogram failed');

  return {
    urls:        (data.data || []).map(d => d.url),
    model:       'ideogram-v2',
    generatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  CAMPAIGN KIT GENERATOR
//  Produces a complete, ready-to-deploy campaign in one call
// ═══════════════════════════════════════════════════════════════════════════
async function generateCampaignKit(brief) {
  const {
    orgName,
    campaignType,     // 'annual_fund' | 'major_gift' | 'planned_giving' | 'giving_day' | 'capital'
    targetAudience,   // 'alumni' | 'parents' | 'faculty' | 'community' | 'major_donors'
    goal,             // dollar amount
    deadline,         // 'end of fiscal year', 'Dec 31', etc.
    keyMessage,       // one sentence describing the primary ask
    fund,             // specific fund or program
    tonePreference,   // 'formal' | 'warm' | 'urgent' | 'celebratory'
    donorCount,       // number of donors in segment
  } = brief;

  logger.info('Generating campaign kit', { orgName, campaignType, targetAudience });

  // ── 1. Strategy (Opus — most capable) ────────────────────────────────────
  const strategy = await callModel(MODELS.opus,
    `You are a chief development officer and master fundraising strategist who has led capital campaigns at Harvard, Duke, and Vanderbilt. You think at the level of a McKinsey consultant combined with the best fundraising instincts in the country.`,
    `Create a campaign strategy brief for:
Institution: ${orgName}
Campaign type: ${campaignType}
Audience: ${targetAudience} (${donorCount || 'unknown'} donors)
Goal: ${goal ? '$'+Number(goal).toLocaleString() : 'TBD'}
Deadline: ${deadline || 'end of fiscal year'}
Key message: ${keyMessage}
Fund/Program: ${fund || 'General'}
Tone: ${tonePreference || 'warm'}

Provide:
1. Campaign positioning (what makes this compelling and urgent)
2. Primary emotional hook (the single feeling we want to create)
3. Segmentation strategy (3 donor tiers with different approaches)
4. 5-touch cadence recommendation (channel + timing + purpose for each touch)
5. Expected conversion rates and goal alignment
6. One creative insight that no other institution is doing right now

Be specific and brilliant. 400 words max.`,
    900
  );

  // ── 2. Subject lines — 10 variants (Haiku — fast) ────────────────────────
  const subjectLines = await callModel(MODELS.haiku,
    'You write email subject lines that achieve 40%+ open rates for university fundraising campaigns. You know exactly what language works and what feels generic.',
    `Write 10 subject line variants for a ${campaignType} campaign at ${orgName} targeting ${targetAudience}.
Goal: ${keyMessage}
Write: 3 curiosity, 3 personal/warm, 2 urgent, 2 story-forward.
Format: numbered list. No explanations.`,
    300
  );

  // ── 3. Email series — 4 emails (Sonnet) ──────────────────────────────────
  const emailSeries = await callModel(MODELS.sonnet,
    `You are the best fundraising copywriter in higher education. Your emails are read from first word to last. You never use the phrases "make a difference", "your gift will help", or "now more than ever". You write like a trusted human being, not a development office.`,
    `Write a 4-email campaign series for ${orgName}'s ${campaignType} campaign.

Campaign brief:
- Audience: ${targetAudience}
- Fund: ${fund || 'general fund'}
- Goal: ${goal ? '$'+Number(goal).toLocaleString() : 'TBD'} by ${deadline || 'year end'}
- Key message: ${keyMessage}
- Tone: ${tonePreference || 'warm'}

Email 1 — Awareness (7 days before close): Cultivate. Story-first. No ask yet.
Email 2 — Soft ask (5 days before close): First ask with emotional anchor.
Email 3 — Mid push (3 days before close): Social proof + urgency building.
Email 4 — Final day: Deadline urgency + thank you in advance energy.

For each email:
SUBJECT: [subject line]
PREVIEW: [35-char preview text]
BODY: [full email body, 150–200 words]
CTA: [button text]

Be brilliant. Be human. Be specific.`,
    1600
  );

  // ── 4. Appeal letter (Sonnet) ────────────────────────────────────────────
  const appealLetter = await callModel(MODELS.sonnet,
    'You write major gift appeal letters that feel like personal correspondence from a respected institutional leader. They are warm, specific, and create genuine urgency without manipulation.',
    `Write a direct mail appeal letter for ${orgName}'s ${campaignType} campaign.
Audience: ${targetAudience}
Fund: ${fund || 'general fund'}
Key message: ${keyMessage}
Tone: ${tonePreference || 'warm'}

Format: full letter with greeting, 3 paragraphs, ask paragraph, PS.
Length: 350–400 words.
The PS should be the strongest sentence in the letter — it's the most-read line.`,
    800
  );

  // ── 5. Social media pack (Haiku — fast) ──────────────────────────────────
  const socialPack = await callModel(MODELS.haiku,
    'You write social media content for university campaigns that people actually share. Not institutional. Human.',
    `Write a social media pack for ${orgName}'s ${campaignType} campaign:
- 3 LinkedIn posts (200 words each)
- 4 Facebook posts (100 words each)
- 5 Instagram captions (under 100 words, emoji-friendly)
- 1 Twitter/X thread (5 tweets)

Key message: ${keyMessage}
Tone: ${tonePreference || 'warm and celebratory'}`,
    1000
  );

  // ── 6. Image prompts (Sonnet) ─────────────────────────────────────────────
  const imagePrompts = await callModel(MODELS.sonnet,
    'You are an art director at a top nonprofit creative agency. You write image generation prompts that produce stunning, emotionally resonant campaign imagery.',
    `Write 5 image generation prompts for a ${campaignType} campaign for ${orgName} targeting ${targetAudience}.

For each prompt include:
- Primary subject and composition
- Lighting and mood
- Style (photorealistic / painterly / graphic)
- Specific emotional quality to convey
- Negative prompt (what to avoid)

Avoid: generic graduation photos, generic handshakes, stock photo clichés.
Each prompt should be ready to paste into DALL-E 3 or Midjourney.`,
    600
  );

  // ── 7. Video script (Sonnet) ─────────────────────────────────────────────
  const videoScript = await callModel(MODELS.sonnet,
    'You write :60 and :90 fundraising video scripts that make people cry and then give. Your scripts win Helixx awards. You understand pacing, visual storytelling, and the emotional architecture of a great ask.',
    `Write a :90 second fundraising video script for ${orgName}'s ${campaignType} campaign.
Key message: ${keyMessage}
Audience: ${targetAudience}

Format:
[0:00–0:05] Opening hook
[0:05–0:35] Story/problem/opportunity
[0:35–0:70] Impact proof
[0:70–0:85] Ask
[0:85–0:90] Emotional close

Include: voiceover copy, scene descriptions, on-screen text suggestions.`,
    700
  );

  return {
    campaignBrief:  brief,
    generatedAt:    new Date().toISOString(),
    models:         { strategy: 'claude-opus-4', copy: 'claude-sonnet-4', quickCopy: 'claude-haiku-4.5' },
    kit: {
      strategy,
      subjectLines,
      emailSeries,
      appealLetter,
      socialPack,
      imagePrompts,
      videoScript,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  STEWARDSHIP REPORT GENERATOR
// ═══════════════════════════════════════════════════════════════════════════
async function generateStewardshipReport(donorData, impactData) {
  const {
    first_name, last_name, total_giving, class_year,
    designated_fund, largest_gift,
  } = donorData;

  return callModel(MODELS.sonnet,
    'You write the most moving, personalized donor stewardship reports in higher education. Every word is chosen to make the donor feel that their investment mattered — because it did.',
    `Write a personalized stewardship impact report for ${first_name} ${last_name} from ${orgName || 'the institution'}.

Donor data:
- Total giving: $${parseFloat(total_giving||0).toLocaleString()}
- Class year: ${class_year || 'N/A'}
- Primary fund: ${designated_fund || 'General Fund'}
- Largest gift: $${parseFloat(largest_gift||0).toLocaleString()}

Impact data: ${JSON.stringify(impactData || { students_supported: 3, scholarships: 1, programs_funded: 2 })}

Write a 300-word personalized stewardship letter that:
1. Opens with a specific student story directly linked to their giving
2. Quantifies the impact in human terms (not just dollars)
3. Connects to their personal history at the institution
4. Ends with a forward-looking statement about continued impact

No generic platitudes. Make them feel this.`,
    600
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  PERSONALIZED APPEAL LETTER GENERATOR (mail merge at scale)
// ═══════════════════════════════════════════════════════════════════════════
async function generatePersonalizedAppeal(donorData, campaignContext) {
  const {
    first_name, last_name, preferred_name, class_year,
    last_gift_amount, last_gift_fund, total_giving,
    consecutive_years, archetype,
  } = donorData;

  const salutation = preferred_name || first_name;

  return callModel(MODELS.sonnet,
    'You write personalized fundraising letters that feel like they came from a real person who knows this donor. No form letter energy. Each letter should feel hand-written.',
    `Write a personalized appeal letter for ${salutation} ${last_name}.

Donor history:
- Class of ${class_year || 'N/A'}
- Total giving: $${parseFloat(total_giving||0).toLocaleString()}
- Last gift: $${parseFloat(last_gift_amount||0).toLocaleString()} to ${last_gift_fund || 'General Fund'}
- Consecutive giving years: ${consecutive_years || 1}
- Donor archetype: ${archetype || 'Loyal Alumnus'}

Campaign: ${campaignContext.type || 'Annual Fund'}
Key message: ${campaignContext.keyMessage || 'Your support changes lives'}
Suggested ask: $${campaignContext.suggestedAsk || Math.round(parseFloat(last_gift_amount||100)*1.2)}

Write a 250-word personal appeal letter. 
- Reference their specific history (class year, fund they support, streak if any)
- Connect their giving to a specific outcome
- Make the ask feel personal, not obligatory
- Include a compelling PS

Salutation: Dear ${salutation},`,
    500
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  PHONE SCRIPT GENERATOR
// ═══════════════════════════════════════════════════════════════════════════
async function generatePhoneScript(donorData, callPurpose) {
  const { first_name, last_name, class_year, total_giving, last_gift_amount, archetype } = donorData;

  return callModel(MODELS.haiku,
    'You write phone scripts for fundraising callers that sound completely natural — never robotic. You understand that the best calls feel like conversations, not pitches.',
    `Write a phone script for a call to ${first_name} ${last_name} (Class of ${class_year || 'N/A'}).

Purpose: ${callPurpose || 'Annual fund renewal'}
Their giving history: $${parseFloat(total_giving||0).toLocaleString()} total, last gift $${parseFloat(last_gift_amount||0).toLocaleString()}
Archetype: ${archetype || 'Loyal Alumnus'}

Include:
1. Opening (personalized, warm — not scripted sounding)
2. Discovery question (before the ask — learn something)
3. Bridge to ask (connect their answer to the campaign)
4. The ask (specific dollar amount: $${Math.round(parseFloat(last_gift_amount||100)*1.2)})
5. Thank you (whether yes or no)
6. 3 objection handles

Each section should feel like a real conversation. Total: 300 words.`,
    500
  );
}

module.exports = {
  generateCampaignKit,
  generateStewardshipReport,
  generatePersonalizedAppeal,
  generatePhoneScript,
  generateImage,
  generateIdeogramImage,
  MODELS,
};
