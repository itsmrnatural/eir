import { useEffect, useRef, useState } from 'react';
import { RFID_CONFIG, classifyScan, clock } from '../../lib/rfid.js';

/**
 * Captures an RFID reader that types like a keyboard. An always-focused, visually hidden input receives
 * the keystrokes; classifyScan() separates a card tap (fast burst + Enter) from human typing.
 * Human-typed input is never sent as a card ID. Calls onScan(tag) for taps, onRejected(result) otherwise.
 */
export default function TapPanel({ busy, onScan, onRejected }) {
  const inputRef = useRef(null);
  const keys = useRef([]);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function finish() {
    const result = classifyScan(keys.current);
    keys.current = [];
    if (result.ok) onScan(result.tag);
    else if (result.tag) onRejected?.(result);
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter' || (e.key === 'Tab' && keys.current.length)) {
      e.preventDefault();
      finish();
    } else if (e.key === 'Escape') {
      keys.current = [];
    } else if (e.key.length === 1) {
      e.preventDefault(); // the buffer is our source of truth, nothing needs to be typed into the input
      const t = clock.now();
      const last = keys.current[keys.current.length - 1];
      if (last && t - last.t > RFID_CONFIG.staleMs) keys.current = [];
      keys.current.push({ ch: e.key, t });
    }
  }

  return (
    <div className={`tap-panel${focused ? ' ready' : ''}${busy ? ' busy' : ''}`} onClick={() => inputRef.current?.focus()}>
      <div className="tap-ring" aria-hidden="true"><span /></div>
      <div className="tap-text">
        <h2>Tap card</h2>
        <p>Hold the student ID card on the reader.</p>
        <p className="tap-status" role="status">
          {busy ? 'Looking up card…' : focused ? 'Reader ready' : 'Click here to turn the reader on'}
        </p>
      </div>
      <input
        ref={inputRef}
        className="sr-only"
        aria-label="RFID reader input"
        autoComplete="off"
        inputMode="none"
        spellCheck={false}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          setFocused(false);
          keys.current = [];
          // Clicking empty space puts focus back on the reader; tabbing to another control is left alone.
          if (!e.relatedTarget) setTimeout(() => inputRef.current?.focus(), 0);
        }}
      />
    </div>
  );
}
