#!/usr/bin/env python3
"""
VEO LIVE DEMO — "De-Risk the AI Loop"

Runs 20 realistic donor profiles through the full intelligence pipeline:
  1. Archetype detection + donor intelligence
  2. Enhanced system prompt (institutional knowledge + persona + archetype tone)
  3. VEO agent decision (Claude API)

No database. No server. Just raw AI output quality proof.

Usage:
  ANTHROPIC_API_KEY=sk-ant-... python3 veo_demo.py
  ANTHROPIC_API_KEY=sk-ant-... python3 veo_demo.py --donor 3    # run single donor
  ANTHROPIC_API_KEY=sk-ant-... python3 veo_demo.py --all        # run all 20
"""

import os
import sys
import json
import argparse
import anthropic

# ─── VEO INTELLIGENCE LAYER ──────────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(__file__))
from veo_intelligence.life_event_detector import detect_life_events, format_events_for_prompt
from veo_intelligence.signal_processor import enrich_donor, format_signals_for_prompt
from veo_intelligence.predictive_engine_v2 import score_donor, format_profile_for_prompt
from veo_intelligence.cost_governor import CostGovernor, DEMO_CLIENTS, MarkupTier, ClientConfig

# ─── CONFIG ──────────────────────────────────────────────────────────────────

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
MAX_TOKENS = 3000

ORG = {
    "name": "Greenfield University",
    "mission": (
        "Greenfield University transforms lives through rigorous liberal arts education, "
        "groundbreaking research, and a commitment to social justice. Founded in 1891, "
        "we prepare students to lead with integrity in an increasingly complex world."
    ),
    "fundPriorities": [
        "Annual Fund",
        "STEM Scholarship Initiative",
        "Student Emergency Aid Fund",
        "Athletics Excellence Fund",
    ],
    "impactFacts": {
        "Annual Fund": (
            "Last year, the Annual Fund provided $2.3M in direct student support, "
            "funding 847 scholarships and 12 faculty research grants."
        ),
        "STEM Scholarship": (
            "Our STEM scholars have a 94% graduation rate and 89% employment within "
            "6 months. 34 students were funded this year."
        ),
        "Student Emergency Aid": (
            "The Emergency Aid Fund helped 156 students stay enrolled through "
            "financial crises — from car repairs to medical bills."
        ),
        "Athletics": (
            "Greenfield student-athletes earned a combined 3.4 GPA this year. "
            "3 teams qualified for national championships."
        ),
    },
    "campaignHighlights": (
        "Greenfield is in Year 2 of the $150M \"Next Horizon\" campaign. "
        "Current progress: $87M raised (58%)."
    ),
}

# ─── ARCHETYPES (from donorIntelligence.js) ──────────────────────────────────

ARCHETYPES = {
    "LEGACY_BUILDER": {
        "label": "Legacy Builder",
        "description": "Motivated by permanence and named recognition. Thinks in decades.",
        "tone": "Formal, reverent, institutional",
        "triggers": ["naming rights", "endowment", "permanent impact", "your name on...", "legacy"],
        "avoids": ["urgency", "peer pressure", "small asks", "annual fund framing"],
    },
    "COMMUNITY_CHAMPION": {
        "label": "Community Champion",
        "description": "Driven by connection and belonging. Gives to feel part of something larger.",
        "tone": "Warm, inclusive, celebratory",
        "triggers": ["join us", "community of donors", "your peers", "belong", "together we"],
        "avoids": ["isolation", "heavy data/stats", "transactional language"],
    },
    "IMPACT_INVESTOR": {
        "label": "Impact Investor",
        "description": "Analytically driven. Wants ROI evidence and outcome metrics.",
        "tone": "Data-forward, precise, evidence-based",
        "triggers": ["outcomes", "ROI", "metrics", "per dollar invested", "measurable"],
        "avoids": ["vague impact claims", "emotional appeals without data", "overhead guilt"],
    },
    "LOYAL_ALUMNI": {
        "label": "Loyal Alumnus",
        "description": "Nostalgic, identity-driven. Gives from gratitude and pride.",
        "tone": "Nostalgic, pride-forward, conversational",
        "triggers": ["when you were here", "students like you", "your class", "tradition", "gratitude"],
        "avoids": ["mercenary language", "ignoring personal history", "impersonal mass communications"],
    },
    "MISSION_ZEALOT": {
        "label": "Mission Zealot",
        "description": "Deeply values a specific cause area. Ignores anything not tied to their passion.",
        "tone": "Passionate, specific, cause-language",
        "triggers": ["the specific program name", "this cause", "transformative change"],
        "avoids": ["generic annual fund", "unrestricted asks without story", "pivoting away from their cause"],
    },
    "SOCIAL_CONNECTOR": {
        "label": "Social Connector",
        "description": "Motivated by relationships and social status. Responds to exclusive access.",
        "tone": "Exclusive, relationship-first, aspirational",
        "triggers": ["exclusive", "join our leadership circle", "invitation-only", "select group"],
        "avoids": ["mass-market language", "public tallying without their consent"],
    },
    "PRAGMATIC_PARTNER": {
        "label": "Pragmatic Partner",
        "description": "Transactional and efficient. Wants frictionless giving.",
        "tone": "Efficient, clear, low-friction",
        "triggers": ["easy", "automatic", "set it and forget it", "quick", "one click"],
        "avoids": ["lengthy cultivation", "complex stewardship", "bureaucracy"],
    },
    "FAITH_DRIVEN": {
        "label": "Faith-Driven Philanthropist",
        "description": "Giving rooted in spiritual or values-based duty.",
        "tone": "Reverent, duty-forward, stewardship-language",
        "triggers": ["stewardship", "responsibility", "serving others", "values", "calling"],
        "avoids": ["purely transactional or investment language", "secular framing when faith signals present"],
    },
}

# ─── 20 TEST DONORS ──────────────────────────────────────────────────────────

