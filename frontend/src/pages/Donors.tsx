import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import type { Donor, PagedResponse } from '@/types';
import styles from './Donors.module.css';

const STAGE_LABELS: Record<string, string> = {
  uncontacted:      'Uncontacted',
  opted_in:         'Opted In',
  cultivation:      'Cultivation',
  discovery:        'Discovery',
  solicitation:     'Solicitation',
  committed:        'Committed',
  stewardship:      'Stewardship',
  lapsed_outreach:  'Lapsed',
  legacy_cultivation:'Legacy',
  closed:           'Closed',
};

const STAGE_ACCENTS: Record<string, string> = {
  cultivation:     'green',
  discovery:       'purple',
  solicitation:    'amber',
  committed:       'green',
  stewardship:     'teal',
  lapsed_outreach: 'rose',
  legacy_cultivation: 'amber',
};

function scoreBadge(score: number): string {
  if (score >= 80) return styles.scoreHigh;
  if (score >= 50) return styles.scoreMid;
  return styles.scoreLow;
}

function formatDollars(cents: number): string {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000) return `$${(d / 1_000).toFixed(0)}K`;
  return `$${d.toFixed(0)}`;
}

export default function Donors() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input
  function handleSearchChange(val: string) {
    setSearch(val);
    clearTimeout((window as unknown as { _searchTimer: ReturnType<typeof setTimeout> })._searchTimer);
    (window as unknown as { _searchTimer: ReturnType<typeof setTimeout> })._searchTimer = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 300);
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['donors', page, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: '25',
        sort: 'propensity_score',
        order: 'desc',
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      return api.get<PagedResponse<Donor>>(`/donors?${params}`);
    },
    placeholderData: (prev) => prev,
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Donors</h1>
          {data && (
            <p className={styles.sub}>
              {data.pagination.total.toLocaleString()} total
            </p>
          )}
        </div>
        <input
          type="search"
          className={styles.search}
          placeholder="Search name, email..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          aria-label="Search donors"
        />
      </header>

      {isError && <p className={styles.error}>Failed to load donors.</p>}

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Stage</th>
              <th className={styles.numCol}>Score</th>
              <th className={styles.numCol}>Total Giving</th>
              <th className={styles.numCol}>Last Gift</th>
              <th>AI</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className={styles.skeletonRow}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j}><div className={styles.skeleton} /></td>
                    ))}
                  </tr>
                ))
              : data?.data.map((donor) => (
                  <tr key={donor.id} className={styles.dataRow}>
                    <td>
                      <Link to={`/donors/${donor.id}`} className={styles.donorLink}>
                        {donor.firstName} {donor.lastName}
                      </Link>
                      {donor.classYear && (
                        <span className={styles.classYear}>'{String(donor.classYear).slice(2)}</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={styles.stageBadge}
                        data-accent={STAGE_ACCENTS[donor.stage] ?? 'default'}
                      >
                        {STAGE_LABELS[donor.stage] ?? donor.stage}
                      </span>
                    </td>
                    <td className={styles.numCol}>
                      <span className={`${styles.score} ${scoreBadge(donor.propensityScore)}`}>
                        {donor.propensityScore}
                      </span>
                    </td>
                    <td className={styles.numCol}>{formatDollars(donor.totalGivingCents)}</td>
                    <td className={styles.numCol}>
                      {donor.lastGiftDate
                        ? new Date(donor.lastGiftDate).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
                        : '—'}
                    </td>
                    <td>
                      {donor.aiOptedIn
                        ? <span className={styles.aiOn}>On</span>
                        : <span className={styles.aiOff}>Off</span>
                      }
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {data && data.pagination.pages > 1 && (
        <div className={styles.pagination}>
          <button
            className={styles.pageBtn}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </button>
          <span className={styles.pageInfo}>
            Page {page} of {data.pagination.pages}
          </span>
          <button
            className={styles.pageBtn}
            onClick={() => setPage((p) => Math.min(data.pagination.pages, p + 1))}
            disabled={page === data.pagination.pages}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
