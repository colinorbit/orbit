import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import StatCard from '@/components/ui/StatCard';
import type { AnalyticsOverview } from '@/types';
import styles from './Dashboard.module.css';

function formatDollars(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
  return `$${dollars.toFixed(0)}`;
}

export default function Dashboard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: () => api.get<{ data: AnalyticsOverview }>('/analytics/overview'),
    refetchInterval: 60_000,
  });

  const overview = data?.data;

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <div className="spinner" />
        <p>Loading dashboard...</p>
      </div>
    );
  }

  if (isError || !overview) {
    return <p className={styles.error}>Failed to load dashboard data.</p>;
  }

  const campaignPct = overview.totalCampaignGoalCents > 0
    ? Math.round((overview.totalCampaignRaisedCents / overview.totalCampaignGoalCents) * 100)
    : 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Dashboard</h1>
        <p className={styles.sub}>Advancement intelligence overview</p>
      </header>

      <section className={styles.statsGrid}>
        <StatCard
          label="Total Donors"
          value={overview.totalDonors.toLocaleString()}
          sub={`${overview.activeDonors.toLocaleString()} active`}
          accent="green"
        />
        <StatCard
          label="Total Giving"
          value={formatDollars(overview.totalGivingCents)}
          sub={`Avg gift: ${formatDollars(overview.averageGiftCents)}`}
          accent="teal"
        />
        <StatCard
          label="Active Campaigns"
          value={overview.activeCampaigns}
          sub={`${campaignPct}% of goal raised`}
          accent="purple"
        />
        <StatCard
          label="Agent Decisions"
          value={overview.agentDecisionsThisMonth.toLocaleString()}
          sub="This month"
          accent="amber"
        />
        <StatCard
          label="Pending Pledges"
          value={formatDollars(overview.pendingPledgesCents)}
          sub="Outstanding"
          accent="sky"
        />
        <StatCard
          label="Campaign Revenue"
          value={formatDollars(overview.totalCampaignRaisedCents)}
          sub={`of ${formatDollars(overview.totalCampaignGoalCents)} goal`}
          accent="green"
        />
      </section>

      <section className={styles.recentSection}>
        <h2 className={styles.sectionTitle}>Recent Gifts</h2>
        {overview.recentGifts.length === 0 ? (
          <p className={styles.empty}>No recent gifts.</p>
        ) : (
          <div className={styles.giftList}>
            {overview.recentGifts.map((gift) => (
              <div key={gift.id} className={styles.giftRow}>
                <span className={styles.giftAmount}>{formatDollars(gift.amountCents)}</span>
                <span className={styles.giftType}>{gift.giftType}</span>
                <span className={styles.giftDate}>
                  {new Date(gift.giftDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                <span className={`${styles.giftStatus} ${styles[`status_${gift.status}`]}`}>
                  {gift.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
