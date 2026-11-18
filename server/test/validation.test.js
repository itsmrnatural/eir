import { describe, it, expect } from 'vitest';
import {
  nonStudentBody, patientPatchBody, visitCreateBody, visitPatchBody, loginBody,
  phoneField, rangeQuery, limitedRangeQuery, overTimeQuery, searchQuery, idParams,
} from '../src/validation/schemas.js';
import { validate } from '../src/middleware/validate.js';
import { toErrorResponse, AppError } from '../src/errors.js';
import { loadConfig } from '../src/config.js';
import { sanitizeUrl } from '../src/logger.js';

const ok = (schema, value) => schema.safeParse(value);
const UUID = '3f2b8c1e-5d4a-4b6e-9c7d-1a2b3c4d5e6f';
const nonStudent = { name: '  Test Person  ', age: 40, sex: 'F', phone_no: '9000000001', designation: 'FACULTY' };

describe('phone numbers', () => {
  it.each([
    ['9000000001', '9000000001'],
    ['+919000000001', '9000000001'],
    ['+91 90000 00001', '9000000001'],
    [' 90000 00001 ', '9000000001'],
  ])('normalises %s', (input, expected) => {
    expect(phoneField.parse(input)).toBe(expected);
  });

  it.each(['900000000', '90000000011', '919000000001', '90000a0001', '', '+91', '+9190000000'])(
    'rejects %s', (input) => {
      expect(ok(phoneField, input).success).toBe(false);
    },
  );

  it('rejects non-strings', () => {
    expect(ok(phoneField, 9000000001).success).toBe(false);
  });
});

describe('POST /patients/non-students body', () => {
  it('accepts and normalises a valid body', () => {
    const r = ok(nonStudentBody, { ...nonStudent, phone_no: '+91 90000 00001' });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ ...nonStudent, name: 'Test Person', phone_no: '9000000001' });
  });

  it.each([0, 1, 120])('accepts age %s', (age) => {
    expect(ok(nonStudentBody, { ...nonStudent, age }).success).toBe(true);
  });

  it.each([-1, 121, 12.5, '40', null, NaN])('rejects age %s', (age) => {
    expect(ok(nonStudentBody, { ...nonStudent, age }).success).toBe(false);
  });

  it.each(['X', 'male', 'f', ''])('rejects sex %s', (sex) => {
    expect(ok(nonStudentBody, { ...nonStudent, sex }).success).toBe(false);
  });

  it('accepts sex M, F, Other', () => {
    for (const sex of ['M', 'F', 'Other']) expect(ok(nonStudentBody, { ...nonStudent, sex }).success).toBe(true);
  });

  it('rejects an unknown designation and empty names', () => {
    expect(ok(nonStudentBody, { ...nonStudent, designation: 'STUDENT' }).success).toBe(false);
    expect(ok(nonStudentBody, { ...nonStudent, name: '   ' }).success).toBe(false);
  });

  it.each(['roll_no', 'rfid_id', 'patient_type', 'patient_id', 'date_time'])('rejects client-supplied %s', (key) => {
    expect(ok(nonStudentBody, { ...nonStudent, [key]: 'x' }).success).toBe(false);
  });
});

describe('PATCH /patients/:id body', () => {
  it('accepts every patchable field', () => {
    const body = { name: 'A B', sex: 'M', dob: '2004-02-29', age: 33, phone_no: '9000000002', designation: 'WORKER' };
    expect(ok(patientPatchBody, body).success).toBe(true);
  });

  it.each(['roll_no', 'rfid_id', 'patient_type'])('rejects %s (not patchable)', (key) => {
    expect(ok(patientPatchBody, { name: 'A B', [key]: 'x' }).success).toBe(false);
  });

  it('rejects an empty patch, impossible dates and future dates', () => {
    expect(ok(patientPatchBody, {}).success).toBe(false);
    expect(ok(patientPatchBody, { dob: '2005-02-30' }).success).toBe(false);
    expect(ok(patientPatchBody, { dob: '2999-01-01' }).success).toBe(false);
    expect(ok(patientPatchBody, { dob: '05/02/2005' }).success).toBe(false);
  });
});

