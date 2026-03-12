/**
 * ============================================================================
 * ORBIT NAVIGATION ARCHITECTURE v2.0
 * ============================================================================
 *
 * Redesign: 27 items -> 8 primary nav items
 * Principle: Group by USER INTENT, not technical category
 * Pattern: Slim icon rail (Option A from nav mockup) with tab-based sub-pages
 *
 * Questions this nav answers in the first 5 seconds:
 *   "What should I do right now?"        -> Home (role-aware briefing)
 *   "Who should I talk to?"              -> Donors
 *   "What should I say to them?"         -> Outreach
 *   "How are my campaigns performing?"   -> Campaigns
 *   "What is AI doing on my behalf?"     -> Agents
 *   "What does the data tell me?"        -> Reports
 *   "How do I accept gifts?"             -> Giving
 *   "How do I configure the system?"     -> Settings (admin-gated)
 *
 * ============================================================================
 */


// ============================================================================
// 1. PRIMARY NAVIGATION ARRAY (8 items, down from 27)
// ============================================================================

const NAV_PRIMARY = [
  {
    key: 'home',
    label: 'Home',
    icon: 'Home',        // Lucide icon name
    path: '/home',
    description: 'Role-aware briefing with today\'s priorities',
    // Visible to ALL roles. This is the default landing page.
    roles: ['admin', 'manager', 'staff'],
  },
  {
    key: 'donors',
    label: 'Donors',
    icon: 'Users',
    path: '/donors',
    description: 'Donor profiles, portfolios, prospect discovery, and pipeline',
    roles: ['admin', 'manager', 'staff'],
  },
  {
    key: 'outreach',
    label: 'Outreach',
    icon: 'Send',
    path: '/outreach',
    description: 'All communication channels: email, SMS, phone, social, direct mail',
    roles: ['admin', 'manager', 'staff'],
    badge: { type: 'count', source: 'outreach.pending' }, // e.g., "12"
  },
  {
    key: 'campaigns',
    label: 'Campaigns',
    icon: 'Target',
    path: '/campaigns',
    description: 'Campaign management, giving days, pledges, and matching gifts',
    roles: ['admin', 'manager'],
  },
  {
    key: 'giving',
    label: 'Giving',
    icon: 'Heart',
    path: '/giving',
    description: 'Gift pipeline, giving forms, pledge management, matching gifts',
    roles: ['admin', 'manager', 'staff'],
  },
  {
    key: 'agents',
    label: 'Agents',
    icon: 'Bot',
    path: '/agents',
    description: 'AI agent fleet: VEO, VSO, VPGO, VCO status and configuration',
    roles: ['admin', 'manager'],
    badge: { type: 'live', label: 'LIVE' },
  },
  {
    key: 'reports',
    label: 'Reports',
    icon: 'BarChart3',
    path: '/reports',
    description: 'Analytics, dashboards, and data exports',
    roles: ['admin', 'manager', 'staff'],
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: 'Settings',
    path: '/settings',
    description: 'Users, integrations, billing, compliance, agent config',
    // Settings is always at the BOTTOM of the rail, visually separated.
    // Admin-only items are tab-gated inside the page, not hidden from nav.
    roles: ['admin', 'manager', 'staff'],
    position: 'footer', // Renders in rail footer section, not main nav
  },
];


// ============================================================================
// 2. COMPLETE PAGE MAPPING: Where every current page lives
//    NOTHING IS DELETED. Every page is nested as a tab or panel.
// ============================================================================

