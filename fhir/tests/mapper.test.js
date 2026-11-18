import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  patientToFhir, visitToFhirResources, buildPatientBundle, buildBulkBundle, FhirMappingError, ROLL_NO_SYSTEM,
} from '../index.js';
import { uuidV5, UUID_RE } from '../src/uuid.js';
import { student, nonStudent, other, studentVisits, nonStudentVisits, otherVisits } from './fixtures.js';

describe('patientToFhir', () => {
  test('student: id, roll-no identifier, name.text, gender, full birthDate, no telecom', () => {
    assert.deepEqual(patientToFhir(student), {
      resourceType: 'Patient', id: student.patient_id,
      identifier: [{ system: 'https://nitdelhi.ac.in/id/roll-no', value: '251210901' }],
      name: [{ text: 'Sample Alpha' }], gender: 'female', birthDate: '2006-03-14',
    });
    assert.equal(ROLL_NO_SYSTEM, 'https://nitdelhi.ac.in/id/roll-no');
  });
  test('non-student: phone telecom and an approximate YEAR-ONLY birthDate (registered_on year - age_at_registration)', () => {
    assert.deepEqual(patientToFhir(nonStudent), {
      resourceType: 'Patient', id: nonStudent.patient_id, telecom: [{ system: 'phone', value: '9000000001' }],
      name: [{ text: 'Sample Bravo' }], gender: 'male', birthDate: '1985',
    });
    // the estimate does not drift with the current age field: 2026 - 30 = 1996 would be wrong, 2026 (registered) - 30 = 1996 here
    assert.equal(patientToFhir(other).birthDate, '1996');
    assert.equal(patientToFhir({ ...nonStudent, age: 99 }).birthDate, '1985', 'uses age_at_registration, not the live age');
  });
  test('gender mapping M/F/Other', () => {
    assert.deepEqual([student, nonStudent, other].map((p) => patientToFhir(p).gender), ['female', 'male', 'other']);
    assert.equal(patientToFhir({ ...student, sex: 'M' }).gender, 'male');
  });
  test('birthDate is omitted (not guessed) when the data to compute it is absent', () => {
    const { registered_on, ...noReg } = nonStudent;
    assert.equal('birthDate' in patientToFhir(noReg), false);
    const { dob, ...noDob } = student;
    assert.equal('birthDate' in patientToFhir(noDob), false);
  });
  test('rejects what it cannot map', () => {
    assert.throws(() => patientToFhir({ ...student, sex: 'X' }), FhirMappingError);
    assert.throws(() => patientToFhir({ ...student, patient_id: 'abc' }), /UUID/);
    assert.throws(() => patientToFhir({ ...student, patient_type: 'DOCTOR' }), FhirMappingError);
    assert.throws(() => patientToFhir(null), FhirMappingError);
  });
});

