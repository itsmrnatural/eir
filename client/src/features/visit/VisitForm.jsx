import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/index.js';
import { friendlyMessage } from '../../api/errors.js';
import Clock from '../../components/Clock.jsx';
import Field from '../../components/Field.jsx';
import Modal from '../../components/Modal.jsx';
import { ErrorBox } from '../../components/States.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatTime } from '../../lib/datetime.js';
import HealthIssueField, { OTHER, resolveIssue } from './HealthIssueField.jsx';

/** Health issue + remedy for one patient. The server sets date_time and recorded_by. */
export default function VisitForm({ patient, onSaved, onCancel }) {
  const qc = useQueryClient();
  const toast = useToast();
  const selectRef = useRef(null);
  const customRef = useRef(null);
  const remedyRef = useRef(null);
  const [issue, setIssue] = useState('');
  const [custom, setCustom] = useState('');
  const [remedy, setRemedy] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [dup, setDup] = useState(null); // {at} while the duplicate-visit question is open
  // React Query runs onError before it clears isPending, so the duplicate dialog would open
  // with disabled buttons for one render. Track submission ourselves.
  const [submitting, setSubmitting] = useState(false);

  const issuesQ = useQuery({ queryKey: ['meta', 'health-issues'], queryFn: api.listHealthIssues, staleTime: Infinity });

  useEffect(() => {
    selectRef.current?.focus();
  }, []);
  useEffect(() => {
    if (issue === OTHER) customRef.current?.focus();
  }, [issue]);

  const save = useMutation({
    mutationFn: (confirmDuplicate) =>
      api.createVisit({
        patient_id: patient.patient_id,
        ...resolveIssue(issue, custom),
        remedy: remedy.trim(),
        ...(confirmDuplicate ? { confirm_duplicate: true } : {}),
      }),
    onSuccess: () => {
      setSubmitting(false);
      setDup(null);
      qc.invalidateQueries({ queryKey: ['history'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      toast.success(`Visit saved for ${patient.name}`);
      onSaved();
    },
    onError: (err) => {
      setSubmitting(false);
      if (err.code === 'DUPLICATE_VISIT_WARNING') {
        setServerError(null);
        setDup({ at: err.details?.last_visit_at ?? null });
      } else {
        setDup(null);
        setServerError(friendlyMessage(err));
      }
    },
  });

  function submit(e) {
    e.preventDefault();
    if (submitting) return;
    const next = {};
    if (!issue) next.issue = 'Choose a health issue.';
    else if (issue === OTHER && !custom.trim()) next.custom = 'Describe the health issue.';
    if (!remedy.trim()) next.remedy = 'Enter the remedy (medicine) given.';
    setErrors(next);
    if (next.issue) return selectRef.current?.focus();
    if (next.custom) return customRef.current?.focus();
    if (next.remedy) return remedyRef.current?.focus();
    setServerError(null);
    setSubmitting(true);
    return save.mutate(false);
  }

  return (
    <>
      <form
        className="card visit-form"
        aria-label="Visit details"
        noValidate
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !dup) {
            e.preventDefault();
            onCancel();
          }
        }}
      >
        <h2>Visit details</h2>
        <p className="meta-line">
          Date and time: <Clock /> <span className="hint">(recorded automatically when you save)</span>
        </p>
        {issuesQ.isError && <ErrorBox error={issuesQ.error} onRetry={issuesQ.refetch} />}
        <HealthIssueField
          issues={issuesQ.data ?? []}
          value={issue}
          onChange={setIssue}
          custom={custom}
          onCustomChange={setCustom}
          selectRef={selectRef}
          customRef={customRef}
          issueError={errors.issue}
          customError={errors.custom}
        />
        <Field label="Remedy (medicine)" error={errors.remedy}>
          <input ref={remedyRef} value={remedy} onChange={(e) => setRemedy(e.target.value)} maxLength={200} autoComplete="off" />
        </Field>
        {serverError && (
          <div className="alert alert-error" role="alert">{serverError}</div>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save visit'}
          </button>
        </div>
        <p className="hint">Esc cancels and returns to the card reader.</p>
      </form>

      {dup && (
        <Modal title="Possible duplicate visit" role="alertdialog" onClose={() => setDup(null)}>
          <p>
            {dup.at
              ? `This patient already has a visit at ${formatTime(dup.at)}. Save another?`
              : 'This patient already has a very recent visit. Save another?'}
          </p>
          <div className="actions">
            <button type="button" className="btn" onClick={() => setDup(null)} disabled={submitting}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              data-autofocus
              onClick={() => {
                setSubmitting(true);
                save.mutate(true);
              }}
              disabled={submitting}
            >
              {submitting ? 'Saving…' : 'Save another'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
