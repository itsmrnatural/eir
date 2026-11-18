import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { istParts, istDateString, istMidnightUtc, dateRangeUtc, bucketStartYmd, nextBucketYmd, addDaysYmd, parseYmd } from '../lib/time.js';
import { fullYearsBetween, computeAge } from '../lib/age.js';
import { parseRollNo, RollNoError, PROGRAM_BY_DIGIT } from '../lib/rollno.js';
import { parseCsv, parseCsvRecords } from '../lib/csv.js';
import { normalizePhone, normalizeRfid, assertWritableRfid, isUuid, uuidV4FromBytes } from '../lib/ids.js';
import { isDuplicateVisit, duplicateWindowMin } from '../lib/domain.js';
import { AppError } from '../lib/errors.js';

describe('time (Asia/Kolkata)', () => {
  test('IST calendar parts across the UTC date line', () => {
    const d = new Date('2026-03-10T18:30:00Z'); // 00:00 on the 11th in IST
    assert.deepEqual(istParts(d), { year: 2026, month: 3, day: 11, hour: 0, minute: 0, weekday: 3 });
    assert.equal(istDateString(new Date('2026-03-10T18:29:59Z')), '2026-03-10');
    assert.equal(istMidnightUtc('2026-03-11').toISOString(), '2026-03-10T18:30:00.000Z');
  });
  test('from/to are inclusive IST days', () => {
    const r = dateRangeUtc({ from: '2026-03-10', to: '2026-03-10' });
    assert.equal(r.start.toISOString(), '2026-03-09T18:30:00.000Z');
    assert.equal(r.endExclusive.toISOString(), '2026-03-10T18:30:00.000Z');
    assert.deepEqual(dateRangeUtc({}), { start: null, endExclusive: null });
    assert.throws(() => dateRangeUtc({ from: '2026-03-11', to: '2026-03-10' }), { code: 'VALIDATION_ERROR' });
    assert.throws(() => dateRangeUtc({ from: '2026-02-30' }), { code: 'VALIDATION_ERROR' });
    assert.throws(() => dateRangeUtc({ from: '10/03/2026' }), { code: 'VALIDATION_ERROR' });
  });
  test('buckets: day, Monday-based week, month', () => {
    const wed = new Date('2026-11-18T05:00:00Z');
    assert.equal(bucketStartYmd(wed, 'day'), '2026-11-18');
    assert.equal(bucketStartYmd(wed, 'week'), '2026-11-16');
    assert.equal(bucketStartYmd(new Date('2026-11-15T10:00:00Z'), 'week'), '2026-11-09'); // Sunday belongs to the previous week
    assert.equal(bucketStartYmd(wed, 'month'), '2026-11-01');
    assert.equal(nextBucketYmd('2026-12-01', 'month'), '2027-01-01');
    assert.equal(nextBucketYmd('2026-02-23', 'week'), '2026-03-02');
    assert.equal(addDaysYmd('2024-02-28', 2), '2024-03-01');
    assert.equal(parseYmd('2025-02-29'), null);
  });
});

describe('age', () => {
  test('full years, birthday rule', () => {
    assert.equal(fullYearsBetween('2006-05-21', '2026-05-20'), 19);
    assert.equal(fullYearsBetween('2006-05-21', '2026-05-21'), 20);
    assert.equal(fullYearsBetween('2004-02-29', '2025-02-28'), 20);
    assert.equal(fullYearsBetween('2004-02-29', '2025-03-01'), 21);
  });
  test('student age from dob, non-student age is estimated and grows with time since registration', () => {
    const at = new Date('2026-11-17T06:00:00Z');
    assert.deepEqual(computeAge({ patient_type: 'STUDENT', dob: '2006-11-17' }, at), { age: 20, age_is_estimated: false });
    const ns = { patient_type: 'NON_STUDENT', age_at_registration: 40, registered_on: '2025-06-01' };
    assert.deepEqual(computeAge(ns, at), { age: 41, age_is_estimated: true });
    assert.deepEqual(computeAge(ns, new Date('2026-05-31T06:00:00Z')), { age: 40, age_is_estimated: true });
  });
  test('uses the IST day, not the UTC day', () => {
    const justAfterIstMidnight = new Date('2026-11-16T18:45:00Z'); // 17 Nov 00:15 IST
    assert.equal(computeAge({ patient_type: 'STUDENT', dob: '2006-11-17' }, justAfterIstMidnight).age, 20);
  });
});

