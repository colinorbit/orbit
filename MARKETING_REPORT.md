# Orbit Platform -- Marketing Review & Go-to-Market Assessment

**Prepared by: Marketing Team**
**Date: March 9, 2026**
**Status: Pre-Launch Review**

---

## 1. Executive Summary

Orbit is a genuinely differentiated product entering the higher ed advancement technology market at a moment when AI adoption is accelerating but most incumbents are bolting AI onto legacy architectures rather than building AI-native platforms. The product vision -- autonomous AI agents that manage donor relationships at scale -- is compelling and addresses a well-documented pain point (the 1:150 gift officer capacity ceiling). However, Orbit is not yet marketing-ready: the messaging oscillates between two different pricing structures across its own materials, the brand name carries a known collision with a defunct developer community tool, there is no social proof from named institutions, and the content engine is non-existent. The bones are strong. The marketing house has not been built yet.

---

## 2. Brand Assessment

### Name: "Orbit" / "Donor Orbit"

**Strengths:**
- Evocative and memorable. The orbital metaphor (donors revolving around the institution, AI agents circling donors) is visually rich and works across marketing contexts -- the landing page already exploits it well with animated orbital rings.
- Short, one-word, easy to say in conversation: "Have you tried Orbit?"
- Natural compound constructions: Orbit Dashboard, Orbit Agents, Orbit Intelligence.
- The pitch deck uses "Orbit Advancement" as the formal name, which is more precise and defensible than plain "Orbit."

**Weaknesses and Concerns:**
- **Trademark collision.** Orbit was previously the name of a community engagement platform by Orbit.love (shut down 2023). While that product targeted developer relations rather than fundraising, the tech/SaaS audience overlap means some buyers may conflate the two or assume the product is a resurrection of the defunct tool. A trademark search is essential before launch.
- **Domain availability.** The CLAUDE.md references `app.orbitfundraising.com` in deployment. The deployment guide references `api.orbit.ai`. Neither `orbit.ai` nor `orbit.com` is likely available (both are premium domains). If the actual target domain is `donororbit.com`, that should be verified as available and secured immediately. Additionally, `orbitadvancement.com` should be registered as a defensive measure, matching the pitch deck branding.
- **"Donor Orbit" vs. "Orbit" vs. "Orbit Advancement."** The materials use at least three brand variants. This must be consolidated before launch. Recommendation: **Orbit** as the product name, **Orbit Advancement** as the company/entity name (matching the pitch deck), and retire "Donor Orbit" unless it is specifically needed for the domain.
- **Generic search discoverability.** Searching for "Orbit" returns hundreds of irrelevant results (Orbit gum, Orbit baby strollers, Orbit Media Studios, etc.). SEO will be challenging with a single-word brand. "Orbit Advancement" or "Orbit fundraising" as the searchable phrase is more defensible.

**Recommendations:**
1. Conduct a full USPTO trademark search for "Orbit" in Class 42 (SaaS) and Class 36 (financial/fundraising services).
2. Consolidate to one brand name across all materials. Use "Orbit" in conversational contexts and "Orbit Advancement" in formal/legal/SEO contexts.
3. Secure `orbitadvancement.com`, `orbitfundraising.com`, and `donororbit.com` as defensive registrations. Use whichever is the primary marketing domain and redirect the others.
4. Register social handles: @OrbitAdvancement on LinkedIn, Twitter/X, YouTube, and Instagram.

---

## 3. Current Messaging Audit

### Landing Page (`orbit-platform.html`)

**What is working:**
- **Hero headline is strong.** "Every donor in your orbit. Always." is clear, benefits-oriented, and uses the brand name organically. This is one of the best lines in the entire marketing package.
- **The "agent team" framing is compelling.** Introducing four named AI agents (VEO, VSO, VPGO, VCO) with distinct missions creates a concrete mental model. Buyers can envision which agent solves their specific pain.
- **The "How It Works" framework** -- "Sense, Solve, Engage, Repeat" -- is simple enough to remember and differentiates from workflow-automation competitors.
- **Visual design is polished.** The warm cream/teal palette with animated orbital rings communicates premium quality. This does not look like a startup MVP. It looks like a product with investment behind it.
- **CRM integration section** names the right platforms (Salesforce NPSP, RE NXT, Ellucian, HubSpot). This is table-stakes but essential for credibility in higher ed.
- **Dashboard mockup** with live funnel data, engagement scores, and agent activity creates product tangibility. Showing the product reduces perceived risk.

