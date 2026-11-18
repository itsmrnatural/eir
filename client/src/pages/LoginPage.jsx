import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { friendlyMessage } from '../api/errors.js';
import Field from '../components/Field.jsx';
import { Alert, Loading } from '../components/States.jsx';

export default function LoginPage() {
  const { login, status } = useAuth();
  const { state } = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (status === 'authed') return <Navigate to={state?.from ?? '/visit'} replace />;
  if (status === 'loading') return <div className="page-center"><Loading label="Checking your session…" /></div>;

  async function submit(e) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.code === 'UNAUTHENTICATED' ? 'Wrong username or password.' : friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-center">
      <form className="card login" onSubmit={submit} noValidate>
        <h1>Health Centre</h1>
        <p className="hint">NIT Delhi. Staff and admin sign in.</p>
        <Field label="Username">
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        </Field>
        <Field label="Password">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        {error && <Alert kind="error">{error}</Alert>}
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {import.meta.env.MODE === 'mock' && (
          <p className="hint">Mock mode: admin / admin123 or staff / staff123.</p>
        )}
      </form>
    </div>
  );
}
