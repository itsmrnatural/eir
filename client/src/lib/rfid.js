// Most USB RFID readers behave like a keyboard: they type the tag ID very fast, then press Enter.
// Humans type much slower, so inter-key timing separates a card tap from keyboard noise.
const env = import.meta.env ?? {};
const maxGap = Number(env.VITE_RFID_MAX_GAP_MS) || 100;

export const RFID_CONFIG = Object.freeze({
  minLength: 4, // shortest tag we accept
  maxGapMs: maxGap, // slowest single gap inside one burst
  maxAvgGapMs: Math.max(20, Math.round(maxGap / 2)), // average gap inside one burst
  staleMs: 1500, // a pause this long starts a fresh buffer
});

/** Indirection so tests can fake time. */
export const clock = { now: () => performance.now() };

/**
 * @param {{ch:string, t:number}[]} keys keystrokes since the buffer was last cleared
 * @returns {{ok:boolean, tag:string, reason?:'too_short'|'too_slow'}}
 */
export function classifyScan(keys, cfg = RFID_CONFIG) {
  const tag = keys.map((k) => k.ch).join('');
  if (tag.length < cfg.minLength) return { ok: false, tag, reason: 'too_short' };
  const gaps = keys.slice(1).map((k, i) => k.t - keys[i].t);
  const max = Math.max(...gaps);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (max > cfg.maxGapMs || avg > cfg.maxAvgGapMs) return { ok: false, tag, reason: 'too_slow' };
  return { ok: true, tag };
}