**What is not working:**
- **Pricing disconnect.** The landing page lists Essentials at $1,200/mo, Growth at $3,800/mo, and Enterprise as Custom. The pitch deck lists Starter at $499/mo and Growth at $1,299/mo. These are fundamentally different pricing structures that would immediately undermine credibility if a prospect sees both. This is the single most urgent marketing fix.
- **Unsubstantiated social proof.** The landing page claims "$12M+ Raised Autonomously" and "100+ partner organizations." The pitch deck references "Greenfield University" pilot data. None of these claims are backed by named logos, testimonials, or verifiable case studies. If Greenfield University is a fictional test institution (the demo data confirms it is), these claims risk being perceived as fabricated metrics. Advancement professionals are deeply skeptical buyers; invented numbers will end a sales conversation instantly.
- **Hero sub-copy is too dense.** The sentence "Orbit deploys autonomous AI fundraising agents that personally engage, steward, and close gifts -- reaching every donor in your portfolio with the depth and warmth of a seasoned gift officer" tries to do too much in one breath. It should be broken into two cleaner sentences.
- **Agent jargon.** VEO, VSO, VPGO, VCO are internal codenames that mean nothing to a first-time visitor. The landing page introduces them with icons and short descriptions, which helps, but the four-letter acronyms need to be secondary to the human-readable names (e.g., "Your AI Engagement Officer" rather than "VEO").
- **No named testimonials or logos.** The results section says "100+ partner organizations" but shows zero logos and zero quotes. Even a single named VP of Advancement quote would be worth more than all the animated statistics combined.
- **CTA strategy is weak.** "Schedule a Demo" is the only meaningful CTA. There is no content offer (whitepaper, ROI calculator, benchmark report) to capture leads who are not yet ready for a sales conversation. The "Watch 3-min overview" button links to "#" -- this video does not exist.
- **Missing "Built by advancement professionals" proof.** The footer mentions this claim but the About/Team section is absent. Buyers in this space deeply value domain expertise; a founder bio or "Meet the Team" section showing advancement backgrounds would significantly increase trust.

### Pitch Deck (`orbit-pitch-deck.html`)

**What is working:**
- **Opening headline is exceptional.** "What if every donor felt like your only donor?" is the single best piece of copy in the entire Orbit marketing package. It is emotionally resonant, immediately understood, and positions the product around the donor experience rather than the technology. This line should be promoted to the landing page.
- **Problem slide is well-structured.** The four pain points (150-donor ceiling, 43% lapse rate from feeling forgotten, 70% unclaimed matching gifts, 4 hours per donor brief) are concrete, quantified, and verifiable against industry benchmarks.
- **ROI calculator is a smart interactive element.** Letting a prospect input their donor count and see projected revenue lift makes the value prop tangible and personal.
- **Comparison table** positions Orbit against "Legacy CRM" and "Point Solutions" on dimensions where Orbit wins. This is effective if used carefully (see risks below).
- **90-day pilot with money-back guarantee** is a strong risk-reversal mechanism. This should be more prominent in all materials.
- **Onboarding timeline** (30 days to live, 90 days to outcomes) sets clear expectations and reduces the "this sounds complicated" objection.

**What is not working:**
- **Same pricing inconsistency** as the landing page, but in the opposite direction. The pitch deck's Starter at $499/mo is dramatically lower than the landing page's Essentials at $1,200/mo. Either someone has not updated one of the documents, or these represent two different go-to-market strategies that have not been reconciled.
- **Pilot data from "Greenfield University."** If this is a fictional institution created for the demo, presenting its data in a pitch deck as "pilot data" without disclosing that it is simulated/projected is a significant credibility risk. Advancement VPs will Google "Greenfield University Orbit" and find nothing.
- **Slides are text-heavy.** The security and compliance slide, while comprehensive, reads like a feature list rather than a trust signal. Consider condensing to a "badges and certifications" visual.
- **No team slide.** Investors and buyers both want to know who is behind the product. A team slide with advancement industry credentials is essential.

### Overall Value Proposition Clarity

The core value prop -- "10x your gift officer capacity with AI agents that manage donor relationships autonomously" -- is clear and differentiated. However, it is expressed in at least four different ways across the materials:

1. "Autonomous Fundraising Intelligence" (landing page title tag)
2. "The AI Advancement Platform" (pitch deck title tag)
3. "AI-native fundraising intelligence platform" (CLAUDE.md)
4. "Autonomous AI fundraising agents" (hero sub-copy)

Recommendation: Pick one and use it everywhere. The strongest candidate is **"The AI Advancement Platform"** because it is category-defining, specific to the buyer (advancement), and positions Orbit as a platform rather than a tool.