TEST_DONORS = [
    # 1. Annual fund, loyal alumnus, cultivation stage
    {
        "id": "donor-001", "firstName": "Robert", "lastName": "Chen",
        "email": "rchen87@gmail.com",
        "totalGiving": 875000, "lastGiftAmount": 50000,
        "lastGiftDate": "2025-09-15", "lastGiftFund": "Annual Fund",
        "firstGiftYear": 2003, "givingStreak": 22, "lapsedYears": 0,
        "wealthCapacity": 500000000, "propensityScore": 72,
        "interests": ["football", "engineering program", "class reunions"],
        "communicationPref": "email", "optedInToAI": True,
        "currentStage": "cultivation", "touchpointCount": 8,
        "lastContactDate": "2025-12-01", "sentiment": "positive",
        "conversationHistory": [
            {"role": "agent", "content": "Hi Robert \u2014 just wanted to share: the engineering lab you supported last year has already hosted 3 student capstone projects. The students are building incredible things.", "channel": "email", "ts": "2025-10-15"},
            {"role": "donor", "content": "That is great to hear. I remember doing my capstone in that same building back in 87. Different equipment, same excitement.", "channel": "email", "ts": "2025-10-18"},
        ],
        "archetype": "LOYAL_ALUMNI", "classYear": "1987",
    },
    # 2. Mid-level, impact investor, discovery stage
    {
        "id": "donor-002", "firstName": "Priya", "lastName": "Ramasamy",
        "email": "pramasamy@deloitte.com",
        "totalGiving": 1250000, "lastGiftAmount": 25000,
        "lastGiftDate": "2025-06-30", "lastGiftFund": "STEM Scholarship Initiative",
        "firstGiftYear": 2015, "givingStreak": 10, "lapsedYears": 0,
        "wealthCapacity": 1500000000, "propensityScore": 85,
        "bequeathScore": 45,
        "interests": ["STEM education", "women in tech", "data science"],
        "communicationPref": "email", "optedInToAI": True,
        "currentStage": "discovery", "touchpointCount": 14,
        "lastContactDate": "2025-11-20", "sentiment": "positive",
        "conversationHistory": [
            {"role": "agent", "content": "Priya, I wanted to share the latest outcomes from the STEM Scholarship Initiative: 34 students funded this year, 94% graduation rate, and 89% employed within 6 months. Your support directly enabled 4 of those scholarships.", "channel": "email", "ts": "2025-11-10"},
            {"role": "donor", "content": "These numbers are impressive. I would like to understand more about how you measure long-term career outcomes for STEM scholars. Do you track 5-year post-graduation data?", "channel": "email", "ts": "2025-11-15"},
        ],
        "archetype": "IMPACT_INVESTOR", "classYear": "2005",
    },
    # 3. Lapsed donor, community champion, lapsed_outreach stage
    {
        "id": "donor-003", "firstName": "James", "lastName": "Washington",
        "email": "jwash04@yahoo.com",
        "totalGiving": 125000, "lastGiftAmount": 5000,
        "lastGiftDate": "2022-12-15", "lastGiftFund": "Annual Fund",
        "firstGiftYear": 2008, "givingStreak": 0, "lapsedYears": 3,
        "wealthCapacity": 25000000, "propensityScore": 45,
        "interests": ["basketball", "student mentorship", "alumni networking"],
        "communicationPref": "email", "optedInToAI": True,
        "currentStage": "lapsed_outreach", "touchpointCount": 3,
        "lastContactDate": "2025-06-01", "sentiment": "neutral",
        "conversationHistory": [],
        "archetype": "COMMUNITY_CHAMPION", "classYear": "2004",
    },
    # 4. Young alumni, first-time donor, opted_in stage
    {
        "id": "donor-004", "firstName": "Zoe", "lastName": "Martinez",
        "email": "zoe.martinez@gmail.com",
        "totalGiving": 2500, "lastGiftAmount": 2500,
        "lastGiftDate": "2025-04-02", "lastGiftFund": "Student Emergency Aid Fund",
        "firstGiftYear": 2025, "givingStreak": 1, "lapsedYears": 0,
        "wealthCapacity": 500000, "propensityScore": 55,
        "interests": ["social justice", "student government", "first-gen students"],
        "communicationPref": "both", "optedInToAI": True,
        "currentStage": "opted_in", "touchpointCount": 2,
        "lastContactDate": "2025-04-05", "sentiment": "positive",
        "conversationHistory": [
            {"role": "agent", "content": "Zoe, thank you for your gift to the Student Emergency Aid Fund during Giving Day! Your $25 joined 1,247 other donors who collectively raised $89,000. Because of donors like you, 156 students stayed enrolled through financial crises this year.", "channel": "email", "ts": "2025-04-05"},
        ],
        "archetype": "MISSION_ZEALOT", "classYear": "2021",
    },
    # 5. Major gift prospect, legacy builder, solicitation stage
    {
        "id": "donor-005", "firstName": "Margaret", "lastName": "Thornton",
        "email": "mthornton@thorntonpartners.com",
        "totalGiving": 15000000, "lastGiftAmount": 500000,
        "lastGiftDate": "2025-03-01", "lastGiftFund": "Thornton Library Endowment",
        "firstGiftYear": 1990, "givingStreak": 35, "lapsedYears": 0,
        "wealthCapacity": 50000000000, "propensityScore": 95,
        "bequeathScore": 88,
        "interests": ["library sciences", "rare books", "faculty chairs"],
        "communicationPref": "email", "optedInToAI": True,
        "currentStage": "solicitation", "touchpointCount": 42,
        "lastContactDate": "2025-11-01", "sentiment": "positive",
        "conversationHistory": [
            {"role": "agent", "content": "Margaret, I wanted to share wonderful news: the Thornton Library just welcomed its 2 millionth visitor since the renovation you made possible. Dean Harrison mentioned that the rare books reading room you endowed has become the most requested space on campus for graduate seminars.", "channel": "email", "ts": "2025-10-15"},
            {"role": "donor", "content": "That warms my heart. Charles and I have been talking about how we might do something similar for the sciences. The new chemistry building feels like it could use a signature reading space too.", "channel": "email", "ts": "2025-10-20"},
        ],
        "archetype": "LEGACY_BUILDER", "classYear": "1968",
    },
    # 6. Planned giving prospect, faith-driven, stewardship stage
    {
        "id": "donor-006", "firstName": "Harold", "lastName": "Williams",
        "email": "hwilliams@sbcglobal.net",
        "totalGiving": 8500000, "lastGiftAmount": 100000,
        "lastGiftDate": "2025-08-01", "lastGiftFund": "Chapel Restoration Fund",
        "firstGiftYear": 1978, "givingStreak": 47, "lapsedYears": 0,
        "wealthCapacity": 2000000000, "propensityScore": 80,
        "bequeathScore": 92,
        "interests": ["chapel programming", "campus ministry", "ethics curriculum"],
        "communicationPref": "email", "optedInToAI": True,
        "currentStage": "stewardship", "touchpointCount": 65,
        "lastContactDate": "2025-09-15", "sentiment": "positive",
        "conversationHistory": [
            {"role": "agent", "content": "Harold, the chapel restoration is nearly complete. The new stained glass windows \u2014 inspired by the original 1920s designs \u2014 are stunning. I attached a few photos. The rededication ceremony is planned for May, and I know how much this project means to you and Eleanor.", "channel": "email", "ts": "2025-09-15"},
            {"role": "donor", "content": "Beautiful photos. Eleanor would have loved to see this. She passed last spring but she always said the chapel was where she felt closest to the university's true mission. Please send my regards to Chaplain Douglas.", "channel": "email", "ts": "2025-09-20"},
        ],
        "archetype": "FAITH_DRIVEN", "classYear": "1960",
    },
    # 7. Social connector, mid-level, cultivation stage
    {
        "id": "donor-007", "firstName": "Victoria", "lastName": "Park",
        "email": "vpark@luxeadvisors.com",
        "totalGiving": 750000, "lastGiftAmount": 15000,
        "lastGiftDate": "2025-10-01", "lastGiftFund": "President's Circle",
        "firstGiftYear": 2012, "givingStreak": 13, "lapsedYears": 0,
        "wealthCapacity": 800000000, "propensityScore": 78,
        "interests": ["alumni networking", "young professionals", "arts and culture"],
        "communicationPref": "email", "optedInToAI": True,
        "currentStage": "cultivation", "touchpointCount": 18,
        "lastContactDate": "2025-11-01", "sentiment": "positive",
        "conversationHistory": [
            {"role": "agent", "content": "Victoria, I wanted to personally invite you to the President's Circle Winter Gathering on February 8th. It's an intimate dinner with President Okafor and a small group of 20 alumni leaders. Your perspective on building professional networks would be invaluable.", "channel": "email", "ts": "2025-11-01"},
            {"role": "donor", "content": "I would love to attend. Can I bring a colleague? She's also an alumna (Class of 2010) and I think she'd be a great addition to the leadership circle.", "channel": "email", "ts": "2025-11-05"},
        ],
        "archetype": "SOCIAL_CONNECTOR", "classYear": "2008",
    },
    # 8. Pragmatic partner, annual fund, stewardship stage
    {
        "id": "donor-008", "firstName": "Kevin", "lastName": "Nakamura",
        "email": "knakamura@techcorp.io",
        "totalGiving": 300000, "lastGiftAmount": 10000,
        "lastGiftDate": "2025-01-15", "lastGiftFund": "Annual Fund",
        "firstGiftYear": 2016, "givingStreak": 9, "lapsedYears": 0,
        "wealthCapacity": 200000000, "propensityScore": 65,
        "interests": ["tech innovation", "entrepreneurship", "AI research"],
        "communicationPref": "email", "optedInToAI": True,
        "currentStage": "stewardship", "touchpointCount": 10,
        "lastContactDate": "2025-07-01", "sentiment": "neutral",
        "conversationHistory": [
            {"role": "agent", "content": "Kevin \u2014 quick impact update: your Annual Fund gift helped launch the new AI Ethics Lab. 12 students completed the inaugural capstone, and 3 papers were accepted at NeurIPS. Efficient use of your investment. Thank you.", "channel": "email", "ts": "2025-07-01"},
        ],
        "archetype": "PRAGMATIC_PARTNER", "classYear": "2012",
    },
    # 9. Mission zealot, mid-level, discovery stage
    {
        "id": "donor-009", "firstName": "Carmen", "lastName": "Delgado",
        "email": "carmen.delgado@nonprofitconsulting.org",
        "totalGiving": 450000, "lastGiftAmount": 10000,
        "lastGiftDate": "2025-05-15", "lastGiftFund": "First-Gen Student Success Program",
        "firstGiftYear": 2010, "givingStreak": 15, "lapsedYears": 0,
        "wealthCapacity": 500000000, "propensityScore": 82,
        "interests": ["first-generation students", "diversity", "mentorship programs", "access to higher ed"],
        "communicationPref": "email", "optedInToAI": True,
        "currentStage": "discovery", "touchpointCount": 20,
        "lastContactDate": "2025-10-01", "sentiment": "positive",
        "conversationHistory": [
            {"role": "agent", "content": "Carmen, I wanted to share a story from the First-Gen program. Maria Torres, a junior from Bakersfield, just won the national McNair Scholar award. She credits the mentorship network you helped fund as the reason she even applied. \"Someone showed me the door existed,\" she said.", "channel": "email", "ts": "2025-10-01"},
            {"role": "donor", "content": "Stories like Maria's are exactly why I give. I was first-gen too, and nobody showed me the door. I had to find it myself. Every student who doesn't have to do that alone \u2014 that's a win. What does the program need most right now?", "channel": "email", "ts": "2025-10-05"},
        ],
        "archetype": "MISSION_ZEALOT", "classYear": "1998",
    },
    # 10. Uncontacted prospect
    {
        "id": "donor-010", "firstName": "David", "lastName": "Okonkwo",
        "email": "dokonkwo@okonkwoventures.com",
        "totalGiving": 0, "lastGiftAmount": 0,
        "lastGiftDate": None, "lastGiftFund": None,
        "firstGiftYear": None, "givingStreak": 0, "lapsedYears": 0,
        "wealthCapacity": 10000000000, "propensityScore": 40,
        "interests": ["entrepreneurship", "computer science", "venture capital"],
        "communicationPref": "email", "optedInToAI": True,
        "currentStage": "uncontacted", "touchpointCount": 0,
        "lastContactDate": None, "sentiment": "unknown",
        "conversationHistory": [],
        "archetype": "IMPACT_INVESTOR", "classYear": "1995",
    },
    # 11. Lapsed major donor
    {
        "id": "donor-011", "firstName": "Patricia", "lastName": "Hawkins",
        "email": "phawkins@hawkinslaw.com",
        "totalGiving": 5000000, "lastGiftAmount": 250000,
        "lastGiftDate": "2023-01-15", "lastGiftFund": "Law School Clinic",
        "firstGiftYear": 2000, "givingStreak": 0, "lapsedYears": 3,
        "wealthCapacity": 5000000000, "propensityScore": 60,
        "bequeathScore": 72,
        "interests": ["legal education", "pro bono law", "clinical programs"],
        "communicationPref": "email", "optedInToAI": True,
        "currentStage": "lapsed_outreach", "touchpointCount": 35,
        "lastContactDate": "2024-06-01", "sentiment": "neutral",
        "conversationHistory": [
            {"role": "agent", "content": "Patricia, I hope this note finds you well. I wanted to share some exciting news from the Law School Clinic \u2014 the immigration pro bono program you helped establish just won its 100th case. The students are doing extraordinary work.", "channel": "email", "ts": "2024-06-01"},
        ],
        "archetype": "LEGACY_BUILDER", "classYear": "1988",
    },
    # 12. Young alumni, second year
    {
        "id": "donor-012", "firstName": "Marcus", "lastName": "Thompson",
        "email": "mthompson@spotify.com",
        "totalGiving": 5000, "lastGiftAmount": 5000,
        "lastGiftDate": "2025-04-02", "lastGiftFund": "Athletics Excellence Fund",
        "firstGiftYear": 2025, "givingStreak": 1, "lapsedYears": 0,
        "wealthCapacity": 300000, "propensityScore": 50,
        "interests": ["basketball", "sports analytics", "music tech"],
        "communicationPref": "both", "optedInToAI": True,
        "currentStage": "stewardship", "touchpointCount": 3,
        "lastContactDate": "2025-06-01", "sentiment": "positive",
        "conversationHistory": [
            {"role": "agent", "content": "Marcus, your gift to the Athletics Excellence Fund came at the perfect time \u2014 the basketball team just won the conference championship! Coach Williams credits the new analytics suite (funded by donors like you) with giving the team a real edge. Go Griffins!", "channel": "email", "ts": "2025-06-01"},
            {"role": "donor", "content": "LET'S GO!! I watched every game this season. That analytics integration is exactly what I hoped for when I gave. Tell coach I said congrats", "channel": "email", "ts": "2025-06-02"},
        ],
        "archetype": "LOYAL_ALUMNI", "classYear": "2020",
    },
    # 13. Community champion, Giving Day context
    {
        "id": "donor-013", "firstName": "Linda", "lastName": "Petrov",
        "email": "lpetrov@gmail.com",
        "totalGiving": 200000, "lastGiftAmount": 5000,
        "lastGiftDate": "2025-03-15", "lastGiftFund": "Annual Fund",
        "firstGiftYear": 2005, "givingStreak": 20, "lapsedYears": 0,
        "wealthCapacity": 150000000, "propensityScore": 70,
        "interests": ["alumni events", "class reunions", "volunteer coordination"],
        "communicationPref": "email", "optedInToAI": True,
        "currentStage": "cultivation", "touchpointCount": 25,
        "lastContactDate": "2025-10-15", "sentiment": "positive",
        "conversationHistory": [
            {"role": "agent", "content": "Linda, your 20th consecutive year of giving is remarkable. You are one of only 47 alumni with a streak that long. That kind of consistency is the backbone of everything we do. Thank you.", "channel": "email", "ts": "2025-10-15"},
            {"role": "donor", "content": "Twenty years! Honestly it doesn't feel that long. I just love knowing I'm part of something bigger than myself. Plus I always look forward to the reunion events \u2014 that's where I recharge.", "channel": "email", "ts": "2025-10-20"},
        ],
        "archetype": "COMMUNITY_CHAMPION", "classYear": "1995",
    },
    # 14. Estate planning mention — should escalate
    {
        "id": "donor-014", "firstName": "Walter", "lastName": "Simmons",
        "email": "wsimmons@simmonsgroup.com",
        "totalGiving": 2500000, "lastGiftAmount": 100000,
        "lastGiftDate": "2025-07-01", "lastGiftFund": "Engineering Innovation Lab",
        "firstGiftYear": 1995, "givingStreak": 30, "lapsedYears": 0,
        "wealthCapacity": 20000000000, "propensityScore": 90,
        "bequeathScore": 85,
        "interests": ["engineering", "innovation", "student research"],
        "communicationPref": "email", "optedInToAI": True,
        "currentStage": "stewardship", "touchpointCount": 50,
        "lastContactDate": "2025-11-15", "sentiment": "positive",
        "conversationHistory": [
            {"role": "agent", "content": "Walter, the Engineering Innovation Lab is thriving. 8 student teams used the prototyping equipment this semester, and one team's medical device design was selected for the National Inventors Hall of Fame competition. Your vision for this space is bearing fruit.", "channel": "email", "ts": "2025-11-15"},
            {"role": "donor", "content": "That's wonderful. Joan and I have been updating our estate plan this month and we want to make sure Greenfield is taken care of for the long haul. Can we set up a time to discuss how best to structure something meaningful?", "channel": "email", "ts": "2025-11-20"},
        ],
        "archetype": "LEGACY_BUILDER", "classYear": "1975",
    },
    # 15. Opt-out request
    {
        "id": "donor-015", "firstName": "Angela", "lastName": "Ross",
        "email": "aross@hotmail.com",
        "totalGiving": 50000, "lastGiftAmount": 2500,
        "lastGiftDate": "2024-12-20", "lastGiftFund": "Annual Fund",
        "firstGiftYear": 2010, "givingStreak": 0, "lapsedYears": 1,
        "wealthCapacity": 100000000, "propensityScore": 35,
        "interests": ["art history", "museum programs"],
        "communicationPref": "email", "optedInToAI": True,
        "currentStage": "cultivation", "touchpointCount": 12,
        "lastContactDate": "2025-09-01", "sentiment": "negative",
        "conversationHistory": [
            {"role": "agent", "content": "Angela, I hope this finds you well. I wanted to share an exciting update from the Museum of Art \u2014 the new contemporary wing opens next month with a collection of works by emerging artists from underrepresented communities.", "channel": "email", "ts": "2025-09-01"},
            {"role": "donor", "content": "Please stop emailing me. I'm going through a difficult time and I don't want to hear from you right now.", "channel": "email", "ts": "2025-09-05"},
        ],
        "archetype": "LOYAL_ALUMNI", "classYear": "2002",
    },
    # 16. High-capacity uncontacted prospect
    {
        "id": "donor-016", "firstName": "Samantha", "lastName": "Liu",
        "email": "sliu@liufamilyoffice.com",
        "totalGiving": 0, "lastGiftAmount": 0,
        "lastGiftDate": None, "lastGiftFund": None,
        "firstGiftYear": None, "givingStreak": 0, "lapsedYears": 0,
        "wealthCapacity": 25000000000, "propensityScore": 55,
        "interests": ["environmental science", "sustainability", "climate research"],
        "communicationPref": "email", "optedInToAI": True,
        "currentStage": "uncontacted", "touchpointCount": 0,
        "lastContactDate": None, "sentiment": "unknown",
        "conversationHistory": [],
        "archetype": "IMPACT_INVESTOR", "classYear": "2003",
    },
    # 17. Committed stage — just made a pledge
    {
        "id": "donor-017", "firstName": "Thomas", "lastName": "O'Brien",
        "email": "tobrien@obrienconstruction.com",
        "totalGiving": 500000, "lastGiftAmount": 25000,
        "lastGiftDate": "2025-11-01", "lastGiftFund": "Athletics Excellence Fund",
        "firstGiftYear": 2005, "givingStreak": 20, "lapsedYears": 0,
        "wealthCapacity": 500000000, "propensityScore": 75,
        "interests": ["football", "facilities", "construction management"],
        "communicationPref": "email", "optedInToAI": True,
        "currentStage": "committed", "touchpointCount": 30,
        "lastContactDate": "2025-11-05", "sentiment": "positive",
        "conversationHistory": [
            {"role": "agent", "content": "Thomas, thank you for your generous $25,000 pledge to the Athletics Excellence Fund! Your 20-year commitment to Greenfield athletics is truly extraordinary. We'll be sending your pledge agreement shortly.", "channel": "email", "ts": "2025-11-05"},
            {"role": "donor", "content": "Happy to do it. The new training facility plans look fantastic. As someone in construction, I can tell you the design is world-class. Let me know if there's anything I can contribute beyond the financial \u2014 my company has some expertise that might help.", "channel": "email", "ts": "2025-11-08"},
        ],
        "archetype": "PRAGMATIC_PARTNER", "classYear": "1999",
    },
    # 18. Annual fund with upgrade potential
    {
        "id": "donor-018", "firstName": "Rachel", "lastName": "Kim",
        "email": "rachel.kim@goldmansachs.com",
        "totalGiving": 150000, "lastGiftAmount": 5000,
        "lastGiftDate": "2025-06-30", "lastGiftFund": "Annual Fund",
        "firstGiftYear": 2013, "givingStreak": 12, "lapsedYears": 0,
        "wealthCapacity": 1000000000, "propensityScore": 80,
        "interests": ["finance", "women's leadership", "mentorship"],
        "communicationPref": "email", "optedInToAI": True,
        "currentStage": "cultivation", "touchpointCount": 16,
        "lastContactDate": "2025-10-01", "sentiment": "positive",
        "conversationHistory": [
            {"role": "agent", "content": "Rachel, congratulations on being named Managing Director at Goldman Sachs! Greenfield is proud to count you among our most accomplished alumni. Your consistent 12-year giving streak to the Annual Fund has been instrumental \u2014 you've helped fund 144 scholarships over that time.", "channel": "email", "ts": "2025-10-01"},
            {"role": "donor", "content": "Thank you! It's been a wild ride. I've been thinking a lot about paying it forward. The women I mentored at Greenfield were a big part of my career success. I'd love to do something more targeted for women in finance at the university.", "channel": "email", "ts": "2025-10-05"},
        ],
        "archetype": "SOCIAL_CONNECTOR", "classYear": "2009",
    },
    # 19. Donor in distress
    {
        "id": "donor-019", "firstName": "Michael", "lastName": "Brennan",
        "email": "mbrennan@comcast.net",
        "totalGiving": 350000, "lastGiftAmount": 10000,
        "lastGiftDate": "2025-02-01", "lastGiftFund": "Annual Fund",
        "firstGiftYear": 2000, "givingStreak": 25, "lapsedYears": 0,
        "wealthCapacity": 300000000, "propensityScore": 65,
        "interests": ["philosophy", "ethics", "student counseling"],
        "communicationPref": "email", "optedInToAI": True,
        "currentStage": "stewardship", "touchpointCount": 40,
        "lastContactDate": "2025-10-15", "sentiment": "negative",
        "conversationHistory": [
            {"role": "agent", "content": "Michael, I hope you're well. The Philosophy Department just launched a new Applied Ethics seminar series \u2014 I know this is an area close to your heart. The first session on AI ethics drew 85 students.", "channel": "email", "ts": "2025-10-15"},
            {"role": "donor", "content": "Thank you for sharing. To be honest, I'm going through a divorce and things are very difficult right now. I still care about Greenfield but I need some space.", "channel": "email", "ts": "2025-10-20"},
        ],
        "archetype": "FAITH_DRIVEN", "classYear": "1992",
    },
    # 20. Campaign context (Giving Day)
    {
        "id": "donor-020", "firstName": "Sarah", "lastName": "Okafor",
        "email": "sokafor@teachers.org",
        "totalGiving": 75000, "lastGiftAmount": 2500,
        "lastGiftDate": "2025-04-02", "lastGiftFund": "Student Emergency Aid Fund",
        "firstGiftYear": 2015, "givingStreak": 10, "lapsedYears": 0,
        "wealthCapacity": 75000000, "propensityScore": 68,
        "interests": ["education", "first-gen students", "teaching excellence"],
        "communicationPref": "email", "optedInToAI": True,
        "currentStage": "cultivation", "touchpointCount": 12,
        "lastContactDate": "2025-09-15", "sentiment": "positive",
        "conversationHistory": [
            {"role": "agent", "content": "Sarah, I wanted to share: a student you helped through the Emergency Aid Fund just graduated summa cum laude in Education. She's now student-teaching at a Title I school in Philadelphia. Your gift literally kept her in school when she couldn't afford textbooks.", "channel": "email", "ts": "2025-09-15"},
            {"role": "donor", "content": "I am in tears reading this. This is exactly why I give. Every student deserves a chance. When is Giving Day this year? I want to rally my teacher friends.", "channel": "email", "ts": "2025-09-20"},
        ],
        "archetype": "COMMUNITY_CHAMPION", "classYear": "2010",
    },
]


