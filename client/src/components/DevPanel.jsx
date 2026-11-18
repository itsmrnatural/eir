import { useState } from 'react';
import { DEV_TAP_EVENT } from '../lib/devEvents.js';
import { MOCK_RFIDS } from '../mocks/db.js';

/** Development only (see Layout). Lets the demo run without RFID hardware. */
export default function DevPanel() {
  const [value, setValue] = useState('');
  const mock = import.meta.env.MODE === 'mock';
  const tap = (id) => window.dispatchEvent(new CustomEvent(DEV_TAP_EVENT, { detail: { rfid_id: id } }));

  return (
    <aside className="dev-panel no-print" aria-label="Developer tools">
      <details open>
        <summary>Dev panel</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) tap(value.trim());
          }}
        >
          <label htmlFor="dev-rfid">Simulate RFID tap</label>
          <div className="row">
            <input id="dev-rfid" value={value} onChange={(e) => setValue(e.target.value)} placeholder="card ID" autoComplete="off" />
            <button type="submit" className="btn btn-small">Tap</button>
          </div>
        </form>
        <p className="hint">Works on Record visit in Student mode.</p>
        {mock && (
          <ul className="dev-cards">
            {MOCK_RFIDS.map((c) => (
              <li key={c.id}>
                <button type="button" className="link" onClick={() => tap(c.id)}>{c.id}</button>
                <span>{c.note}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </aside>
  );
}
