// Input checks shared by the in-memory and the PostgreSQL/MongoDB repositories so both
// behave identically. Everything throws AppError('VALIDATION_ERROR', ...).
import { validationError } from './errors.js';
import { isUuid, normalizePhone, normalizeRfid, assertWritableRfid } from './ids.js';
import { parseYmd } from './time.js';
import { fullYearsBetween } from './age.js';

export const SEXES = ['M', 'F', 'Other'];
export const PROGRAMS = ['UG', 'PG'];
export const DESIGNATIONS = ['STAFF', 'FACULTY', 'WORKER', 'OTHER'];
export const ROLES = ['ADMIN', 'STAFF'];
export const NOT_PATCHABLE = ['roll_no', 'patient_type', 'rfid_id'];
const PATCHABLE = ['name', 'sex', 'dob', 'age', 'phone_no', 'designation'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);

export function requireObject(v, what = 'body') {
  if (!isPlainObject(v)) throw validationError(`${what} must be an object`);
  return v;
}

/** Trim, collapse inner whitespace, 1..max chars. */
export function cleanText(v, field, max) {
  if (typeof v !== 'string') throw validationError(`${field} must be a string`, { field });
  const s = v.trim().replace(/\s+/g, ' ');
  // eslint-disable-next-line no-control-regex
  if (s.length < 1 || s.length > max || /[\u0000-\u001f]/.test(s)) {
    throw validationError(`${field} must be 1-${max} printable characters`, { field });
  }
  return s;
}

export const cleanName = (v) => cleanText(v, 'name', 100);

export function checkSex(v) {
  if (!SEXES.includes(v)) throw validationError(`sex must be one of ${SEXES.join(', ')}`, { field: 'sex' });
  return v;
}

export function checkDob(v, today) {
  if (!parseYmd(v)) throw validationError('dob must be a real date in YYYY-MM-DD format', { field: 'dob' });
  if (v > today) throw validationError('dob cannot be in the future', { field: 'dob' });
  if (fullYearsBetween(v, today) > 120) throw validationError('dob implies an age above 120', { field: 'dob' });
  return v;
}

export function checkAge(v) {
  if (!isInt(v) || v < 0 || v > 120) throw validationError('age must be an integer between 0 and 120', { field: 'age' });
  return v;
}

export function checkDesignation(v) {
  if (!DESIGNATIONS.includes(v)) throw validationError(`designation must be one of ${DESIGNATIONS.join(', ')}`, { field: 'designation' });
  return v;
}

export function checkLimit(v, def = 20, max = 100) {
  if (v === undefined || v === null) return def;
  const n = Number(v);
  if (!isInt(n) || n < 1) throw validationError('limit must be a positive integer', { field: 'limit' });
  return Math.min(n, max);
}

export function checkBucket(v = 'day') {
  if (!['day', 'week', 'month'].includes(v)) {
    throw validationError("bucket must be one of 'day', 'week', 'month'", { field: 'bucket', value: v });
  }
  return v;
}

/** input of patients.createStudent */
export function validateNewStudent(input, today) {
  const i = requireObject(input, 'student');
  const out = {
    name: cleanName(i.name),
    dob: checkDob(i.dob, today),
    sex: checkSex(i.sex),
    roll_no: cleanText(i.roll_no, 'roll_no', 20),
    batch_year: i.batch_year,
    program: i.program,
    branch_id: i.branch_id,
    rfid_id: null,
  };
  if (!isInt(out.batch_year) || out.batch_year < 1990 || out.batch_year > 2100) {
    throw validationError('batch_year must be a 4-digit year', { field: 'batch_year' });
  }
  if (!PROGRAMS.includes(out.program)) throw validationError('program must be UG or PG', { field: 'program' });
  if (!isInt(out.branch_id) || out.branch_id < 1) throw validationError('branch_id must be a positive integer', { field: 'branch_id' });
  if (i.rfid_id !== undefined && i.rfid_id !== null && i.rfid_id !== '') {
    out.rfid_id = assertWritableRfid(normalizeRfid(i.rfid_id));
  }
  return out;
}

/** input of patients.createNonStudent */
export function validateNewNonStudent(input) {
  const i = requireObject(input, 'patient');
  return {
    name: cleanName(i.name),
    age: checkAge(i.age),
    sex: checkSex(i.sex),
    phone_no: normalizePhone(i.phone_no),
    designation: checkDesignation(i.designation),
  };
}