---

## 4. Positioning Statement

**For** advancement offices at mid-size universities and national nonprofits **who** cannot meaningfully engage more than 3% of their donor base with existing staff, **Orbit is** the AI advancement platform **that** deploys four autonomous AI officers to cultivate, steward, and close gifts across your entire donor portfolio -- personally, continuously, and at scale. **Unlike** legacy CRMs like Blackbaud and point solutions like GiveCampus, **Orbit** does not just store donor data or automate email blasts; it actively manages relationships with the contextual intelligence and judgment of a seasoned gift officer, escalating to humans only when it matters most.

---

## 5. Target Audience Segmentation

### Ideal Customer Profile (ICP)

| Attribute | ICP Specification |
|---|---|
| Organization type | Private liberal arts colleges, mid-size public universities (5K-30K alumni), regional nonprofits with $2M-$20M annual fund targets |
| Donor database size | 2,000-25,000 active records |
| Advancement staff | 3-15 FTE gift officers (enough to feel the pain, too few to solve it with headcount) |
| Current CRM | Salesforce NPSP, Raiser's Edge NXT, or Ellucian (Orbit's built integrations) |
| Budget authority | VP of Advancement, VP of Development, or Chief Advancement Officer with discretionary technology budget |
| Buying trigger | Board pressure on participation rates, failed campaign, recent staff turnover, merger/consolidation of advancement offices |
| Disqualifiers | Institutions with <1,000 donors (too small to justify), institutions with >100K donors and dedicated IT procurement (cycle too long for startup), organizations without CRM (no integration path) |

### First 10 Customers -- Target Profile

1. **3-4 private liberal arts colleges** (1,500-8,000 donors) whose small advancement teams are overwhelmed and whose boards care deeply about alumni participation rates. These institutions have Salesforce NPSP or RE NXT, limited IT bureaucracy, and a VP of Advancement who can sign a $500-$1,300/mo contract without a formal RFP.

2. **2-3 mid-size public universities** (10,000-25,000 donors) at the R2 Carnegie classification level, where the advancement office is large enough to have dedicated annual giving, stewardship, and major gift teams but not large enough to hire another 10 gift officers. These institutions often run giving days and campaigns where the VCO agent provides immediate, measurable value.

3. **2-3 regional nonprofits or community foundations** (2,000-10,000 donors) that have matured past mass-email fundraising but cannot afford major gift officer salaries. These are faster sales cycles with less procurement friction.

4. **1 flagship "lighthouse" institution** -- a well-known university name willing to pilot in exchange for favorable terms. This customer exists purely for logo value and case study content. Worth offering a free or heavily discounted pilot.

### Buyer Personas (Decision-Making Unit)

| Persona | Role in Purchase | Primary Concern |
|---|---|---|
| VP of Advancement / CAO | Economic buyer, final sign-off | ROI, board-reportable metrics, risk to institutional reputation |
| Director of Annual Giving | Champion / initiator | Participation rates, LYBUNT recovery, staff capacity |
| Advancement Database Admin | Technical gatekeeper | CRM integration quality, data integrity, audit trail |
| Director of Donor Relations | User / influencer | Stewardship quality, acknowledgment timing, donor experience |
| CIO / IT Security | Veto power (at larger institutions) | FERPA, data security, SOC 2, SSO integration |

---

## 6. Competitive Messaging

### Competitive Landscape Summary

| Competitor | Category | Strengths | Weaknesses (for Orbit messaging) |
|---|---|---|---|
| **GiveCampus** | Giving day platform + engagement tools | Strong brand in higher ed, excellent giving day tools, growing social giving features, large installed base at small-mid colleges | Not AI-native; giving day focused, not full lifecycle; no autonomous agent capability; more of a "giving page builder" than a relationship manager |
| **Givzy** | Mobile micro-giving / social giving | Mobile-first, social integration, younger donor appeal, simple UX | Very narrow use case (micro-gifts), no CRM integration depth, no stewardship or planned giving capability, limited to young alumni segment |
| **Blackbaud (RE NXT)** | Legacy CRM / system of record | Massive installed base, deep reporting, institutional trust, comprehensive ecosystem (Financial Edge, NetCommunity, etc.) | Slow innovation, expensive, poor UX, no AI agents, 18-24 month implementation cycles, customers are frustrated but locked in |
| **EverTrue** | Alumni engagement analytics | Good data enrichment, social media signal intelligence, strong at major gift prospect identification | Analytics-only (does not take action), no outreach capability, no stewardship, requires human officers to act on signals |
| **Gravyty (now part of Community Brands)** | AI-assisted communications | Early mover in AI-for-fundraising, generates draft outreach messages | Acquired and absorbed into Community Brands; innovation has slowed; generates drafts but does not autonomously manage relationships; still requires officer action on every message |