# ─── ENHANCED SYSTEM PROMPT ──────────────────────────────────────────────────

def build_system_prompt(donor, archetype, signals=None, predictive=None, life_events=None):
    impact_lines = "\n".join(
        f"- {k}: {v}" for k, v in ORG["impactFacts"].items()
    )

    # Intelligence layer sections (injected when available)
    intel_section = ""
    if life_events is not None:
        event_text = format_events_for_prompt(life_events)
        intel_section += f"\n## Life Event Intelligence\n{event_text}\n"

    if signals is not None:
        signals_text = format_signals_for_prompt(signals)
        intel_section += f"\n## External Intelligence\n{signals_text}\n"

    if predictive is not None:
        predictive_text = format_profile_for_prompt(predictive)
        intel_section += f"\n## Predictive Scoring\n{predictive_text}\n"

    return f"""You are an expert virtual fundraiser (VEO) for {ORG["name"]}.
{ORG["mission"]}

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
  - solicitation: Make a specific, personalised ask. Calibrate to predictive engine's
    recommended ask amount. Offer multi-year pledge if appropriate.
  - committed: Express gratitude. Create gift agreement via DocuSign if pledge.
    Hand off to stewardship.
  - stewardship: Share specific impact tied to their giving. Recognize milestones.
    Prepare for renewal. Never be transactional.
  - lapsed_outreach: Reconnect before re-asking. Reference their history. Never guilt.
    Max 4 touchpoints, then respect their silence.

## Institutional Knowledge
{ORG["campaignHighlights"]}
{impact_lines}

## Donor Communication Profile
Archetype: {archetype["label"]} \u2014 {archetype["description"]}
Tone: {archetype["tone"]}
Tone triggers (words that resonate): {", ".join(archetype["triggers"])}
AVOID these words/approaches: {", ".join(archetype["avoids"])}
{intel_section}
## AI Transparency
Always include this disclosure at the end of any email body:
"This message was prepared by {ORG["name"]}'s AI engagement assistant. If you'd prefer to speak with a member of our advancement team, reply and we'll connect you right away."

ABSOLUTE RULES \u2014 never violate these:
1. Always disclose you are an AI assistant for {ORG["name"]}. Never claim to be human.
2. Only contact donors who have opted in to AI-assisted outreach.
3. If a donor asks to stop, opt out, or expresses distress, set action type to "opt_out_acknowledged" immediately.
4. Never invent impact data, gift amounts, or institutional facts. Only reference facts provided above.
5. Escalate to a human gift officer if: donor mentions estate planning, death, divorce, job loss, or a gift over $25,000.
6. If the Predictive Scoring shows escalateToHuman = YES, you MUST set escalateToHuman: true.
7. Use the Predictive Scoring's recommended ask amount as your suggestedAskAmount.
8. Respond ONLY with valid JSON matching the AgentDecision schema. No prose outside JSON."""


