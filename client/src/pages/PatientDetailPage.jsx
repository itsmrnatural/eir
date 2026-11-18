import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import ExportFhirButton from '../components/ExportFhirButton.jsx';
import PatientCard from '../components/PatientCard.jsx';
import { ErrorBox, Loading } from '../components/States.jsx';
import PatientEditForm from '../features/patients/PatientEditForm.jsx';
import { slug } from '../lib/format.js';

export default function PatientDetailPage() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['patient', id], queryFn: () => api.getPatient(id) });

  if (q.isLoading) return <div className="page"><Loading label="Loading patient…" /></div>;
  if (q.isError) {
    return (
      <div className="page">
        <h1>Patient record</h1>
        <ErrorBox error={q.error} onRetry={q.refetch} />
        <p><Link to="/patients">Back to search</Link></p>
      </div>
    );
  }
  const p = q.data;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Patient record</h1>
        <p><Link to="/patients">Back to search</Link></p>
      </div>
      <PatientCard patient={p}>
        {p.rfid_id && <p className="hint">Card ID: {p.rfid_id}. Card changes are made by an admin script.</p>}
      </PatientCard>
      {editing ? (
        <PatientEditForm patient={p} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />
      ) : (
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>Edit details</button>
          {isAdmin && <Link className="btn" to={`/admin/patients/${p.patient_id}/history`}>View visit history</Link>}
          {isAdmin && (
            <ExportFhirButton
              filename={`fhir-patient-${slug(p.name)}.json`}
              fetcher={() => api.exportFhirPatient(p.patient_id)}
            />
          )}
        </div>
      )}
    </div>
  );
}
