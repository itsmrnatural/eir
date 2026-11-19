import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../api/config.js';
import { getDemoKey } from '../../lib/demoTap.js';

const SAME_TAP_MS = 1500; // a card resting on the phone can be reported twice

/**
 * Demo only. Listens for card taps sent by a phone reader (server: /api/v1/demo/tap) and passes
 * each card id to onTap, exactly like a USB reader would. Does nothing unless a demo key was
 * given in the address (see lib/demoTap.js).
 *
 * @param {(rfidId: string) => void} onTap
 * @returns {'off' | 'connecting' | 'connected' | 'error'}
 */
export function useDemoTap(onTap) {
  const handler = useRef(onTap);
  useEffect(() => {
    handler.current = onTap;
  });

  const supported = typeof EventSource !== 'undefined';
  const [status, setStatus] = useState(() => (supported && getDemoKey() ? 'connecting' : 'off'));

  useEffect(() => {
    const key = getDemoKey();
    if (!key || !supported) return undefined;

    let last = { tag: '', at: 0 };
    const source = new EventSource(`${API_BASE_URL}/demo/tap/stream?key=${encodeURIComponent(key)}`);
    source.onopen = () => setStatus('connected');
    // CLOSED means the server refused us (wrong key, or DEMO_TAP is off); otherwise the browser retries by itself.
    source.onerror = () => setStatus(source.readyState === EventSource.CLOSED ? 'error' : 'connecting');
    source.addEventListener('tap', (event) => {
      let tag;
      try {
        tag = JSON.parse(event.data).rfid_id;
      } catch {
        return;
      }
      if (typeof tag !== 'string' || !tag) return;
      const now = Date.now();
      if (tag === last.tag && now - last.at < SAME_TAP_MS) return;
      last = { tag, at: now };
      handler.current?.(tag);
    });
    return () => source.close();
  }, [supported]);

  return status;
}

export const DEMO_TAP_MESSAGES = {
  connecting: 'Phone reader: connecting…',
  connected: 'Phone reader connected. Tap a card on the phone.',
  error: 'Phone reader unavailable. Check the demo key, and that the server runs with DEMO_TAP=1.',
};
