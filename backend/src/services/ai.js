'use strict';
/**
 * AI Service
 * Wraps all Claude API calls with structured prompts and donor context.
 */

const fetch  = require('node-fetch');
const logger = require('../utils/logger');

const CLAUDE_URL   = 'https://api.anthropic.com/v1/messages';
const MODEL        = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

/** Appended to every system prompt to prevent AI-telltale writing patterns */
const WRITING_GUARD = `

CRITICAL WRITING RULES — follow these without exception:
- Never use em dashes (—) or en dashes (–) anywhere in your response. Replace them with commas, periods, or rewrite the sentence.
- Never use hyphens as punctuation dashes (e.g. " - "). Hyphens are only acceptable inside compound words (e.g. "follow-up", "well-known").
- Write in natural, flowing prose. Vary sentence structure. Do not default to lists or bullets unless explicitly asked.
- Avoid starting sentences with "I" back to back. Avoid robotic sentence patterns.
- Sound like a thoughtful human professional, not a language model.`;

async function callClaude(systemPrompt, userMessage, maxTokens = 1024) {
  const guardedPrompt = systemPrompt + WRITING_GUARD;
  const res = await fetch(CLAUDE_URL, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: maxTokens,
      system:     guardedPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Claude API ${res.status}: ${err.error?.message || JSON.stringify(err)}`);
  }

  const data = await res.json();
  return data.content[0]?.text || '';
}

// ── generateDonorBrief ────────────────────────────────────────────────────────
async function generateDonorBrief(donor, purpose = 'meeting prep') {
  const system = `You are Orbit, an autonomous fundraising intelligence assistant for a university advancement office. 
You generate concise, actionable donor briefings for gift officers. 
Be specific, practical, and insight-driven. Never be generic.
Output JSON only — no markdown, no preamble.`;

  const giftHistory = (donor.gift_history || [])
    .slice(0, 8)
    .map(g => `${g.date}: $${g.amount} to ${g.fund || 'General'}`)
    .join(', ');

  const user = `Generate a donor briefing for ${purpose}.

DONOR DATA:
Name: ${donor.name}
Stage: ${donor.stage}
Assigned Agent: ${donor.assigned_agent}
Propensity Score: ${donor.propensity_score}/100
Engagement Score: ${donor.engagement_score}/100
Sentiment Trend: ${donor.sentiment_trend}
Lifetime Giving: $${(donor.lifetime_giving || 0).toLocaleString()}
Last Gift: $${donor.last_gift_amount || 0} on ${donor.last_gift_date || 'unknown'}
Total Gifts: ${donor.total_gifts || 0}
Interests: ${(donor.interests || []).join(', ') || 'Unknown'}
Preferred Channel: ${donor.preferred_channel || 'Email'}
Gift History: ${giftHistory || 'No history'}
Do Not Contact: ${donor.do_not_contact}
Email Opt-Out: ${donor.email_opt_out}

Return JSON with this exact shape:
{
  "brief": "2-3 sentence narrative summary",
  "talking_points": ["point 1", "point 2", "point 3"],
  "ask_strategy": "specific, actionable ask recommendation with amount and timing",
  "channel_recommendation": "best channel and timing for next contact",
  "risk_flags": ["any concerns to be aware of"],
  "next_action": "single most important next step"
}`;

  const raw = await callClaude(system, user, 600);

  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch(e) {
    logger.warn('Brief parse failed — returning raw', { err: e.message });
    return { brief: raw, talking_points: [], ask_strategy: '', channel_recommendation: '', risk_flags: [], next_action: '' };
  }
}

// ── generateOutreachMessage ────────────────────────────────────────────────────
async function generateOutreachMessage(donor, agentConfig, channel = 'Email') {
  const system = `${agentConfig.persona || 'You are a professional university fundraising assistant.'}
Institution: ${agentConfig.instName || 'Greenfield University'}
Tone: ${agentConfig.tone || 'warm-professional'}
Signature: ${agentConfig.sigName || 'The Advancement Team'}

Generate outreach messages that feel personal, never mass-produced.
Output JSON only.`;

  const user = `Write a ${channel} outreach message for this donor.

Donor: ${donor.name}
Stage: ${donor.stage}
Last Gift: $${donor.last_gift_amount || 0}
Interests: ${(donor.interests || []).join(', ')}
Sentiment: ${donor.sentiment_trend}
Engagement Score: ${donor.engagement_score}/100

Return JSON:
{
  "subject": "email subject line (blank for SMS/Phone)",
  "body": "full message body",
  "rationale": "1 sentence explaining the strategy"
}`;

  const raw = await callClaude(system, user, 500);

  // AI disclosure — appended to every generated message body.
  // Required ethically; also pre-complies with emerging state AI-disclosure laws.
  // Officers may remove this before approving, but it is present by default.
  const AI_DISCLOSURE = channel.toLowerCase() === 'sms'
    ? '\n\n[AI-assisted]'
    : '\n\n---\n*This message was drafted with AI assistance by Orbit and reviewed by your advancement team.*';

  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (parsed.body) parsed.body = parsed.body.trimEnd() + AI_DISCLOSURE;
    return parsed;
  } catch(e) {
    return { subject: '', body: raw.trimEnd() + AI_DISCLOSURE, rationale: '' };
  }
}

// ── generateAgentReasoning ────────────────────────────────────────────────────
async function generateAgentReasoning(agentKey, donor, agentConfig) {
  const AGENT_ROLES = {
    VEO:  'You are VEO — Virtual Engagement Officer. Your goal is to upgrade and convert mid-level donors.',
    VSO:  'You are VSO — Virtual Stewardship Officer. Your goal is to retain donors and maximize lifetime value.',
    VPGO: 'You are VPGO — Virtual Planned Giving Officer. Your goal is to identify and cultivate legacy donors.',
    VCO:  'You are VCO — Virtual Campaign Officer. Your goal is to maximize campaign response and conversion.',
  };

  const system = `${AGENT_ROLES[agentKey] || 'You are an Orbit AI fundraising agent.'}
Think step by step. Be specific. Surface insights a human gift officer would miss.
Output JSON only.`;

  const user = `Analyze this donor and determine the optimal action.

Donor: ${donor.name}
Stage: ${donor.stage}  
Propensity: ${donor.propensity_score}/100
Engagement: ${donor.engagement_score}/100
Sentiment: ${donor.sentiment_trend}
Last Gift: $${donor.last_gift_amount || 0} on ${donor.last_gift_date || 'unknown'}
Interests: ${(donor.interests || []).join(', ')}
Preferred Channel: ${donor.preferred_channel}
Total Lifetime: $${(donor.lifetime_giving || 0).toLocaleString()}

Return JSON:
{
  "reasoning": "step-by-step analysis (3-5 sentences)",
  "priority": "high|medium|low",
  "recommended_action": "exactly what to do next",
  "recommended_ask": "dollar amount if applicable",
  "timing": "when to act",
  "confidence": 0-100
}`;

  const raw = await callClaude(system, user, 600);
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch(e) {
    return { reasoning: raw, priority: 'medium', recommended_action: '', recommended_ask: null, timing: 'Soon', confidence: 50 };
  }
}

module.exports = { callClaude, generateDonorBrief, generateOutreachMessage, generateAgentReasoning };
