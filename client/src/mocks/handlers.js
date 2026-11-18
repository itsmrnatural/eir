// MSW handlers for mock mode. They enforce roles and return the standard error envelope,
// and they exercise every error the UI must handle (see MOCK_RFIDS and FULL_PHONE in db.js).
import { delay, http, HttpResponse } from 'msw';
import * as M from './db.js';
import { mockBundle, mockPatientResource, mockVisitResources } from './fhir.js';

const api = (p) => `*/api/v1${p}`; // matches any origin, so it works for relative and absolute base URLs
const STAFF_PLUS = ['STAFF', 'ADMIN'];
const ADMIN = ['ADMIN'];
const latency = () => delay(import.meta.env?.MODE === 'mock' ? 250 : 0);

const fail = (status, code, message, details = {}) =>
  HttpResponse.json({ error: { code, message, details } }, { status });
const readJson = async (request) => {
  try {
    return (await request.json()) ?? {};
  } catch {
    return {};
  }
};
const query = (request) => Object.fromEntries(new URL(request.url).searchParams);
const fhirResponse = (bundle) =>
  new HttpResponse(JSON.stringify(bundle, null, 2), { headers: { 'Content-Type': 'application/fhir+json' } });

/** Wraps a handler with latency + bearer-token + role checks. roles = undefined means any signed-in user. */
const withAuth = (roles, fn) => async (info) => {
  await latency();
  const header = info.request.headers.get('Authorization') ?? '';
  const user = M.parseMockToken(header.startsWith('Bearer ') ? header.slice(7) : null);
  if (!user) return fail(401, 'UNAUTHENTICATED', 'Missing or invalid token');
  if (roles && !roles.includes(user.role)) return fail(403, 'FORBIDDEN', 'Your role does not allow this action');
  return fn({ ...info, user });
};

const SEXES = ['M', 'F', 'Other'];
const DESIGNATIONS = ['STAFF', 'FACULTY', 'WORKER', 'OTHER'];
const digits = (s) => String(s ?? '').replace(/\D/g, '');
const today = () => M.istYMD(new Date());

/** Non-student phone/name rules shared by create and patch. Returns an error Response or null. */
function phoneRules(phone_no, name, selfId) {
  const others = M.db.patients.filter((p) => p.patient_type === 'NON_STUDENT' && p.phone_no === phone_no && p.patient_id !== selfId);
  if (others.length >= 5) return fail(409, 'PHONE_LIMIT_REACHED', 'This phone number already has 5 registered people', { phone_no, limit: 5 });
  if (others.some((p) => p.name.toLowerCase() === name.toLowerCase()))
    return fail(409, 'DUPLICATE_PATIENT', 'Someone with this name is already registered under this phone number');
  return null;
}

