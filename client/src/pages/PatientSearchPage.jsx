import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api/index.js';
import DataTable from '../components/DataTable.jsx';
import Field from '../components/Field.jsx';
import { Empty, ErrorBox, Loading } from '../components/States.jsx';
import { DESIGNATION_LABEL, branchLabel, formatAge } from '../lib/format.js';
import { useDebounced } from '../lib/hooks.js';

const columns = [
  { header: 'Name', value: (p) => <Link to={`/patients/${p.patient_id}`}>{p.name}</Link> },
  { header: 'Type', value: (p) => (p.patient_type === 'STUDENT' ? 'Student' : DESIGNATION_LABEL[p.designation] ?? 'Non-student') },
  { header: 'Roll no / phone', value: (p) => p.roll_no ?? p.phone_no ?? '—' },
  { header: 'Branch', value: (p) => (p.patient_type === 'STUDENT' ? branchLabel(p) : '—') },
  { header: 'Age', value: (p) => formatAge(p) },
];

export default function PatientSearchPage() {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 300);
  const inputRef = useRef(null);
  useEffect(() => inputRef.current?.focus(), []);

  const query = useQuery({
    queryKey: ['patients', 'search', q],
    queryFn: () => api.searchPatients(q, 20),
    enabled: q.length >= 2,
  });
  const items = query.data?.items ?? [];

  return (
    <div className="page">
      <h1>Patients</h1>
      <div className="card">
        <Field label="Search by name, roll number or phone" hint="Type at least 2 characters.">
          <input ref={inputRef} type="search" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        </Field>
      </div>
      {q.length >= 2 && (
        <section aria-live="polite">
          {query.isLoading ? (
            <Loading label="Searching…" />
          ) : query.isError ? (
            <ErrorBox error={query.error} onRetry={query.refetch} />
          ) : items.length === 0 ? (
            <Empty>No patients match “{q}”. Check the spelling, or try the roll number or phone.</Empty>
          ) : (
            <>
              <p className="hint">{query.data.total ?? items.length} found{(query.data.total ?? 0) > items.length ? `, showing the first ${items.length}` : ''}.</p>
              <DataTable columns={columns} rows={items} caption="Patient search results" />
            </>
          )}
        </section>
      )}
    </div>
  );
}
