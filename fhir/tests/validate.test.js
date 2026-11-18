import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateBundle, validateResource } from './r4-structural.js';
import { buildPatientBundle, buildBulkBundle, patientToFhir } from '../index.js';
import { student, nonStudent, other, studentVisits, nonStudentVisits, otherVisits } from './fixtures.js';

describe('structural R4 check: everything the mapper emits is clean', () => {
  test('student, non-student and bulk bundles have no issues', () => {
    assert.deepEqual(validateBundle(buildPatientBundle(student, studentVisits)), []);
    assert.deepEqual(validateBundle(buildPatientBundle(nonStudent, nonStudentVisits)), []);
    assert.deepEqual(validateBundle(buildBulkBundle([
      { patient: student, visits: studentVisits }, { patient: nonStudent, visits: nonStudentVisits }, { patient: other, visits: otherVisits },
    ])), []);
  });
  test('a patient with no visits and every sex value validate', () => {
    for (const p of [student, nonStudent, other, { ...student, sex: 'M' }]) assert.deepEqual(validateBundle(buildPatientBundle(p, [])), []);
  });
});

describe('the checker itself catches mistakes (so a clean result means something)', () => {
  const good = () => buildPatientBundle(student, studentVisits);
  const issuesOf = (mutate) => { const b = structuredClone(good()); mutate(b); return validateBundle(b); };
  const has = (issues, text) => assert.ok(issues.some((i) => i.includes(text)), `expected an issue containing "${text}", got:\n${issues.join('\n')}`);

  test('unknown / R5 element names', () => {
    has(issuesOf((b) => { b.entry[1].resource.subjectt = {}; }), 'not an element of Encounter');
    has(issuesOf((b) => { b.entry[3].resource.medication = { concept: { text: 'x' } }; }), 'not an element of MedicationStatement'); // R5 name
    has(issuesOf((b) => { b.entry[3].resource.encounter = { reference: b.entry[1].fullUrl }; }), 'not an element of MedicationStatement'); // R5 name for `context`
  });
  test('required elements and value sets', () => {
    has(issuesOf((b) => { delete b.entry[1].resource.status; }), 'status: required');
    has(issuesOf((b) => { delete b.entry[1].resource.class; }), 'class: required');
    has(issuesOf((b) => { b.entry[0].resource.gender = 'M'; }), 'required value set');
    has(issuesOf((b) => { b.entry[1].resource.status = 'done'; }), 'required value set');
    has(issuesOf((b) => { delete b.entry[2].resource.subject; }), 'subject: required');
    has(issuesOf((b) => { delete b.entry[3].resource.medicationCodeableConcept; }), 'medicationCodeableConcept / medicationReference');
  });
  test('formats and JSON rules', () => {
    has(issuesOf((b) => { b.entry[0].resource.birthDate = '14/03/2006'; }), 'valid FHIR date');
    has(issuesOf((b) => { b.entry[1].resource.period.start = '2026-11-16 05:35'; }), 'valid FHIR dateTime');
    has(issuesOf((b) => { b.entry[0].resource.name = []; }), 'empty array');
    has(issuesOf((b) => { b.entry[0].resource.name = { text: 'x' }; }), 'must be an array');
    has(issuesOf((b) => { b.entry[2].resource.code.text = ''; }), 'empty string');
    has(issuesOf((b) => { b.entry[0].resource.id = 'has spaces'; }), 'valid FHIR id');
  });
  test('bundle rules and reference resolution', () => {
    has(issuesOf((b) => { b.total = 3; }), 'bdl-1');
    has(issuesOf((b) => { b.type = 'searchset'; }), 'collection bundles only');
    has(issuesOf((b) => { b.entry[2].fullUrl = b.entry[1].fullUrl; }), 'bdl-7');
    has(issuesOf((b) => { b.entry[1].fullUrl = 'urn:uuid:00000000-0000-4000-8000-000000000000'; }), 'does not match');
    has(issuesOf((b) => { b.entry[2].resource.subject.reference = 'urn:uuid:11111111-1111-4111-8111-111111111111'; }), 'does not resolve');
    has(issuesOf((b) => { b.entry[2].resource.encounter.reference = b.entry[0].fullUrl; }), 'points to a Patient');
    has(issuesOf((b) => { delete b.entry[1].fullUrl; }), 'fullUrl: required');
    has(validateResource({ resourceType: 'Patient' }), 'id: missing');
    has(validateResource({ resourceType: 'Banana', id: 'x' }), 'not covered');
  });
  test('year-only birthDate is a valid FHIR date', () => {
    assert.deepEqual(validateResource(patientToFhir(nonStudent)), []);
  });
});
