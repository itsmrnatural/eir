import Field from '../../components/Field.jsx';
import { addDays, startOfMonth, todayIST } from '../../lib/datetime.js';

/** From/To dates (YYYY-MM-DD, inclusive, Asia/Kolkata) with quick presets. */
export default function RangePicker({ from, to, onChange, error }) {
  const today = todayIST();
  const presets = [
    { label: 'Last 7 days', from: addDays(today, -6) },
    { label: 'Last 30 days', from: addDays(today, -29) },
    { label: 'This month', from: startOfMonth(today) },
  ];
  return (
    <section className="card range" aria-label="Date range">
      <Field label="From">
        <input type="date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} />
      </Field>
      <Field label="To">
        <input type="date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} />
      </Field>
      <div className="presets" role="group" aria-label="Quick ranges">
        {presets.map((p) => (
          <button key={p.label} type="button" className="btn btn-small" onClick={() => onChange(p.from, today)}>
            {p.label}
          </button>
        ))}
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
}
