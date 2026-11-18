import { useState } from 'react';
import Segmented from '../../components/Segmented.jsx';
import ExistingLookup from './ExistingLookup.jsx';
import NewNonStudentForm from './NewNonStudentForm.jsx';
import VisitEntry from './VisitEntry.jsx';

/** Non-students are identified by phone number: pick an existing person or register a new one. */
export default function NonStudentFlow() {
  const [tab, setTab] = useState('existing');
  const [phoneDraft, setPhoneDraft] = useState(''); // carried between the two tabs; also re-mounts them (key)
  const [selected, setSelected] = useState(null);

  if (selected) {
    return (
      <VisitEntry
        key={selected.patient_id}
        patient={selected}
        onDone={() => {
          setSelected(null);
          setPhoneDraft('');
          setTab('existing');
        }}
        onCancel={() => {
          setPhoneDraft(selected.phone_no ?? '');
          setSelected(null);
          setTab('existing');
        }}
      />
    );
  }

  return (
    <div className="stack">
      <Segmented
        name="non-student-mode"
        legend="Existing or new person"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'existing', label: 'Existing' },
          { value: 'new', label: 'New' },
        ]}
      />
      {tab === 'existing' ? (
        <ExistingLookup
          key={`e-${phoneDraft}`}
          initialPhone={phoneDraft}
          onSelect={setSelected}
          onRegisterNew={(p) => {
            setPhoneDraft(p);
            setTab('new');
          }}
        />
      ) : (
        <NewNonStudentForm
          key={`n-${phoneDraft}`}
          initialPhone={phoneDraft}
          onCreated={setSelected}
          onPickExisting={(p) => {
            setPhoneDraft(p);
            setTab('existing');
          }}
        />
      )}
    </div>
  );
}
