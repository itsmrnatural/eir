import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as api from '../../api/index.js';
import Field from '../../components/Field.jsx';
import { Alert, ErrorBox, Loading } from '../../components/States.jsx';
import { DESIGNATION_LABEL, SEX_LABEL, formatAge } from '../../lib/format.js';
import { normalizePhone, phoneError } from '../../lib/phone.js';

/** Phone number -> up to 5 registered people -> pick one. */
export default function ExistingLookup({ initialPhone = '', onSelect, onRegisterNew }) {
  const [input, setInput] = useState(initialPhone);
  const [phone, setPhone] = useState(initialPhone ? normalizePhone(initialPhone) : null);
  const [problem, setProblem] = useState(null);
  const inputRef = useRef(null);
  const firstRef = useRef(null);

  const q = useQuery({
    queryKey: ['patients', 'by-phone', phone],
    queryFn: () => api.getPatientsByPhone(phone),
    enabled: !!phone,
    staleTime: 0,
    gcTime: 0,
  });
  const items = q.data?.items ?? [];

  useEffect(() => {
    if (!initialPhone) inputRef.current?.focus();
  }, [initialPhone]);
  useEffect(() => {
    if (q.isSuccess && !q.isFetching && items.length) firstRef.current?.focus();
  }, [q.isSuccess, q.isFetching, items.length]);

  function submit(e) {
    e.preventDefault();
    const msg = phoneError(input);
    setProblem(msg);
    if (msg) return;
    const next = normalizePhone(input);
    if (next === phone) q.refetch();
    else setPhone(next);
  }

  return (
    <div className="stack">
      <form className="card form-inline" onSubmit={submit} noValidate>
        <Field label="Phone number" error={problem}>
          <input ref={inputRef} type="tel" inputMode="tel" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={q.isFetching}>Look up</button>
      </form>

      {phone && q.isFetching && <Loading label="Looking up phone number…" />}
      {phone && q.isError && !q.isFetching && <ErrorBox error={q.error} onRetry={q.refetch} />}
      {phone && q.isSuccess && !q.isFetching && items.length === 0 && (
        <Alert kind="info">
          <p>No one is registered under {phone}.</p>
          <button type="button" className="btn" onClick={() => onRegisterNew(phone)}>Register a new person</button>
        </Alert>
      )}
      {phone && q.isSuccess && !q.isFetching && items.length > 0 && (
        <section className="card" aria-label="People on this phone number">
          <h2>Who is visiting?</h2>
          <p className="hint">
            {items.length} of 5 people registered under this number.
            {items.length >= 5 && ' This number is full, so a new person cannot be added to it.'}
          </p>
          <ul className="person-list">
            {items.map((p, i) => (
              <li key={p.patient_id}>
                <button type="button" ref={i === 0 ? firstRef : null} className="person" onClick={() => onSelect(p)}>
                  <strong>{p.name}</strong>
                  <span>{DESIGNATION_LABEL[p.designation] ?? p.designation}</span>
                  <span>{SEX_LABEL[p.sex] ?? p.sex}, age {formatAge(p)}</span>
                </button>
              </li>
            ))}
          </ul>
          {items.length < 5 && (
            <button type="button" className="btn btn-ghost" onClick={() => onRegisterNew(phone)}>Someone else on this number? Register new</button>
          )}
        </section>
      )}
    </div>
  );
}
