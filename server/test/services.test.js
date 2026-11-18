/**
 * Business-rule tests at the service layer (no HTTP), using the in-memory repositories.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPatientService, MAX_PEOPLE_PER_PHONE } from '../src/services/patientService.js';
import { createVisitService } from '../src/services/visitService.js';
import { createExportService } from '../src/services/exportService.js';
import * as fhirMapper from '../../fhir/index.js';
import { todayIST } from '../src/util/dates.js';
import { createTestRepositories } from './repos.js';

const ACTOR = { user_id: 7, username: 'staff', role: 'STAFF' };
const ADMIN = { user_id: 1, username: 'admin', role: 'ADMIN' };

async function setup() {
  const repos = createTestRepositories();
  const branches = await repos.meta.listBranches();
  const student = await repos.patients.createStudent({
    name: 'Test Student One', dob: '2005-03-14', sex: 'F', roll_no: '251210001', batch_year: 2025,
    program: 'UG', branch_id: branches.find((b) => b.branch_code === '210').branch_id, rfid_id: 'TESTRFID0001',
  });
  return {
    repos,
    student,
    issues: await repos.meta.listHealthIssues(), // never hard-code issue names
    patients: createPatientService({ repos }),
    visits: createVisitService({ repos }),
    exportsSvc: createExportService({ repos, fhir: fhirMapper }),
  };
}

const person = (n, phone = '9000000001') => ({ name: `Test Person ${n}`, age: 30 + n, sex: 'M', phone_no: phone, designation: 'STAFF' });

async function fillPhone(patients, phone, count = MAX_PEOPLE_PER_PHONE) {
  const created = [];
  for (let i = 1; i <= count; i += 1) created.push(await patients.createNonStudent(person(i, phone)));
  return created;
}

describe('patientService.createNonStudent', () => {
  let ctx;
  beforeEach(async () => { ctx = await setup(); });

  it('registers a non-student with an estimated age', async () => {
    const p = await ctx.patients.createNonStudent(person(1));
    expect(p.patient_type).toBe('NON_STUDENT');
    expect(p.age).toBe(31);
    expect(p.age_is_estimated).toBe(true);
    expect(p.phone_no).toBe('9000000001');
  });

  it('allows up to 5 people per phone and rejects the 6th with PHONE_LIMIT_REACHED', async () => {
    await fillPhone(ctx.patients, '9000000001');
    await expect(ctx.patients.createNonStudent(person(6))).rejects.toMatchObject({ code: 'PHONE_LIMIT_REACHED' });
    const { items, total } = await ctx.patients.getByPhone('9000000001');
    expect(items).toHaveLength(5);
    expect(total).toBe(5);
  });

  it('rejects the same name (case-insensitive) under one phone with DUPLICATE_PATIENT', async () => {
    await ctx.patients.createNonStudent(person(1));
    await expect(
      ctx.patients.createNonStudent({ ...person(2), name: 'TEST PERSON 1' }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_PATIENT' });
  });

  it('reports DUPLICATE_PATIENT (not PHONE_LIMIT) when the phone is full and the person already exists', async () => {
    await fillPhone(ctx.patients, '9000000001');
    await expect(ctx.patients.createNonStudent(person(1))).rejects.toMatchObject({ code: 'DUPLICATE_PATIENT' });
  });

  it('allows the same name under a different phone', async () => {
    await ctx.patients.createNonStudent(person(1, '9000000001'));
    const other = await ctx.patients.createNonStudent(person(1, '9000000002'));
    expect(other.phone_no).toBe('9000000002');
  });

  it('only forwards the five contract fields to the repository', async () => {
    const spy = vi.spyOn(ctx.repos.patients, 'createNonStudent');
    await ctx.patients.createNonStudent({ ...person(1), extra: 'x' });
    expect(Object.keys(spy.mock.calls[0][0]).sort()).toEqual(['age', 'designation', 'name', 'phone_no', 'sex']);
  });
});

describe('patientService.update', () => {
  let ctx;
  beforeEach(async () => { ctx = await setup(); });

  it('404s for an unknown patient', async () => {
    await expect(ctx.patients.update('00000000-0000-4000-8000-000000000000', { name: 'X Y' }, ACTOR))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('passes the actor user id to the repository (audit trail)', async () => {
    const spy = vi.spyOn(ctx.repos.patients, 'update');
    const view = await ctx.patients.update(ctx.student.patient_id, { name: 'Renamed Student' }, ACTOR);
    expect(spy).toHaveBeenCalledWith(ctx.student.patient_id, { name: 'Renamed Student' }, 7);
    expect(view.name).toBe('Renamed Student');
  });

  it('rejects non-student fields on a student and student fields on a non-student', async () => {
    const np = await ctx.patients.createNonStudent(person(1));
    for (const patch of [{ age: 20 }, { phone_no: '9111111111' }, { designation: 'WORKER' }]) {
      await expect(ctx.patients.update(ctx.student.patient_id, patch, ACTOR)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    await expect(ctx.patients.update(np.patient_id, { dob: '1990-01-01' }, ACTOR)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('updates a non-student age (age is re-based, not stored as a current value)', async () => {
    const np = await ctx.patients.createNonStudent(person(1));
    const view = await ctx.patients.update(np.patient_id, { age: 55 }, ACTOR);
    expect(view.age).toBe(55);
    expect(view.age_is_estimated).toBe(true);
  });

  it('re-checks the 5-per-phone rule when a phone number changes', async () => {
    await fillPhone(ctx.patients, '9000000001');
    const lone = await ctx.patients.createNonStudent(person(9, '9000000002'));
    await expect(ctx.patients.update(lone.patient_id, { phone_no: '9000000001' }, ACTOR))
      .rejects.toMatchObject({ code: 'PHONE_LIMIT_REACHED' });
  });

  it('does not count the person themselves, and allows renaming on a full phone', async () => {
    const five = await fillPhone(ctx.patients, '9000000001');
    const view = await ctx.patients.update(five[0].patient_id, { name: 'Brand New Name' }, ACTOR);
    expect(view.name).toBe('Brand New Name');
  });

  it('rejects renaming to a name already used under that phone', async () => {
    const [first] = await fillPhone(ctx.patients, '9000000001', 2);
    await expect(ctx.patients.update(first.patient_id, { name: 'test person 2' }, ACTOR))
      .rejects.toMatchObject({ code: 'DUPLICATE_PATIENT' });
  });
});

describe('visitService.create', () => {
  let ctx;
  beforeEach(async () => { ctx = await setup(); });
  const base = (ctx_, over = {}) => ({
    patient_id: ctx_.student.patient_id, health_issue: ctx.issues[0].label, health_issue_is_custom: false,
    remedy: 'Paracetamol 500mg', ...over,
  });

  it('records recorded_by from the caller and lets the repository set date_time', async () => {
    const spy = vi.spyOn(ctx.repos.visits, 'create');
    const v = await ctx.visits.create(base(ctx), ACTOR);
    const arg = spy.mock.calls[0][0];
    expect(arg.recorded_by).toBe(7);
    expect(arg).not.toHaveProperty('date_time');
    expect(arg.confirm_duplicate).toBe(false);
    expect(v.recorded_by).toBe(7);
    expect(v.snapshot.name).toBe('Test Student One');
    expect(Number.isNaN(new Date(v.date_time).getTime())).toBe(false);
  });

  it('404s for an unknown patient', async () => {
    await expect(ctx.visits.create(base(ctx, { patient_id: '00000000-0000-4000-8000-000000000000' }), ACTOR))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('accepts a listed issue by label or by code and stores the label', async () => {
    const [fever] = (await ctx.repos.meta.listHealthIssues());
    const byCode = await ctx.visits.create(base(ctx, { health_issue: fever.code }), ACTOR);
    expect(byCode.health_issue).toBe(fever.label);
    expect(byCode.health_issue_is_custom).toBe(false);
    const byLabel = await ctx.visits.create(base(ctx, { health_issue: fever.label, confirm_duplicate: true }), ACTOR);
    expect(byLabel.health_issue).toBe(fever.label);
  });

  it('rejects an unlisted issue unless it is flagged custom', async () => {
    await expect(ctx.visits.create(base(ctx, { health_issue: 'Not A Listed Issue' }), ACTOR))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const custom = await ctx.visits.create(base(ctx, { health_issue: 'Sore elbow', health_issue_is_custom: true }), ACTOR);
    expect(custom.health_issue).toBe('Sore elbow');
    expect(custom.health_issue_is_custom).toBe(true);
  });

  it('warns on a duplicate visit and saves it when confirm_duplicate is true', async () => {
    await ctx.visits.create(base(ctx), ACTOR);
    const err = await ctx.visits.create(base(ctx), ACTOR).catch((e) => e);
    expect(err.code).toBe('DUPLICATE_VISIT_WARNING');
    expect(typeof err.details.last_visit_at).toBe('string');
    const spy = vi.spyOn(ctx.repos.visits, 'create');
    const saved = await ctx.visits.create(base(ctx, { confirm_duplicate: true }), ACTOR);
    expect(spy.mock.calls[0][0].confirm_duplicate).toBe(true);
    expect(saved.visit_id).toBeDefined();
  });

  it('never leaks a Mongo _id', async () => {
    vi.spyOn(ctx.repos.visits, 'create').mockResolvedValue({ _id: 'x', visit_id: 'v' });
    expect(await ctx.visits.create(base(ctx), ACTOR)).toEqual({ visit_id: 'v' });
  });
});

describe('visitService.update / history', () => {
  let ctx;
  beforeEach(async () => { ctx = await setup(); });

  it('404s for an unknown visit', async () => {
    await expect(ctx.visits.update('00000000-0000-4000-8000-000000000000', { remedy: 'x' }, ADMIN))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('forwards only the changed fields and the actor id', async () => {
    const v = await ctx.repos.visits.create({
      patient_id: ctx.student.patient_id, health_issue: ctx.issues[0].label, health_issue_is_custom: false,
      remedy: 'Old remedy', recorded_by: 7,
    });
    const spy = vi.spyOn(ctx.repos.visits, 'update');
    const updated = await ctx.visits.update(v.visit_id, { remedy: 'New remedy' }, ADMIN);
    expect(spy).toHaveBeenCalledWith(v.visit_id, { remedy: 'New remedy' }, 1);
    expect(updated.remedy).toBe('New remedy');
    expect(updated.health_issue).toBe(ctx.issues[0].label);
  });

  it('returns {patient, items, total}, newest first, and filters by IST date range', async () => {
    const mk = (confirm) => ctx.repos.visits.create({
      patient_id: ctx.student.patient_id, health_issue: ctx.issues[0].label, health_issue_is_custom: false,
      remedy: 'x', recorded_by: 7, confirm_duplicate: confirm,
    });
    await mk(false);
    await mk(true);
    const today = todayIST();
    const all = await ctx.visits.history(ctx.student.patient_id, {});
    expect(all.total).toBe(2);
    expect(all.patient.patient_id).toBe(ctx.student.patient_id);
    expect(new Date(all.items[0].date_time) >= new Date(all.items[1].date_time)).toBe(true);
    expect((await ctx.visits.history(ctx.student.patient_id, { from: today, to: today })).total).toBe(2);
    expect((await ctx.visits.history(ctx.student.patient_id, { from: '2000-01-01', to: '2000-01-02' })).total).toBe(0);
  });

  it('404s for history of an unknown patient', async () => {
    await expect(ctx.visits.history('00000000-0000-4000-8000-000000000000', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('exportService', () => {
  let ctx;
  beforeEach(async () => {
    ctx = await setup();
    await ctx.repos.visits.create({
      patient_id: ctx.student.patient_id, health_issue: ctx.issues[0].label, health_issue_is_custom: false,
      remedy: 'Paracetamol 500mg', recorded_by: 7,
    });
  });

  /** every entry has a urn:uuid fullUrl and every reference resolves inside the bundle. */
  function expectSelfContained(bundle) {
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('collection');
    const urls = new Set(bundle.entry.map((e) => e.fullUrl));
    for (const e of bundle.entry) expect(e.fullUrl).toMatch(/^urn:uuid:[0-9a-f-]{36}$/i);
    const refs = [];
    const walk = (o) => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o)) {
          if (k === 'reference' && typeof v === 'string') refs.push(v);
          else walk(v);
        }
      }
    };
    bundle.entry.forEach((e) => walk(e.resource));
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(urls.has(r)).toBe(true);
  }

  it('builds a self-contained patient bundle (Patient + Encounter + Condition + MedicationStatement)', async () => {
    const bundle = await ctx.exportsSvc.patientBundle(ctx.student.patient_id);
    expect(bundle.entry.map((e) => e.resource.resourceType).sort())
      .toEqual(['Condition', 'Encounter', 'MedicationStatement', 'Patient']);
    expectSelfContained(bundle);
  });

  it('404s for an unknown patient', async () => {
    await expect(ctx.exportsSvc.patientBundle('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('hands the mapper (patientView, visits) for a single patient', async () => {
    const fhir = { ...fhirMapper, buildPatientBundle: vi.fn(() => ({ resourceType: 'Bundle' })) };
    const svc = createExportService({ repos: ctx.repos, fhir });
    await svc.patientBundle(ctx.student.patient_id);
    const [patient, visits] = fhir.buildPatientBundle.mock.calls[0];
    expect(patient.patient_id).toBe(ctx.student.patient_id);
    expect(visits).toHaveLength(1);
  });

  it('bulk: accepts listForExport() entries shaped [{patient, visits}]', async () => {
    const bundle = await ctx.exportsSvc.bulkBundle({});
    expect(bundle.entry).toHaveLength(4);
    expectSelfContained(bundle);
  });

  it('bulk: also accepts a flat Visit[] and groups it by patient', async () => {
    const flat = (await ctx.repos.visits.listByPatient(ctx.student.patient_id));
    vi.spyOn(ctx.repos.visits, 'listForExport').mockResolvedValue(flat);
    const fhir = { ...fhirMapper, buildBulkBundle: vi.fn(() => ({ resourceType: 'Bundle' })) };
    await createExportService({ repos: ctx.repos, fhir }).bulkBundle({});
    const entries = fhir.buildBulkBundle.mock.calls[0][0];
    expect(entries).toHaveLength(1);
    expect(entries[0].patient.patient_id).toBe(ctx.student.patient_id);
    expect(entries[0].visits).toHaveLength(1);
  });

  it('bulk: fails loudly instead of silently dropping visits of an unknown patient', async () => {
    vi.spyOn(ctx.repos.visits, 'listForExport').mockResolvedValue([{ visit_id: 'v', patient_id: 'missing' }]);
    await expect(ctx.exportsSvc.bulkBundle({})).rejects.toThrow(/unknown patient/);
  });

  it('bulk: empty range gives an empty collection', async () => {
    vi.spyOn(ctx.repos.visits, 'listForExport').mockResolvedValue([]);
    const bundle = await ctx.exportsSvc.bulkBundle({ from: '2000-01-01', to: '2000-01-02' });
    expect(bundle.entry).toEqual([]);
  });
});
