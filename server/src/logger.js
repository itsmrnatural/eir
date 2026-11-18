import pino from 'pino';

/**
 * Pino logger. Credentials never reach the logs: request bodies are not logged at all, and
 * the paths below are redacted as a second line of defence.
 */
export function createLogger({ level = 'info', stream } = {}) {
  return pino(
    {
      level,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          '*.password',
          '*.token',
          '*.password_hash',
        ],
        censor: '[REDACTED]',
      },
    },
    stream,
  );
}

/**
 * Patient identifiers that live in the URL path (phone numbers, RFID tags) and all query
 * strings (search terms) are personal data; keep them out of the access log.
 */
export function sanitizeUrl(url = '') {
  const path = String(url).split('?')[0];
  return path
    .replace(/\/by-phone\/[^/]+/, '/by-phone/:phone_no')
    .replace(/\/by-rfid\/[^/]+/, '/by-rfid/:rfid_id');
}
