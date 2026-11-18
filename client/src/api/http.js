import { API_BASE_URL } from './config.js';
import { ApiError } from './errors.js';
import { tokenStore } from './session.js';

let onUnauthenticated = null;
/** The auth provider registers a callback that runs when the server says the token is no longer valid. */
export function setUnauthenticatedHandler(fn) {
  onUnauthenticated = fn;
}

function buildUrl(path, query) {
  const base = `${API_BASE_URL}${path}`;
  if (!query) return base;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * @param {'GET'|'POST'|'PATCH'} method
 * @param {string} path  path after /api/v1, starting with "/"
 * @param {{query?:object, body?:object, accept?:string, responseType?:'json'|'blob', auth?:boolean}} [opts]
 */
export async function request(method, path, { query, body, accept, responseType = 'json', auth = true } = {}) {
  const headers = { Accept: accept ?? 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = tokenStore.get();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError({ status: 0, code: 'NETWORK', message: 'Cannot reach the server' });
  }

  if (!res.ok) {
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      /* body was not JSON */
    }
    const e = payload?.error;
    const err = new ApiError({
      status: res.status,
      code: e?.code ?? (res.status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL'),
      message: e?.message ?? res.statusText,
      details: e?.details ?? {},
    });
    if (err.code === 'UNAUTHENTICATED' && auth && onUnauthenticated) onUnauthenticated();
    throw err;
  }

  if (responseType === 'blob') return res.blob();
  if (res.status === 204) return null;
  return res.json();
}
