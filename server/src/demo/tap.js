/*
 * Demo only. Turns an Android phone (Chrome + Web NFC) into the card reader for the Health Centre app.
 * Reads the card's serial number and POSTs it to /api/v1/demo/tap; the open app screens do the lookup.
 *
 * Web NFC needs: Chrome on Android, a secure context (https, localhost, or an origin you have marked
 * as secure in chrome://flags), and a tap on the Start button (a user gesture).
 */
(() => {
  'use strict';

  const TAP_URL = '/api/v1/demo/tap';
  const KEY_STORE = 'hc.demoKey';
  const SAME_CARD_MS = 2500; // a card resting on the phone can be reported twice; ignore the repeat

  const $ = (id) => document.getElementById(id);
  const keyInput = $('key');
  const startBtn = $('start');
  const statusEl = $('status');
  const recentEl = $('recent');
  const recentEmpty = $('recent-empty');
  const manualInput = $('manual');
  const sendBtn = $('send');

  let reading = false;
  let last = { uid: '', at: 0 };

  /* ---------- small helpers ---------- */

  function setStatus(kind, text, detail) {
    statusEl.className = kind;
    statusEl.textContent = text;
    if (detail) {
      const small = document.createElement('small');
      small.textContent = detail;
      statusEl.appendChild(small);
    }
  }

  function addRecent(uid, note) {
    recentEmpty.hidden = true;
    const li = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = uid;
    const span = document.createElement('span');
    span.textContent = note;
    li.append(code, span);
    recentEl.prepend(li);
    while (recentEl.children.length > 6) recentEl.lastChild.remove();
  }

  const getKey = () => keyInput.value.trim();
  const storeKey = () => {
    try { localStorage.setItem(KEY_STORE, getKey()); } catch { /* private mode: fine */ }
  };

  // ?key=... in the address is a convenience for the QR/link; keep it out of the address bar afterwards.
  (function initKey() {
    const url = new URL(location.href);
    const fromUrl = url.searchParams.get('key');
    let saved = '';
    try { saved = localStorage.getItem(KEY_STORE) || ''; } catch { /* ignore */ }
    keyInput.value = fromUrl || saved;
    if (fromUrl) {
      storeKey();
      url.searchParams.delete('key');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  })();
  keyInput.addEventListener('change', storeKey);

  /* ---------- sending ---------- */

  async function send(uid, source) {
    const key = getKey();
    if (!key) {
      setStatus('bad', 'Enter the demo key first.');
      return;
    }
    let res;
    try {
      res = await fetch(TAP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Demo-Key': key },
        body: JSON.stringify({ rfid_id: uid }),
      });
    } catch {
      setStatus('bad', 'Could not reach the server.', 'Check the phone is on the same Wi-Fi as the laptop.');
      addRecent(uid, 'not sent');
      return;
    }

    if (res.status === 202) {
      const { delivered } = await res.json().catch(() => ({ delivered: 0 }));
      if (delivered > 0) {
        setStatus('ready', `Sent ${uid}`, `${delivered} screen${delivered === 1 ? '' : 's'} received it.`);
        addRecent(uid, source === 'manual' ? 'sent (manual)' : 'sent');
      } else {
        setStatus('warn', `Sent ${uid}, but no screen is listening.`,
          'On the laptop open the app with ?demo=<key> in the address, sign in, and go to Record visit > Student.');
        addRecent(uid, 'no screen');
      }
    } else if (res.status === 401) {
      setStatus('bad', 'Wrong demo key.');
      addRecent(uid, 'wrong key');
    } else if (res.status === 404) {
      setStatus('bad', 'Demo mode is off on the server.', 'Start the server with DEMO_TAP=1 and a DEMO_TAP_KEY.');
      addRecent(uid, 'demo off');
    } else if (res.status === 429) {
      setStatus('bad', 'Too many wrong keys. Wait a minute and try again.');
    } else {
      setStatus('bad', `The server answered ${res.status}.`);
      addRecent(uid, `error ${res.status}`);
    }
    if (navigator.vibrate) navigator.vibrate(res.status === 202 ? 60 : [60, 60, 60]);
  }

  function onCard(uid) {
    const now = Date.now();
    if (uid === last.uid && now - last.at < SAME_CARD_MS) return;
    last = { uid, at: now };
    send(uid, 'card');
  }

  /* ---------- reading cards ---------- */

  async function keepScreenOn() {
    try {
      if ('wakeLock' in navigator) await navigator.wakeLock.request('screen');
    } catch { /* optional nicety */ }
  }

  function unavailableReason() {
    if (!window.isSecureContext) {
      return {
        text: 'This page is not in a secure context, so Chrome blocks NFC.',
        detail: `In Chrome open chrome://flags, search "Insecure origins treated as secure", add ${location.origin}, enable it and relaunch Chrome. Or open this page over https.`,
      };
    }
    if (!('NDEFReader' in window)) {
      return { text: 'Web NFC is not available here.', detail: 'Use Chrome on an Android phone with NFC switched on.' };
    }
    return null;
  }

  async function start() {
    if (!getKey()) {
      setStatus('bad', 'Enter the demo key first.');
      keyInput.focus();
      return;
    }
    storeKey();
    const blocked = unavailableReason();
    if (blocked) {
      setStatus('bad', blocked.text, blocked.detail);
      return;
    }
    if (reading) return;

    startBtn.disabled = true;
    try {
      const reader = new NDEFReader();
      await reader.scan(); // asks for NFC permission the first time
      reader.addEventListener('reading', (event) => {
        const uid = String(event.serialNumber || '').trim();
        if (!uid) {
          setStatus('warn', 'The card was read but gave no serial number.', 'Try again, or use another card.');
          return;
        }
        onCard(uid);
      });
      reader.addEventListener('readingerror', () => {
        setStatus('warn', 'Could not read that card.', 'Hold it flat against the back of the phone, near the camera, and keep still.');
      });
      reading = true;
      startBtn.textContent = 'Reader is on';
      setStatus('ready', 'Ready. Hold a card on the back of the phone.', 'Keep this page open and the screen on.');
      keepScreenOn();
    } catch (err) {
      startBtn.disabled = false;
      if (err && err.name === 'NotAllowedError') {
        setStatus('bad', 'NFC permission was refused.', 'Allow NFC for this site in Chrome (lock icon > Permissions), then press Start again.');
      } else if (err && err.name === 'NotSupportedError') {
        setStatus('bad', 'NFC is switched off on this phone.', 'Turn on NFC in the phone settings and press Start again.');
      } else {
        setStatus('bad', 'Could not start the reader.', err && err.message ? err.message : String(err));
      }
    }
  }

  startBtn.addEventListener('click', start);

  sendBtn.addEventListener('click', () => {
    const uid = manualInput.value.trim();
    if (!uid) return;
    send(uid, 'manual');
  });
  manualInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendBtn.click();
  });

  // The screen wake lock is released whenever the page is hidden; take it again when the page returns.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && reading) keepScreenOn();
  });
})();
