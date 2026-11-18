import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api/index.js';
import DataTable from '../components/DataTable.jsx';
import ExportFhirButton from '../components/ExportFhirButton.jsx';
import Field from '../components/Field.jsx';
import PatientCard from '../components/PatientCard.jsx';
import { Empty, ErrorBox, Loading } from '../components/States.jsx';
import EditVisitDialog from '../features/history/EditVisitDialog.jsx';
import { downloadCsv, toCsv } from '../lib/csv.js';
import { formatDate, formatDateTime, rangeError } from '../lib/datetime.js';
import { slug } from '../lib/format.js';

const csvColumns = [
  { header: 'Date and time (IST)', value: (v) => formatDateTime(v.date_time) },
  { header: 'Health issue', value: (v) => v.health_issue },
  { header: 'Custom issue', value: (v) => (v.health_issue_is_custom ? 'Yes' : 'No') },
  { header: 'Remedy', value: (v) => v.remedy },
  { header: 'Age at visit', value: (v) => v.snapshot?.age_at_visit },
  { header: 'Recorded by (user id)', value: (v) => v.recorded_by },
  { header: 'Visit ID', value: (v) => v.visit_id },
];

export default function PatientHistoryPage() {
  const { id } = useParams();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [editing, setEditing] = useState(null);
  const problem = rangeError(from, to);

  const q = useQuery({
    queryKey: ['history', id, from, to],
    queryFn: () => api.getPatientHistory(id, { from, to }),
    enabled: !problem,
  });
  const patient = q.data?.patient;
  const items = q.data?.items ?? [];
  const rangeLabel = from || to ? `${from ? formatDate(from) : 'the first visit'} to ${to ? formatDate(to) : 'today'}` : 'All visits';

  const columns = [
    { header: 'Date and time', value: (v) => formatDateTime(v.date_time) },
    { header: 'Health issue', value: (v) => (v.health_issue_is_custom ? `${v.health_issue} (other)` : v.health_issue) },
    { header: 'Remedy', value: (v) => v.remedy },
    { header: 'Age', value: (v) => v.snapshot?.age_at_visit ?? '—' },
    {
      header: 'Edit',
      className: 'no-print',
      value: (v) => (
        <button type="button" className="btn btn-small" onClick={() => setEditing(v)} aria-label={`Edit visit on ${formatDateTime(v.date_time)}`}>
          Edit
        </button>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head no-print">
        <h1>Visit history</h1>
        <p><Link to={`/patients/${id}`}>Back to patient</Link></p>
      </div>
      <h1 className="print-only">Visit history{patient ? `: ${patient.name}` : ''}</h1>
      <p className="print-only">Showing: {rangeLabel}. Printed {formatDateTime(new Date())} (IST).</p>

      {patient && <PatientCard patient={patient} />}

      <section className="card range no-print" aria-label="Date range">
        <Field label="From"><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => { setFrom(''); setTo(''); }} disabled={!from && !to}>
          Clear dates
        </button>
        {problem && <p className="field-error" role="alert">{problem}</p>}
      </section>

      <div className="actions no-print">
        <button type="button" className="btn" onClick={() => window.print()} disabled={!patient}>Print</button>
        <button
          type="button"
          className="btn"
          disabled={!patient || items.length === 0}
          onClick={() => downloadCsv(`history-${slug(patient.name)}-${from || 'all'}_${to || 'all'}.csv`, toCsv(csvColumns, items))}
        >
          Download CSV
        </button>
        <ExportFhirButton filename={`fhir-patient-${slug(patient?.name)}.json`} fetcher={() => api.exportFhirPatient(id)} disabled={!patient} />
      </div>

      {q.isLoading && !problem ? (
        <Loading label="Loading visits…" />
      ) : q.isError ? (
        <ErrorBox error={q.error} onRetry={q.refetch} />
      ) : patient && items.length === 0 ? (
        <Empty>No visits in this range.</Empty>
      ) : patient ? (
        <>
          <p className="hint">{q.data.total} {q.data.total === 1 ? 'visit' : 'visits'}, newest first. The FHIR export always contains the full record.</p>
          <DataTable columns={columns} rows={items} caption="Visits" />
        </>
      ) : null}

      {editing && <EditVisitDialog visit={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
