import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import styles from './AppLayout.module.css';

const NAV_ITEMS = [
  { to: '/dashboard',  label: 'Dashboard',  icon: '⬡' },
  { to: '/donors',     label: 'Donors',     icon: '◎' },
  { to: '/campaigns',  label: 'Campaigns',  icon: '◈' },
  { to: '/analytics',  label: 'Analytics',  icon: '▦' },
  { to: '/agents',     label: 'Agents',     icon: '◉' },
  { to: '/outreach',   label: 'Outreach',   icon: '◌' },
];

export default function AppLayout() {
  const { user, logout } = useAuth();

  return (
    <div className={styles.shell}>
      {/* ── Sidebar ── */}
      <nav className={styles.sidebar}>
        <div className={styles.logoMark}>
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="#1C2028"/>
            <circle cx="16" cy="16" r="11" stroke="#3ECF8E" strokeWidth="1.8" strokeDasharray="5 2.5" opacity=".9"/>
            <circle cx="16" cy="16" r="4" fill="#F0F2F5"/>
            <circle cx="27" cy="16" r="2.8" fill="#A78BFA"/>
          </svg>
          <span className={styles.logoText}>Orbit</span>
        </div>

        <ul className={styles.navList}>
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
                }
              >
                <span className={styles.navIcon}>{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>

        {user && (
          <div className={styles.userArea}>
            <div className={styles.userInfo}>
              <span className={styles.userName}>{user.firstName} {user.lastName}</span>
              <span className={styles.userRole}>{user.role}</span>
            </div>
            <button className={styles.logoutBtn} onClick={logout} aria-label="Sign out">
              &#x2192;
            </button>
          </div>
        )}
      </nav>

      {/* ── Main content ── */}
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
