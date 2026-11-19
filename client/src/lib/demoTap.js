/**
 * Demo only: the key that lets this browser listen to taps from a phone reader.
 *
 * Open the app once as  http://localhost:8080/?demo=<key>  . The key is kept for this browser tab
 * (sessionStorage, like the login token) and removed from the address bar. Without a key the
 * feature is completely off: no connection is made. `?demo=off` forgets the key.
 */
const STORE = 'hc.demoTapKey';

/** Call once at start-up, before the router can redirect and drop the query string. */
export function captureDemoKey() {
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('demo');
    if (fromUrl === null) return;
    if (fromUrl === 'off' || fromUrl === '') sessionStorage.removeItem(STORE);
    else sessionStorage.setItem(STORE, fromUrl);
    url.searchParams.delete('demo');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* storage or history unavailable: the feature simply stays off */
  }
}

export function getDemoKey() {
  try {
    return sessionStorage.getItem(STORE) || null;
  } catch {
    return null;
  }
}
