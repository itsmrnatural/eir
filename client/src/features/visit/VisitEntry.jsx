import PatientCard from '../../components/PatientCard.jsx';
import VisitForm from './VisitForm.jsx';

/** Patient summary next to the visit form: the second half of both student and non-student flows. */
export default function VisitEntry({ patient, onDone, onCancel }) {
  return (
    <div className="visit-entry">
      <PatientCard patient={patient} />
      <VisitForm patient={patient} onSaved={onDone} onCancel={onCancel} />
    </div>
  );
}