const PAGE_MAPPING = {
  // ─── HOME (formerly: Dashboard, Officer Intel) ─────────────────────
  home: {
    absorbs: ['overview', 'officer'],
    tabs: [
      { key: 'briefing',  label: 'Today\'s Briefing',  formerPage: 'overview' },
      { key: 'intel',     label: 'Officer Intel',       formerPage: 'officer' },
    ],
    notes: `
      The old "Dashboard" and "Officer Intel" merge into a single role-aware
      home screen. The briefing tab is the default — it shows a personalized
      action feed based on the user's role (see ROLE_LANDING below).
      Officer Intel becomes a tab that surfaces AI-generated portfolio insights.
    `,
  },

  // ─── DONORS (formerly: Donor Portfolios, Prospect Discovery, Ask Engine) ─
  donors: {
    absorbs: ['donors', 'prospects', 'askengine'],
    tabs: [
      { key: 'portfolio',  label: 'My Portfolio',         formerPage: 'donors' },
      { key: 'all',        label: 'All Donors',           formerPage: 'donors' },
      { key: 'discover',   label: 'Prospect Discovery',   formerPage: 'prospects', badge: 'AI' },
      { key: 'ask',        label: 'Ask Engine',            formerPage: 'askengine', badge: 'ML' },
      { key: 'signals',    label: 'Signals',               formerPage: 'signals',   badge: 'AI' },
    ],
    notes: `
      "Who should I talk to?" is the intent. The donor page is the primary
      workspace for gift officers. Prospect Discovery and Ask Engine are
      AI-powered tools that FIND donors — they belong with donors, not in
      an "AI Tools" junk drawer. Signal Intelligence surfaces donor behavior
      signals — it's donor context, not a separate tool.
    `,
  },

  // ─── OUTREACH (formerly: Outreach Center, Email Templates, SMS Engine,
  //     Phone Dialer, Social Comms) ───────────────────────────────────────
  outreach: {
    absorbs: ['outreach', 'emailtemplates', 'sms', 'phonedialer', 'socialcomms'],
    tabs: [
      { key: 'inbox',      label: 'Activity Feed',        formerPage: 'outreach' },
      { key: 'email',      label: 'Email',                formerPage: 'emailtemplates' },
      { key: 'sms',        label: 'SMS',                  formerPage: 'sms' },
      { key: 'phone',      label: 'Phone',                formerPage: 'phonedialer' },
      { key: 'social',     label: 'Social',               formerPage: 'socialcomms' },
    ],
    notes: `
      "What should I say to them?" — all communication channels in one place.
      The old Outreach Center becomes the activity feed (pending approvals,
      sent history, scheduled messages). Each channel gets a tab for template
      management and configuration. This eliminates 5 separate nav items that
      all answer the same user question.
    `,
  },

  // ─── CAMPAIGNS (formerly: Campaigns [both instances], Giving Day Live) ─
  campaigns: {
    absorbs: ['campaigns', 'givingday'],
    tabs: [
      { key: 'active',     label: 'Active Campaigns',     formerPage: 'campaigns' },
      { key: 'builder',    label: 'Campaign Builder',      formerPage: 'campaigns' },
      { key: 'givingday',  label: 'Giving Day',            formerPage: 'givingday', badge: 'LIVE' },
    ],
    notes: `
      Eliminates the duplicate "Campaigns" nav item. Giving Day is a campaign
      type, not a separate concept. When a Giving Day is active, its tab gets
      a pulsing LIVE badge and auto-surfaces in the Home briefing.
    `,
  },

  // ─── GIVING (formerly: Gift Pipeline, Giving Forms, Pledges, Matching) ─
  giving: {
    absorbs: ['gifts', 'givingform', 'pledges', 'matching'],
    tabs: [
      { key: 'pipeline',   label: 'Gift Pipeline',        formerPage: 'gifts' },
      { key: 'forms',      label: 'Giving Forms',         formerPage: 'givingform' },
      { key: 'pledges',    label: 'Pledges',              formerPage: 'pledges' },
      { key: 'matching',   label: 'Matching Gifts',       formerPage: 'matching' },
    ],
    notes: `
      "How do I accept and manage gifts?" — the financial side of fundraising.
      Gift Pipeline is the default tab showing active opportunities. Giving
      Forms, Pledges, and Matching are operational tools that support the
      gift lifecycle. These were scattered across "Donors & Gifts", "AI Tools"
      (Giving Forms), and "Campaigns & Events" (Pledges, Matching).
    `,
  },

  // ─── AGENTS (formerly: Agent Console, Agent Config) ───────────────────
  agents: {
    absorbs: ['agents', 'settings'],
    tabs: [
      { key: 'overview',   label: 'Fleet Overview',       formerPage: 'agents' },
      { key: 'veo',        label: 'Aria (VEO)',           formerPage: 'agents' },
      { key: 'vso',        label: 'Marcus (VSO)',         formerPage: 'agents' },
      { key: 'vpgo',       label: 'Eleanor (VPGO)',       formerPage: 'agents' },
      { key: 'vco',        label: 'Dev (VCO)',            formerPage: 'agents' },
      { key: 'config',     label: 'Agent Config',         formerPage: 'settings' },
    ],
    notes: `
      The Agent Console and Agent Config were split across "Command Center"
      and "Settings". They belong together. Config is a tab within the agent
      page because the people who manage agents are the ones who configure
      them. Individual agent tabs match the existing orbit-agents.html pattern.
    `,
  },

  // ─── REPORTS (formerly: Analytics, Integrations) ──────────────────────
  reports: {
    absorbs: ['analytics', 'integrations'],
    tabs: [
      { key: 'dashboard',  label: 'Dashboard',            formerPage: 'analytics' },
      { key: 'giving',     label: 'Giving Analytics',     formerPage: 'analytics' },
      { key: 'retention',  label: 'Retention',            formerPage: 'analytics' },
      { key: 'campaigns',  label: 'Campaign Reports',     formerPage: 'analytics' },
      { key: 'agents',     label: 'Agent Performance',    formerPage: 'analytics' },
    ],
    notes: `
      Analytics is the only former page here. The tab structure breaks the
      monolithic analytics page into focused report views. Integrations moves
      to Settings (where users expect system configuration).
    `,
  },

  // ─── SETTINGS (formerly: Users & Roles, Onboarding, Billing, Compliance,
  //     Integrations, Sales Pitch Mode) ──────────────────────────────────
  settings: {
    absorbs: ['users', 'onboarding', 'billing', 'compliance', 'integrations', 'pitch'],
    tabs: [
      { key: 'general',       label: 'General',           formerPage: null },
      { key: 'users',         label: 'Users & Roles',     formerPage: 'users',         adminOnly: true },
      { key: 'integrations',  label: 'Integrations',      formerPage: 'integrations' },
      { key: 'billing',       label: 'Billing',           formerPage: 'billing',       adminOnly: true },
      { key: 'compliance',    label: 'Compliance',        formerPage: 'compliance',    adminOnly: true },
      { key: 'onboarding',    label: 'Onboarding',        formerPage: 'onboarding',    adminOnly: true },
      { key: 'pitch',         label: 'Demo Mode',         formerPage: 'pitch',         adminOnly: true },
    ],
    notes: `
      All admin/config pages consolidate here. Non-admin users see only
      "General" and "Integrations" tabs. Admin-only tabs are hidden from
      non-admin users via the adminOnly flag. Sales Pitch Mode becomes
      "Demo Mode" — an admin-only tool for sales demonstrations.
      Integrations moves here from Reports because it's system config,
      not reporting.
    `,
  },
};


