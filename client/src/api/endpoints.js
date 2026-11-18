/**
 * One function per endpoint, same paths, same shapes.
 * @typedef {import('./types.js').PatientView} PatientView
 * @typedef {import('./types.js').Visit} Visit
 * @typedef {import('./types.js').User} User
 * @typedef {{from?:string, to?:string}} DateRange  YYYY-MM-DD, inclusive, Asia/Kolkata
 */
import { request } from './http.js';

const enc = encodeURIComponent;

// ---- auth ----
/** @returns {Promise<{token:string, user:User}>} */
export const login = (username, password) =>
  request('POST', '/auth/login', { body: { username, password }, auth: false });
/** @returns {Promise<User>} */
export const me = () => request('GET', '/auth/me');

// ---- patients ----
/** @returns {Promise<PatientView>} rejects with RFID_NOT_FOUND (404) or RFID_INACTIVE (409) */
export const getPatientByRfid = (rfid_id) => request('GET', `/patients/by-rfid/${enc(rfid_id)}`);
/** @returns {Promise<{items:PatientView[]}>} */
export const getPatientsByPhone = (phone_no) => request('GET', `/patients/by-phone/${enc(phone_no)}`);
/**
 * @param {{name:string, age:number, sex:string, phone_no:string, designation:string}} body
 * @returns {Promise<PatientView>} rejects with PHONE_LIMIT_REACHED / DUPLICATE_PATIENT (409)
 */
export const createNonStudent = (body) => request('POST', '/patients/non-students', { body });
/** @returns {Promise<{items:PatientView[], total?:number}>} */
export const searchPatients = (q, limit = 20) => request('GET', '/patients', { query: { q, limit } });
/** @returns {Promise<PatientView>} */
export const getPatient = (id) => request('GET', `/patients/${enc(id)}`);
/**
 * @param {string} id
 * @param {{name?:string, sex?:string, dob?:string, age?:number, phone_no?:string, designation?:string}} patch
 * @returns {Promise<PatientView>}
 */
export const patchPatient = (id, patch) => request('PATCH', `/patients/${enc(id)}`, { body: patch });

// ---- visits ----
/**
 * @param {{patient_id:string, health_issue:string, health_issue_is_custom:boolean, remedy:string, confirm_duplicate?:boolean}} body
 * @returns {Promise<Visit>} rejects with DUPLICATE_VISIT_WARNING (409, details.last_visit_at)
 */
export const createVisit = (body) => request('POST', '/visits', { body });
/** @param {{health_issue?:string, remedy?:string}} patch @returns {Promise<Visit>} (ADMIN) */
export const patchVisit = (id, patch) => request('PATCH', `/visits/${enc(id)}`, { body: patch });
/** @param {DateRange} [range] @returns {Promise<{patient:PatientView, items:Visit[], total:number}>} (ADMIN) */
export const getPatientHistory = (id, { from, to } = {}) =>
  request('GET', `/patients/${enc(id)}/history`, { query: { from, to } });

// ---- reports (ADMIN) ----
export const reports = {
  /** @returns {Promise<import('./types.js').CommonIssueRow[]>} */
  commonIssues: ({ from, to, limit }) => request('GET', '/reports/common-issues', { query: { from, to, limit } }),
  /** @returns {Promise<import('./types.js').PeakHourRow[]>} */
  peakHours: ({ from, to }) => request('GET', '/reports/peak-hours', { query: { from, to } }),
  /** @returns {Promise<import('./types.js').FrequentVisitorRow[]>} */
  frequentVisitors: ({ from, to, limit }) =>
    request('GET', '/reports/frequent-visitors', { query: { from, to, limit } }),
  /** @returns {Promise<import('./types.js').BranchRow[]>} */
  visitsByBranch: ({ from, to }) => request('GET', '/reports/visits-by-branch', { query: { from, to } }),
  /** @returns {Promise<import('./types.js').BatchRow[]>} */
  visitsByBatch: ({ from, to }) => request('GET', '/reports/visits-by-batch', { query: { from, to } }),
  /** @param {{from:string, to:string, bucket:'day'|'week'|'month'}} p @returns {Promise<import('./types.js').TimeBucketRow[]>} */
  visitsOverTime: ({ from, to, bucket }) => request('GET', '/reports/visits-over-time', { query: { from, to, bucket } }),
};

// ---- meta ----
/** @returns {Promise<import('./types.js').Branch[]>} */
export const listBranches = () => request('GET', '/meta/branches');
/** @returns {Promise<import('./types.js').HealthIssue[]>} */
export const listHealthIssues = () => request('GET', '/meta/health-issues');

// ---- FHIR export (ADMIN). Resolve to a Blob of application/fhir+json. ----
/** @returns {Promise<Blob>} */
export const exportFhirPatient = (id) =>
  request('GET', `/export/fhir/patients/${enc(id)}`, { accept: 'application/fhir+json', responseType: 'blob' });
/** @param {DateRange} [range] @returns {Promise<Blob>} */
export const exportFhirBulk = ({ from, to } = {}) =>
  request('GET', '/export/fhir/bulk', { query: { from, to }, accept: 'application/fhir+json', responseType: 'blob' });
