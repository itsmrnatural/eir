import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { Loading } from '../components/States.jsx';

export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <div className="page-center"><Loading label="Checking your session…" /></div>;
  if (status === 'anon') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

/** Role gate. STAFF is the lower role; ADMIN may open everything. */
export function RequireRole({ role }) {
  const { user } = useAuth();
  if (user?.role !== role) {
    return (
      <div className="page">
        <h1>Not allowed</h1>
        <p>This screen is for {role === 'ADMIN' ? 'admins' : 'staff'} only. Ask an admin if you need access.</p>
      </div>
    );
  }
  return <Outlet />;
}