// ============================================================================
// 3. VERIFICATION: Every original page is accounted for
// ============================================================================

const ORIGINAL_PAGES = [
  'overview',         // -> home.briefing
  'officer',          // -> home.intel
  'agents',           // -> agents.overview + agents.veo/vso/vpgo/vco
  'donors',           // -> donors.portfolio + donors.all
  'gifts',            // -> giving.pipeline
  'campaigns',        // -> campaigns.active + campaigns.builder
  'outreach',         // -> outreach.inbox
  'analytics',        // -> reports.dashboard/giving/retention/campaigns/agents
  'integrations',     // -> settings.integrations
  'prospects',        // -> donors.discover
  'askengine',        // -> donors.ask
  'givingform',       // -> giving.forms
  'pledges',          // -> giving.pledges
  'matching',         // -> giving.matching
  'phonedialer',      // -> outreach.phone
  'emailtemplates',   // -> outreach.email
  'givingday',        // -> campaigns.givingday
  'sms',              // -> outreach.sms
  'signals',          // -> donors.signals
  'socialcomms',      // -> outreach.social
  'users',            // -> settings.users
  'onboarding',       // -> settings.onboarding
  'billing',          // -> settings.billing
  'compliance',       // -> settings.compliance
  'settings',         // -> agents.config (agent config)
  'pitch',            // -> settings.pitch
];
// Total: 26 unique pages (campaigns appeared twice in old nav = 27 items, 26 unique)
// All 26 are mapped. Zero pages deleted.


// ============================================================================
// 4. ROLE-AWARE LANDING EXPERIENCE
// ============================================================================

/**
 * When a user logs in, they land on /home but the HOME page renders a
 * role-specific briefing. This is NOT a redirect — the home page itself
 * is polymorphic based on the user's role.
 */
const ROLE_LANDING = {
  // ─── Sarah: Major Gift Officer ─────────────────────────────────────
  // Intent: "Who should I contact today and what should I know about them?"
  mgo: {
    persona: 'Sarah — Major Gift Officer',
    landingTab: 'home.briefing',
    briefingModules: [
      {
        id: 'todays-contacts',
        title: 'Today\'s Priority Contacts',
        description: 'AI-ranked list of donors requiring attention today',
        source: 'agent_decisions WHERE action_type IN (call, visit, email) AND scheduled_for = TODAY',
        position: 'primary',   // Large card, top of page
        actions: ['View Briefing', 'Start Outreach', 'Snooze'],
      },
      {
        id: 'portfolio-alerts',
        title: 'Portfolio Alerts',
        description: 'Wealth signals, lapse risks, and milestone events for assigned donors',
        source: 'donors WHERE assigned_to = current_user AND has_active_signal = true',
        position: 'primary',
      },
      {
        id: 'gift-pipeline',
        title: 'My Pipeline',
        description: 'Active gift opportunities and stage progression',
        source: 'gifts WHERE assigned_to = current_user AND status = active',
        position: 'secondary', // Smaller card, below primary
      },
      {
        id: 'agent-activity',
        title: 'Agent Activity',
        description: 'What VEO/VSO did overnight for your donors',
        source: 'agent_decisions WHERE donor_id IN (assigned_donors) AND created_at > yesterday',
        position: 'sidebar',   // Right sidebar panel
      },
    ],
  },

  // ─── Marcus: Annual Giving Director ────────────────────────────────
  // Intent: "How are my campaigns performing and what needs my attention?"
  annual_giving: {
    persona: 'Marcus — Annual Giving Director',
    landingTab: 'home.briefing',
    briefingModules: [
      {
        id: 'campaign-performance',
        title: 'Campaign Performance',
        description: 'Active campaigns with real-time giving totals and participation rates',
        source: 'campaigns WHERE status = active',
        position: 'primary',
        actions: ['View Campaign', 'Send Blast', 'Adjust Goal'],
      },
      {
        id: 'lybunt-sybunt',
        title: 'Lapsed Donor Recovery',
        description: 'LYBUNT/SYBUNT counts with AI reactivation progress',
        source: 'donors WHERE stage IN (lapsed_outreach) AND campaign_eligible = true',
        position: 'primary',
      },
      {
        id: 'outreach-queue',
        title: 'Pending Approvals',
        description: 'AI-drafted messages awaiting your review before send',
        source: 'outreach WHERE status = pending_approval AND campaign_id IS NOT NULL',
        position: 'secondary',
        actions: ['Approve All', 'Review'],
      },
      {
        id: 'giving-day-status',
        title: 'Giving Day Status',
        description: 'Live thermometer if a Giving Day is active; upcoming dates if not',
        source: 'campaigns WHERE type = giving_day',
        position: 'sidebar',
        conditionalDisplay: true, // Only shows when a giving day is upcoming or live
      },
    ],
  },

  // ─── Dani: CRM Admin ──────────────────────────────────────────────
  // Intent: "Is the system healthy? Are integrations working? Any errors?"
  crm_admin: {
    persona: 'Dani — CRM Administrator',
    landingTab: 'home.briefing',
    briefingModules: [
      {
        id: 'system-health',
        title: 'System Health',
        description: 'Integration status, sync errors, queue depth',
        source: 'integrations.status + worker_queues.depth',
        position: 'primary',
        actions: ['View Errors', 'Force Sync', 'Queue Dashboard'],
      },
      {
        id: 'agent-fleet',
        title: 'Agent Fleet Status',
        description: 'All 4 agents: active assignments, error rate, throughput',
        source: 'agents.aggregate_stats',
        position: 'primary',
      },
      {
        id: 'audit-recent',
        title: 'Recent Audit Log',
        description: 'Last 24 hours of system-level events',
        source: 'audit_logs WHERE created_at > NOW() - 24h ORDER BY created_at DESC LIMIT 20',
        position: 'secondary',
      },
      {
        id: 'user-activity',
        title: 'User Activity',
        description: 'Active sessions, recent logins, failed auth attempts',
        source: 'audit_logs WHERE event_type IN (login, failed_login)',
        position: 'sidebar',
      },
    ],
  },

  // ─── Priya: Stewardship Officer ───────────────────────────────────
  // Intent: "Which donors need acknowledgment? Are impact reports going out?"
  stewardship: {
    persona: 'Priya — Stewardship Officer',
    landingTab: 'home.briefing',
    briefingModules: [
      {
        id: 'ack-queue',
        title: 'Acknowledgment Queue',
        description: 'Gifts received in last 48 hours needing thank-you',
        source: 'gifts WHERE acknowledged_at IS NULL AND created_at > NOW() - 48h',
        position: 'primary',
        actions: ['Send Acknowledgment', 'View Gift', 'Mark Complete'],
      },
      {
        id: 'stewardship-calendar',
        title: 'Stewardship Calendar',
        description: 'Upcoming donor milestones, anniversaries, and impact report deadlines',
        source: 'donor_milestones WHERE due_date BETWEEN NOW() AND NOW() + 30d',
        position: 'primary',
      },
      {
        id: 'vso-activity',
        title: 'VSO Activity',
        description: 'What the Virtual Stewardship Officer sent on your behalf',
        source: 'agent_decisions WHERE agent_type = VSO AND created_at > yesterday',
        position: 'secondary',
      },
      {
        id: 'sentiment-alerts',
        title: 'Sentiment Alerts',
        description: 'Donors whose sentiment score dropped or who expressed concerns',
        source: 'donors WHERE sentiment_delta < -10 AND last_assessed > NOW() - 7d',
        position: 'sidebar',
      },
    ],
  },
};