### Messaging Framework by Competitor

**When a prospect asks "How are you different from GiveCampus?"**
> "GiveCampus is excellent at giving days and donation pages. Orbit operates at a different layer entirely. Where GiveCampus helps you collect gifts during a 24-hour event, Orbit manages the year-round relationship that makes a donor want to give in the first place. Most of our institutions use GiveCampus for giving day alongside Orbit for continuous donor engagement. They are complementary, not competitive."

**When a prospect asks "How are you different from Blackbaud / RE NXT?"**
> "We do not replace your CRM. Orbit sits on top of Raiser's Edge NXT (or Salesforce, or Ellucian) and adds a relationship intelligence layer that your CRM was never designed to provide. Your CRM stores data. Orbit acts on it. Think of it as the difference between a filing cabinet and a gift officer -- we are the gift officer."

**When a prospect asks "How are you different from EverTrue?"**
> "EverTrue gives your team better intelligence about prospects, which is valuable. But it still requires a human officer to read that intelligence, decide what to do, and manually execute outreach. Orbit closes that loop: it reads the signals, reasons about the best action, drafts and sends personalized outreach, and only escalates to a human when the situation demands it. EverTrue tells you who to call. Orbit makes the call."

**When a prospect asks "How are you different from Givzy?"**
> "Givzy is focused on mobile micro-giving and social sharing, which is a great tool for young alumni engagement during campaigns. Orbit manages the full donor lifecycle from first contact through planned giving, across all channels, for your entire donor base. They solve different problems at different scales."

**When a prospect asks "Is this just ChatGPT for fundraising?"**
> "No. ChatGPT generates text when you ask it a question. Orbit is an autonomous system with four specialized AI agents that continuously monitor your donor base, make strategic decisions about relationship management, and execute personalized outreach without a human prompting each interaction. It is the difference between a word processor and a gift officer."

### Competitive Positioning Do's and Don'ts

- **Do** position as a new category ("AI Advancement Platform") rather than an improvement to an existing category. Category creation is more defensible than feature comparison.
- **Do** emphasize the "augment, not replace" message for gift officers. Fear of AI replacing jobs is the number one objection in advancement offices.
- **Do** name integrations with competitor CRMs as a strength. "Orbit makes your Blackbaud investment smarter."
- **Don't** directly attack Blackbaud or GiveCampus by name in public marketing. The advancement community is small, collegial, and interconnected. Negative messaging will travel fast.
- **Don't** compare on features. Orbit will lose a feature-checklist comparison against a 40-year-old Blackbaud ecosystem. Compare on outcomes (donor retention, revenue lift, staff leverage).

---

## 7. Content Strategy

### Content Pillars

1. **The Capacity Crisis** -- Research-backed content about the structural understaffing of advancement offices and why headcount alone cannot solve the problem.
2. **AI in Advancement** -- Thought leadership on how AI changes donor engagement, with emphasis on ethics, transparency, and AI disclosure.
3. **Donor Retention Science** -- Data-driven content about why donors lapse and how personalized stewardship prevents it.
4. **Planned Giving Opportunity** -- Content about the $68 trillion wealth transfer and how mid-size institutions can capture their share.
5. **Practitioner Playbooks** -- Tactical guides for advancement professionals (how to run a giving day, how to build a stewardship matrix, how to segment donors).

### Content Calendar -- First 6 Months

| Month | Asset | Type | Purpose |
|---|---|---|---|
| 1 | "The 97% Problem: Why Most Donors Never Hear From You" | Whitepaper / gated PDF | Top-of-funnel lead generation; anchor stat from pitch deck |
| 1 | "Orbit Launch Announcement" | Blog post + LinkedIn | Brand awareness |
| 2 | "What AI Agents Actually Do (And Don't Do) in Fundraising" | Blog post | Address AI skepticism; SEO for "AI fundraising" |
| 2 | "Donor Retention Benchmark Report: 2026 Edition" | Gated report | Lead magnet; positions Orbit as a data authority |
| 3 | "How [First Customer Name] Reactivated 400 Lapsed Donors in 90 Days" | Case study | Social proof; decision-stage content |
| 3 | "The Advancement Office of 2030" | Webinar with industry guest | Thought leadership; email list building |
| 4 | "LYBUNT Recovery Playbook: A Step-by-Step Guide" | Blog series (3 parts) | SEO; practitioner value; positions Orbit as a stewardship expert |
| 4 | "Orbit ROI Calculator" (interactive web tool) | Web app | Mid-funnel conversion tool; mirrors pitch deck ROI slide |
| 5 | "Planned Giving and the $68 Trillion Transfer: What Mid-Size Institutions Need to Know" | Whitepaper | Buyer education; VPGO agent positioning |
| 5 | "Building Trust with AI-Generated Donor Communications" | Webinar | Address the ethics objection; build community |
| 6 | "State of AI in University Advancement" | Annual survey/report | Category ownership; PR pickup; shareable data |

