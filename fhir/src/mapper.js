// PatientView / Visit  ->  FHIR R4 resources. Pure functions: no I/O, no clock, no database.
import { uuidV5, UUID_RE } from './uuid.js';

export const ROLL_NO_SYSTEM = 'https://nitdelhi.ac.in/id/roll-no';
export const ACT_CODE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v3-ActCode';
const GENDER = Object.freeze({ M: 'male', F: 'female', Other: 'other' });
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export class FhirMappingError extends Error {
  constructor(message) { super(message); this.name = 'FhirMappingError'; }
}
const fail = (m) => { throw new FhirMappingError(m); };

const urn = (id) => `urn:uuid:${id}`;
const ref = (id) => ({ reference: urn(id) });

function requireUuid(v, what) {
  if (typeof v !== 'string' || !UUID_RE.test(v)) fail(`${what} must be a UUID, got ${JSON.stringify(v)}`);
  return v.toLowerCase();
}

function isoInstant(v, what) {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) fail(`${what} is not a valid date-time: ${JSON.stringify(v)}`);
  return d.toISOString();
}

/** Patient. Students: full birthDate. Non-students: year only, an approximation (see NOTES.md). */
export function patientToFhir(p) {
  if (!p || typeof p !== 'object') fail('patientView is required');
  const id = requireUuid(p.patient_id, 'patient_id');
  if (!GENDER[p.sex]) fail(`sex must be M, F or Other, got ${JSON.stringify(p.sex)}`);
  if (typeof p.name !== 'string' || p.name.trim() === '') fail('name is required');
  if (p.patient_type !== 'STUDENT' && p.patient_type !== 'NON_STUDENT') fail(`patient_type must be STUDENT or NON_STUDENT, got ${JSON.stringify(p.patient_type)}`);

  const r = { resourceType: 'Patient', id };
  if (p.patient_type === 'STUDENT') {
    if (p.roll_no) r.identifier = [{ system: ROLL_NO_SYSTEM, value: String(p.roll_no) }];
  } else if (p.phone_no) {
    r.telecom = [{ system: 'phone', value: String(p.phone_no) }];
  }
  r.name = [{ text: p.name }];
  r.gender = GENDER[p.sex];

  if (p.patient_type === 'STUDENT') {
    if (typeof p.dob === 'string' && YMD.test(p.dob)) r.birthDate = p.dob;
  } else if (typeof p.registered_on === 'string' && YMD.test(p.registered_on) && Number.isInteger(p.age_at_registration)) {
    const year = Number(p.registered_on.slice(0, 4)) - p.age_at_registration;
    if (year >= 1 && year <= 9999) r.birthDate = String(year).padStart(4, '0'); // year only: the age was an estimate
  }
  return r;
}

/**
 * Encounter + Condition (+ MedicationStatement when a remedy was recorded) for one visit.
 * @param {object} visit        visit document (date_time may be a Date or an ISO string)
 * @param {object} patientView  must be the visit's patient
 * @param {{conditionCodings?: Record<string, {system:string, code:string, display?:string}>}} [opts]
 *        optional VERIFIED terminology codings keyed by health_issue label (none are shipped: see NOTES.md)
 */
export function visitToFhirResources(visit, patientView, opts = {}) {
  if (!visit || typeof visit !== 'object') fail('visit is required');
  const visitId = requireUuid(visit.visit_id, 'visit_id');
  const patientId = requireUuid(visit.patient_id, 'visit.patient_id');
  if (patientView && patientView.patient_id && patientId !== String(patientView.patient_id).toLowerCase()) {
    fail(`visit ${visitId} belongs to patient ${patientId}, not ${patientView.patient_id}`);
  }
  if (typeof visit.health_issue !== 'string' || visit.health_issue.trim() === '') fail(`visit ${visitId} has no health_issue`);
  const when = isoInstant(visit.date_time, 'visit.date_time');

  const encounter = {
    resourceType: 'Encounter',
    id: visitId,
    status: 'finished',
    class: { system: ACT_CODE_SYSTEM, code: 'AMB', display: 'ambulatory' },
    subject: ref(patientId),
    period: { start: when },
  };

  const code = { text: visit.health_issue };
  const known = !visit.health_issue_is_custom && opts.conditionCodings?.[visit.health_issue];
  if (known && known.system && known.code) {
    code.coding = [{ system: known.system, code: known.code, ...(known.display ? { display: known.display } : {}) }];
  }
  const condition = {
    resourceType: 'Condition',
    id: uuidV5(`${visitId}:condition`),
    code,
    subject: ref(patientId),
    encounter: ref(visitId),
    recordedDate: when,
  };

  const out = [encounter, condition];
  if (typeof visit.remedy === 'string' && visit.remedy.trim() !== '') {
    out.push({
      resourceType: 'MedicationStatement',
      id: uuidV5(`${visitId}:medication-statement`),
      status: 'completed',
      medicationCodeableConcept: { text: visit.remedy },
      subject: ref(patientId),
      context: ref(visitId),
      dateAsserted: when,
    });
  }
  return out;
}

const toEntry = (resource) => ({ fullUrl: urn(resource.id), resource });

function bundleOf(resources) {
  const seen = new Set();
  for (const r of resources) {
    const key = `${r.resourceType}/${r.id}`;
    if (seen.has(key)) fail(`duplicate resource ${key} in bundle`);
    seen.add(key);
  }
  return { resourceType: 'Bundle', type: 'collection', entry: resources.map(toEntry) };
}

/** One patient with all the given visits. */
export function buildPatientBundle(patientView, visits = []) {
  const patient = patientToFhir(patientView);
  const resources = [patient];
  for (const v of visits) resources.push(...visitToFhirResources(v, patientView));
  return bundleOf(resources);
}

/**
 * @param {{patient: object, visits: object[]}[]} entries  the shape returned by repos.visits.listForExport()
 */
export function buildBulkBundle(entries = []) {
  const resources = [];
  for (const { patient, visits = [] } of entries) {
    resources.push(patientToFhir(patient));
    for (const v of visits) resources.push(...visitToFhirResources(v, patient));
  }
  return bundleOf(resources);
}
