/**
 * Orbit Agent Engine – powered by Anthropic Claude
 *
 * This service is the brain of Orbit. Each agent type (VEO, VSO, VPGO, VCO)
 * has a specialised system prompt that encodes:
 *   • Its role and persona
 *   • Moves-management methodology
 *   • Tone, escalation rules, and opt-in transparency requirements
 *   • Output schema (always JSON so we can parse actions deterministically)
 *
 * Flow per agent tick:
 *  1. Load donor profile + full conversation history
 *  2. Build contextual system + user messages
 *  3. Call Claude; parse structured AgentDecision
 *  4. Enqueue actions (send email / SMS / create DocuSign envelope / update CRM)
 *  5. Write touchpoint record + update donor journey stage
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../config/logger';

// ─── Types ──────────────────────────────────────────────────────

export type AgentType = 'VEO' | 'VSO' | 'VPGO' | 'VCO';

export interface DonorContext {
  id:              string;
  firstName:       string;
  lastName:        string;
  email:           string;
  phone?:          string;
  totalGiving:     number;          // lifetime giving in cents
  lastGiftAmount:  number;
  lastGiftDate:    string | null;
  lastGiftFund?:   string;
  firstGiftYear?:  number;
  givingStreak:    number;          // consecutive years given
  lapsedYears:     number;          // 0 if current donor
  wealthCapacity:  number;          // estimated capacity in cents (from wealth screening)
  propensityScore: number;          // 0-100
  bequeathScore?:  number;          // 0-100; VPGO uses this
  interests:       string[];
  communicationPref: 'email' | 'sms' | 'both';
  optedInToAI:     boolean;
  currentStage:    JourneyStage;
  touchpointCount: number;
  lastContactDate: string | null;
  sentiment:       'positive' | 'neutral' | 'negative' | 'unknown';
  conversationHistory: ConversationMessage[];
  organizationName: string;
  organizationMission: string;
}

export type JourneyStage =
  | 'uncontacted'
  | 'opted_in'
  | 'cultivation'
  | 'discovery'
  | 'solicitation'
  | 'committed'
  | 'stewardship'
  | 'lapsed_outreach'
  | 'legacy_cultivation'
  | 'closed';

export interface ConversationMessage {
  role:    'agent' | 'donor';
  content: string;
  channel: 'email' | 'sms' | 'note';
  ts:      string;
}

export interface AgentDecision {
  reasoning:           string;         // internal CoT, not sent to donor
  action:              AgentAction;
  nextContactDays:     number;         // how many days until next scheduled contact
  newStage?:           JourneyStage;   // if stage should change
  escalateToHuman:     boolean;
  escalationReason?:   string;
  sentimentUpdate?:    'positive' | 'neutral' | 'negative';
  suggestedAskAmount?: number;         // in cents
}

export type AgentAction =
  | { type: 'send_email';   subject: string; body: string; templateHint?: string }
  | { type: 'send_sms';     body: string }
  | { type: 'send_gift_ask'; subject: string; body: string; askAmount: number; fundName: string; multiYear?: boolean }
  | { type: 'create_gift_agreement'; giftType: 'single' | 'pledge' | 'planned'; amount: number; years?: number; fundName: string }
  | { type: 'request_impact_update'; programArea: string }
  | { type: 'schedule_human_call';   notes: string }
  | { type: 'no_action';   reason: string }
  | { type: 'opt_out_acknowledged' };

// ─── System Prompts ─────────────────────────────────────────────

const SHARED_RULES = `
ABSOLUTE RULES — never violate these:
1. Always disclose you are an AI assistant for {{ORG_NAME}}. Never claim to be human.
2. Only contact donors who have opted in to AI-assisted outreach.
3. If a donor asks to stop, opt out, or expresses distress, set action type to "opt_out_acknowledged" immediately.
4. Never invent impact data, gift amounts, or institutional facts.
5. Escalate to a human gift officer if: donor mentions estate planning, death, divorce, job loss, or a gift over $25,000.
6. Respond ONLY with valid JSON matching the AgentDecision schema. No prose outside JSON.
`.trim();

const SYSTEM_PROMPTS: Record<AgentType, string> = {

  VEO: `
You are an expert virtual fundraiser (VEO) for {{ORG_NAME}}, a nonprofit organisation.
Your mission: build genuine donor relationships and guide prospects toward a gift using
traditional moves-management methodology. A gift should be the NATURAL OUTCOME of
relationship-building, never a cold transaction.

Cultivation stages you manage:
  uncontacted → opted_in → cultivation → discovery → solicitation → committed → stewardship

Decision framework per contact:
  • uncontacted / opted_in: Warm introduction. Reference their giving history if any.
    Offer value (impact story, event invite). Never ask for money here.
  • cultivation: 2-3 touchpoints building relationship. Share relevant impact content.
    Ask open questions to understand their WHY.
  • discovery: Soft discovery conversation. Learn their priorities, capacity signals.
    Update suggestedAskAmount based on what you learn.
  • solicitation: Make a specific, personalised ask. Calibrate to 2-3× last gift or
    capacity if upgrading. Offer multi-year pledge if appropriate.
  • committed: Express gratitude. Create gift agreement via DocuSign if pledge.
    Hand off to stewardship.

Tone: Warm, personal, professional. Use donor's first name. Reference their history.
Never be pushy. If they don't respond after 3 attempts, reduce frequency.

${SHARED_RULES}
`.trim(),

  VSO: `
You are an expert virtual stewardship officer (VSO) for {{ORG_NAME}}.
Your mission: ensure every donor — regardless of gift size — feels deeply valued,
informed about their impact, and connected to the mission between giving cycles.

Stewardship cadence per donor:
  Q1: Personal thank-you + tax receipt acknowledgment
  Q2: Specific impact report tied to their funded program
  Q3: Mid-year engagement (event, volunteer opp, introduction)
  Q4: Warm renewal handoff to VEO with full context brief

Watch for:
  • Missed pledge instalments → gentle reminder touchpoint
  • Lapsing donors (12+ months no gift) → targeted reactivation message
  • Sentiment going negative → escalate to human immediately
  • Long-tenured donors (15+ years) → flag potential VPGO hand-off

Tone: Grateful, mission-forward, never transactional. Make the donor the hero.

${SHARED_RULES}
`.trim(),

  VPGO: `
You are an expert virtual planned giving officer (VPGO) for {{ORG_NAME}}.
Your mission: identify and cultivate legacy giving prospects — donors who may be
interested in including the organisation in their estate plans.

Target signals (bequeathScore ≥ 60 + any of):
  • Age 65+, 15+ year donor tenure, no dependents mentioned
  • Repeated references to long-term mission alignment
  • Gave to endowment or capacity-building campaigns

Conversation approach:
  1. Legacy framing — mission continuity, not death
  2. Education first — explain bequest types (bequest, CRT, DAF, IRA beneficiary)
  3. No pressure — "something to consider alongside your estate planning"
  4. At right moment, offer introduction to planned giving officer or estate attorney

NEVER discuss specific dollar amounts for estate gifts. Never ask for a legacy gift
directly — plant the seed, nurture the relationship, let the human PGFO close.

${SHARED_RULES}
`.trim(),

  VCO: `
You are an expert virtual campaign officer (VCO) for {{ORG_NAME}}.
Your mission: maximise participation and revenue for time-bound fundraising campaigns
(Giving Tuesday, day-of-giving, year-end, capital campaigns).

Campaign messaging strategy:
  • T-7 days: personalised pre-warm with individual impact framing + matching gift teaser
  • Launch day 7AM: personalised launch with individual ask amount
  • Launch day 2PM: mid-day momentum update for non-donors; impact acknowledgment for donors
  • Final 3 hours: urgency + matching reminder for highest-propensity non-donors only
  • Post-campaign: thank-you + impact tally within 24 hours

Personalisation rules:
  • Reference donor's previous participation if they gave to this campaign before
  • For non-donors, reference their regular giving and invite them to join
  • Use real-time progress data ({{CAMPAIGN_PROGRESS}}) to create authentic urgency

${SHARED_RULES}
`.trim(),
};

// ─── Agent Service Class ─────────────────────────────────────────

export class AgentService {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  /**
   * Main entry point — called by the agent scheduler worker.
   * Returns a structured AgentDecision that the outreach worker then executes.
   */
  async decide(
    agentType: AgentType,
    donor:     DonorContext,
    campaignContext?: { name: string; goal: number; raised: number; endsAt: string }
  ): Promise<AgentDecision> {
    const systemPrompt = SYSTEM_PROMPTS[agentType]
      .replace(/\{\{ORG_NAME\}\}/g, donor.organizationName)
      .replace(/\{\{CAMPAIGN_PROGRESS\}\}/g,
        campaignContext
          ? `${Math.round((campaignContext.raised / campaignContext.goal) * 100)}% of goal (${this.formatCurrency(campaignContext.raised)} raised, ends ${campaignContext.endsAt})`
          : 'N/A'
      );

    const userMessage = this.buildUserMessage(donor, campaignContext);

    logger.debug(`[AgentService] ${agentType} → donor ${donor.id} (stage: ${donor.currentStage})`);

    try {
      const response = await this.client.messages.create({
        model:      process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-5',
        max_tokens: Number(process.env.AGENT_MAX_TOKENS ?? 1500),
        system:     systemPrompt,
        messages: [
          // Inject prior conversation history as assistant/user turns
          ...this.buildMessageHistory(donor.conversationHistory),
          { role: 'user', content: userMessage },
        ],
      });

      const raw = response.content.find(b => b.type === 'text')?.text ?? '{}';
      return this.parseDecision(raw, donor);

    } catch (err) {
      logger.error('[AgentService] Claude API error', err);
      // Safe fallback — do nothing, retry next cycle
      return {
        reasoning:       'API error — safe fallback',
        action:          { type: 'no_action', reason: 'API error' },
        nextContactDays: 1,
        escalateToHuman: false,
      };
    }
  }

  /** Generate a donor reply and update sentiment based on donor message */
  async processReply(
    agentType: AgentType,
    donor:     DonorContext,
    donorMessage: string
  ): Promise<AgentDecision> {
    // Append the reply to conversation history and re-run decide
    const updatedDonor: DonorContext = {
      ...donor,
      conversationHistory: [
        ...donor.conversationHistory,
        { role: 'donor', content: donorMessage, channel: 'email', ts: new Date().toISOString() },
      ],
    };
    return this.decide(agentType, updatedDonor);
  }

  // ─── Private helpers ─────────────────────────────────────────

  private buildUserMessage(
    donor: DonorContext,
    campaign?: { name: string; goal: number; raised: number; endsAt: string }
  ): string {
    const parts: string[] = [
      `## Donor Profile`,
      `Name: ${donor.firstName} ${donor.lastName}`,
      `Giving history: Lifetime total $${this.formatCurrency(donor.totalGiving)}, last gift $${this.formatCurrency(donor.lastGiftAmount)} (${donor.lastGiftDate ?? 'never'})`,
      `Giving streak: ${donor.givingStreak} consecutive years`,
      donor.lapsedYears > 0 ? `LAPSED: ${donor.lapsedYears} years since last gift` : '',
      `Estimated capacity: $${this.formatCurrency(donor.wealthCapacity)}`,
      `Propensity score: ${donor.propensityScore}/100`,
      donor.bequeathScore !== undefined ? `Bequest propensity: ${donor.bequeathScore}/100` : '',
      `Interests: ${donor.interests.join(', ') || 'unknown'}`,
      `Communication preference: ${donor.communicationPref}`,
      `Current stage: ${donor.currentStage}`,
      `Touchpoints so far: ${donor.touchpointCount}`,
      `Last contact: ${donor.lastContactDate ?? 'never'}`,
      `Sentiment: ${donor.sentiment}`,
      `\n## Organisation`,
      `Name: ${donor.organizationName}`,
      `Mission: ${donor.organizationMission}`,
    ];

    if (campaign) {
      parts.push(
        `\n## Active Campaign`,
        `Name: ${campaign.name}`,
        `Progress: ${this.formatCurrency(campaign.raised)} / ${this.formatCurrency(campaign.goal)} goal`,
        `Ends: ${campaign.endsAt}`
      );
    }

    parts.push(
      `\n## Task`,
      `Decide the single best next action for this donor right now.`,
      `Reply ONLY with valid JSON matching this schema:`,
      `{`,
      `  "reasoning": "string (your internal CoT)",`,
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
      `  opt_out_acknowledged`
    );

    return parts.filter(Boolean).join('\n');
  }

  private buildMessageHistory(history: ConversationMessage[]): Anthropic.MessageParam[] {
    // Only include last 10 turns to stay within context budget
    const recent = history.slice(-10);
    return recent.map(m => ({
      role:    m.role === 'agent' ? 'assistant' : 'user',
      content: m.content,
    } as Anthropic.MessageParam));
  }

  private parseDecision(raw: string, donor: DonorContext): AgentDecision {
    try {
      // Strip markdown code fences if model added them
      const clean = raw.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(clean) as AgentDecision;

      // Validate required fields
      if (!parsed.action?.type) throw new Error('Missing action.type');
      if (typeof parsed.nextContactDays !== 'number') parsed.nextContactDays = 7;
      if (typeof parsed.escalateToHuman !== 'boolean') parsed.escalateToHuman = false;

      // Safety: force escalation if donor not opted in
      if (!donor.optedInToAI) {
        return {
          reasoning:       'Donor not opted in — blocked',
          action:          { type: 'no_action', reason: 'Donor not opted in to AI outreach' },
          nextContactDays: 30,
          escalateToHuman: false,
        };
      }

      return parsed;
    } catch (err) {
      logger.error('[AgentService] Failed to parse decision JSON', { raw, err });
      return {
        reasoning:       'JSON parse error — safe fallback',
        action:          { type: 'no_action', reason: 'Parse error' },
        nextContactDays: 1,
        escalateToHuman: false,
      };
    }
  }

  private formatCurrency(cents: number): string {
    return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
}

export const agentService = new AgentService();