### SEO Target Keywords

| Keyword | Monthly Search Volume (est.) | Competition | Orbit Angle |
|---|---|---|---|
| AI fundraising software | 400-800 | Medium | Primary product keyword |
| donor retention strategies | 1,200-2,000 | Medium | Content pillar |
| advancement CRM | 500-900 | High (Blackbaud dominates) | Integration messaging |
| AI for nonprofits | 2,000-4,000 | Medium-High | Broader awareness |
| giving day platform | 600-1,000 | Medium (GiveCampus owns) | VCO agent positioning |
| planned giving software | 300-600 | Low | VPGO agent positioning |
| donor engagement platform | 400-700 | Medium | Category keyword |
| LYBUNT recovery | 200-400 | Low | Practitioner content |

---

## 8. Channel Strategy

### Where Advancement Office Buyers Spend Time

| Channel | Relevance | Strategy |
|---|---|---|
| **CASE Conferences** (Annual, District, Mini-Conferences) | Highest | CASE is the professional home of advancement officers. Sponsor CASE Annual Conference, submit speaking proposals on AI in advancement, host a reception or dinner for VPs of Advancement. CASE Annual typically occurs in January-February. District conferences (I through VIII) run throughout the year. |
| **AFP ICON** (Association of Fundraising Professionals) | High | The largest fundraising conference in North America. Broader than higher ed (includes health, arts, social services) but advancement officers attend. Booth + breakout session on AI agents. Typically held in April-May. |
| **AASP (Advancement Services Professionals)** | High | Directly targets database admins and advancement ops staff -- the technical gatekeepers. Critical for winning the "will this break our CRM?" objection. |
| **LinkedIn** | High | Advancement professionals are active on LinkedIn. The VP of Advancement persona checks LinkedIn daily. Organic thought leadership + targeted sponsored content to job titles (VP Advancement, Director Annual Giving, Gift Officer). |
| **CASE Currents / Currents Online** | High | The trade publication of advancement. Contributed articles, sponsored content, and display ads reach the exact ICP. |
| **APRA (Association of Professional Researchers for Advancement)** | Medium-High | Prospect research professionals who evaluate tools. They are influencers in the buying process, especially for wealth screening and signal intelligence features. |
| **Inside Higher Ed / Chronicle of Philanthropy** | Medium | Trade publications read by advancement leadership. Contributed op-eds and sponsored content. |
| **Webinars (self-hosted)** | Medium-High | Advancement professionals consume webinars heavily. Co-host with a recognized advancement consultant or CASE faculty member. |
| **Referral / Word of Mouth** | Highest (long-term) | The advancement community is tight-knit. A single VP of Advancement who champions Orbit at a CASE district conference is worth more than $100K in advertising. Build a formal referral program early. |
| **Email** | Medium | Not for cold outreach (advancement professionals are deluged). For nurturing leads captured via content and events. |
| **Twitter/X** | Low | Advancement professionals are not heavily active on X. Deprioritize. |
| **TikTok / Instagram** | Negligible | Not where B2B decisions happen in this vertical. |

### Conference Calendar (Key Events)

| Event | Typical Timing | Audience | Orbit Action |
|---|---|---|---|
| CASE Annual Conference | January-February | Advancement leadership | Speaking proposal + sponsor |
| AFP ICON | April-May | Fundraising professionals (cross-sector) | Booth + breakout session |
| CASE District Conferences (I-VIII) | Throughout year | Regional advancement professionals | Targeted attendance at 2-3 districts |
| AASP Annual Conference | September-October | Advancement services/data professionals | Technical demo booth |
| Blackbaud bbcon | October | Blackbaud ecosystem users | Attend (not sponsor); network with frustrated RE NXT users |
| APRA Prospect Development Conference | July-August | Prospect researchers | Speaking proposal on AI wealth signals |

---

## 9. Launch Checklist

### Must-Have Before Go-to-Market

