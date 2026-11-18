import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv.js';
import { addDays, formatTime, rangeError, ymdIST } from './datetime.js';
import { formatAge } from './format.js';
import { normalizePhone, phoneError } from './phone.js';

describe('dates are shown and grouped in Asia/Kolkata', () => {
  it('formats 10:00 UTC as 3:30 pm IST', () => {
    expect(formatTime('2026-11-16T10:00:00Z')).toMatch(/3:30\s?pm/i);
  });
  it('rolls the calendar day over at 18:30 UTC', () => {
    expect(ymdIST('2026-11-16T18:29:00Z')).toBe('2026-11-16');
    expect(ymdIST('2026-11-16T18:31:00Z')).toBe('2026-11-17');
  });
  it('adds days across month ends', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('flags a reversed range', () => {
    expect(rangeError('2026-11-10', '2026-11-01')).toMatch(/on or before/);
    expect(rangeError('2026-11-01', '2026-11-10')).toBeNull();
  });
});

describe('csv', () => {
  it('quotes cells and doubles inner quotes', () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
  });
  it('neutralises spreadsheet formulas in text', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe(`"'=SUM(A1:A9)"`);
  });
  it('builds header and rows with CRLF', () => {
    const out = toCsv([{ header: 'A', value: (r) => r.a }], [{ a: 1 }, { a: 'x' }]);
    expect(out).toBe('"A"\r\n"1"\r\n"x"\r\n');
  });
});

describe('phone and age helpers', () => {
  it('normalises phone numbers the same way everywhere', () => {
    expect(normalizePhone(' +91 98765-43210 ')).toBe('+919876543210');
    expect(normalizePhone('(900) 000-0101')).toBe('9000000101');
  });
  it('validates length', () => {
    expect(phoneError('12345')).toMatch(/7 to 15/);
    expect(phoneError('9000000101')).toBeNull();
  });
  it('marks estimated ages', () => {
    expect(formatAge({ age: 46, age_is_estimated: true })).toBe('46 (approx.)');
    expect(formatAge({ age: 20, age_is_estimated: false })).toBe('20');
  });
});
