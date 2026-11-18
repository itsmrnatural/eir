import { Suspense, lazy, useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

// Dev-only: the condition is a build-time constant, so production bundles never contain the panel.
const DevPanel = import.meta.env.DEV ? lazy(() => import('./DevPanel.jsx')) : null;

export default function Layout() {
  const { user, isAdmin, logout } = useAuth();
  const { pathname } = useLocation();
  const mainRef = useRef(null);
  const firstRender = useRef(true);

  // After navigating, move focus to the page unless a page control already took it.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const main = mainRef.current;
    if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <aside className="rail no-print">
        <div className="brand">
          <strong>Health Centre</strong>
          <span>NIT Delhi</span>
        </div>
        <nav aria-label="Main">
          <NavLink to="/visit">Record visit</NavLink>
          <NavLink to="/patients">Patients</NavLink>
          {isAdmin && <NavLink to="/admin/reports">Reports</NavLink>}
        </nav>
        <div className="rail-user">
          <span className="who">{user?.username} <span className="role">({user?.role === 'ADMIN' ? 'admin' : 'staff'})</span></span>
          <button type="button" className="btn btn-small btn-ghost" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main id="main" ref={mainRef} tabIndex={-1}>
        <Outlet />
      </main>
      {DevPanel && (
        <Suspense fallback={null}>
          <DevPanel />
        </Suspense>
      )}
    </div>
  );
}