- [ ] **Resolve the pricing discrepancy.** Landing page and pitch deck must show identical pricing. Decide on one pricing model and update both documents.
- [ ] **Remove or qualify unverifiable claims.** "$12M+ raised autonomously" and "100+ partner organizations" must be either backed by real data or replaced with clearly labeled projections/simulations.
- [ ] **Produce the 3-minute overview video.** The landing page CTA links to a video that does not exist. This is a critical conversion asset.
- [ ] **Secure at least 2-3 named pilot customers** willing to be referenced. Even "currently in pilot at [Institution]" is better than fictional metrics.
- [ ] **Build a "Request Demo" form and CRM.** Currently both CTAs link to "#". Set up HubSpot (or Salesforce) for lead capture, with automated follow-up sequences.
- [ ] **Create email nurture sequences** -- post-demo follow-up (3-5 emails), post-content-download nurture (5-7 emails).
- [ ] **Write and publish a privacy/security page.** Advancement offices handle FERPA-protected data. A dedicated security page with compliance statements is table stakes.
- [ ] **Consolidate brand name.** Pick "Orbit" or "Orbit Advancement" and update all materials.
- [ ] **Publish a team/about page.** Show advancement industry credentials of founders and key team members.
- [ ] **Register and configure analytics.** Google Analytics 4, Google Tag Manager, LinkedIn Insight Tag on the landing page for conversion tracking.
- [ ] **Set up social accounts.** LinkedIn company page, YouTube channel (for demo videos and webinar recordings).
- [ ] **Prepare a one-pager / leave-behind PDF.** For conference conversations and email follow-ups.
- [ ] **Write a formal data security questionnaire response template.** Many institutions will send a vendor security questionnaire before any pilot.
- [ ] **Build the first gated content asset.** The "97% Problem" whitepaper for lead generation.
- [ ] **SOC 2 timeline.** If not yet started, begin the SOC 2 Type II process. Enterprise buyers will require it. The pitch deck already claims "SOC 2 Type II + TX-RAMP certified" -- this must be true before it is published.

### Nice-to-Have for Launch

- [ ] Interactive ROI calculator on the website (replicating the pitch deck feature)
- [ ] Integration partner pages with co-branded content (Salesforce AppExchange listing, etc.)
- [ ] A "Founder's Story" blog post explaining why Orbit exists
- [ ] Press release distributed through higher ed channels
- [ ] G2 and Capterra profile creation

---

## 10. Pricing Strategy Thoughts

### Current State

The platform has two different pricing structures published across its own materials:

| Tier | Pitch Deck Price | Landing Page Price | Delta |
|---|---|---|---|
| Starter/Essentials | $499/mo | $1,200/mo | 2.4x difference |
| Growth | $1,299/mo | $3,800/mo | 2.9x difference |
| Enterprise | Custom | Custom | Aligned |

This must be resolved immediately. Below is an analysis of what the pricing should be.

### Infrastructure Cost Basis

Per the Deployment Guide, the estimated infrastructure cost per tenant is approximately **$246/month**, dominated by:
- Anthropic API tokens (~$180/mo at ~2M tokens/day)
- VPS, managed Postgres, managed Redis (~$46/mo)
- SendGrid, Twilio (~$20/mo + per-message)

This is a variable-cost business at the bottom of the stack, with AI API costs scaling roughly linearly with donor count. The pitch deck's $499/mo Starter price yields only ~$253/mo gross margin on infrastructure, which is dangerously thin before accounting for support, onboarding, customer success, and team costs.

### Competitive Price Anchoring

| Competitor | Pricing Model | Approximate Cost |
|---|---|---|
| GiveCampus | Per-institution + % of giving day revenue | $3,000-$15,000/year for giving tools; social engagement add-ons additional |
| Blackbaud RE NXT | Per-user license + implementation | $10,000-$50,000/year depending on modules; implementations cost $20K-$100K+ |
| EverTrue | Per-institution, tiered by alumni count | $15,000-$75,000/year |
| Gravyty (Community Brands) | Per-institution | $12,000-$36,000/year estimated |

### Pricing Recommendation

The pitch deck pricing ($499/mo Starter) is too low. The landing page pricing ($1,200/mo Essentials) is closer to correct but the tier structure needs refinement. Recommended pricing:

| Tier | Price | Donor Limit | Rationale |
|---|---|---|---|
| **Starter** | $999/mo ($11,988/yr billed annually) | Up to 2,500 donors | Floor price that delivers ~$750/mo gross margin on infrastructure, undercuts EverTrue/Gravyty by 20-40%, and is accessible to small colleges |
| **Growth** | $2,499/mo ($29,988/yr billed annually) | Up to 15,000 donors | Mid-market sweet spot; Anthropic API costs scale to ~$400-600/mo at this volume; still delivers 60%+ gross margin |
| **Enterprise** | Custom (floor $5,000/mo) | 15,000+ donors, multi-campus | Custom pricing for R1 universities; includes white-label, SSO, dedicated CSM, SLA |