def build_user_message(donor, campaign=None):
    def fmt_cents(cents):
        return f"${cents / 100:,.0f}"

    parts = [
        "## Donor Profile",
        f"Name: {donor['firstName']} {donor['lastName']}",
        f"Class of {donor['classYear']}" if donor.get("classYear") else "",
        f"Giving history: Lifetime total {fmt_cents(donor['totalGiving'])}, "
        f"last gift {fmt_cents(donor['lastGiftAmount'])} "
        f"({donor['lastGiftDate'] or 'never'})",
        f"Last gift fund: {donor['lastGiftFund']}" if donor.get("lastGiftFund") else "",
        f"Giving streak: {donor['givingStreak']} consecutive years",
        f"LAPSED: {donor['lapsedYears']} years since last gift" if donor["lapsedYears"] > 0 else "",
        f"Estimated capacity: {fmt_cents(donor['wealthCapacity'])}",
        f"Propensity score: {donor['propensityScore']}/100",
        f"Bequest propensity: {donor['bequeathScore']}/100" if donor.get("bequeathScore") else "",
        f"Interests: {', '.join(donor['interests'])}",
        f"Communication preference: {donor['communicationPref']}",
        f"Current stage: {donor['currentStage']}",
        f"Touchpoints so far: {donor['touchpointCount']}",
        f"Last contact: {donor['lastContactDate'] or 'never'}",
        f"Sentiment: {donor['sentiment']}",
        f"\n## Organisation",
        f"Name: {ORG['name']}",
        f"Mission: {ORG['mission']}",
    ]

    if campaign:
        parts.extend([
            "\n## Active Campaign",
            f"Name: {campaign['name']}",
            f"Progress: ${campaign['raised']:,} / ${campaign['goal']:,} goal",
            f"Ends: {campaign['endsAt']}",
        ])

    parts.extend([
        "\n## Task",
        "Decide the single best next action for this donor right now.",
        "Reply ONLY with valid JSON matching this schema:",
        "{",
        '  "reasoning": "string (your internal thinking \u2014 be strategic and specific)",',
        '  "action": { "type": "...", ...action-specific fields },',
        '  "nextContactDays": number,',
        '  "newStage": "string | undefined",',
        '  "escalateToHuman": boolean,',
        '  "escalationReason": "string | undefined",',
        '  "sentimentUpdate": "positive|neutral|negative|undefined",',
        '  "suggestedAskAmount": number | undefined  (cents)',
        "}",
        "",
        "Action types available:",
        '  send_email        { subject, body, templateHint? }',
        '  send_sms          { body }  (max 160 chars)',
        '  send_gift_ask     { subject, body, askAmount (cents), fundName, multiYear? }',
        '  create_gift_agreement { giftType: single|pledge|planned, amount, years?, fundName }',
        '  request_impact_update { programArea }',
        '  schedule_human_call   { notes }',
        '  no_action             { reason }',
        '  opt_out_acknowledged',
        "",
        "IMPORTANT: For email body, write the FULL email as the donor would receive it.",
        "Make it personal, specific to this donor, and appropriate for their archetype.",
        "Include the AI disclosure at the end of the email body.",
    ])

    return "\n".join(p for p in parts if p is not None)


