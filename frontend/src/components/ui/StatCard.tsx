import styles from './StatCard.module.css';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: 'green' | 'purple' | 'teal' | 'amber' | 'sky';
}

export default function StatCard({ label, value, sub, accent = 'green' }: StatCardProps) {
  return (
    <div className={styles.card} data-accent={accent}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      {sub && <span className={styles.sub}>{sub}</span>}
    </div>
  );
}
