/**
 * Error codes and their HTTP status. This table is the single source of truth in the server.
 * Repositories throw AppError(code, message, details?) with these codes; we map by
 * duck-typing on `err.code`, so it does not matter which AppError class instance is thrown.
 */
export const ERROR_STATUS = Object.freeze({
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RFID_NOT_FOUND: 404,
  RFID_INACTIVE: 409,
  PHONE_LIMIT_REACHED: 409,
  DUPLICATE_PATIENT: 409,
  DUPLICATE_VISIT_WARNING: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
});

export class AppError extends Error {
  /**
   * @param {keyof typeof ERROR_STATUS} code
   * @param {string} message
   * @param {object} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Turn anything thrown into { status, body } where body is the standard error envelope.
 * Unknown errors become INTERNAL with a generic message (never leak internals).
 */
export function toErrorResponse(err) {
  const code = err && typeof err.code === 'string' ? err.code : undefined;

  if (code && Object.hasOwn(ERROR_STATUS, code) && code !== 'INTERNAL') {
    return {
      status: ERROR_STATUS[code],
      body: {
        error: {
          code,
          message: String(err.message || code),
          details: isPlainObject(err.details) ? err.details : {},
        },
      },
    };
  }

  // body-parser / http-errors client errors (malformed JSON, body too large, bad charset, ...)
  if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 500 && err.expose) {
    return {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: err.status === 413 ? 'Request body is too large' : 'Request body could not be parsed',
          details: {},
        },
      },
    };
  }

  return {
    status: 500,
    body: { error: { code: 'INTERNAL', message: 'Internal server error', details: {} } },
  };
}
