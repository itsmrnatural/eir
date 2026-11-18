const KEY = 'hc.token';
let memory = null;

/** JWT storage. sessionStorage so a shared desk machine forgets the login when the tab closes. */
export const tokenStore = {
  get() {
    try {
      return sessionStorage.getItem(KEY) ?? memory;
    } catch {
      return memory;
    }
  },
  set(token) {
    memory = token;
    try {
      sessionStorage.setItem(KEY, token);
    } catch {
      /* storage unavailable: keep in memory only */
    }
  },
  clear() {
    memory = null;
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};