// ============================================================================
// 5. TAB/PANEL STRUCTURE FOR EACH CONSOLIDATED PAGE
// ============================================================================

/**
 * Each primary nav item expands into tabs rendered as a horizontal tab bar
 * at the top of the content area (matching the existing orbit-comms-v2.html
 * tab pattern). Some tabs have secondary panel layouts within them.
 */

const PAGE_STRUCTURES = {

  // ─── HOME ──────────────────────────────────────────────────────────
  home: {
    defaultTab: 'briefing',
    tabs: [
      {
        key: 'briefing',
        label: 'Today\'s Briefing',
        layout: 'dashboard',  // KPI cards + action feed + sidebar
        description: 'Role-aware daily briefing (see ROLE_LANDING)',
        components: [
          'RoleBriefingHeader',     // "Good morning, Sarah. 7 donors need your attention."
          'PriorityActionFeed',     // Role-specific modules from ROLE_LANDING
          'QuickActionBar',         // Contextual action buttons
        ],
      },
      {
        key: 'intel',
        label: 'Officer Intel',
        layout: 'split',     // Left panel list + right detail
        description: 'AI-generated portfolio intelligence summaries',
        components: [
          'IntelFeedList',          // Scrollable list of AI insights
          'IntelDetailPanel',       // Expanded insight with donor context
          'InsightActions',         // "Dismiss", "Act on this", "Share with team"
        ],
      },
    ],
  },

  // ─── DONORS ────────────────────────────────────────────────────────
  donors: {
    defaultTab: 'portfolio',
    tabs: [
      {
        key: 'portfolio',
        label: 'My Portfolio',
        layout: 'table',
        description: 'Assigned donors with moves management stages',
        components: [
          'DonorTable',             // Sortable, filterable table
          'DonorDetailDrawer',      // Slide-out panel on row click
          'StageProgressionBar',    // Visual pipeline stages
        ],
      },
      {
        key: 'all',
        label: 'All Donors',
        layout: 'table',
        description: 'Organization-wide donor database',
        components: [
          'DonorTable',             // Same component, different data scope
          'SegmentFilters',         // Advanced filtering and saved segments
          'BulkActions',            // Assign, tag, export
        ],
      },
      {
        key: 'discover',
        label: 'Prospect Discovery',
        layout: 'search',
        description: 'AI-powered prospect identification and wealth screening',
        badge: 'AI',
        components: [
          'ProspectSearchBar',      // Natural language search
          'ProspectResultsGrid',    // Card grid of discovered prospects
          'WealthScreenPanel',      // Capacity and propensity scores
          'AddToPortfolioAction',   // Quick-assign discovered prospects
        ],
      },
      {
        key: 'ask',
        label: 'Ask Engine',
        layout: 'chat',
        description: 'Conversational AI for donor data queries',
        badge: 'ML',
        components: [
          'AskEngineChat',          // Chat interface
          'QueryResultsTable',      // Structured results
          'SaveQueryAction',        // Save as report/segment
        ],
      },
      {
        key: 'signals',
        label: 'Signals',
        layout: 'feed',
        description: 'Real-time donor behavior signals and wealth triggers',
        badge: 'AI',
        components: [
          'SignalFeed',             // Chronological signal list
          'SignalFilters',          // By type: wealth, engagement, lapse, etc.
          'SignalDetailPanel',      // Expanded signal with recommended action
        ],
      },
    ],
  },

  // ─── OUTREACH ──────────────────────────────────────────────────────
  outreach: {
    defaultTab: 'inbox',
    tabs: [
      {
        key: 'inbox',
        label: 'Activity Feed',
        layout: 'feed',
        description: 'All pending, scheduled, and sent communications',
        components: [
          'OutreachStatusFilters',  // Pending | Scheduled | Sent | Failed
          'OutreachFeed',           // Chronological list with approval actions
          'BulkApproveBar',         // "Approve 12 pending messages"
        ],
      },
      {
        key: 'email',
        label: 'Email',
        layout: 'builder',
        description: 'Email template designer with personalization tokens',
        components: [
          'TemplateList',           // Saved templates sidebar
          'EmailDesigner',          // Drag-and-drop editor (orbit-comms-v2 pattern)
          'TokenInsertion',         // Personalization token panel
          'PreviewPanel',           // Live preview with sample donor data
        ],
      },
      {
        key: 'sms',
        label: 'SMS',
        layout: 'builder',
        description: 'SMS template designer with character counting',
        components: [
          'SMSTemplateList',
          'SMSComposer',
          'TokenInsertion',
          'SMSPreview',
        ],
      },
      {
        key: 'phone',
        label: 'Phone',
        layout: 'dialer',
        description: 'Click-to-call dialer with donor briefing cards',
        components: [
          'CallQueue',              // Prioritized call list
          'DonorBriefingCard',      // Context card shown during call
          'CallLogForm',            // Post-call disposition
          'DialerControls',         // Start call, transfer, end
        ],
      },
      {
        key: 'social',
        label: 'Social',
        layout: 'feed',
        description: 'Social media outreach and monitoring',
        components: [
          'SocialFeed',
          'SocialComposer',
          'EngagementMetrics',
        ],
      },
    ],
  },

  // ─── CAMPAIGNS ─────────────────────────────────────────────────────
  campaigns: {
    defaultTab: 'active',
    tabs: [
      {
        key: 'active',
        label: 'Active Campaigns',
        layout: 'grid',
        description: 'All running campaigns with performance dashboards',
        components: [
          'CampaignGrid',           // Card grid of active campaigns
          'CampaignDetailPanel',    // Slide-out with metrics
          'DonorAssignmentTool',    // Add/remove donors from campaigns
        ],
      },
      {
        key: 'builder',
        label: 'Campaign Builder',
        layout: 'wizard',
        description: 'Step-by-step campaign creation flow',
        components: [
          'CampaignWizard',         // Multi-step form
          'AudienceSelector',       // Segment-based targeting
          'ChannelMixer',           // Select outreach channels
          'GoalSetter',             // Financial and participation goals
        ],
      },
      {
        key: 'givingday',
        label: 'Giving Day',
        layout: 'live',
        description: 'Real-time Giving Day command center',
        badge: 'LIVE',             // Pulsing when active
        components: [
          'LiveThermometer',        // Real-time fundraising total
          'LeaderboardPanel',       // Competition/challenge boards
          'SocialFeedWidget',       // Live social media mentions
          'PushNotificationTool',   // Send alerts to ambassadors
          'RealTimeMetrics',        // Donors/minute, avg gift, etc.
        ],
      },
    ],
  },

  // ─── GIVING ────────────────────────────────────────────────────────
  giving: {
    defaultTab: 'pipeline',
    tabs: [
      {
        key: 'pipeline',
        label: 'Gift Pipeline',
        layout: 'kanban',
        description: 'Visual pipeline of gift opportunities by stage',
        components: [
          'PipelineKanban',         // Drag-and-drop stage board
          'GiftDetailDrawer',       // Slide-out gift details
          'PipelineSummaryBar',     // Total value by stage
        ],
      },
      {
        key: 'forms',
        label: 'Giving Forms',
        layout: 'builder',
        description: 'Online giving form builder and management',
        components: [
          'FormList',               // Saved giving forms
          'FormDesigner',           // Visual form builder
          'FormAnalytics',          // Conversion rates, avg gift
        ],
      },
      {
        key: 'pledges',
        label: 'Pledges',
        layout: 'table',
        description: 'Pledge schedules, installments, and fulfillment tracking',
        components: [
          'PledgeTable',            // All pledges with fulfillment status
          'InstallmentTimeline',    // Visual timeline of scheduled payments
          'PledgeReminderConfig',   // Automated reminder settings
        ],
      },
      {
        key: 'matching',
        label: 'Matching Gifts',
        layout: 'table',
        description: 'Matching gift program management and employer verification',
        components: [
          'MatchingGiftTable',      // Pending matches
          'EmployerDatabase',       // Known matching programs
          'MatchingGiftReminders',  // Automated follow-ups for unclaimed matches
        ],
      },
    ],
  },

  // ─── AGENTS ────────────────────────────────────────────────────────
  agents: {
    defaultTab: 'overview',
    tabs: [
      {
        key: 'overview',
        label: 'Fleet Overview',
        layout: 'dashboard',
        description: 'All 4 agents: status, throughput, assignment counts',
        components: [
          'AgentFleetGrid',         // 4-card grid (matches orbit-agents.html)
          'AgentActivityFeed',      // Recent decisions across all agents
          'FleetMetrics',           // Total assignments, decisions/day, error rate
        ],
      },
      {
        key: 'veo',
        label: 'Aria (VEO)',
        layout: 'agent-detail',
        description: 'Virtual Engagement Officer: cultivation pipeline',
        components: ['AgentDetailView'],
      },
      {
        key: 'vso',
        label: 'Marcus (VSO)',
        layout: 'agent-detail',
        description: 'Virtual Stewardship Officer: retention and acknowledgment',
        components: ['AgentDetailView'],
      },
      {
        key: 'vpgo',
        label: 'Eleanor (VPGO)',
        layout: 'agent-detail',
        description: 'Virtual Planned Giving Officer: legacy cultivation',
        components: ['AgentDetailView'],
      },
      {
        key: 'vco',
        label: 'Dev (VCO)',
        layout: 'agent-detail',
        description: 'Virtual Campaign Officer: campaign participation',
        components: ['AgentDetailView'],
      },
      {
        key: 'config',
        label: 'Configuration',
        layout: 'form',
        description: 'Agent behavior rules, guardrails, and prompt configuration',
        components: [
          'AgentRulesEditor',       // Tone, frequency, escalation thresholds
          'GuardrailsConfig',       // Opt-in requirements, contact limits
          'PromptTemplates',        // Claude prompt customization
        ],
      },
    ],
  },

  // ─── REPORTS ───────────────────────────────────────────────────────
  reports: {
    defaultTab: 'dashboard',
    tabs: [
      {
        key: 'dashboard',
        label: 'Overview',
        layout: 'dashboard',
        description: 'KPI summary: raised YTD, donor count, retention rate',
        components: [
          'KPICardRow',             // $4.2M Raised, 1,847 Donors, 73% Retention
          'TrendChart',             // 12-month giving trend
          'ComparisonTable',        // YoY, MoM comparisons
        ],
      },
      {
        key: 'giving',
        label: 'Giving',
        layout: 'analytics',
        description: 'Gift analytics: by fund, by amount, by source',
        components: [
          'GivingBreakdownChart',
          'FundAllocationTable',
          'GiftSourceAnalysis',
        ],
      },
      {
        key: 'retention',
        label: 'Retention',
        layout: 'analytics',
        description: 'Donor retention analysis: LYBUNT/SYBUNT, cohort analysis',
        components: [
          'RetentionFunnel',
          'CohortHeatmap',
          'LapseRiskTable',
        ],
      },
      {
        key: 'campaigns',
        label: 'Campaigns',
        layout: 'analytics',
        description: 'Campaign performance comparison and ROI analysis',
        components: [
          'CampaignComparisonChart',
          'ChannelROITable',
          'ParticipationTrends',
        ],
      },
      {
        key: 'agents',
        label: 'Agent Performance',
        layout: 'analytics',
        description: 'AI agent effectiveness: conversion rates, response rates',
        components: [
          'AgentEffectivenessChart',
          'OutreachConversionFunnel',
          'AgentROICalculator',
        ],
      },
    ],
  },

  // ─── SETTINGS ──────────────────────────────────────────────────────
  settings: {
    defaultTab: 'general',
    tabs: [
      {
        key: 'general',
        label: 'General',
        layout: 'form',
        description: 'Organization profile, timezone, fiscal year settings',
        components: [
          'OrgProfileForm',
          'FiscalYearConfig',
          'NotificationPreferences',
        ],
      },
      {
        key: 'users',
        label: 'Users & Roles',
        layout: 'table',
        adminOnly: true,
        description: 'User management, role assignment, team structure',
        components: [
          'UserTable',
          'RoleEditor',
          'InviteUserFlow',
        ],
      },
      {
        key: 'integrations',
        label: 'Integrations',
        layout: 'grid',
        description: 'CRM, payment, communication, and data integrations',
        components: [
          'IntegrationGrid',        // Salesforce, Stripe, SendGrid, etc.
          'IntegrationStatusBar',   // Health indicators
          'SyncLogViewer',          // Recent sync activity
        ],
      },
      {
        key: 'billing',
        label: 'Billing',
        layout: 'form',
        adminOnly: true,
        description: 'Subscription plan, payment methods, invoice history',
        components: [
          'PlanSelector',
          'PaymentMethodForm',
          'InvoiceTable',
        ],
      },
      {
        key: 'compliance',
        label: 'Compliance',
        layout: 'form',
        adminOnly: true,
        description: 'Data privacy, consent management, audit log access',
        components: [
          'ConsentDashboard',
          'DataRetentionConfig',
          'AuditLogExporter',
        ],
      },
      {
        key: 'onboarding',
        label: 'Onboarding',
        layout: 'wizard',
        adminOnly: true,
        description: 'Setup wizard for new organizations',
        components: [
          'OnboardingChecklist',
          'DataImportWizard',
          'QuickStartGuide',
        ],
      },
      {
        key: 'pitch',
        label: 'Demo Mode',
        layout: 'special',
        adminOnly: true,
        description: 'Sales demonstration mode with sample data',
        components: [
          'DemoModeToggle',
          'SampleDataGenerator',
          'PresentationView',
        ],
      },
    ],
  },
};


