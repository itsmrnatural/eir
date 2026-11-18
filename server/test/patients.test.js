import { describe, it, expect, vi } from 'vitest';
import { AppError } from '../src/errors.js';
import { SEED, buildHarness, expectError } from './helpers.js';

const nonStudent = (over = {}) => ({
  name: 'Test Visitor One', age: 41, sex: 'M', phone_no: '9000000001', designation: 'FACULTY', ...over,
});
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('GET /patients/by-rfid/:rfid_id', () => {
  it('returns the PatientView for a registered card', async () => {
    const h = await buildHarness();
    const res = await h.api('staff').get(`/patients/by-rfid/${SEED.rfid}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      patient_id: h.student.patient_id, patient_type: 'STUDENT', name: 'Test Student One',
      roll_no: SEED.studentRoll, sex: 'F', age_is_estimated: false, rfid_id: SEED.rfid,
    });
    expect(typeof res.body.age).toBe('number');
  });

  it('404 RFID_NOT_FOUND for an unregistered card', async () => {
    const h = await buildHarness();
    expectError(await h.api('staff').get('/patients/by-rfid/UNKNOWNCARD'), 404, 'RFID_NOT_FOUND');
  });

  it('409 RFID_INACTIVE when the repository reports an inactive tag', async () => {
    const h = await buildHarness();
    vi.spyOn(h.repos.patients, 'findByRfid').mockRejectedValue(new AppError('RFID_INACTIVE', 'Card deactivated'));
    expectError(await h.api('staff').get(`/patients/by-rfid/${SEED.rfid}`), 409, 'RFID_INACTIVE');
  });
});

describe('POST /patients/non-students', () => {
  it('registers a non-student (201) with an estimated age and a normalised phone', async () => {
    const h = await buildHarness();
    const res = await h.api('staff').post('/patients/non-students').send(nonStudent({ phone_no: '+91 90000 00001' }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      patient_type: 'NON_STUDENT', name: 'Test Visitor One', age: 41, age_is_estimated: true,
      sex: 'M', phone_no: '9000000001', designation: 'FACULTY',
    });
    expect(res.body.patient_id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it.each([
    ['age 121', { age: 121 }], ['age -1', { age: -1 }], ['fractional age', { age: 40.5 }],
    ['string age', { age: '40' }], ['bad sex', { sex: 'X' }], ['short phone', { phone_no: '90000' }],
    ['bad designation', { designation: 'STUDENT' }], ['empty name', { name: '  ' }],
    ['roll_no supplied', { roll_no: '251210999' }], ['rfid_id supplied', { rfid_id: 'ABC' }],
  ])('400 VALIDATION_ERROR for %s', async (_label, over) => {
    const h = await buildHarness();
    expectError(await h.api('staff').post('/patients/non-students').send(nonStudent(over)), 400, 'VALIDATION_ERROR');
  });

  it('allows 5 people per phone and rejects the 6th with 409 PHONE_LIMIT_REACHED', async () => {
    const h = await buildHarness();
    for (let i = 1; i <= 5; i += 1) {
      const res = await h.api('staff').post('/patients/non-students').send(nonStudent({ name: `Test Visitor ${i}` }));
      expect(res.status).toBe(201);
    }
    expectError(
      await h.api('staff').post('/patients/non-students').send(nonStudent({ name: 'Test Visitor 6' })),
      409, 'PHONE_LIMIT_REACHED',
    );
    const list = await h.api('staff').get('/patients/by-phone/9000000001');
    expect(list.body.items).toHaveLength(5);
  });

  it('409 DUPLICATE_PATIENT for the same name (any case) under the same phone', async () => {
    const h = await buildHarness();
    await h.api('staff').post('/patients/non-students').send(nonStudent());
    expectError(
      await h.api('staff').post('/patients/non-students').send(nonStudent({ name: 'TEST VISITOR ONE' })),
      409, 'DUPLICATE_PATIENT',
    );
  });
});

describe('GET /patients/by-phone/:phone_no, search and get-by-id', () => {
  it('lists the people registered under a phone (also for +91 / spaced input)', async () => {
    const h = await buildHarness();
    await h.api('staff').post('/patients/non-students').send(nonStudent());
    await h.api('staff').post('/patients/non-students').send(nonStudent({ name: 'Test Visitor Two' }));
    const res = await h.api('staff').get(`/patients/by-phone/${encodeURIComponent('+91 90000 00001')}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((p) => p.name).sort()).toEqual(['Test Visitor One', 'Test Visitor Two']);
    expect(res.body.total).toBe(2);
  });

  it('returns an empty list for an unknown phone and 400 for a malformed one', async () => {
    const h = await buildHarness();
    expect((await h.api('staff').get('/patients/by-phone/9999999999')).body).toEqual({ items: [], total: 0 });
    expectError(await h.api('staff').get('/patients/by-phone/12345'), 400, 'VALIDATION_ERROR');
  });

  it('searches by name, roll number and phone (case-insensitive, partial)', async () => {
    const h = await buildHarness();
    await h.api('staff').post('/patients/non-students').send(nonStudent());
    for (const [q, name] of [['student one', 'Test Student One'], [SEED.studentRoll.slice(0, 6), 'Test Student One'], ['90000', 'Test Visitor One']]) {
      const res = await h.api('staff').get(`/patients?q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      expect(res.body.items.map((p) => p.name)).toContain(name);
      expect(res.body.total).toBe(res.body.items.length);
    }
  });

  it('honours limit and validates q / limit', async () => {
    const h = await buildHarness();
    expect((await h.api('staff').get('/patients?q=test&limit=1')).body.items).toHaveLength(1);
    expectError(await h.api('staff').get('/patients'), 400, 'VALIDATION_ERROR');
    expectError(await h.api('staff').get('/patients?q=%20'), 400, 'VALIDATION_ERROR');
    expectError(await h.api('staff').get('/patients?q=test&limit=0'), 400, 'VALIDATION_ERROR');
    expectError(await h.api('staff').get('/patients?q=test&limit=101'), 400, 'VALIDATION_ERROR');
  });

  it('GET /patients/:id: 200, 404 for unknown, 400 for a malformed id', async () => {
    const h = await buildHarness();
    const ok = await h.api('staff').get(`/patients/${h.student.patient_id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.patient_id).toBe(h.student.patient_id);
    expectError(await h.api('staff').get(`/patients/${UNKNOWN_ID}`), 404, 'NOT_FOUND');
    expectError(await h.api('staff').get('/patients/not-a-uuid'), 400, 'VALIDATION_ERROR');
  });
});

describe('PATCH /patients/:id (STAFF and ADMIN)', () => {
  it('lets STAFF fix details and records the actor for the audit log', async () => {
    const h = await buildHarness();
    const spy = vi.spyOn(h.repos.patients, 'update');
    const res = await h.api('staff').patch(`/patients/${h.student.patient_id}`).send({ name: ' Renamed Student ', sex: 'Other' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Renamed Student', sex: 'Other' });
    expect(spy).toHaveBeenCalledWith(h.student.patient_id, { name: 'Renamed Student', sex: 'Other' }, h.staff.user.user_id);
  });

  it('lets ADMIN edit too', async () => {
    const h = await buildHarness();
    expect((await h.api('admin').patch(`/patients/${h.student.patient_id}`).send({ dob: '2005-04-01' })).status).toBe(200);
  });

  it.each(['roll_no', 'rfid_id', 'patient_type', 'patient_id'])('400 and no repository call when %s is supplied', async (key) => {
    const h = await buildHarness();
    const spy = vi.spyOn(h.repos.patients, 'update');
    expectError(await h.api('staff').patch(`/patients/${h.student.patient_id}`).send({ name: 'A B', [key]: 'x' }), 400, 'VALIDATION_ERROR');
    expect(spy).not.toHaveBeenCalled();
  });

  it('400 for an empty patch, for a student field on a non-student and vice versa', async () => {
    const h = await buildHarness();
    const np = (await h.api('staff').post('/patients/non-students').send(nonStudent())).body;
    expectError(await h.api('staff').patch(`/patients/${h.student.patient_id}`).send({}), 400, 'VALIDATION_ERROR');
    expectError(await h.api('staff').patch(`/patients/${np.patient_id}`).send({ dob: '1980-01-01' }), 400, 'VALIDATION_ERROR');
    expectError(await h.api('staff').patch(`/patients/${h.student.patient_id}`).send({ age: 20 }), 400, 'VALIDATION_ERROR');
    expectError(await h.api('staff').patch(`/patients/${h.student.patient_id}`).send({ phone_no: '9111111111' }), 400, 'VALIDATION_ERROR');
  });

  it('updates a non-student age and 404s for an unknown patient', async () => {
    const h = await buildHarness();
    const np = (await h.api('staff').post('/patients/non-students').send(nonStudent())).body;
    const res = await h.api('staff').patch(`/patients/${np.patient_id}`).send({ age: 52 });
    expect(res.body.age).toBe(52);
    expectError(await h.api('staff').patch(`/patients/${UNKNOWN_ID}`).send({ name: 'A B' }), 404, 'NOT_FOUND');
  });

  it('re-checks the 5-per-phone rule when moving a person to another phone', async () => {
    const h = await buildHarness();
    for (let i = 1; i <= 5; i += 1) {
      await h.api('staff').post('/patients/non-students').send(nonStudent({ name: `Test Visitor ${i}` }));
    }
    const lone = (await h.api('staff').post('/patients/non-students').send(nonStudent({ name: 'Lone Person', phone_no: '9000000002' }))).body;
    expectError(await h.api('staff').patch(`/patients/${lone.patient_id}`).send({ phone_no: '9000000001' }), 409, 'PHONE_LIMIT_REACHED');
  });
});
