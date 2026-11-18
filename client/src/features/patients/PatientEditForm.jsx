import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/index.js';
import { friendlyMessage } from '../../api/errors.js';
import Field from '../../components/Field.jsx';
import { Alert } from '../../components/States.jsx';
import { useToast } from '../../components/Toast.jsx';
import { isValidYMD, todayIST } from '../../lib/datetime.js';
import { DESIGNATION_OPTIONS, SEX_OPTIONS } from '../../lib/format.js';
import { normalizePhone, phoneError } from '../../lib/phone.js';

/**
 * Edits only the fields staff/admin can patch: name, sex, dob (students), age/phone_no/designation (non-students).
 * Roll number, patient type and card are not editable here. Only changed fields are sent.
 */
export default function PatientEditForm({ patient, onCancel, onSaved }) {
  const qc = useQueryClient();
  const toast = useToast();
  const student = patient.patient_type === 'STUDENT';
  const initial = useMemo(
    () => ({
      name: patient.name,
      sex: patient.sex,
      dob: patient.dob?.slice(0, 10) ?? '',
      age: String(patient.age ?? ''),
      phone_no: patient.phone_no ?? '',
      designation: patient.designation ?? '',
    }),
    [patient],
  );
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState({});
  const [note, setNote] = useState(null); // {kind, text}
  const nameRef = useRef(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: (patch) => api.patchPatient(patient.patient_id, patch),
    onSuccess: (updated) => {
      qc.setQueryData(['patient', patient.patient_id], updated);
      qc.invalidateQueries({ queryKey: ['patients'] });
      toast.success('Details saved');
      onSaved(updated);
    },
    onError: (err) => setNote({ kind: 'error', text: friendlyMessage(err) }),
  });

  function submit(e) {
    e.preventDefault();
    if (save.isPending) return;
    const errs = {};
    if (!f.name.trim()) errs.name = 'Enter the name.';
    if (student) {
      if (!isValidYMD(f.dob) || f.dob > todayIST() || f.dob < '1900-01-01') errs.dob = 'Enter a valid date of birth in the past.';
    } else {
      const age = Number(f.age);
      if (f.age === '' || !Number.isInteger(age) || age < 0 || age > 120) errs.age = 'Enter a whole-number age from 0 to 120.';
      const pe = phoneError(f.phone_no);
      if (pe) errs.phone_no = pe;
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      setNote(null);
      return;
    }

    const patch = {};
    if (f.name.trim() !== initial.name) patch.name = f.name.trim();
    if (f.sex !== initial.sex) patch.sex = f.sex;
    if (student) {
      if (f.dob !== initial.dob) patch.dob = f.dob;
    } else {
      if (f.age !== initial.age) patch.age = Number(f.age);
      if (normalizePhone(f.phone_no) !== normalizePhone(initial.phone_no)) patch.phone_no = normalizePhone(f.phone_no);
      if (f.designation !== initial.designation) patch.designation = f.designation;
    }
    if (!Object.keys(patch).length) {
      setNote({ kind: 'info', text: 'Nothing has changed yet.' });
      return;
    }
    setNote(null);
    save.mutate(patch);
  }

  return (
    <form className="card form-grid" onSubmit={submit} noValidate aria-label="Edit patient details">
      <h2>Edit details</h2>
      <p className="hint span-all">
        Roll number, card and patient type cannot be changed here. Every change is recorded in the audit log.
      </p>
      <Field label="Name" error={errors.name}>
        <input ref={nameRef} value={f.name} onChange={set('name')} maxLength={100} autoComplete="off" autoFocus />
      </Field>
      <Field label="Sex">
        <select value={f.sex} onChange={set('sex')}>
          {SEX_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
      {student ? (
        <Field label="Date of birth" error={errors.dob}>
          <input type="date" value={f.dob} max={todayIST()} onChange={set('dob')} />
        </Field>
      ) : (
        <>
          <Field label="Age" error={errors.age} hint="Saving a new age restarts the age estimate from today.">
            <input type="number" inputMode="numeric" min="0" max="120" value={f.age} onChange={set('age')} />
          </Field>
          <Field label="Phone number" error={errors.phone_no}>
            <input type="tel" inputMode="tel" value={f.phone_no} onChange={set('phone_no')} autoComplete="off" />
          </Field>
          <Field label="Designation">
            <select value={f.designation} onChange={set('designation')}>
              {DESIGNATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </>
      )}
      {note && <Alert kind={note.kind} className={`alert alert-${note.kind} span-all`}>{note.text}</Alert>}
      <div className="actions span-all">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  );
}