describe('visitToFhirResources', () => {
  const [enc, cond, med] = visitToFhirResources(studentVisits[0], student);
  test('Encounter: finished, class AMB, period.start = date_time (UTC), subject -> Patient', () => {
    assert.deepEqual(enc, {
      resourceType: 'Encounter', id: studentVisits[0].visit_id, status: 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
      subject: { reference: `urn:uuid:${student.patient_id}` }, period: { start: '2026-11-16T05:35:00.000Z' },
    });
  });
  test('Condition: code.text = health_issue, encounter and subject refs, no coding without a verified code', () => {
    assert.deepEqual(cond.code, { text: 'Fever' });
    assert.deepEqual(cond.subject, { reference: `urn:uuid:${student.patient_id}` });
    assert.deepEqual(cond.encounter, { reference: `urn:uuid:${enc.id}` });
    assert.equal(cond.recordedDate, '2026-11-16T05:35:00.000Z');
    assert.match(cond.id, UUID_RE);
  });
  test('MedicationStatement: completed, remedy as text, context -> Encounter, subject -> Patient', () => {
    assert.equal(med.status, 'completed');
    assert.deepEqual(med.medicationCodeableConcept, { text: 'Paracetamol 500mg' });
    assert.deepEqual(med.context, { reference: `urn:uuid:${enc.id}` });
    assert.deepEqual(med.subject, { reference: `urn:uuid:${student.patient_id}` });
  });
  test('derived ids are stable and distinct', () => {
    const again = visitToFhirResources(studentVisits[0], student);
    assert.deepEqual(again, [enc, cond, med]);
    assert.equal(new Set([enc.id, cond.id, med.id]).size, 3);
    assert.equal(uuidV5('x'), uuidV5('x'));
    assert.notEqual(uuidV5('x'), uuidV5('y'));
    assert.equal(uuidV5('x')[14], '5');
  });
  test('coding is added only for a verified, non-custom mapping the caller supplies', () => {
    const codings = { Fever: { system: 'http://example.org/verified', code: 'F1', display: 'Fever' } };
    assert.deepEqual(visitToFhirResources(studentVisits[0], student, { conditionCodings: codings })[1].code, {
      text: 'Fever', coding: [{ system: 'http://example.org/verified', code: 'F1', display: 'Fever' }],
    });
    const custom = { ...studentVisits[0], health_issue_is_custom: true };
    assert.deepEqual(visitToFhirResources(custom, student, { conditionCodings: codings })[1].code, { text: 'Fever' });
  });
  test('accepts ISO strings for date_time; no MedicationStatement when no remedy; refuses a visit of another patient', () => {
    const asString = { ...studentVisits[0], date_time: '2026-11-16T11:05:00+05:30' };
    assert.equal(visitToFhirResources(asString, student)[0].period.start, '2026-11-16T05:35:00.000Z');
    assert.equal(visitToFhirResources({ ...studentVisits[0], remedy: '  ' }, student).length, 2);
    assert.throws(() => visitToFhirResources(studentVisits[0], nonStudent), /belongs to patient/);
    assert.throws(() => visitToFhirResources({ ...studentVisits[0], date_time: 'yesterday' }, student), /date-time/);
    assert.throws(() => visitToFhirResources({ ...studentVisits[0], health_issue: '' }, student), FhirMappingError);
  });
});

describe('bundles', () => {
  test('patient bundle: type collection, urn:uuid fullUrls, Patient first then 3 resources per visit', () => {
    const b = buildPatientBundle(student, studentVisits);
    assert.equal(b.resourceType, 'Bundle');
    assert.equal(b.type, 'collection');
    assert.equal('total' in b, false);
    assert.deepEqual(b.entry.map((e) => e.resource.resourceType), ['Patient', 'Encounter', 'Condition', 'MedicationStatement', 'Encounter', 'Condition', 'MedicationStatement']);
    for (const e of b.entry) assert.equal(e.fullUrl, `urn:uuid:${e.resource.id}`);
    assert.equal(buildPatientBundle(student, []).entry.length, 1);
  });
  test('every reference resolves inside the bundle', () => {
    const b = buildBulkBundle([{ patient: student, visits: studentVisits }, { patient: nonStudent, visits: nonStudentVisits }]);
    const urls = new Set(b.entry.map((e) => e.fullUrl));
    const refs = [];
    const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') { if (n.reference) refs.push(n.reference); Object.values(n).forEach(walk); } };
    b.entry.forEach((e) => walk(e.resource));
    assert.ok(refs.length >= 10);
    for (const r of refs) assert.ok(urls.has(r), `${r} dangling`);
  });
  test('bulk bundle groups per patient; refuses duplicates', () => {
    const b = buildBulkBundle([{ patient: student, visits: studentVisits }, { patient: other, visits: otherVisits }]);
    assert.equal(b.entry.length, (1 + 6) + (1 + 3)); // student: Patient + 2 visits x 3, other: Patient + 1 visit x 3
    assert.deepEqual(buildBulkBundle([]).entry, []);
    assert.throws(() => buildBulkBundle([{ patient: student, visits: [] }, { patient: student, visits: [] }]), /duplicate resource/);
  });
  test('functions are pure: inputs are not mutated', () => {
    const before = JSON.stringify([student, studentVisits]);
    buildPatientBundle(student, studentVisits);
    assert.equal(JSON.stringify([student, studentVisits]), before);
  });
});
