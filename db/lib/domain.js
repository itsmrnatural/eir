// Business rules that do not depend on which database is underneath.
import { istDateString } from './time.js';

export const DEFAULT_DUPLICATE_WINDOW_MIN = 10;

export function duplicateWindowMin(explicit, env = process.env) {
  const v = Number(explicit ?? env.DUPLICATE_VISIT_WINDOW_MIN ?? DEFAULT_DUPLICATE_WINDOW_MIN);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_DUPLICATE_WINDOW_MIN;
}

/** a visit is a duplicate if the same patient has a visit within the last N minutes (inclusive). */
export function isDuplicateVisit(lastVisitAt, now, windowMin) {
  return now.getTime() - new Date(lastVisitAt).getTime() <= windowMin * 60 * 1000;
}

/** visit snapshot: what the patient looked like at visit time (reports read only this). */
export function buildSnapshot(view) {
  const snap = { name: view.name, sex: view.sex, age_at_visit: view.age };
  if (view.patient_type === 'STUDENT') {
    snap.roll_no = view.roll_no;
    snap.batch_year = view.batch_year;
    snap.program = view.program;
    snap.branch_id = view.branch_id;
    snap.branch_name = view.branch_name;
  } else {
    snap.phone_no = view.phone_no;
    snap.designation = view.designation;
  }
  return snap;
}

/** visit document. date_time is always set here (the server), never by a client. */
export function buildVisitDoc({ visitId, view, input, now }) {
  return {
    visit_id: visitId,
    patient_id: view.patient_id,
    patient_type: view.patient_type,
    snapshot: buildSnapshot(view),
    date_time: now,
    health_issue: input.health_issue,
    health_issue_is_custom: input.health_issue_is_custom,
    remedy: input.remedy,
    recorded_by: input.recorded_by,
    created_at: now,
    updated_at: now,
  };
}

export const todayIst = (now) => istDateString(now);

/** Drop null/undefined keys so optional PatientView fields are simply absent. */
export function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
}

/**
 * Turn a patient_with_age row (or the in-memory equivalent) into a PatientView.
 * age_at_registration/registered_on are exposed for NON_STUDENT only (needed by the FHIR mapper, see ASSUMPTIONS).
 */
export function toPatientView(row) {
  const view = compact({
    patient_id: row.patient_id,
    patient_type: row.patient_type,
    name: row.name,
    dob: row.patient_type === 'STUDENT' ? row.dob : null,
    age: row.age,
    age_is_estimated: row.age_is_estimated,
    sex: row.sex,
    roll_no: row.roll_no,
    batch_year: row.batch_year,
    program: row.program,
    branch_id: row.branch_id,
    branch_code: row.branch_code,
    branch_name: row.branch_name,
    phone_no: row.phone_no,
    designation: row.designation,
    rfid_id: row.rfid_id,
    age_at_registration: row.patient_type === 'NON_STUDENT' ? row.age_at_registration : null,
    registered_on: row.patient_type === 'NON_STUDENT' ? row.registered_on : null,
  });
  return view;
}