export const handlers = [
  http.post(api('/auth/login'), async ({ request }) => {
    await latency();
    const { username, password } = await readJson(request);
    const u = M.MOCK_USERS.find((x) => x.username === username && x.password === password);
    if (!u) return fail(401, 'UNAUTHENTICATED', 'Wrong username or password');
    return HttpResponse.json({ token: M.makeMockToken(u), user: { user_id: u.user_id, username: u.username, role: u.role } });
  }),
  http.get(api('/auth/me'), withAuth(undefined, ({ user }) => HttpResponse.json(user))),

  // ---- patients ----
  http.get(api('/patients/by-rfid/:rfid_id'), withAuth(STAFF_PLUS, ({ params }) => {
    const p = M.db.patients.find((x) => x.rfid_id === params.rfid_id);
    if (!p) return fail(404, 'RFID_NOT_FOUND', 'No student is registered for this card');
    if (!p.rfid_active) return fail(409, 'RFID_INACTIVE', 'This card has been deactivated');
    return HttpResponse.json(M.toView(p));
  })),
  http.get(api('/patients/by-phone/:phone_no'), withAuth(STAFF_PLUS, ({ params }) =>
    HttpResponse.json({ items: M.db.patients.filter((p) => p.phone_no === params.phone_no).map((p) => M.toView(p)) }))),
  http.post(api('/patients/non-students'), withAuth(STAFF_PLUS, async ({ request }) => {
    const b = await readJson(request);
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    const errs = [];
    if (!name) errs.push('name is required');
    if (!Number.isInteger(b.age) || b.age < 0 || b.age > 120) errs.push('age must be a whole number from 0 to 120');
    if (!SEXES.includes(b.sex)) errs.push('sex must be M, F or Other');
    if (digits(b.phone_no).length < 7) errs.push('phone_no is not valid');
    if (!DESIGNATIONS.includes(b.designation)) errs.push('designation is not valid');
    if (errs.length) return fail(400, 'VALIDATION_ERROR', errs.join('; '));
    const blocked = phoneRules(b.phone_no, name, null);
    if (blocked) return blocked;
    const p = {
      patient_id: M.uuid(), patient_type: 'NON_STUDENT', name, sex: b.sex, age_at_registration: b.age,
      registered_on: today(), phone_no: b.phone_no, designation: b.designation,
    };
    M.db.patients.push(p);
    return HttpResponse.json(M.toView(p), { status: 201 });
  })),
  http.get(api('/patients'), withAuth(STAFF_PLUS, ({ request }) => {
    const { q = '', limit = '20' } = query(request);
    const needle = q.trim().toLowerCase();
    const hits = M.db.patients.filter((p) =>
      [p.name, p.roll_no, p.phone_no].some((f) => f && f.toLowerCase().includes(needle)));
    return HttpResponse.json({ items: hits.slice(0, Number(limit) || 20).map((p) => M.toView(p)), total: hits.length });
  })),
  http.get(api('/patients/:id'), withAuth(STAFF_PLUS, ({ params }) => {
    const p = M.findPatient(params.id);
    return p ? HttpResponse.json(M.toView(p)) : fail(404, 'NOT_FOUND', 'Patient not found');
  })),
  http.patch(api('/patients/:id'), withAuth(STAFF_PLUS, async ({ params, request }) => {
    const p = M.findPatient(params.id);
    if (!p) return fail(404, 'NOT_FOUND', 'Patient not found');
    const b = await readJson(request);
    const allowed = p.patient_type === 'STUDENT' ? ['name', 'sex', 'dob'] : ['name', 'sex', 'age', 'phone_no', 'designation'];
    const bad = Object.keys(b).filter((k) => !allowed.includes(k));
    if (bad.length) return fail(400, 'VALIDATION_ERROR', `Not editable here: ${bad.join(', ')}`);
    const errs = [];
    if ('name' in b && !String(b.name).trim()) errs.push('name cannot be empty');
    if ('sex' in b && !SEXES.includes(b.sex)) errs.push('sex must be M, F or Other');
    if ('dob' in b && !/^\d{4}-\d{2}-\d{2}$/.test(b.dob)) errs.push('dob must be YYYY-MM-DD');
    if ('age' in b && (!Number.isInteger(b.age) || b.age < 0 || b.age > 120)) errs.push('age must be 0 to 120');
    if ('designation' in b && !DESIGNATIONS.includes(b.designation)) errs.push('designation is not valid');
    if ('phone_no' in b && digits(b.phone_no).length < 7) errs.push('phone_no is not valid');
    if (errs.length) return fail(400, 'VALIDATION_ERROR', errs.join('; '));
    if (p.patient_type === 'NON_STUDENT' && ('phone_no' in b || 'name' in b)) {
      const blocked = phoneRules(b.phone_no ?? p.phone_no, String(b.name ?? p.name).trim(), p.patient_id);
      if (blocked) return blocked;
    }
    const { age, ...rest } = b;
    Object.assign(p, rest);
    if (typeof b.name === 'string') p.name = b.name.trim();
    if (age !== undefined) Object.assign(p, { age_at_registration: age, registered_on: today() });
    return HttpResponse.json(M.toView(p));
  })),

  // ---- visits ----
  http.post(api('/visits'), withAuth(STAFF_PLUS, async ({ request, user }) => {
    const b = await readJson(request);
    const p = M.findPatient(b.patient_id);
    if (!p) return fail(404, 'NOT_FOUND', 'Patient not found');
    const errs = [];
    if (!String(b.health_issue ?? '').trim()) errs.push('health_issue is required');
    if (!String(b.remedy ?? '').trim()) errs.push('remedy is required');
    if (typeof b.health_issue_is_custom !== 'boolean') errs.push('health_issue_is_custom must be true or false');
    if (errs.length) return fail(400, 'VALIDATION_ERROR', errs.join('; '));
    const last = M.lastVisitOf(p.patient_id);
    if (last && !b.confirm_duplicate && Date.now() - Date.parse(last.date_time) < M.DUPLICATE_WINDOW_MIN * 60_000)
      return fail(409, 'DUPLICATE_VISIT_WARNING', 'This patient already has a very recent visit', { last_visit_at: last.date_time });
    const v = M.makeVisit(p, Date.now(), b.health_issue.trim(), b.health_issue_is_custom, b.remedy.trim(), user.user_id);
    M.db.visits.push(v);
    return HttpResponse.json(v, { status: 201 });
  })),
  http.patch(api('/visits/:id'), withAuth(ADMIN, async ({ params, request }) => {
    const v = M.db.visits.find((x) => x.visit_id === params.id);
    if (!v) return fail(404, 'NOT_FOUND', 'Visit not found');
    const b = await readJson(request);
    const bad = Object.keys(b).filter((k) => !['health_issue', 'remedy'].includes(k));
    if (bad.length) return fail(400, 'VALIDATION_ERROR', `Not editable: ${bad.join(', ')}`);
    if (('health_issue' in b && !String(b.health_issue).trim()) || ('remedy' in b && !String(b.remedy).trim()))
      return fail(400, 'VALIDATION_ERROR', 'health_issue and remedy cannot be empty');
    Object.assign(v, b, { updated_at: new Date().toISOString() });
    return HttpResponse.json(v);
  })),
  http.get(api('/patients/:id/history'), withAuth(ADMIN, ({ params, request }) => {
    const p = M.findPatient(params.id);
    if (!p) return fail(404, 'NOT_FOUND', 'Patient not found');
    const { from, to } = query(request);
    const items = M.visitsInRange(from, to).filter((v) => v.patient_id === p.patient_id)
      .sort((a, b) => b.date_time.localeCompare(a.date_time));
    return HttpResponse.json({ patient: M.toView(p), items, total: items.length });
  })),

  // ---- reports ----
  http.get(api('/reports/common-issues'), withAuth(ADMIN, ({ request }) => {
    const { from, to, limit } = query(request);
    return HttpResponse.json(M.commonIssues(from, to, Number(limit) || 10));
  })),
  http.get(api('/reports/peak-hours'), withAuth(ADMIN, ({ request }) => {
    const { from, to } = query(request);
    return HttpResponse.json(M.peakHours(from, to));
  })),
  http.get(api('/reports/frequent-visitors'), withAuth(ADMIN, ({ request }) => {
    const { from, to, limit } = query(request);
    return HttpResponse.json(M.frequentVisitors(from, to, Number(limit) || 10));
  })),
  http.get(api('/reports/visits-by-branch'), withAuth(ADMIN, ({ request }) => {
    const { from, to } = query(request);
    return HttpResponse.json(M.visitsByBranch(from, to));
  })),
  http.get(api('/reports/visits-by-batch'), withAuth(ADMIN, ({ request }) => {
    const { from, to } = query(request);
    return HttpResponse.json(M.visitsByBatch(from, to));
  })),
  http.get(api('/reports/visits-over-time'), withAuth(ADMIN, ({ request }) => {
    const { from, to, bucket } = query(request);
    return HttpResponse.json(M.visitsOverTime(from, to, ['day', 'week', 'month'].includes(bucket) ? bucket : 'day'));
  })),

  // ---- meta ----
  http.get(api('/meta/branches'), withAuth(STAFF_PLUS, () => HttpResponse.json(M.BRANCHES))),
  http.get(api('/meta/health-issues'), withAuth(STAFF_PLUS, () => HttpResponse.json(M.HEALTH_ISSUES))),

  // ---- FHIR export ----
  http.get(api('/export/fhir/patients/:id'), withAuth(ADMIN, ({ params }) => {
    const p = M.findPatient(params.id);
    if (!p) return fail(404, 'NOT_FOUND', 'Patient not found');
    const resources = [mockPatientResource(M.toView(p)), ...M.db.visits.filter((v) => v.patient_id === p.patient_id).flatMap((v) => mockVisitResources(v, p.patient_id))];
    return fhirResponse(mockBundle(resources));
  })),
  http.get(api('/export/fhir/bulk'), withAuth(ADMIN, ({ request }) => {
    const { from, to } = query(request);
    const visits = M.visitsInRange(from, to);
    const ids = [...new Set(visits.map((v) => v.patient_id))];
    const resources = [
      ...ids.map((id) => mockPatientResource(M.toView(M.findPatient(id)))),
      ...visits.flatMap((v) => mockVisitResources(v, v.patient_id)),
    ];
    return fhirResponse(mockBundle(resources));
  })),
];
