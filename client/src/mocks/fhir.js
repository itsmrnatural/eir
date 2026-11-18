// Small FHIR stand-in for mock mode, so the export buttons have something to download.
import { uuid } from './db.js';

const GENDER = { M: 'male', F: 'female', Other: 'other' };
const ref = (id) => ({ reference: `urn:uuid:${id}` });

export function mockPatientResource(v) {
  const r = { resourceType: 'Patient', id: v.patient_id, name: [{ text: v.name }], gender: GENDER[v.sex] };
  if (v.roll_no) r.identifier = [{ system: 'https://nitdelhi.ac.in/id/roll-no', value: v.roll_no }];
  if (v.phone_no) r.telecom = [{ system: 'phone', value: v.phone_no }];
  r.birthDate = v.dob ?? String(new Date().getUTCFullYear() - v.age);
  return r;
}

export function mockVisitResources(visit, patientId) {
  const enc = uuid();
  return [
    { resourceType: 'Encounter', id: enc, status: 'finished', class: { code: 'AMB' }, period: { start: visit.date_time }, subject: ref(patientId) },
    { resourceType: 'Condition', id: uuid(), code: { text: visit.health_issue }, subject: ref(patientId), encounter: ref(enc) },
    { resourceType: 'MedicationStatement', id: uuid(), status: 'completed', medicationCodeableConcept: { text: visit.remedy }, subject: ref(patientId), context: ref(enc) },
  ];
}

export function mockBundle(resources) {
  return { resourceType: 'Bundle', type: 'collection', entry: resources.map((r) => ({ fullUrl: `urn:uuid:${r.id}`, resource: r })) };
}
