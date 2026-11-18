import { describe, it, expect, vi } from 'vitest';
import { buildHarness, expectError } from './helpers.js';
import { todayIST } from '../src/util/dates.js';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const visitBody = (h, patient_id, over = {}) => ({
  patient_id, health_issue: h.issues[0].label, health_issue_is_custom: false, remedy: 'Paracetamol 500mg', ...over,
});

describe('POST /visits', () => {
  it('creates a visit (201); server sets date_time and recorded_by', async () => {
    const h = await buildHarness();
    const before = Date.now();
    const res = await h.api('staff').post('/visits').send(visitBody(h, h.student.patient_id));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      patient_id: h.student.patient_id, patient_type: 'STUDENT', health_issue: h.issues[0].label,
      health_issue_is_custom: false, remedy: 'Paracetamol 500mg', recorded_by: h.staff.user.user_id,
    });
    expect(res.body.visit_id).toBeDefined();
    expect(res.body.snapshot).toMatchObject({ name: 'Test Student One', sex: 'F', roll_no: '251210001' });
    expect(res.body).not.toHaveProperty('_id');
    const t = Date.parse(res.body.date_time);
    expect(t).toBeGreaterThan(before - 5000);
    expect(t).toBeLessThan(Date.now() + 5000);
  });

  it.each(['date_time', 'recorded_by', 'visit_id', 'snapshot'])('400 and nothing saved when the client sends %s', async (key) => {
    const h = await buildHarness();
    const spy = vi.spyOn(h.repos.visits, 'create');
    const res = await h.api('staff').post('/visits').send(visitBody(h, h.student.patient_id, { [key]: 'x' }));
    expectError(res, 400, 'VALIDATION_ERROR');
    expect(spy).not.toHaveBeenCalled();
  });

  it('400 for missing fields, bad uuid and non-boolean confirm_duplicate', async () => {
    const h = await buildHarness();
    const ok = visitBody(h, h.student.patient_id);
    expectError(await h.api('staff').post('/visits').send({ ...ok, remedy: undefined }), 400, 'VALIDATION_ERROR');
    expectError(await h.api('staff').post('/visits').send({ ...ok, patient_id: 'nope' }), 400, 'VALIDATION_ERROR');
    expectError(await h.api('staff').post('/visits').send({ ...ok, confirm_duplicate: 'true' }), 400, 'VALIDATION_ERROR');
  });

  it('404 NOT_FOUND for an unknown patient', async () => {
    const h = await buildHarness();
    expectError(await h.api('staff').post('/visits').send(visitBody(h, UNKNOWN_ID)), 404, 'NOT_FOUND');
  });

  it('records a listed issue (by code or label, stored as label) and free-text "Other" issues', async () => {
    const h = await buildHarness();
    const [first] = h.issues;
    const byCode = await h.api('staff').post('/visits').send(visitBody(h, h.student.patient_id, { health_issue: first.code }));
    expect(byCode.body).toMatchObject({ health_issue: first.label, health_issue_is_custom: false });

    const custom = await h.api('staff').post('/visits').send(
      visitBody(h, h.student2.patient_id, { health_issue: 'Sore elbow', health_issue_is_custom: true }),
    );
    expect(custom.status).toBe(201);
    expect(custom.body).toMatchObject({ health_issue: 'Sore elbow', health_issue_is_custom: true });

    const unlisted = await h.api('staff').post('/visits').send(visitBody(h, h.student.patient_id, { health_issue: 'Made up', confirm_duplicate: true }));
    expectError(unlisted, 400, 'VALIDATION_ERROR');
  });

  it('duplicate flow: first retry is 409 DUPLICATE_VISIT_WARNING with last_visit_at, confirm_duplicate saves it', async () => {
    const h = await buildHarness();
    expect((await h.api('staff').post('/visits').send(visitBody(h, h.student.patient_id))).status).toBe(201);

    const warn = await h.api('staff').post('/visits').send(visitBody(h, h.student.patient_id));
    expectError(warn, 409, 'DUPLICATE_VISIT_WARNING');
    expect(Number.isNaN(Date.parse(warn.body.error.details.last_visit_at))).toBe(false);

    const spy = vi.spyOn(h.repos.visits, 'create');
    const confirmed = await h.api('staff').post('/visits').send(visitBody(h, h.student.patient_id, { confirm_duplicate: true }));
    expect(confirmed.status).toBe(201);
    expect(spy.mock.calls[0][0].confirm_duplicate).toBe(true);
  });
});