// ============================================================================
// 6. SMART CONTEXTUAL UX ELEMENTS
// ============================================================================

/**
 * These elements exist OUTSIDE the primary navigation and provide
 * cross-cutting functionality accessible from any page.
 */

const SMART_ELEMENTS = {

  // ─── Command Palette (Cmd+K) ──────────────────────────────────────
  commandPalette: {
    trigger: 'Cmd+K / Ctrl+K',
    placement: 'modal-overlay',
    description: `
      Global search and quick-action launcher. Searches across:
      - Donor names and emails
      - Campaign names
      - Page names (navigate directly)
      - Actions ("create campaign", "send email to...")
      This replaces the need for users to know WHERE something lives
      in the navigation. They type what they want and go there directly.
    `,
    searchCategories: [
      { key: 'donors',    icon: 'Users',    label: 'Donors',    example: 'Search donors...' },
      { key: 'pages',     icon: 'Layout',   label: 'Pages',     example: 'Go to...' },
      { key: 'actions',   icon: 'Zap',      label: 'Actions',   example: 'Create, send, assign...' },
      { key: 'campaigns', icon: 'Target',   label: 'Campaigns', example: 'Search campaigns...' },
      { key: 'help',      icon: 'HelpCircle', label: 'Help',    example: 'How do I...' },
    ],
  },

  // ─── Quick Action Bar ─────────────────────────────────────────────
  quickActionBar: {
    placement: 'top-of-content-area',
    visibility: 'home-page-only',
    description: `
      A horizontal bar of 3-5 contextual action buttons that appear
      on the Home page based on the user's role and current state.
      Answers: "What's the ONE thing I should do right now?"
    `,
    examples: {
      mgo: [
        { label: 'Call Robert Chen', icon: 'Phone', action: 'navigate:/donors/robert-chen?tab=outreach' },
        { label: 'Review 3 AI Drafts', icon: 'FileText', action: 'navigate:/outreach?tab=inbox&filter=pending' },
        { label: 'Update Pipeline', icon: 'TrendingUp', action: 'navigate:/giving?tab=pipeline' },
      ],
      annual_giving: [
        { label: 'Approve 12 Messages', icon: 'CheckCircle', action: 'navigate:/outreach?tab=inbox&filter=pending' },
        { label: 'Spring Campaign', icon: 'Target', action: 'navigate:/campaigns/spring-2026' },
        { label: 'View Lapsed Report', icon: 'AlertTriangle', action: 'navigate:/reports?tab=retention' },
      ],
    },
  },

  // ─── Notification Panel ───────────────────────────────────────────
  notificationPanel: {
    trigger: 'Bell icon in rail footer',
    placement: 'slide-out-panel-right',
    description: `
      Grouped notifications: Agent Activity, Donor Signals, System Alerts.
      Each notification is actionable — clicking navigates to the relevant
      page and tab with context pre-loaded.
    `,
    groups: [
      { key: 'agent',  label: 'Agent Activity',  icon: 'Bot' },
      { key: 'donor',  label: 'Donor Signals',   icon: 'Users' },
      { key: 'system', label: 'System',           icon: 'Server' },
    ],
  },

  // ─── AI Status Indicator ──────────────────────────────────────────
  aiStatusIndicator: {
    placement: 'rail-footer',
    description: `
      A small pulsing green dot in the rail footer that indicates AI agents
      are active. Clicking opens a mini-panel showing:
      - 4 agent status lines (VEO: 342 active, VSO: 1,208 active, etc.)
      - Last decision timestamp
      - Error count in last 24h
      This gives admins ambient awareness of AI health without leaving
      their current page.
    `,
  },

  // ─── Breadcrumb Trail ─────────────────────────────────────────────
  breadcrumb: {
    placement: 'top-of-content-area',
    description: `
      Shows: Primary Nav Item > Tab Name > [Optional: Entity Name]
      Example: "Donors > My Portfolio > Robert Chen"
      Clicking any segment navigates back to that level.
    `,
    format: '{primaryNav} > {tabName} > {entityName?}',
  },

  // ─── Rail Expand-on-Hover ─────────────────────────────────────────
  railExpandBehavior: {
    collapsed: {
      width: '64px',
      shows: 'icons-only',
      tooltipOnHover: true,
    },
    expanded: {
      width: '220px',
      shows: 'icons-and-labels',
      trigger: 'hover-over-rail',
      delay: '150ms',
      animation: 'width 200ms ease',
    },
    pinnable: true, // User can pin expanded state
    description: `
      The slim dark rail (Option A from nav mockup) is 64px collapsed.
      On hover, it expands to 220px showing full labels. Users can pin
      the expanded state via a pin icon at the top of the rail.
      This maximizes content area by default while remaining discoverable.
    `,
  },
};


