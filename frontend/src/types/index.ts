// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  orgId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'manager' | 'staff';
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: User;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface PagedResponse<T> {
  data: T[];
  pagination: Pagination;
}

// ─── API Error ────────────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  code: string;
  details?: unknown[];
}

// ─── Donors ───────────────────────────────────────────────────────────────────

export type DonorStage =
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

export interface Donor {
  id: string;
  orgId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  classYear: number | null;
  school: string | null;
  degree: string | null;
  stage: DonorStage;
  propensityScore: number;
  bequeathScore: number;
  totalGivingCents: number;
  lastGiftCents: number | null;
  lastGiftDate: string | null;
  numberOfGifts: number;
  wealthCapacityCents: number | null;
  aiOptedIn: boolean;
  emailOptedIn: boolean;
  smsOptedIn: boolean;
  touchpointCount: number;
  lastContactAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Gifts ────────────────────────────────────────────────────────────────────

export type GiftType = 'online' | 'check' | 'wire' | 'stock' | 'crypto' | 'inkind' | 'daf';
export type GiftStatus = 'pending' | 'cleared' | 'bounced' | 'refunded';

export interface Gift {
  id: string;
  orgId: string;
  donorId: string;
  campaignId: string | null;
  amountCents: number;
  giftType: GiftType;
  status: GiftStatus;
  giftDate: string;
  appealCode: string | null;
  fundCode: string | null;
  notes: string | null;
  createdAt: string;
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

export type CampaignType = 'annual_fund' | 'major_gift' | 'planned_giving' | 'capital' | 'endowment' | 'emergency' | 'giving_day';
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';

export interface Campaign {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  campaignType: CampaignType;
  status: CampaignStatus;
  goalCents: number;
  raisedCents: number;
  donorCount: number;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface AnalyticsOverview {
  totalDonors: number;
  activeDonors: number;
  totalGivingCents: number;
  averageGiftCents: number;
  activeCampaigns: number;
  totalCampaignGoalCents: number;
  totalCampaignRaisedCents: number;
  agentDecisionsThisMonth: number;
  pendingPledgesCents: number;
  recentGifts: Gift[];
}

// ─── Agents ───────────────────────────────────────────────────────────────────

export type AgentType = 'VEO' | 'VSO' | 'VPGO' | 'VCO' | 'VAFO';

export interface AgentAssignment {
  id: string;
  donorId: string;
  agentType: AgentType;
  status: 'active' | 'paused' | 'completed';
  nextContactAt: string | null;
  lastDecisionAt: string | null;
}
