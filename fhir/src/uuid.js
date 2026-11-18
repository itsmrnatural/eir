// RFC 4122 version-5 (name-based, SHA-1) UUIDs. Used to give each visit's Condition and
// MedicationStatement a stable id derived from the visit id, so exporting the same data twice
// yields identical resource ids.
import { createHash } from 'node:crypto';

// Fixed namespace for this project (an arbitrary constant; changing it changes every derived id).
export const NAMESPACE = '6f1d1c1e-5b7a-4c1e-9d3a-2f0e8a4b7c11';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuidV5(name, namespace = NAMESPACE) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const h = createHash('sha1').update(ns).update(String(name), 'utf8').digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
