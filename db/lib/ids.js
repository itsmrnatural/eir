import { validationError } from './errors.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

/** Build a v4-format UUID from 16 bytes (used by the seeded generator for reproducible ids). */
export function uuidV4FromBytes(bytes) {
  const b = Uint8Array.from(bytes);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Phone numbers are stored without spaces, dashes, dots or brackets; a leading '+' is kept.
 * Every method that takes or searches a phone number applies this, so "98 765-43210" and
 * "9876543210" are the same number.
 */
export function normalizePhone(raw) {
  if (typeof raw !== 'string') throw validationError('phone_no must be a string', { field: 'phone_no' });
  const cleaned = raw.trim().replace(/[\s\-().]/g, '');
  if (!/^\+?\d{7,15}$/.test(cleaned)) {
    throw validationError('phone_no must contain 7 to 15 digits (optional leading +)', { field: 'phone_no' });
  }
  return cleaned;
}

/**
 * RFID ids are compared trimmed and upper-cased so a reader that emits lower-case hex still
 * matches the imported value. Lenient on purpose: a garbage scan simply becomes RFID_NOT_FOUND.
 */
export function normalizeRfid(raw) {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

/** Stricter check used only when WRITING a tag (import, relink). */
export function assertWritableRfid(rfid, field = 'rfid_id') {
  if (!/^[A-Z0-9:_-]{1,64}$/.test(rfid)) {
    throw validationError('rfid_id must be 1-64 characters of A-Z, 0-9, ":", "_" or "-"', { field, value: rfid });
  }
  return rfid;
}
