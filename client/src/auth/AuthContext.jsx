import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as api from '../api/index.js';
import { setUnauthenticatedHandler } from '../api/http.js';

const AuthContext = createContext(null);

/** Holds the signed-in user. status: 'loading' (checking a stored token) | 'authed' | 'anon'. */
export function AuthProvider({ children }) {
  const qc = useQueryClient();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(api.tokenStore.get() ? 'loading' : 'anon');

  const logout = useCallback(() => {
    api.tokenStore.clear();
    setUser(null);
    setStatus('anon');
    qc.clear();
  }, [qc]);

  // Any request answered with UNAUTHENTICATED signs the user out.
  useEffect(() => {
    setUnauthenticatedHandler(logout);
    return () => setUnauthenticatedHandler(null);
  }, [logout]);

  // Validate a token left over from an earlier page load.
  useEffect(() => {
    if (status !== 'loading') return undefined;
    let cancelled = false;
    api
      .me()
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        setStatus('authed');
      })
      .catch(() => {
        if (cancelled) return;
        api.tokenStore.clear();
        setStatus('anon');
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  const login = useCallback(async (username, password) => {
    const res = await api.login(username, password);
    api.tokenStore.set(res.token);
    setUser(res.user);
    setStatus('authed');
    return res.user;
  }, []);

  const value = useMemo(() => ({ user, status, login, logout, isAdmin: user?.role === 'ADMIN' }), [user, status, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
