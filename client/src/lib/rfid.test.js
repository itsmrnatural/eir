import { describe, expect, it } from 'vitest';
import { classifyScan } from './rfid.js';

const burst = (s, gap) => [...s].map((ch, i) => ({ ch, t: i * gap }));

describe('classifyScan', () => {
  it('accepts a fast keyboard-wedge burst as a card tap', () => {
    expect(classifyScan(burst('0012345678', 8))).toEqual({ ok: true, tag: '0012345678' });
  });
  it('rejects human typing speed', () => {
    const r = classifyScan(burst('RFID0001', 250));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too_slow');
  });
  it('rejects a burst with one long pause inside it', () => {
    const keys = burst('ABCDEFGH', 10);
    keys.forEach((k, i) => { if (i >= 4) k.t += 400; });
    expect(classifyScan(keys).reason).toBe('too_slow');
  });
  it('rejects input that is too short to be a tag', () => {
    expect(classifyScan(burst('123', 5)).reason).toBe('too_short');
  });
});