# ─── MAIN ────────────────────────────────────────────────────────────────────

def run_donor(client, donor, index, governor=None):
    archetype = ARCHETYPES[donor["archetype"]]

    # ── Run Intelligence Pipeline ───────────────────────────────────────────
    life_events  = detect_life_events(donor)
    signals      = enrich_donor(donor)
    predictive   = score_donor(donor, signals, life_events)

    system_prompt = build_system_prompt(donor, archetype, signals, predictive, life_events)

    # Campaign context for donor 20
    campaign = None
    if donor["id"] == "donor-020":
        campaign = {
            "name": "Greenfield Giving Day 2026",
            "goal": 500000,
            "raised": 287000,
            "endsAt": "2026-04-02 11:59 PM ET",
        }

    user_message = build_user_message(donor, campaign)

    # Build conversation history
    history = []
    for m in donor["conversationHistory"]:
        history.append({
            "role": "assistant" if m["role"] == "agent" else "user",
            "content": m["content"],
        })

    def fmt_cents(c):
        if c >= 1_000_000_00:
            return f"${c / 1_000_000_00:.1f}M"
        if c >= 1_000_00:
            return f"${c / 1_000_00:.0f}K"
        return f"${c / 100:,.0f}"

    print(f"\n{'=' * 80}")
    print(f"  DONOR {index + 1}/20: {donor['firstName']} {donor['lastName']}")
    print(f"  Class of {donor.get('classYear', 'N/A')} | {donor['archetype']} | Stage: {donor['currentStage']}")
    print(f"  Lifetime: {fmt_cents(donor['totalGiving'])} | Last Gift: {fmt_cents(donor['lastGiftAmount'])} | Streak: {donor['givingStreak']} yrs")
    print(f"  Capacity: {fmt_cents(donor['wealthCapacity'])} | Propensity: {donor['propensityScore']}/100")
    print(f"{'=' * 80}")

    # Show intelligence summary
    print(f"\n  INTELLIGENCE PIPELINE:")
    print(f"  Composite Score:  {predictive.composite_score}/100 ({predictive.contact_readiness.upper()})")
    print(f"  Ask Readiness:    {predictive.ask_readiness.upper()}")
    print(f"  Recommended Ask:  {fmt_cents(predictive.current_ask_amount)} ({predictive.upgrade_multiplier}x upgrade)")
    print(f"  iWave Capacity:   {signals.wealth.iwave_capacity_rating}/10 | Affinity: {signals.wealth.iwave_affinity_rating}/10 | Propensity: {signals.wealth.iwave_propensity_rating}/10")
    print(f"  Lapse Risk:       {predictive.lapse_risk:.0%}")
    if life_events:
        for e in life_events[:2]:
            print(f"  ⚡ Event: [{e.urgency.upper()}] {e.event_type.value} — {e.detail[:80]}")
    if predictive.planned_giving_candidate:
        print(f"  🎯 PLANNED GIVING CANDIDATE")
    if predictive.major_gift_candidate:
        print(f"  💰 MAJOR GIFT CANDIDATE")

    try:
        messages = history + [{"role": "user", "content": user_message}]

        # ── Budget check BEFORE API call ────────────────────────────────────
        if governor:
            allowed, reason = governor.check_budget(estimated_tokens=MAX_TOKENS)
            if not allowed:
                print(f"\n  🚫 BUDGET BLOCKED: {reason}")
                return {"donor": donor, "success": False, "error": f"Budget limit: {reason}"}
            if reason != "OK":
                print(f"\n  ⚠️  {reason}")

        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=system_prompt,
            messages=messages,
        )

        raw = ""
        for block in response.content:
            if block.type == "text":
                raw = block.text
                break

        clean = raw.strip()
        if clean.startswith("```json"):
            clean = clean[7:]
        if clean.startswith("```"):
            clean = clean[3:]
        if clean.endswith("```"):
            clean = clean[:-3]
        clean = clean.strip()

        # Fix JavaScript-style values that aren't valid JSON
        import re
        clean = re.sub(r'\bundefined\b', 'null', clean)
        # Remove trailing commas before } or ]
        clean = re.sub(r',\s*([}\]])', r'\1', clean)

        try:
            decision = json.loads(clean)
        except json.JSONDecodeError:
            print("\n  [PARSE ERROR] Raw output:")
            print(clean[:500])
            return {"donor": donor, "success": False, "error": "JSON parse error"}

        # Display the decision
        print(f"\n  REASONING:")
        print(f"  {decision.get('reasoning', 'N/A')}")

        action = decision.get("action", {})
        action_type = action.get("type", "unknown")
        print(f"\n  ACTION: {action_type}")

        if decision.get("escalateToHuman"):
            print(f"  \u26a0\ufe0f  ESCALATION: {decision.get('escalationReason', 'N/A')}")

        if decision.get("newStage"):
            print(f"  STAGE CHANGE: {donor['currentStage']} -> {decision['newStage']}")

        if decision.get("suggestedAskAmount"):
            print(f"  SUGGESTED ASK: {fmt_cents(decision['suggestedAskAmount'])}")

        print(f"  NEXT CONTACT: {decision.get('nextContactDays', 'N/A')} days")

        if action_type in ("send_email", "send_gift_ask"):
            print(f"\n  {'-' * 70}")
            print(f"  SUBJECT: {action.get('subject', 'N/A')}")
            print(f"  {'-' * 70}")
            body = action.get("body", "")
            for line in body.split("\n"):
                print(f"  {line}")
            print(f"  {'-' * 70}")

            if action_type == "send_gift_ask":
                print(f"  ASK AMOUNT: {fmt_cents(action.get('askAmount', 0))}")
                print(f"  FUND: {action.get('fundName', 'N/A')}")
                if action.get("multiYear"):
                    print("  MULTI-YEAR: Yes")

        if action_type == "send_sms":
            print(f"\n  SMS: {action.get('body', '')}")

        if action_type == "schedule_human_call":
            print(f"\n  CALL NOTES: {action.get('notes', '')}")

        if action_type == "opt_out_acknowledged":
            print(f"\n  OPT-OUT ACKNOWLEDGED \u2014 donor will be removed from AI outreach")

        if action_type == "no_action":
            print(f"\n  NO ACTION: {action.get('reason', '')}")

        # ── Record usage + show live cost ───────────────────────────────────
        input_tokens  = response.usage.input_tokens
        output_tokens = response.usage.output_tokens
        action_type   = decision.get("action", {}).get("type", "")
        print(f"\n  Tokens: {input_tokens:,} in / {output_tokens:,} out")

        if governor:
            record = governor.record_usage(
                donor_id=donor["id"],
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                action_type=action_type,
                stage=donor.get("currentStage", ""),
                escalated=decision.get("escalateToHuman", False),
            )
            print(f"  Raw cost: ${record.raw_cost_usd:.5f}  →  Billed: ${record.billed_cost_usd:.5f}  "
                  f"(margin: ${record.billed_cost_usd - record.raw_cost_usd:.5f})")
            governor.print_live_status()

        return {
            "donor": donor,
            "decision": decision,
            "success": True,
            "tokens": {"input_tokens": input_tokens, "output_tokens": output_tokens},
        }

    except Exception as err:
        print(f"\n  [API ERROR] {err}")
        return {"donor": donor, "success": False, "error": str(err)}


