import { useCallback, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import * as api from '../../api/index.js';
import { friendlyMessage } from '../../api/errors.js';
import { Alert } from '../../components/States.jsx';
import { DEV_TAP_EVENT } from '../../lib/devEvents.js';
import TapPanel from './TapPanel.jsx';
import VisitEntry from './VisitEntry.jsx';

/** Students are identified only by card; there is no registration form here. */
export default function StudentFlow() {
  const [patient, setPatient] = useState(null);
  const [problem, setProblem] = useState(null); // {text, tag, code}
  const [hint, setHint] = useState(null);

  const lookup = useMutation({
    mutationFn: (tag) => api.getPatientByRfid(tag),
    onSuccess: (p) => {
      setProblem(null);
      setPatient(p);
    },
    onError: (err, tag) => {
      setPatient(null);
      setProblem({ code: err.code, text: friendlyMessage(err), tag });
    },
  });

  const onScan = useCallback(
    (tag) => {
      setHint(null);
      lookup.mutate(tag);
    },
    [lookup.mutate], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Development only: the dev panel can fire a tap without hardware.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const handler = (e) => onScan(e.detail.rfid_id);
    window.addEventListener(DEV_TAP_EVENT, handler);
    return () => window.removeEventListener(DEV_TAP_EVENT, handler);
  }, [onScan]);

  const reset = () => {
    setPatient(null);
    setProblem(null);
    setHint(null);
  };

  if (patient) return <VisitEntry key={patient.patient_id} patient={patient} onDone={reset} onCancel={reset} />;

  return (
    <div className="stack">
      <TapPanel
        busy={lookup.isPending}
        onScan={onScan}
        onRejected={(r) =>
          setHint(
            r.reason === 'too_slow'
              ? 'That looked like typing, not a card tap. Hold the card on the reader.'
              : 'The card was not read properly. Hold it on the reader again.',
          )
        }
      />
      {problem && (
        <Alert kind="error" className="alert alert-error alert-big">
          <p className="alert-title">{problem.text}</p>
          <p className="hint">Card ID: {problem.tag}</p>
        </Alert>
      )}
      {hint && <Alert kind="info">{hint}</Alert>}
    </div>
  );
}
