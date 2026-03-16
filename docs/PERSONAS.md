# Orbit Platform: User Research & Personas

> Extracted from CLAUDE.md. This document captures the user research foundation for Orbit's design decisions.

---

## Research Basis

Synthesized from: CASE benchmarking studies, AFP Fundraising Effectiveness Project, Blackbaud Institute Charitable Giving Report (2022–2024), Giving USA, APRA body of knowledge, Veritus Group methodology, practitioner blogs, and 50+ advancement office job description analyses.

---

## Operator Personas

### Persona 1: The Major Gift Officer (MGO)
**Archetype**: Sarah, Senior MGO, mid-size research university

- Manages 125–175 prospects; compensation tied to dollars raised
- Travels 30–40% for visits; 15+ min/donor for CRM research before each contact
- **Primary pain**: "I have 165 prospects but only meaningful relationships with 40 of them."
- **Orbit use**: AI-prepared donor briefings; escalation alerts when $25K threshold crossed; VEO handles annual fund while she focuses on major gifts

### Persona 2: The Annual Giving Director
**Archetype**: Marcus, Director of Annual Giving, liberal arts college

- Manages $2–5M annual fund; owns participation rates (board-watched metric)
- **Primary pain**: LYBUNT/SYBUNT management — thousands of lapsed donors, staff can't reach them all
- **Orbit use**: Automated lapse reactivation sequences; AI-generated personalized campaign messages; escalation to calling team for high-propensity non-responders

### Persona 3: The CRM Administrator
**Archetype**: Dani, Advancement Database Administrator

- Controls data integrity; highly skeptical of new integrations
- **Primary concerns**: "Will this break our CRM data? Who's responsible when AI sends the wrong message? I need a full audit trail."
- **What makes them a champion**: Clean CRM integration, exportable audit logs, documented data flows, easy override of AI actions

### Persona 4: The Stewardship Officer
**Archetype**: Priya, Director of Donor Relations

- Manages acknowledgment and impact reporting for 2,000+ donors alone
- **Primary pain**: "I know I should send a mid-year impact update to every $1,000+ donor. I physically cannot do it for 3,000 people."
- **Orbit use**: VSO handles routine touchpoints < $25K lifetime; she reviews AI-drafted impact reports; alerts when high-value donor sentiment goes negative

---

## End User Personas

### Persona 5: The Loyal Annual Donor
**Archetype**: Robert, Class of 1987, 22 consecutive years giving

- Motivated by: habit, identity, sense of obligation
- **Lapse risk**: excessive email volume; transactional feeling; connection feels one-way
- **Orbit experience**: Quarterly stewardship emails referencing his specific history; personalized Giving Day message; warm reactivation (not guilt) if he misses a year

### Persona 6: The Major Gift Prospect
**Archetype**: Linda, Class of 1992, CEO, $8M+ estimated capacity

- Values personal relationships; has DAF; may have estate planning interest
- **Trust signals**: Gift officer knows her history without being told; institution demonstrates stewardship before asking for more
- **Orbit experience**: VEO surfaces interest signals → escalation to human MGO → AI-prepared briefing; VPGO initiates legacy conversation after estate planning mention

### Persona 7: The Lapsed Donor
**Archetype**: James, Class of 2004, 5 gifts, last gift 3 years ago

- Lapsed due to life change; institution never followed up meaningfully
- **Reactivation triggers**: Reunion year, matching gift opportunity, peer pressure, relevant program news
- **Orbit experience**: VSO detects 12-month lapse → `lapsed_outreach` stage → VEO soft sequence (reconnect before ask) → 4-touchpoint limit before moving to `closed`

### Persona 8: The Young Alumni First-Time Donor
**Archetype**: Zoe, Class of 2021, 1 gift ($25, Giving Day)

- Gave via social proof + FOMO; mobile-first; not ready for calls
- **Long-term value**: Pipeline for mid-level and major donors in 20–30 years; year 2–3 retention is critical intervention point
- **Orbit experience**: VSO personal thank-you + impact video within 24hrs; lightweight quarterly touchpoints; gentle year-2 Giving Day ask with class challenge stats

---

## Jobs-To-Be-Done

### Advancement Staff

| Job | Current State | Orbit Solution |
|---|---|---|
| Know every donor's history before outreach | Manual CRM research (15 min/donor) | AI-prepared donor briefings |
| Maintain relationships with 1,000s of donors | Impossible — only top 150 get attention | Agent fleet manages 10,000+ relationships |
| Detect lapsed donors before they're gone | Quarterly reports; 12+ months late | Real-time lapse detection + automated reactivation |
| Personalize campaign messages at scale | Segments of 500+ get generic copy | 1:1 personalization for every donor |
| Ensure every gift is acknowledged within 48hrs | Manual batch; often weeks late | VSO automated acknowledgment within 24 hours |
| Identify major gift prospects from annual fund | Expensive prospect research; low hit rate | Continuous wealth signal monitoring + escalation |

### Alumni & Donors

| Job | Current State | Orbit Solution |
|---|---|---|
| Feel my gift made a difference | Generic annual report PDF | Specific impact story tied to their fund |
| Be recognized for loyalty | Form letter acknowledgment | Personalized milestone recognition |
| Give easily when inspired | Clunky giving portal, desktop-only | Mobile-optimized, one-click recurring giving |
| Stay connected to my institution | Mass email newsletter | Relevant content based on interests |
| Explore planned giving options | Cold call from PGFO | VPGO nurtures interest over time, no pressure |
