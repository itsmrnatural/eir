import { describe, it, expect, vi } from 'vitest';
import { buildHarness, expectError } from './helpers.js';
import * as fhirMapper from '../../fhir/index.js';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

async function recordVisit(h, patient, over = {}) {
  const res = await h.api('staff').post('/visits').send({
    patient_id: patient.patient_id, health_issue: h.issues[0].label, health_issue_is_custom: false,
    remedy: 'Paracetamol 500mg', confirm_duplicate: true, ...over,
  });
  expect(res.status).toBe(201);
  return res.body;
}

/** fullUrl is urn:uuid:<id> on every entry and every reference resolves inside the bundle. */
function expectSelfContainedCollection(bundle) {
  expect(bundle.resourceType).toBe('Bundle');
  expect(bundle.type).toBe('collection');
  const urls = new Set(bundle.entry.map((e) => e.fullUrl));
  for (const url of urls) expect(url).toMatch(/^urn:uuid:[0-9a-f-]{36}$/i);
  const refs = [];
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) (k === 'reference' && typeof v === 'string' ? refs.push(v) : walk(v));
    }
  };
  bundle.entry.forEach((e) => walk(e.resource));
  for (const r of refs) expect(urls.has(r), `unresolved reference ${r}`).toBe(true);
}

describe('GET /export/fhir/patients/:id (ADMIN only)', () => {
  it('returns a FHIR R4 collection Bundle as application/fhir+json', async () => {
    const h = await buildHarness();
    await recordVisit(h, h.student);
    const res = await h.api('admin').get(`/export/fhir/patients/${h.student.patient_id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/fhir\+json/);
    expectSelfContainedCollection(res.body);
    const types = res.body.entry.map((e) => e.resource.resourceType);
    expect(types).toContain('Patient');
    expect(types).toContain('Encounter');
    expect(types).toContain('Condition');
    expect(types).toContain('MedicationStatement');
    const patient = res.body.entry.find((e) => e.resource.resourceType === 'Patient').resource;
    expect(patient.id).toBe(h.student.patient_id);
  });

  it('calls the pure mapper with (PatientView, Visit[]) — the server does the fetching', async () => {
    const fhir = { ...fhirMapper, buildPatientBundle: vi.fn(() => ({ resourceType: 'Bundle', type: 'collection', entry: [] })) };
    const h = await buildHarness({ fhir });
    await recordVisit(h, h.student);
    expect((await h.api('admin').get(`/export/fhir/patients/${h.student.patient_id}`)).status).toBe(200);
    const [patient, visits] = fhir.buildPatientBundle.mock.calls[0];
    expect(patient.patient_id).toBe(h.student.patient_id);
    expect(visits).toHaveLength(1);
    expect(visits[0]).not.toHaveProperty('_id');
  });

  it('403 for STAFF, 401 anonymous, 404 unknown patient, 400 malformed id', async () => {
    const h = await buildHarness();
    expectError(await h.api('staff').get(`/export/fhir/patients/${h.student.patient_id}`), 403, 'FORBIDDEN');
    expectError(await h.api(null).get(`/export/fhir/patients/${h.student.patient_id}`), 401, 'UNAUTHENTICATED');
    expectError(await h.api('admin').get(`/export/fhir/patients/${UNKNOWN_ID}`), 404, 'NOT_FOUND');
    expectError(await h.api('admin').get('/export/fhir/patients/nope'), 400, 'VALIDATION_ERROR');
  });
});

describe('GET /export/fhir/bulk (ADMIN only)', () => {
  it('bundles every patient with visits in the range', async () => {
    const h = await buildHarness();
    await recordVisit(h, h.student);
    await recordVisit(h, h.student2);
    const res = await h.api('admin').get('/export/fhir/bulk');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/fhir\+json/);
    expectSelfContainedCollection(res.body);
    expect(res.body.entry.filter((e) => e.resource.resourceType === 'Patient')).toHaveLength(2);
    expect(res.body.entry.filter((e) => e.resource.resourceType === 'Encounter')).toHaveLength(2);
  });

  it('passes from/to through and returns an empty collection for an empty range', async () => {
    const h = await buildHarness();
    await recordVisit(h, h.student);
    const spy = vi.spyOn(h.repos.visits, 'listForExport');
    const res = await h.api('admin').get('/export/fhir/bulk?from=2000-01-01&to=2000-01-31');
    expect(res.status).toBe(200);
    expect(res.body.entry).toEqual([]);
    expect(spy.mock.calls[0][0]).toEqual({ from: '2000-01-01', to: '2000-01-31' });
  });

  it('403 for STAFF and 400 for bad dates', async () => {
    const h = await buildHarness();
    expectError(await h.api('staff').get('/export/fhir/bulk'), 403, 'FORBIDDEN');
    expectError(await h.api('admin').get('/export/fhir/bulk?from=2026-02-01&to=2026-01-01'), 400, 'VALIDATION_ERROR');
  });
});