// ============================================================================
// 7. NAVIGATION RENDERING LOGIC (React-ready)
// ============================================================================

/**
 * Filters nav items by user role and renders in correct positions.
 * This is the actual rendering logic for the slim rail component.
 */

function getVisibleNav(userRole) {
  const mainItems = NAV_PRIMARY.filter(
    item => item.roles.includes(userRole) && item.position !== 'footer'
  );
  const footerItems = NAV_PRIMARY.filter(
    item => item.roles.includes(userRole) && item.position === 'footer'
  );
  return { mainItems, footerItems };
}

/**
 * Filters tabs within a page by admin status.
 * Non-admin users don't see adminOnly tabs.
 */
function getVisibleTabs(pageKey, userRole) {
  const page = PAGE_STRUCTURES[pageKey];
  if (!page) return [];
  return page.tabs.filter(tab => {
    if (tab.adminOnly && userRole !== 'admin') return false;
    return true;
  });
}

/**
 * Resolves the landing configuration for a user based on their role tag.
 * Falls back to the generic briefing if no role match.
 */
function getLandingConfig(userRoleTag) {
  return ROLE_LANDING[userRoleTag] || ROLE_LANDING.mgo; // Default to MGO
}


// ============================================================================
// 8. NAVIGATION COMPONENT SPECIFICATION (React JSX outline)
// ============================================================================