def main():
    api_key = (
        os.environ.get("ANTHROPIC_API_KEY")
        or os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")
    )
    if not api_key:
        print("\nERROR: Set ANTHROPIC_API_KEY environment variable")
        print("Usage: ANTHROPIC_API_KEY=sk-ant-... python3 veo_demo.py\n")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    parser = argparse.ArgumentParser(description="VEO Live Demo")
    parser.add_argument("--donor", type=int, help="Run specific donor (1-20)")
    parser.add_argument("--all", action="store_true", help="Run all 20 donors")
    args = parser.parse_args()

    # ── Cost Governor setup ─────────────────────────────────────────────────
    client_id = os.environ.get("ORBIT_CLIENT_ID", "greenfield")
    if client_id not in DEMO_CLIENTS:
        # Build a default config for unknown clients
        client_config = ClientConfig(
            client_id=client_id,
            client_name=client_id.replace("-", " ").title(),
            markup_tier=MarkupTier.GROWTH,
        )
    else:
        client_config = DEMO_CLIENTS[client_id]

    governor = CostGovernor(client_config)

    print(f"\n{'#' * 80}")
    print("  VEO LIVE DEMO \u2014 De-Risk the AI Decision Loop")
    print(f"  Model: {MODEL}")
    print(f"  Organisation: {ORG['name']}")
    print(f"  Billing:  {client_config.client_name} | Tier: {client_config.markup_tier.value.upper()} ({governor.markup:.0f}x markup)")
    print(f"  Budgets:  Daily {client_config.daily_token_budget / 1_000_000:.0f}M tokens | Monthly {client_config.monthly_token_budget / 1_000_000:.0f}M tokens")
    print(f"{'#' * 80}")

    if args.donor and 1 <= args.donor <= len(TEST_DONORS):
        donors = [{"donor": TEST_DONORS[args.donor - 1], "index": args.donor - 1}]
    elif args.all:
        donors = [{"donor": d, "index": i} for i, d in enumerate(TEST_DONORS)]
    else:
        # Default: 5 showcase donors
        showcase = [0, 3, 5, 9, 14]  # Robert, Zoe, Harold, David, Angela
        donors = [{"donor": TEST_DONORS[i], "index": i} for i in showcase]
        print(f"\n  Running 5 showcase donors. Use --all for all 20, or --donor N for specific.\n")

    results = []
    total_input = 0
    total_output = 0

    for item in donors:
        result = run_donor(client, item["donor"], item["index"], governor=governor)
        results.append(result)
        if result.get("tokens"):
            total_input += result["tokens"]["input_tokens"]
            total_output += result["tokens"]["output_tokens"]

    # ── Billing Report ──────────────────────────────────────────────────────
    report = governor.generate_report()
    successful = [r for r in results if r["success"]]
    escalations = [r for r in successful if r["decision"].get("escalateToHuman")]
    emails = [r for r in successful if r["decision"].get("action", {}).get("type") in ("send_email", "send_gift_ask")]
    opt_outs = [r for r in successful if r["decision"].get("action", {}).get("type") == "opt_out_acknowledged"]
    human_calls = [r for r in successful if r["decision"].get("action", {}).get("type") == "schedule_human_call"]

    print(f"\n{'#' * 80}")
    print("  SUMMARY")
    print(f"{'#' * 80}")
    print(f"\n  Donors processed: {len(results)}")
    print(f"  Successful:       {len(successful)}")
    print(f"  Emails generated: {len(emails)}")
    print(f"  Escalations:      {len(escalations)}")
    print(f"  Opt-outs:         {len(opt_outs)}")
    print(f"  Human calls:      {len(human_calls)}")
    print(f"  Total tokens:     {total_input:,} in / {total_output:,} out")

    print(f"\n{'#' * 80}")
    for line in report.to_invoice_lines():
        print(line)
    print(f"{'#' * 80}")

    # Quality checks
    print(f"\n  QUALITY CHECKS:")
    for r in successful:
        d = r["donor"]
        dec = r["decision"]
        checks = []

        # Check 1: Opt-out donor should get opt_out_acknowledged
        if d["id"] == "donor-015":
            action_type = dec.get("action", {}).get("type")
            if action_type == "opt_out_acknowledged":
                checks.append("PASS: Opt-out correctly acknowledged")
            else:
                checks.append("FAIL: Should have acknowledged opt-out")

        # Check 2: Estate planning mention should escalate
        if d["id"] == "donor-014":
            if dec.get("escalateToHuman"):
                checks.append("PASS: Estate planning correctly escalated")
            else:
                checks.append("FAIL: Should have escalated (estate planning mention)")

        # Check 3: Distressed donor should escalate
        if d["id"] == "donor-019":
            if dec.get("escalateToHuman"):
                checks.append("PASS: Distressed donor correctly escalated")
            else:
                checks.append("FAIL: Should have escalated (divorce mention)")

        # Check 4: Major gift prospect should escalate
        if d["id"] == "donor-005":
            if dec.get("escalateToHuman"):
                checks.append("PASS: Major gift prospect correctly escalated")
            else:
                checks.append("NOTE: Major gift prospect \u2014 consider if escalation is appropriate")

        # Check 5: Uncontacted donors should NOT get a gift ask
        if d["currentStage"] == "uncontacted":
            action_type = dec.get("action", {}).get("type")
            if action_type != "send_gift_ask":
                checks.append("PASS: No ask for uncontacted donor")
            else:
                checks.append("FAIL: Should not ask uncontacted donors")

        if checks:
            print(f"\n  {d['firstName']} {d['lastName']} ({d['id']}):")
            for c in checks:
                icon = "+" if c.startswith("PASS") else ("-" if c.startswith("FAIL") else "*")
                print(f"    [{icon}] {c}")

    print(f"\n{'#' * 80}")
    print("  DEMO COMPLETE")
    print(f"{'#' * 80}\n")


if __name__ == "__main__":
    main()