**Key pricing principles:**
- Price on value, not cost. One recovered lapsed donor at $1,000 annual gift pays for a month of Starter pricing. Frame pricing as "the cost of one gift officer FTE divided by 10."
- Annual billing with a meaningful discount (15-20%) drives cash flow and reduces churn.
- The 90-day money-back guarantee from the pitch deck is a strong risk-reversal mechanism. Keep it.
- Consider a free 30-day pilot for the first 10 customers to build case studies. Frame it as "limited founding partner program."
- Monitor Anthropic API costs closely. If Claude pricing drops (likely over time), margins improve; if token volume per donor is higher than projected, margins compress.

---

## 11. Six-Month Marketing Roadmap

### Month 1: Foundation (March-April 2026)

**Theme: Get the house in order**

- Resolve pricing discrepancy across all materials
- Consolidate brand name to "Orbit" / "Orbit Advancement"
- Remove unverifiable claims from landing page and pitch deck
- Register domains (orbitadvancement.com + defensives)
- Set up LinkedIn company page, YouTube channel
- Set up HubSpot (or equivalent) for lead capture + CRM
- Install GA4 + GTM on landing page
- Produce 3-minute product overview video (screen recording with voiceover is fine for v1)
- Write and publish security/privacy page
- Write team/about page with advancement industry credentials
- Create one-pager PDF (leave-behind for conferences)
- Begin outreach to 5-10 target institutions for founding partner pilot program

### Month 2: First Content + Pilots (April-May 2026)

**Theme: Build credibility**

