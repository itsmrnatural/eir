import { describe, it, expect } from 'vitest';
import { SEED, buildHarness, expectError } from './helpers.js';

/** Every protected endpoint with its minimum role. */
async function routeTable(h) {
  const visit = (await h.api('staff').post('/visits').send({
    patient_id: h.student.patient_id, health_issue: h.issues[0].label, health_issue_is_custom: false, remedy: 'Rest',
  })).body;
  const sid = h.student.patient_id;
  return {
    STAFF: [
      ['get', '/auth/me'],
      ['get', `/patients/by-rfid/${SEED.rfid}`],
      ['get', '/patients/by-phone/9000000001'],
      ['post', '/patients/non-students', { name: 'Role Test', age: 30, sex: 'F', phone_no: '9000000003', designation: 'STAFF' }],
      ['get', '/patients?q=test'],
      ['get', `/patients/${sid}`],
      ['patch', `/patients/${sid}`, { name: 'Test Student One' }],
      ['post', '/visits', { patient_id: h.student2.patient_id, health_issue: h.issues[0].label, health_issue_is_custom: false, remedy: 'Rest' }],
      ['get', '/meta/branches'],
      ['get', '/meta/health-issues'],
    ],
    ADMIN: [
      ['patch', `/visits/${visit.visit_id}`, { remedy: 'Corrected' }],
      ['get', `/patients/${sid}/history`],
      ['get', '/reports/common-issues'],
      ['get', '/reports/peak-hours'],
      ['get', '/reports/frequent-visitors'],
      ['get', '/reports/visits-by-branch'],
      ['get', '/reports/visits-by-batch'],
      ['get', '/reports/visits-over-time'],
      ['get', `/export/fhir/patients/${sid}`],
      ['get', '/export/fhir/bulk'],
    ],
  };
}

describe('role matrix', () => {
  it('every protected endpoint answers 401 without a token', async () => {
    const h = await buildHarness();
    const table = await routeTable(h);
    for (const [method, path, body] of [...table.STAFF, ...table.ADMIN]) {
      const res = await h.api(null)[method](path).send(body);
      expectError(res, 401, 'UNAUTHENTICATED');
    }
  });

  it('STAFF can use every STAFF+ endpoint', async () => {
    const h = await buildHarness();
    const table = await routeTable(h);
    for (const [method, path, body] of table.STAFF) {
      const res = await h.api('staff')[method](path).send(body);
      expect([200, 201], `${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
    }
  });

  it('STAFF gets 403 FORBIDDEN on every ADMIN endpoint', async () => {
    const h = await buildHarness();
    const table = await routeTable(h);
    for (const [method, path, body] of table.ADMIN) {
      expectError(await h.api('staff')[method](path).send(body), 403, 'FORBIDDEN');
    }
  });

  it('ADMIN can use every ADMIN endpoint and every STAFF+ endpoint', async () => {
    const h = await buildHarness();
    const table = await routeTable(h);
    for (const [method, path, body] of [...table.ADMIN, ...table.STAFF.filter(([m, p]) => !(m === 'post' && p === '/visits'))]) {
      const res = await h.api('admin')[method](path).send(body);
      expect([200, 201], `${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
    }
  });

  it('there are no endpoints for creating students or users, or for deleting anything', async () => {
    const h = await buildHarness();
    for (const [method, path] of [
      ['post', '/patients/students'], ['post', '/patients'], ['post', '/users'], ['post', '/auth/register'],
      ['delete', `/patients/${h.student.patient_id}`], ['delete', '/visits/x'], ['get', '/users'],
    ]) {
      expectError(await h.api('admin')[method](path).send({}), 404, 'NOT_FOUND');
    }
  });
});