/**
 * <SlimRail>
 *   <RailLogo />                          -- Orbit "O" logomark
 *   <RailNav>                             -- Main nav section
 *     {mainItems.map(item =>
 *       <RailItem                         -- 40x34px icon button
 *         icon={item.icon}
 *         tooltip={item.label}
 *         active={currentPath === item.path}
 *         badge={item.badge}
 *         onClick={() => navigate(item.path)}
 *       />
 *     )}
 *   </RailNav>
 *   <RailFooter>                          -- Bottom section, visually separated
 *     <AIStatusDot />                     -- Pulsing green when agents active
 *     <NotificationButton count={3} />    -- Bell with unread count
 *     {footerItems.map(item =>
 *       <RailItem icon={item.icon} ... />
 *     )}
 *     <UserAvatar initials="SJ" />        -- User avatar at very bottom
 *   </RailFooter>
 * </SlimRail>
 *
 * <ContentArea>
 *   <Breadcrumb path={[primaryNav, tabName, entityName]} />
 *   <TabBar tabs={getVisibleTabs(currentPage, userRole)} />
 *   <PageContent>
 *     {/* Tab-specific content renders here */}
 *   </PageContent>
 * </ContentArea>
 */


// ============================================================================
// 9. URL ROUTING STRUCTURE
// ============================================================================