- Publish "The 97% Problem" whitepaper (gated)
- Launch founding partner program with 3-5 institutions (free or deeply discounted 90-day pilots in exchange for case study rights)
- Publish first blog post: "What AI Agents Actually Do in Fundraising"
- Begin weekly LinkedIn content cadence (founder posts, 2-3x/week)
- Submit speaking proposals to CASE District conferences (fall schedule)
- Submit AFP ICON speaker proposals (if deadline hasn't passed)
- Set up email nurture sequences in HubSpot
- Begin cold outreach to 20-30 VPs of Advancement via LinkedIn (personal, not spam)

### Month 3: Social Proof Sprint (May-June 2026)

**Theme: Earn the first logos**

- Close 2-3 founding partners into paid contracts
- Begin documenting pilot results for case studies
- Publish "Donor Retention Benchmark Report" (gated)
- Host first webinar: "The Advancement Office of 2030" with an industry guest
- Publish 2-3 blog posts on content pillars
- Launch LinkedIn sponsored content targeting VP Advancement, Director Annual Giving titles
- Begin building G2/Capterra profiles
- Record a customer video testimonial (even 60 seconds from a pilot customer)

### Month 4: Amplify (June-July 2026)

**Theme: Turn pilots into stories**

- Publish first named case study with pilot data
- Launch "Orbit ROI Calculator" as interactive web tool
- Publish LYBUNT Recovery Playbook blog series (3 parts)
- Attend APRA Conference (if timing aligns) -- speaking or booth
- Double LinkedIn ad spend on highest-performing content
- Begin outreach to CASE Currents for contributed article
- Refine ICP based on pipeline data -- who is converting?
- Produce a second product video focused on CRM integration (the "will this break our data?" objection)

### Month 5: Scale Pipeline (July-August 2026)

**Theme: Build the flywheel**

- Publish "Planned Giving and the $68T Transfer" whitepaper
- Host second webinar: "Building Trust with AI-Generated Donor Communications"
- Apply for Salesforce AppExchange listing
- Begin paid search (Google Ads) on "AI fundraising software" and "donor retention platform" keywords
- Launch formal customer referral program (credit or discount for referrals)
- Prepare booth materials and collateral for fall conference season
- Conduct win/loss analysis on first 20-30 qualified opportunities

### Month 6: Conference Season Prep (August-September 2026)

**Theme: Own the fall conference circuit**

- Finalize CASE District and AASP conference sponsorships/booths
- Prepare conference-specific landing pages with offers
- Produce "State of AI in University Advancement" survey (launch at conference)
- Publish 3rd case study
- Evaluate first 6 months of marketing metrics: pipeline generated, cost per lead, conversion rates, ARR from marketing-sourced deals
- Plan Q1 2027 marketing budget based on what is working

---

## 12. Marketing Risks

### Risk 1: Credibility Gap from Unverifiable Claims

**Severity: Critical**

The landing page claims "$12M+ raised autonomously" and "100+ partner organizations," and the pitch deck presents "Greenfield University" pilot data. If these are simulated or projected rather than actual, a single skeptical VP of Advancement will notice, and the damage will spread through the tight-knit CASE network. Advancement professionals talk to each other constantly.

**Mitigation:** Remove all unverifiable claims immediately. Replace with (a) clearly labeled projections ("Based on modeling with 50 synthetic donor portfolios..."), or (b) wait until real pilot data exists. One real number from one real institution is worth more than a hundred modeled projections.

### Risk 2: AI Backlash in a Relationship-Driven Industry

**Severity: High**

University advancement is built on personal relationships. The idea that "AI is sending messages to my donors" will trigger visceral resistance from many gift officers, stewardship directors, and especially senior VPs who built their careers on personal connection. The fear is not just job replacement -- it is that AI-generated outreach will feel transactional and damage institutional reputation.

**Mitigation:** Lead with the "augment, not replace" message in every conversation. Emphasize the human-in-the-loop: AI drafts, humans approve. Highlight the AI disclosure requirement (Orbit agents never claim to be human). Use testimonials from gift officers who freed up time for their top 50 relationships by letting Orbit handle the other 1,450.

### Risk 3: Pricing Inconsistency Destroys Trust Before First Conversation

**Severity: High**

A prospect who sees $499/mo in the pitch deck and $1,200/mo on the website will immediately distrust everything else. In B2B SaaS, pricing transparency is a trust signal. Inconsistency is a red flag that suggests the company does not have its act together.

**Mitigation:** Fix this today. Align on one pricing model across all materials. If pricing is genuinely evolving, remove specific numbers from the website and use "Starting at $X/mo" with a "Talk to Sales" CTA.

### Risk 4: Long Higher Ed Procurement Cycles Starve the Business

**Severity: Medium-High**

University procurement at institutions with >10,000 students often requires vendor security questionnaires, committee reviews, IT approval, legal review, and sometimes board approval. Sales cycles of 6-12 months are common. If Orbit targets larger institutions too early, it will burn through runway waiting for POs to process.

**Mitigation:** Focus initial sales on institutions where the VP of Advancement has discretionary budget authority and does not need to go through formal procurement. This typically means smaller private colleges ($1,200/mo is within a director-level budget at many institutions) or using pilot/trial programs that fall below procurement thresholds. Save the R1 university enterprise sales for Year 2 when the product has proven case studies and SOC 2 certification.

### Risk 5: Anthropic API Cost Volatility

**Severity: Medium**

Orbit's variable costs are dominated by Anthropic Claude API consumption (~$180/mo per tenant at the deployment guide's estimate, but this could be higher at scale). If Anthropic raises prices, shifts rate limits, or if per-donor token consumption is higher than modeled, margins compress rapidly. At the pitch deck's $499/mo price point, a 50% increase in API costs would cut gross margin to ~20%.

**Mitigation:** Build an AI response cache (already implemented per the CHANGELOG -- good). Monitor token consumption per donor closely and set per-tenant token budgets. Model pricing with a 30% buffer on API costs. Consider adding a "fair use" clause for organizations with unusually high agent activity. Long-term, evaluate multi-model strategies (using smaller/cheaper models for routine tasks, reserving Claude for complex reasoning).

---

## Appendix: Key Files Referenced

| File | Path | Content |
|---|---|---|
| Project Constitution | `/Users/colin/my-github-pages-site/orbit-review/CLAUDE.md` | Architecture, personas, value prop, agent system |
| Landing Page | `/Users/colin/my-github-pages-site/orbit-review/orbit-platform.html` | Marketing/sales page with pricing |
| Pitch Deck | `/Users/colin/my-github-pages-site/orbit-review/orbit-pitch-deck.html` | Investor/buyer pitch deck |
| Deployment Guide | `/Users/colin/my-github-pages-site/orbit-review/DEPLOYMENT_GUIDE.md` | Infrastructure costs, deployment config |
| Backend Changelog | `/Users/colin/my-github-pages-site/orbit-review/orbit-backend/CHANGELOG.md` | Recent development activity, features shipped |
| README | `/Users/colin/my-github-pages-site/orbit-review/README.md` | Product overview, CRM integrations, file inventory |

---

*End of Marketing Report*
*Prepared by Marketing Team -- March 9, 2026*
