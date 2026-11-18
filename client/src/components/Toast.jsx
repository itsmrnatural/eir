import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);
let seq = 0;

/** Short confirmations. The live region is always mounted so screen readers announce new toasts. */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((text, kind) => {
    seq += 1;
    const id = seq;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  const api = useMemo(() => ({ success: (t) => push(t, 'success'), error: (t) => push(t, 'error') }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts no-print" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