describe('visit bodies', () => {
  const visit = { patient_id: UUID, health_issue: 'Fever', health_issue_is_custom: false, remedy: 'Paracetamol 500mg' };

  it('accepts a valid body, with or without confirm_duplicate', () => {
    expect(ok(visitCreateBody, visit).success).toBe(true);
    expect(ok(visitCreateBody, { ...visit, confirm_duplicate: true }).success).toBe(true);
  });

  it.each(['date_time', 'recorded_by', 'visit_id', 'snapshot', 'created_at'])('rejects client-supplied %s', (key) => {
    expect(ok(visitCreateBody, { ...visit, [key]: 'x' }).success).toBe(false);
  });

  it('rejects non-boolean confirm_duplicate, bad uuid, missing fields', () => {
    expect(ok(visitCreateBody, { ...visit, confirm_duplicate: 'yes' }).success).toBe(false);
    expect(ok(visitCreateBody, { ...visit, confirm_duplicate: 1 }).success).toBe(false);
    expect(ok(visitCreateBody, { ...visit, patient_id: 'nope' }).success).toBe(false);
    expect(ok(visitCreateBody, { ...visit, remedy: undefined }).success).toBe(false);
    expect(ok(visitCreateBody, { ...visit, health_issue_is_custom: undefined }).success).toBe(false);
  });

  it('PATCH body allows only health_issue/remedy and needs at least one', () => {
    expect(ok(visitPatchBody, { remedy: 'x' }).success).toBe(true);
    expect(ok(visitPatchBody, {}).success).toBe(false);
    expect(ok(visitPatchBody, { remedy: 'x', date_time: '2026-01-01' }).success).toBe(false);
    expect(ok(visitPatchBody, { remedy: 'x', health_issue_is_custom: true }).success).toBe(false);
  });
});

describe('login body and query/params schemas', () => {
  it('login is strict', () => {
    expect(ok(loginBody, { username: 'admin', password: 'p' }).success).toBe(true);
    expect(ok(loginBody, { username: 'admin' }).success).toBe(false);
    expect(ok(loginBody, { username: 'admin', password: 'p', role: 'ADMIN' }).success).toBe(false);
  });

  it('date ranges are YYYY-MM-DD and ordered', () => {
    expect(ok(rangeQuery, { from: '2026-01-01', to: '2026-01-31' }).success).toBe(true);
    expect(ok(rangeQuery, {}).success).toBe(true);
    expect(ok(rangeQuery, { from: '2026-02-01', to: '2026-01-31' }).success).toBe(false);
    expect(ok(rangeQuery, { from: '2026-13-01' }).success).toBe(false);
    expect(ok(rangeQuery, { from: '2026-1-1' }).success).toBe(false);
    expect(ok(rangeQuery, { from: '2026-01-15', to: '2026-01-15' }).success).toBe(true);
  });

  it('limit defaults and bounds', () => {
    expect(limitedRangeQuery.parse({}).limit).toBe(10);
    expect(limitedRangeQuery.parse({ limit: '5' }).limit).toBe(5);
    expect(ok(limitedRangeQuery, { limit: '0' }).success).toBe(false);
    expect(ok(limitedRangeQuery, { limit: '101' }).success).toBe(false);
    expect(ok(limitedRangeQuery, { limit: 'abc' }).success).toBe(false);
  });

  it('bucket defaults to day and only allows day|week|month', () => {
    expect(overTimeQuery.parse({}).bucket).toBe('day');
    expect(overTimeQuery.parse({ bucket: 'month' }).bucket).toBe('month');
    expect(ok(overTimeQuery, { bucket: 'year' }).success).toBe(false);
  });

  it('search needs a non-empty q and defaults limit to 20', () => {
    expect(searchQuery.parse({ q: ' abc ' })).toEqual({ q: 'abc', limit: 20 });
    expect(ok(searchQuery, {}).success).toBe(false);
    expect(ok(searchQuery, { q: '   ' }).success).toBe(false);
    expect(ok(searchQuery, { q: ['a', 'b'] }).success).toBe(false);
  });

  it('id params must be UUIDs', () => {
    expect(ok(idParams, { id: UUID }).success).toBe(true);
    expect(ok(idParams, { id: '123' }).success).toBe(false);
  });
});

