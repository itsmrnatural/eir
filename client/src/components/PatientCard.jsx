import { DESIGNATION_LABEL, SEX_LABEL, branchLabel, formatAge } from '../lib/format.js';
import { formatDate } from '../lib/datetime.js';

/** Read-only summary of a PatientView. Students and non-students show different fields. */
export default function PatientCard({ patient, children }) {
  const student = patient.patient_type === 'STUDENT';
  const rows = student
    ? [
        ['Roll number', patient.roll_no],
        ['Branch', branchLabel(patient)],
        ['Batch', `${patient.batch_year ?? ''} ${patient.program ?? ''}`.trim() || '—'],
        ['Sex', SEX_LABEL[patient.sex] ?? patient.sex],
        ['Age', formatAge(patient)],
        ['Date of birth', formatDate(patient.dob)],
      ]
    : [
        ['Phone', patient.phone_no],
        ['Designation', DESIGNATION_LABEL[patient.designation] ?? patient.designation],
        ['Sex', SEX_LABEL[patient.sex] ?? patient.sex],
        ['Age', formatAge(patient)],
      ];
  return (
    <section className="card patient-card" aria-label="Patient details">
      <header>
        <h2>{patient.name}</h2>
        <span className="badge">{student ? 'Student' : 'Non-student'}</span>
      </header>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v ?? '—'}</dd>
          </div>
        ))}
      </dl>
      {children}
    </section>
  );
}
