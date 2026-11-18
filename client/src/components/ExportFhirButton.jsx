import { useMutation } from '@tanstack/react-query';
import { friendlyMessage } from '../api/errors.js';
import { downloadBlob } from '../lib/csv.js';
import { useToast } from './Toast.jsx';

/** Calls fetcher() (an api export function returning a Blob) and saves the result as a .json file. */
export default function ExportFhirButton({ label = 'Export FHIR (JSON)', filename, fetcher, disabled }) {
  const toast = useToast();
  const m = useMutation({
    mutationFn: async () => downloadBlob(filename, await fetcher()),
    onSuccess: () => toast.success(`Downloaded ${filename}`),
    onError: (err) => toast.error(friendlyMessage(err)),
  });
  return (
    <button type="button" className="btn no-print" disabled={disabled || m.isPending} onClick={() => m.mutate()}>
      {m.isPending ? 'Preparing export…' : label}
    </button>
  );
}