/**
 * Clean URL structure that maps directly to nav + tabs.
 * Pattern: /{primary-nav}/{tab-key}/{optional-entity-id}
 */
const ROUTES = {
  '/home':                        { page: 'home',      tab: 'briefing' },
  '/home/intel':                  { page: 'home',      tab: 'intel' },

  '/donors':                      { page: 'donors',    tab: 'portfolio' },
  '/donors/all':                  { page: 'donors',    tab: 'all' },
  '/donors/discover':             { page: 'donors',    tab: 'discover' },
  '/donors/ask':                  { page: 'donors',    tab: 'ask' },
  '/donors/signals':              { page: 'donors',    tab: 'signals' },
  '/donors/:id':                  { page: 'donors',    tab: 'portfolio', detail: true },

  '/outreach':                    { page: 'outreach',  tab: 'inbox' },
  '/outreach/email':              { page: 'outreach',  tab: 'email' },
  '/outreach/sms':                { page: 'outreach',  tab: 'sms' },
  '/outreach/phone':              { page: 'outreach',  tab: 'phone' },
  '/outreach/social':             { page: 'outreach',  tab: 'social' },

  '/campaigns':                   { page: 'campaigns', tab: 'active' },
  '/campaigns/builder':           { page: 'campaigns', tab: 'builder' },
  '/campaigns/givingday':         { page: 'campaigns', tab: 'givingday' },
  '/campaigns/:id':               { page: 'campaigns', tab: 'active', detail: true },

  '/giving':                      { page: 'giving',    tab: 'pipeline' },
  '/giving/forms':                { page: 'giving',    tab: 'forms' },
  '/giving/pledges':              { page: 'giving',    tab: 'pledges' },
  '/giving/matching':             { page: 'giving',    tab: 'matching' },

  '/agents':                      { page: 'agents',    tab: 'overview' },
  '/agents/veo':                  { page: 'agents',    tab: 'veo' },
  '/agents/vso':                  { page: 'agents',    tab: 'vso' },
  '/agents/vpgo':                 { page: 'agents',    tab: 'vpgo' },
  '/agents/vco':                  { page: 'agents',    tab: 'vco' },
  '/agents/config':               { page: 'agents',    tab: 'config' },

  '/reports':                     { page: 'reports',   tab: 'dashboard' },
  '/reports/giving':              { page: 'reports',   tab: 'giving' },
  '/reports/retention':           { page: 'reports',   tab: 'retention' },
  '/reports/campaigns':           { page: 'reports',   tab: 'campaigns' },
  '/reports/agents':              { page: 'reports',   tab: 'agents' },

  '/settings':                    { page: 'settings',  tab: 'general' },
  '/settings/users':              { page: 'settings',  tab: 'users' },
  '/settings/integrations':       { page: 'settings',  tab: 'integrations' },
  '/settings/billing':            { page: 'settings',  tab: 'billing' },
  '/settings/compliance':         { page: 'settings',  tab: 'compliance' },
  '/settings/onboarding':         { page: 'settings',  tab: 'onboarding' },
  '/settings/demo':               { page: 'settings',  tab: 'pitch' },
};


// ============================================================================
// 10. MIGRATION GUIDE: Old URL -> New URL
// ============================================================================

const URL_REDIRECTS = {
  // Old path              -> New path
  '/overview':              '/home',
  '/officer':               '/home/intel',
  '/agents':                '/agents',
  '/donors':                '/donors',
  '/gifts':                 '/giving',
  '/campaigns':             '/campaigns',
  '/outreach':              '/outreach',
  '/analytics':             '/reports',
  '/integrations':          '/settings/integrations',
  '/prospects':             '/donors/discover',
  '/askengine':             '/donors/ask',
  '/givingform':            '/giving/forms',
  '/pledges':               '/giving/pledges',
  '/matching':              '/giving/matching',
  '/phonedialer':           '/outreach/phone',
  '/emailtemplates':        '/outreach/email',
  '/givingday':             '/campaigns/givingday',
  '/sms':                   '/outreach/sms',
  '/signals':               '/donors/signals',
  '/socialcomms':           '/outreach/social',
  '/users':                 '/settings/users',
  '/onboarding':            '/settings/onboarding',
  '/billing':               '/settings/billing',
  '/compliance':            '/settings/compliance',
  '/settings':              '/agents/config',  // Old "settings" was agent config only
  '/pitch':                 '/settings/demo',
};


// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  NAV_PRIMARY,
  PAGE_MAPPING,
  PAGE_STRUCTURES,
  ROLE_LANDING,
  SMART_ELEMENTS,
  ROUTES,
  URL_REDIRECTS,
  getVisibleNav,
  getVisibleTabs,
  getLandingConfig,
};