/**
 * Patchable: name, sex, dob (students), age (non-students), phone_no and designation (non-students).
 * Not patchable: roll_no, patient_type, rfid_id.
 */
export function validatePatientPatch(patch, patientType, today) {
  const p = requireObject(patch, 'patch');
  const keys = Object.keys(p);
  if (keys.length === 0) throw validationError('patch must contain at least one field');
  for (const k of keys) {
    if (NOT_PATCHABLE.includes(k)) throw validationError(`${k} cannot be changed through a patch`, { field: k });
    if (!PATCHABLE.includes(k)) throw validationError(`unknown field ${k}`, { field: k });
  }
  const studentOnly = ['dob'];
  const nonStudentOnly = ['age', 'phone_no', 'designation'];
  for (const k of keys) {
    if (patientType === 'STUDENT' && nonStudentOnly.includes(k)) throw validationError(`${k} applies to non-students only`, { field: k });
    if (patientType === 'NON_STUDENT' && studentOnly.includes(k)) throw validationError(`${k} applies to students only`, { field: k });
  }
  const out = {};
  if ('name' in p) out.name = cleanName(p.name);
  if ('sex' in p) out.sex = checkSex(p.sex);
  if ('dob' in p) out.dob = checkDob(p.dob, today);
  if ('age' in p) out.age = checkAge(p.age);
  if ('phone_no' in p) out.phone_no = normalizePhone(p.phone_no);
  if ('designation' in p) out.designation = checkDesignation(p.designation);
  return out;
}

/** input of visits.create. `labels` is the Set of the configured health-issue labels. */
export function validateVisitCreate(input, labels) {
  const i = requireObject(input, 'visit');
  if (!isUuid(i.patient_id)) throw validationError('patient_id must be a UUID', { field: 'patient_id' });
  const health_issue = cleanText(i.health_issue, 'health_issue', 120);
  const remedy = cleanText(i.remedy, 'remedy', 500);
  const custom = i.health_issue_is_custom === undefined ? false : i.health_issue_is_custom;
  if (typeof custom !== 'boolean') throw validationError('health_issue_is_custom must be a boolean', { field: 'health_issue_is_custom' });
  if (!custom && !labels.has(health_issue)) {
    throw validationError('health_issue is not in the configured list; send health_issue_is_custom: true for free text', { field: 'health_issue', value: health_issue });
  }
  if (!isInt(i.recorded_by) || i.recorded_by < 1) throw validationError('recorded_by must be a positive integer user id', { field: 'recorded_by' });
  const confirm = i.confirm_duplicate === undefined ? false : i.confirm_duplicate;
  if (typeof confirm !== 'boolean') throw validationError('confirm_duplicate must be a boolean', { field: 'confirm_duplicate' });
  return {
    patient_id: i.patient_id.toLowerCase(),
    health_issue,
    health_issue_is_custom: custom,
    remedy,
    recorded_by: i.recorded_by,
    confirm_duplicate: confirm,
  };
}

/** patch of visits.update: { health_issue?, remedy? } */
export function validateVisitPatch(patch, labels) {
  const p = requireObject(patch, 'patch');
  const keys = Object.keys(p);
  if (keys.length === 0) throw validationError('patch must contain health_issue and/or remedy');
  for (const k of keys) if (!['health_issue', 'remedy'].includes(k)) throw validationError(`${k} cannot be edited`, { field: k });
  const out = {};
  if ('health_issue' in p) {
    out.health_issue = cleanText(p.health_issue, 'health_issue', 120);
    // The visit patch has no health_issue_is_custom: derive it from the configured list.
    out.health_issue_is_custom = !labels.has(out.health_issue);
  }
  if ('remedy' in p) out.remedy = cleanText(p.remedy, 'remedy', 500);
  return out;
}

export function validateUserInput({ username, password_hash, role }) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    throw validationError('username must be 3-32 characters of letters, digits, ".", "_" or "-"', { field: 'username' });
  }
  if (typeof password_hash !== 'string' || !/^\$2[aby]\$\d{2}\$.{53}$/.test(password_hash)) {
    throw validationError('password_hash must be a bcrypt hash', { field: 'password_hash' });
  }
  if (!ROLES.includes(role)) throw validationError(`role must be one of ${ROLES.join(', ')}`, { field: 'role' });
  return { username, password_hash, role };
}
