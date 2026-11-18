/**
 * Contract test against contract/openapi.yaml:
 *   1. every operation in the spec is routed by the server (never 404/405/500 when anonymous),
 *   2. the spec documents no DELETE operation,
 *   3. real responses (success AND error) validate against the response schemas in the spec.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import YAML from 'yaml';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { API, PASSWORDS, SEED, buildHarness } from './helpers.js';

const SPEC_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../contract/openapi.yaml');
const suite = fs.existsSync(SPEC_PATH) ? describe : describe.skip;
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const UUID = '3f2b8c1e-5d4a-4b6e-9c7d-1a2b3c4d5e6f';
const SPEC_ID = 'https://health-centre.test/openapi.json';

suite('contract/openapi.yaml', () => {
  const spec = YAML.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  const ops = Object.entries(spec.paths).flatMap(([template, item]) =>
    METHODS.filter((m) => item[m]).map((method) => ({ method, template })),
  );

  // Spec paths may include /api/v1 or rely on servers[0].url.
  const serverPath = (() => {
    const u = spec.servers?.[0]?.url;
    if (!u) return '';
    return (u.startsWith('http') ? new URL(u).pathname : u).replace(/\/$/, '');
  })();
  const prefix = Object.keys(spec.paths).some((p) => p.startsWith(API)) ? '' : serverPath || API;

  const fill = (template) =>
    template.replace(/\{(\w+)\}/g, (_m, name) => (name.includes('phone') ? '9000000001' : name.includes('rfid') ? 'CARD1' : UUID));

  /* ---- JSON-schema plumbing (OpenAPI 3.0 and 3.1) ---- */
  const ajv = new (String(spec.openapi).startsWith('3.1') ? Ajv2020 : Ajv)({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: SPEC_ID, components: spec.components ?? {} });

  const deref = (node) => {
    let cur = node;
    while (cur && cur.$ref) {
      cur = cur.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], spec);
    }
    return cur;
  };
  const rewriteRefs = (schema) => JSON.parse(JSON.stringify(schema).replaceAll('"$ref":"#/', `"$ref":"${SPEC_ID}#/`));

  function schemaFor(template, method, status) {
    const responses = spec.paths[template]?.[method]?.responses ?? {};
    const response = deref(responses[String(status)] ?? responses.default);
    if (!response) return { documented: false };
    const content = response.content ?? {};
    const media = content['application/json'] ?? content['application/fhir+json'] ?? Object.values(content)[0];
    return { documented: true, schema: media?.schema ? rewriteRefs(media.schema) : null };
  }

  it('documents no DELETE operation (visits are never deleted)', () => {
    expect(ops.filter((o) => o.method === 'delete')).toEqual([]);
  });

  it('every documented operation is routed by the server', async () => {
    const h = await buildHarness();
    const missing = [];
    for (const { method, template } of ops) {
      const res = await request(h.app)[method](prefix + fill(template));
      if (![400, 401].includes(res.status)) missing.push(`${method.toUpperCase()} ${template} -> ${res.status}`);
    }
    expect(missing, `operations not served as documented:\n${missing.join('\n')}`).toEqual([]);
  });

  it('real responses validate against the documented schemas', async () => {
    const h = await buildHarness();
    const person = (await h.api('staff').post('/patients/non-students').send({
      name: 'Contract Person', age: 33, sex: 'F', phone_no: '9000000007', designation: 'STAFF',
    })).body;
    const visitBody = { patient_id: h.student.patient_id, health_issue: h.issues[0].label, health_issue_is_custom: false, remedy: 'Rest' };
    const visit = (await h.api('staff').post('/visits').send(visitBody)).body;
    const sid = h.student.patient_id;

    // [who, method, spec template, concrete path, body, expected status]
    const scenarios = [
      [null, 'post', '/auth/login', '/auth/login', { username: 'admin', password: PASSWORDS.admin }, 200],
      ['staff', 'get', '/auth/me', '/auth/me', undefined, 200],
      ['staff', 'get', '/patients/by-rfid/{rfid_id}', `/patients/by-rfid/${SEED.rfid}`, undefined, 200],
      ['staff', 'get', '/patients/by-rfid/{rfid_id}', '/patients/by-rfid/NOSUCHCARD', undefined, 404],
      ['staff', 'get', '/patients/by-phone/{phone_no}', '/patients/by-phone/9000000007', undefined, 200],
      ['staff', 'post', '/patients/non-students', '/patients/non-students', { name: 'Contract Two', age: 20, sex: 'M', phone_no: '9000000008', designation: 'WORKER' }, 201],
      ['staff', 'post', '/patients/non-students', '/patients/non-students', { name: 'Contract Person', age: 33, sex: 'F', phone_no: '9000000007', designation: 'STAFF' }, 409],
      ['staff', 'post', '/patients/non-students', '/patients/non-students', { name: 'X', age: 999, sex: 'M', phone_no: '1', designation: 'WORKER' }, 400],
      ['staff', 'get', '/patients', '/patients?q=contract', undefined, 200],
      ['staff', 'get', '/patients/{id}', `/patients/${person.patient_id}`, undefined, 200],
      ['staff', 'patch', '/patients/{id}', `/patients/${person.patient_id}`, { name: 'Contract Person Renamed' }, 200],
      ['staff', 'post', '/visits', '/visits', { ...visitBody, patient_id: h.student2.patient_id }, 201],
      ['staff', 'post', '/visits', '/visits', visitBody, 409],
      ['admin', 'patch', '/visits/{id}', `/visits/${visit.visit_id}`, { remedy: 'Corrected' }, 200],
      ['admin', 'get', '/patients/{id}/history', `/patients/${sid}/history`, undefined, 200],
      ['admin', 'get', '/reports/common-issues', '/reports/common-issues', undefined, 200],
      ['admin', 'get', '/reports/peak-hours', '/reports/peak-hours', undefined, 200],
      ['admin', 'get', '/reports/frequent-visitors', '/reports/frequent-visitors', undefined, 200],
      ['admin', 'get', '/reports/visits-by-branch', '/reports/visits-by-branch', undefined, 200],
      ['admin', 'get', '/reports/visits-by-batch', '/reports/visits-by-batch', undefined, 200],
      ['admin', 'get', '/reports/visits-over-time', '/reports/visits-over-time?bucket=week', undefined, 200],
      ['staff', 'get', '/meta/branches', '/meta/branches', undefined, 200],
      ['staff', 'get', '/meta/health-issues', '/meta/health-issues', undefined, 200],
      ['admin', 'get', '/export/fhir/patients/{id}', `/export/fhir/patients/${sid}`, undefined, 200],
      ['admin', 'get', '/export/fhir/bulk', '/export/fhir/bulk', undefined, 200],
      ['staff', 'get', '/reports/common-issues', '/reports/common-issues', undefined, 403],
      [null, 'get', '/auth/me', '/auth/me', undefined, 401],
    ];

    const problems = [];
    const warnings = [];
    for (const [who, method, template, url, body, status] of scenarios) {
      if (!spec.paths[template]?.[method]) { problems.push(`spec has no ${method.toUpperCase()} ${template}`); continue; }
      const res = await h.api(who)[method](url).send(body);
      if (res.status !== status) { problems.push(`${method.toUpperCase()} ${url}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`); continue; }

      const { documented, schema } = schemaFor(template, method, status);
      if (!documented) {
        (status < 400 ? problems : warnings).push(`spec does not document ${status} for ${method.toUpperCase()} ${template}`);
        continue;
      }
      if (!schema) continue;
      const validate = ajv.compile(schema);
      if (!validate(res.body)) {
        problems.push(`${method.toUpperCase()} ${template} ${status} violates the spec: ${ajv.errorsText(validate.errors)}`);
      }
    }
    if (warnings.length) console.warn(`contract warnings:\n${warnings.join('\n')}`);
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
