/** Error thrown for every failed request. Mirrors the standard error envelope. */
export class ApiError extends Error {
  /** @param {{status?:number, code?:string, message?:string, details?:object}} [init] */
  constructor({ status = 0, code = 'INTERNAL', message = 'Unexpected error', details = {} } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Turns any error into text a front-desk user can act on. */
export function friendlyMessage(err) {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  switch (err.code) {
    case 'NETWORK':
      return 'Cannot reach the server. Check the connection and try again.';
    case 'VALIDATION_ERROR':
      return err.message ? `Check the details you entered: ${err.message}` : 'Check the details you entered.';
    case 'UNAUTHENTICATED':
      return 'Your session has ended. Sign in again.';
    case 'FORBIDDEN':
      return 'Your role does not allow this action.';
    case 'NOT_FOUND':
      return 'That record was not found.';
    case 'RFID_NOT_FOUND':
      return 'Card not registered, contact admin';
    case 'RFID_INACTIVE':
      return 'This card has been deactivated, contact admin';
    case 'PHONE_LIMIT_REACHED':
      return 'This phone number already has 5 people registered, which is the maximum. Pick one of them, or use a different number.';
    case 'DUPLICATE_PATIENT':
      return 'Someone with this name is already registered under this phone number.';
    case 'DUPLICATE_VISIT_WARNING':
      return 'This patient already has a very recent visit.';
    default:
      return 'The server hit a problem. Try again, and tell admin if it keeps happening.';
  }
}
