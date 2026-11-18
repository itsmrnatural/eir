import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/index.js';
import { friendlyMessage } from '../../api/errors.js';
import Field from '../../components/Field.jsx';
import Modal from '../../components/Modal.jsx';
import { Alert } from '../../components/States.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatDateTime } from '../../lib/datetime.js';
import HealthIssueField, { OTHER, resolveIssue } from '../visit/HealthIssueField.jsx';

/** Admin correction of a past visit. Only health_issue and remedy can change (PATCH /visits/:id). */
export default function EditVisitDialog({ visit, onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const issuesQ = useQuery({ queryKey: ['meta', 'health-issues'], queryFn: api.listHealthIssues, staleTime: Infinity });
  const [issue, setIssue] = useState(visit.health_issue_is_custom ? OTHER : visit.health_issue);
  const [custom, setCustom] = useState(visit.health_issue_is_custom ? visit.health_issue : '');
  const [remedy, setRemedy] = useState(visit.remedy);
  const [errors, setErrors] = useState({});
  const [note, setNote] = useState(null);
  const customRef = useRef(null);
  const remedyRef = useRef(null);

  const save = useMutation({
    mutationFn: (patch) => api.patchVisit(visit.visit_id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['history'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      toast.success('Visit updated');
      onClose();
    },
    onError: (err) => setNote({ kind: 'error', text: friendlyMessage(err) }),
  });

  function submit(e) {
    e.preventDefault();
    if (save.isPending) return;
    const { health_issue } = resolveIssue(issue, custom);
    const errs = {};
    if (!health_issue) errs.custom = 'Choose or describe the health issue.';
    if (!remedy.trim()) errs.remedy = 'Enter the remedy (medicine).';
    setErrors(errs);
    if (errs.custom) return customRef.current?.focus();
    if (errs.remedy) return remedyRef.current?.focus();
    const patch = {};
    if (health_issue !== visit.health_issue) patch.health_issue = health_issue;
    if (remedy.trim() !== visit.remedy) patch.remedy = remedy.trim();
    if (!Object.keys(patch).length) return setNote({ kind: 'info', text: 'Nothing has changed yet.' });
    setNote(null);
    return save.mutate(patch);
  }

  return (
    <Modal title="Edit visit" onClose={onClose}>
      <form onSubmit={submit} noValidate className="stack">
        <p className="hint">
          Visit of {visit.snapshot?.name} on {formatDateTime(visit.date_time)}. Corrections are recorded in the audit log.
        </p>
        <HealthIssueField
          issues={issuesQ.data ?? []}
          value={issue}
          onChange={setIssue}
          custom={custom}
          onCustomChange={setCustom}
          customRef={customRef}
          issueError={errors.issue}
          customError={errors.custom}
        />
        <Field label="Remedy (medicine)" error={errors.remedy}>
          <input ref={remedyRef} value={remedy} onChange={(e) => setRemedy(e.target.value)} maxLength={200} autoComplete="off" />
        </Field>
        {note && <Alert kind={note.kind}>{note.text}</Alert>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
