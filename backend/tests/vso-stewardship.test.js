/**
 * VSO Stewardship Engine Tests
 * Test the POST /api/agents/vso/run endpoint
 */

const stewEngine = require('../services/stewardship-engine');

// ─── TEST DONOR OBJECTS ───────────────────────────────────────────────────────

const testDonors = [
  {
    // Annual donor needing renewal
    id: 'test-001',
    firstName: 'Robert',
    lastName: 'Chen',
    email: 'rchen@email.com',
    archetype: 'LOYAL_ALUMNI',
    journeyStage: 'stewardship',
    lastGiftCents: 50000,        // $500
    totalGiving: 11200,           // $11,200 lifetime
    givingStreak: 22,
    daysSinceLastGift: 340,
    daysSinceLastContact: 95,
    bequeathScore: 55,
    upgradeReady: false,
  },
  {
    // Mid-level donor, just gifted, upgrade eligible
    id: 'test-002',
    firstName: 'Patricia',
    lastName: 'Okafor',
    email: 'pokafor@techfirm.com',
    archetype: 'IMPACT_INVESTOR',
    journeyStage: 'stewardship',
    lastGiftCents: 500000,       // $5,000
    totalGiving: 52000,           // $52,000 lifetime
    givingStreak: 10,
    daysSinceLastGift: 2,         // Just gave!
    daysSinceLastContact: 2,
    bequeathScore: 40,
    upgradeReady: true,
  },
  {
    // Leadership tier donor with high bequest score
    id: 'test-003',
    firstName: 'Margaret',
    lastName: 'Holloway',
    email: 'mholloway@retired.net',
    archetype: 'FAITH_DRIVEN',
    journeyStage: 'stewardship',
    lastGiftCents: 300000,       // $3,000
    totalGiving: 48500,           // $48,500 lifetime
    givingStreak: 15,
    daysSinceLastGift: 280,
    daysSinceLastContact: 120,
    bequeathScore: 82,            // HIGH — should trigger estate seed
    upgradeReady: false,
  },
  {
    // Lapsed major donor
    id: 'test-004',
    firstName: 'Sandra',
    lastName: 'Reinholt',
    email: 'srein@globalcorp.com',
    archetype: 'PRAGMATIC_PARTNER',
    journeyStage: 'lapsed_outreach',
    lastGiftCents: 2500000,      // $25,000 last gift
    totalGiving: 87000,           // $87,000 lifetime
    givingStreak: 0,              // Lapsed
    daysSinceLastGift: 540,
    daysSinceLastContact: 540,
    bequeathScore: 35,
    upgradeReady: false,
  },
  {
    // First-time young donor
    id: 'test-005',
    firstName: 'Zoe',
    lastName: 'Martinez',
    email: 'zmartinez@startup.io',
    archetype: 'MISSION_ZEALOT',
    journeyStage: 'stewardship',
    lastGiftCents: 5000,         // $50
    totalGiving: 50,              // $50 lifetime (first gift)
    givingStreak: 1,
    daysSinceLastGift: 2,         // Just gave!
    daysSinceLastContact: 2,
    bequeathScore: 5,
    upgradeReady: false,
  },
];

// ─── RUN TESTS ────────────────────────────────────────────────────────────────

function runTests() {
  console.log('\n' + '═'.repeat(70));
  console.log('  VSO STEWARDSHIP ENGINE TESTS');
  console.log('═'.repeat(70));

  testDonors.forEach((donor, idx) => {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`TEST ${idx + 1}: ${donor.firstName} ${donor.lastName}`);
    console.log(`${'─'.repeat(70)}`);
    console.log(`Archetype: ${donor.archetype}`);
    console.log(`Total Giving: $${donor.totalGiving.toLocaleString()}`);
    console.log(`Last Gift: $${(donor.lastGiftCents / 100).toLocaleString()}`);
    console.log(`Streak: ${donor.givingStreak} years`);
    console.log(`Days Since Last Gift: ${donor.daysSinceLastGift}`);
    console.log(`Days Since Last Contact: ${donor.daysSinceLastContact}`);

    // Compute decision
    const decision = stewEngine.decideStewAction(donor, {
      days_since_last_gift: donor.daysSinceLastGift,
      days_since_last_contact: donor.daysSinceLastContact,
    });

    // Print results
    console.log(`\n📋 DECISION:`);
    console.log(`  Action: ${decision.action}`);
    console.log(`  Tier: ${decision.tier}`);
    console.log(`  Urgency: ${decision.urgency}`);
    console.log(`  Channel: ${decision.channel}`);
    console.log(`  Tone: ${decision.tone}`);
    console.log(`  CTA: ${decision.cta}`);
    if (decision.ask_amount_cents > 0) {
      console.log(`  Ask Amount: $${(decision.ask_amount_cents / 100).toLocaleString()}`);
    }
    if (decision.escalate_to_human) {
      console.log(`  ⚠️  ESCALATE TO HUMAN`);
    }
    if (decision.hold_days > 0) {
      console.log(`  🔴 HOLD: ${decision.hold_days} days`);
    }
    console.log(`\n  Rationale: ${decision.rationale}`);

    // Content themes
    if (decision.content_themes.length > 0) {
      console.log(`\n  Content Themes:`);
      decision.content_themes.forEach(theme => {
        if (theme) console.log(`    • ${theme}`);
      });
    }
  });

  console.log('\n' + '═'.repeat(70));
  console.log('  TESTS COMPLETE');
  console.log('═'.repeat(70) + '\n');
}

// ─── DEMO: JSON REQUEST/RESPONSE FORMAT ─────────────────────────────────────

function demoRequestFormat() {
  console.log('\n' + '═'.repeat(70));
  console.log('  POST /api/agents/vso/run — REQUEST/RESPONSE FORMAT');
  console.log('═'.repeat(70));

  const exampleDonor = testDonors[0];

  console.log('\n📤 REQUEST BODY:');
  console.log(JSON.stringify(exampleDonor, null, 2));

  const decision = stewEngine.decideStewAction(exampleDonor, {
    days_since_last_gift: exampleDonor.daysSinceLastGift,
    days_since_last_contact: exampleDonor.daysSinceLastContact,
  });

  const responseBody = {
    donor: {
      id: exampleDonor.id,
      name: `${exampleDonor.firstName} ${exampleDonor.lastName}`,
      archetype: exampleDonor.archetype,
      stage: exampleDonor.journeyStage,
      totalGiving: exampleDonor.totalGiving,
      givingStreak: exampleDonor.givingStreak,
    },
    decision: {
      action: decision.action,
      tier: decision.tier,
      urgency: decision.urgency,
      channel: decision.channel,
      tone: decision.tone,
      content_themes: decision.content_themes,
      cta: decision.cta,
      ask_amount_cents: decision.ask_amount_cents,
      escalate_to_human: decision.escalate_to_human,
      hold_days: decision.hold_days,
      rationale: decision.rationale,
    },
    prompt_formatted: stewEngine.formatDecisionForPrompt(decision),
  };

  console.log('\n📥 RESPONSE BODY:');
  console.log(JSON.stringify(responseBody, null, 2));

  console.log('\n' + '═'.repeat(70) + '\n');
}

// ─── ENTRY POINT ──────────────────────────────────────────────────────────────

if (require.main === module) {
  runTests();
  demoRequestFormat();
}

module.exports = { testDonors, stewEngine };
