import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/index.js';
import { friendlyMessage } from '../../api/errors.js';
import Field from '../../components/Field.jsx';
import { useToast } from '../../components/Toast.jsx';
import { DESIGNATION_OPTIONS, SEX_OPTIONS } from '../../lib/format.js';
import { normalizePhone, phoneError } from '../../lib/phone.js';

function validate(f) {
  const e = {};
  const pe = phoneError(f.phone);
  if (pe) e.phone = pe;
  if (!f.name.trim()) e.name = 'Enter the name.';
  const age = Number(f.age);
  if (f.age === '' || !Number.isInteger(age) || age < 0 || age > 120) e.age = 'Enter a whole-number age from 0 to 120.';
  if (!f.sex) e.sex = 'Choose sex.';
  if (!f.designation) e.designation = 'Choose a designation.';
  return e;
}

/** Registers a faculty/staff/worker/other. The age typed here is an estimate that the server keeps ageing. */
export default function NewNonStudentForm({ initialPhone = '', onCreated, onPickExisting }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ phone: initialPhone, name: '', age: '', sex: '', designation: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null); // {code, text}
  const refs = { phone: useRef(null), name: useRef(null), age: useRef(null), sex: useRef(null), designation: useRef(null) };
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    (initialPhone ? refs.name : refs.phone).current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = useMutation({
    mutationFn: (body) => api.createNonStudent(body),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      toast.success(`Registered ${p.name}`);
      onCreated(p);
    },
    onError: (err) => setServerError({ code: err.code, text: friendlyMessage(err) }),
  });

  function submit(e) {
    e.preventDefault();
    if (create.isPending) return;
    const errs = validate(f);
    setErrors(errs);
    setServerError(null);
    const first = ['phone', 'name', 'age', 'sex', 'designation'].find((k) => errs[k]);
    if (first) {
      refs[first].current?.focus();
      return;
    }
    create.mutate({ name: f.name.trim(), age: Number(f.age), sex: f.sex, phone_no: normalizePhone(f.phone), designation: f.designation });
  }

  return (
    <form className="card form-grid" onSubmit={submit} noValidate aria-label="Register a new person">
      <h2>Register a new person</h2>
      <Field label="Phone number" error={errors.phone}>
        <input ref={refs.phone} type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} autoComplete="off" />
      </Field>
      <Field label="Name" error={errors.name}>
        <input ref={refs.name} value={f.name} onChange={set('name')} maxLength={100} autoComplete="off" />
      </Field>
      <Field label="Age" error={errors.age} hint="An estimate is fine.">
        <input ref={refs.age} type="number" inputMode="numeric" min="0" max="120" value={f.age} onChange={set('age')} />
      </Field>
      <Field label="Sex" error={errors.sex}>
        <select ref={refs.sex} value={f.sex} onChange={set('sex')}>
          <option value="" disabled>Select</option>
          {SEX_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Designation" error={errors.designation}>
        <select ref={refs.designation} value={f.designation} onChange={set('designation')}>
          <option value="" disabled>Select</option>
          {DESIGNATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>

      {serverError && (
        <div className="alert alert-error span-all" role="alert">
          <div>
            <p className="alert-title">{serverError.code === 'PHONE_LIMIT_REACHED' ? 'This phone number is full' : 'Could not register this person'}</p>
            <p>{serverError.text}</p>
            {serverError.code === 'PHONE_LIMIT_REACHED' && (
              <button type="button" className="btn btn-small" onClick={() => onPickExisting(normalizePhone(f.phone))}>
                Show the people on this number
              </button>
            )}
          </div>
        </div>
      )}
      <div className="actions span-all">
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          {create.isPending ? 'Registering…' : 'Register and continue'}
        </button>
      </div>
    </form>
  );
}
