// Contract is silent on phone format. We keep an optional leading "+" and digits only,
// and use the same normalisation for lookup and registration so they always match.
export function normalizePhone(raw) {
  const s = String(raw ?? '').trim();
  return (s.startsWith('+') ? '+' : '') + s.replace(/\D/g, '');
}

/** @returns {string|null} message, or null when valid */
export function phoneError(raw) {
  const digits = normalizePhone(raw).replace('+', '');
  if (!digits) return 'Enter a phone number.';
  if (digits.length < 7 || digits.length > 15) return 'A phone number has 7 to 15 digits.';
  return null;
}