describe('validate() middleware', () => {
  const run = (schemas, req) => new Promise((resolve) => validate(schemas)(req, {}, resolve));

  it('puts parsed values on req.valid and calls next() with no error', async () => {
    const req = { params: {}, query: {}, body: { ...nonStudent } };
    expect(await run({ body: nonStudentBody }, req)).toBeUndefined();
    expect(req.valid.body.name).toBe('Test Person');
  });

  it('produces a VALIDATION_ERROR with per-field issues', async () => {
    const err = await run({ body: nonStudentBody }, { params: {}, query: {}, body: { ...nonStudent, age: 500, roll_no: 'x' } });
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details.issues.map((i) => i.path).sort()).toEqual(['', 'age'].sort());
    expect(err.details.issues.find((i) => i.path === '').message).toMatch(/roll_no/);
  });

  it('reports a missing body field as required', async () => {
    const err = await run({ body: nonStudentBody }, { params: {}, query: {}, body: {} });
    expect(err.details.issues.every((i) => i.message === 'is required')).toBe(true);
  });
});

describe('error mapping', () => {
  it.each([
    ['VALIDATION_ERROR', 400], ['UNAUTHENTICATED', 401], ['FORBIDDEN', 403], ['NOT_FOUND', 404],
    ['RFID_NOT_FOUND', 404], ['RFID_INACTIVE', 409], ['PHONE_LIMIT_REACHED', 409],
    ['DUPLICATE_PATIENT', 409], ['DUPLICATE_VISIT_WARNING', 409], ['RATE_LIMITED', 429],
  ])('%s -> %i', (code, status) => {
    const r = toErrorResponse(new AppError(code, 'msg', { a: 1 }));
    expect(r.status).toBe(status);
    expect(r.body).toEqual({ error: { code, message: 'msg', details: { a: 1 } } });
  });

  it('maps ANY object with a known code (e.g. an AppError from db/)', () => {
    const foreign = Object.assign(new Error('boom'), { code: 'RFID_NOT_FOUND' });
    expect(toErrorResponse(foreign).status).toBe(404);
    expect(toErrorResponse(foreign).body.error.details).toEqual({});
  });

  it('hides internals of unknown errors and of INTERNAL errors', () => {
    for (const e of [new Error('password=secret'), Object.assign(new Error('pg detail'), { code: 'ECONNREFUSED' }), new AppError('INTERNAL', 'SELECT * FROM x')]) {
      const r = toErrorResponse(e);
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ error: { code: 'INTERNAL', message: 'Internal server error', details: {} } });
    }
  });

  it('maps body-parser errors to VALIDATION_ERROR', () => {
    const r = toErrorResponse(Object.assign(new Error('Unexpected token'), { status: 400, expose: true, type: 'entity.parse.failed' }));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(toErrorResponse(Object.assign(new Error('x'), { status: 413, expose: true })).body.error.message).toMatch(/too large/);
  });
});

describe('config', () => {
  const base = { JWT_SECRET: 'a'.repeat(32) };

  it('requires JWT_SECRET', () => {
    expect(() => loadConfig({})).toThrow(/JWT_SECRET/);
  });

  it('applies the contract defaults and treats empty strings as unset', () => {
    const c = loadConfig({ ...base, PORT: '' });
    expect(c.port).toBe(4000);
    expect(c.jwtExpiresIn).toBe('1h');
    expect(c.corsOrigins).toContain('http://localhost:5173');
    expect(c.trustProxy).toBe(false);
  });

  it('parses CORS_ORIGIN lists and TRUST_PROXY', () => {
    const c = loadConfig({ ...base, CORS_ORIGIN: 'https://a.test/, https://b.test', TRUST_PROXY: '1' });
    expect(c.corsOrigins).toEqual(['https://a.test', 'https://b.test']);
    expect(c.trustProxy).toBe(1);
  });

  it('refuses a short JWT_SECRET in production only', () => {
    expect(() => loadConfig({ JWT_SECRET: 'short', NODE_ENV: 'production' })).toThrow(/16 characters/);
    expect(loadConfig({ JWT_SECRET: 'short', NODE_ENV: 'development' }).jwtSecret).toBe('short');
  });
});

describe('log hygiene', () => {
  it('strips phone numbers, RFID tags and query strings from logged URLs', () => {
    expect(sanitizeUrl('/api/v1/patients/by-phone/9000000001')).toBe('/api/v1/patients/by-phone/:phone_no');
    expect(sanitizeUrl('/api/v1/patients/by-rfid/04A3B2C1')).toBe('/api/v1/patients/by-rfid/:rfid_id');
    expect(sanitizeUrl('/api/v1/patients?q=Test%20Student')).toBe('/api/v1/patients');
  });
});
