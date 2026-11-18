// AppError + the error codes from the API contract.
// Usage:  throw new AppError('NOT_FOUND', 'Patient not found', { patient_id })
// Callers should branch on `err.code` (string), not on `instanceof`, in case
// two copies of this class end up in node_modules.

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

export const ERROR_CODES = Object.freeze(Object.fromEntries(Object.keys(ERROR_STATUS).map((c) => [c, c])));

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
    this.status = ERROR_STATUS[code] ?? 500;
    this.details = details;
  }

  /** The exact wire shape. */
  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const validationError = (message, details = {}) => new AppError('VALIDATION_ERROR', message, details);
