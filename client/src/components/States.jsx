import { friendlyMessage } from '../api/errors.js';

export function Loading({ label = 'Loading…' }) {
  return (
    <p className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  );
}

export function ErrorBox({ error, onRetry }) {
  return (
    <div className="alert alert-error" role="alert">
      <span>{friendlyMessage(error)}</span>
      {onRetry && (
        <button type="button" className="btn btn-small" onClick={() => onRetry()}>
          Try again
        </button>
      )}
    </div>
  );
}

/** kind: 'info' | 'error' | 'success' | 'warn' */
export function Alert({ kind = 'info', children, ...rest }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'} {...rest}>
      {children}
    </div>
  );
}

export function Empty({ children }) {
  return <p className="empty">{children}</p>;
}