describe('PATCH /visits/:id (ADMIN only)', () => {
  async function oneVisit(h) {
    return (await h.api('staff').post('/visits').send(visitBody(h, h.student.patient_id))).body;
  }

  it('lets ADMIN correct remedy/health_issue and audits with the actor id', async () => {
    const h = await buildHarness();
    const v = await oneVisit(h);
    const spy = vi.spyOn(h.repos.visits, 'update');
    const res = await h.api('admin').patch(`/visits/${v.visit_id}`).send({ remedy: 'Paracetamol 650mg' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ visit_id: v.visit_id, remedy: 'Paracetamol 650mg', health_issue: h.issues[0].label });
    expect(spy).toHaveBeenCalledWith(v.visit_id, { remedy: 'Paracetamol 650mg' }, h.admin.user.user_id);
  });

  it('403 FORBIDDEN for STAFF; nothing is changed', async () => {
    const h = await buildHarness();
    const v = await oneVisit(h);
    expectError(await h.api('staff').patch(`/visits/${v.visit_id}`).send({ remedy: 'x' }), 403, 'FORBIDDEN');
    expect((await h.repos.visits.findById(v.visit_id)).remedy).toBe('Paracetamol 500mg');
  });

  it('400 for an empty patch and for fields outside {health_issue, remedy}; 404 for unknown id', async () => {
    const h = await buildHarness();
    const v = await oneVisit(h);
    expectError(await h.api('admin').patch(`/visits/${v.visit_id}`).send({}), 400, 'VALIDATION_ERROR');
    expectError(await h.api('admin').patch(`/visits/${v.visit_id}`).send({ remedy: 'x', date_time: '2020-01-01T00:00:00Z' }), 400, 'VALIDATION_ERROR');
    expectError(await h.api('admin').patch(`/visits/${UNKNOWN_ID}`).send({ remedy: 'x' }), 404, 'NOT_FOUND');
  });

  it('there is no way to delete a visit (no DELETE/PUT routes exist)', async () => {
    const h = await buildHarness();
    const v = await oneVisit(h);
    expectError(await h.api('admin').delete(`/visits/${v.visit_id}`), 404, 'NOT_FOUND');
    expectError(await h.api('admin').put(`/visits/${v.visit_id}`).send({}), 404, 'NOT_FOUND');
    expect(await h.repos.visits.findById(v.visit_id)).not.toBeNull();
  });
});

describe('GET /patients/:id/history (ADMIN only)', () => {
  it('returns {patient, items, total}, newest first, and filters by inclusive IST dates', async () => {
    const h = await buildHarness();
    await h.api('staff').post('/visits').send(visitBody(h, h.student.patient_id));
    await h.api('staff').post('/visits').send(visitBody(h, h.student.patient_id, { remedy: 'Second', confirm_duplicate: true }));
    const today = todayIST();

    const all = await h.api('admin').get(`/patients/${h.student.patient_id}/history`);
    expect(all.status).toBe(200);
    expect(all.body.patient.patient_id).toBe(h.student.patient_id);
    expect(all.body.total).toBe(2);
    expect(all.body.items[0].remedy).toBe('Second');

    expect((await h.api('admin').get(`/patients/${h.student.patient_id}/history?from=${today}&to=${today}`)).body.total).toBe(2);
    expect((await h.api('admin').get(`/patients/${h.student.patient_id}/history?from=2000-01-01&to=2000-01-02`)).body).toMatchObject({ total: 0, items: [] });
  });

  it('403 for STAFF, 404 unknown patient, 400 for bad or reversed dates', async () => {
    const h = await buildHarness();
    const base = `/patients/${h.student.patient_id}/history`;
    expectError(await h.api('staff').get(base), 403, 'FORBIDDEN');
    expectError(await h.api('admin').get(`/patients/${UNKNOWN_ID}/history`), 404, 'NOT_FOUND');
    expectError(await h.api('admin').get(`${base}?from=2026-13-45`), 400, 'VALIDATION_ERROR');
    expectError(await h.api('admin').get(`${base}?from=2026-02-01&to=2026-01-01`), 400, 'VALIDATION_ERROR');
    expectError(await h.api('admin').get(`${base}?from=26-1-1`), 400, 'VALIDATION_ERROR');
  });
});