describe('roll number parser (YY P BBB SSS)', () => {
  test('parses the layout', () => {
    assert.deepEqual(parseRollNo('251210001'), { batch_year: 2025, program: 'UG', branch_code: '210', serial: '001' });
    assert.deepEqual(parseRollNo(' 242221017 '), { batch_year: 2024, program: 'PG', branch_code: '221', serial: '017' });
    assert.deepEqual(PROGRAM_BY_DIGIT, { 1: 'UG', 2: 'PG' });
  });
  test('unknown branch, program digit and bad shapes are errors, never guesses', () => {
    assert.throws(() => parseRollNo('251999001'), (e) => e instanceof RollNoError && e.reason === 'UNKNOWN_BRANCH' && /999/.test(e.message));
    assert.throws(() => parseRollNo('253210001'), (e) => e.reason === 'UNKNOWN_PROGRAM');
    for (const bad of ['25121000', '2512100011', 'abc', '', null, '25-1-210-001']) {
      assert.throws(() => parseRollNo(bad), (e) => e instanceof RollNoError && e.reason === 'BAD_FORMAT', String(bad));
    }
  });
  test('the live branch list can be passed in; override skips the check', () => {
    assert.equal(parseRollNo('251230001', { branchCodes: ['230'] }).branch_code, '230');
    assert.throws(() => parseRollNo('251210001', { branchCodes: ['230'] }), { reason: 'UNKNOWN_BRANCH' });
    assert.equal(parseRollNo('251777001', { skipBranchCheck: true }).batch_year, 2025);
  });
});

describe('csv reader', () => {
  test('quotes, escaped quotes, CRLF, BOM, blank lines, line numbers', () => {
    const text = '\ufeffa,b,c\r\n1,"x, y",3\r\n\r\n4,"say ""hi""",6\n7,"multi\nline",9\n10,11,12';
    const rows = parseCsv(text);
    assert.deepEqual(rows.map((r) => r.cells), [['a', 'b', 'c'], ['1', 'x, y', '3'], ['4', 'say "hi"', '6'], ['7', 'multi\nline', '9'], ['10', '11', '12']]);
    assert.deepEqual(rows.map((r) => r.line), [1, 2, 4, 5, 7]);
  });
  test('records are keyed by lower-cased header and trimmed', () => {
    const { header, records } = parseCsvRecords('Roll_No, Name\n 25 , Ann \n');
    assert.deepEqual(header, ['roll_no', 'name']);
    assert.deepEqual(records[0].values, { roll_no: '25', name: 'Ann' });
  });
  test('unterminated quote is reported', () => {
    assert.throws(() => parseCsv('a,b\n1,"oops'), /quoted field/);
  });
});

describe('ids', () => {
  test('phone normalisation', () => {
    assert.equal(normalizePhone(' +91 (98765) 43-210 '), '+919876543210');
    assert.equal(normalizePhone('98765.43210'), '9876543210');
    for (const bad of ['123', 'abcdefghij', '', '9'.repeat(16), 12345678901]) assert.throws(() => normalizePhone(bad), { code: 'VALIDATION_ERROR' });
  });
  test('rfid normalisation is lenient for reads, strict for writes', () => {
    assert.equal(normalizeRfid('  04a3b2 '), '04A3B2');
    assert.equal(normalizeRfid(null), '');
    assert.throws(() => assertWritableRfid('BAD ID'), { code: 'VALIDATION_ERROR' });
    assert.equal(assertWritableRfid('04A3B2-C1'), '04A3B2-C1');
  });
  test('uuid helpers produce v4', () => {
    const id = uuidV4FromBytes(new Uint8Array(16).fill(255));
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(isUuid(id), true);
    assert.equal(isUuid('nope'), false);
  });
});

describe('report helpers and duplicate rule', () => {
  test('duplicate window is inclusive and configurable', () => {
    const now = new Date('2026-11-17T10:10:00Z');
    assert.equal(isDuplicateVisit(new Date('2026-11-17T10:00:00Z'), now, 10), true);
    assert.equal(isDuplicateVisit(new Date('2026-11-17T09:59:59Z'), now, 10), false);
    assert.equal(duplicateWindowMin(undefined, {}), 10);
    assert.equal(duplicateWindowMin(undefined, { DUPLICATE_VISIT_WINDOW_MIN: '25' }), 25);
    assert.equal(duplicateWindowMin(undefined, { DUPLICATE_VISIT_WINDOW_MIN: 'abc' }), 10);
  });
  test('AppError serialises to the wire shape', () => {
    const e = new AppError('DUPLICATE_VISIT_WARNING', 'm', { last_visit_at: 'x' });
    assert.equal(e.status, 409);
    assert.deepEqual(JSON.parse(JSON.stringify(e)), { error: { code: 'DUPLICATE_VISIT_WARNING', message: 'm', details: { last_visit_at: 'x' } } });
  });
});
