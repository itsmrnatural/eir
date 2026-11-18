// In-memory implementation of the repository interface. Same behaviour and the same errors
// as the PostgreSQL + MongoDB implementation (both are run against tests/conformance.js).
//
//   createInMemoryRepositories()                          -> empty, 3 real branches
//   createInMemoryRepositories({ withSeedData: true })    -> synthetic dataset (~300 students, ~60 non-students,
//                                                            ~6,000 visits, users admin/staff) for UI-less development
// Optional test-only options: { clock: () => Date, duplicateWindowMin }.
import { randomUUID } from 'node:crypto';
import { AppError, validationError } from '../../lib/errors.js';
import { isUuid, normalizePhone, normalizeRfid } from '../../lib/ids.js';
import { dateRangeUtc, bucketStartYmd, istParts } from '../../lib/time.js';
import { computeAge } from '../../lib/age.js';
import {
  validateNewStudent, validateNewNonStudent, validatePatientPatch, validateVisitCreate,
  validateVisitPatch, validateUserInput, checkLimit, checkBucket,
} from '../../lib/validation.js';
import {
  buildVisitDoc, duplicateWindowMin as resolveWindow, isDuplicateVisit, toPatientView, todayIst,
} from '../../lib/domain.js';
import { BRANCHES, healthIssueLabels, publicHealthIssues } from '../../lib/reference-data.js';
import { DEV_USERS } from '../../lib/dev-users.js';
import { generateDataset } from '../../seed/generate.js';

const clone = (v) => structuredClone(v);
const lc = (s) => s.toLowerCase();

export function createInMemoryRepositories({ clock = () => new Date(), duplicateWindowMin, withSeedData = false, seedOptions = {} } = {}) {
  const windowMin = resolveWindow(duplicateWindowMin);
  const labels = healthIssueLabels();

  const state = {
    branches: clone(BRANCHES.known),
    patients: new Map(), // patient_id -> raw row (same columns as patient + student + non_student)
    rfids: new Map(), // rfid_id -> {rfid_id, roll_no, is_active}
    visits: [], // visit documents
    users: [],
    audit: [],
  };
  let nextUserId = 1;
  let nextAuditId = 1;

  // ---- helpers -----------------------------------------------------------------------------
  const rowByRoll = (roll) => [...state.patients.values()].find((r) => r.roll_no === roll);
  const branchById = (id) => state.branches.find((b) => b.branch_id === id);
  const atPhone = (phone, exceptId) => [...state.patients.values()]
    .filter((r) => r.patient_type === 'NON_STUDENT' && r.phone_no === phone && r.patient_id !== exceptId);

  function viewOf(row) {
    const { age, age_is_estimated } = computeAge(row, clock());
    const branch = row.branch_id ? branchById(row.branch_id) : null;
    const activeTag = row.roll_no ? [...state.rfids.values()].find((t) => t.roll_no === row.roll_no && t.is_active) : null;
    return toPatientView({
      ...row, age, age_is_estimated,
      branch_code: branch?.branch_code, branch_name: branch?.branch_name, rfid_id: activeTag?.rfid_id,
    });
  }

  function writeAudit(actor, entity, entityId, before, after) {
    state.audit.push({
      audit_id: nextAuditId++, actor_user_id: actor ?? null, entity, entity_id: String(entityId),
      action: 'UPDATE', before: clone(before), after: clone(after), at: clock(),
    });
  }

  function assertPhoneRules(name, phone, exceptId) {
    const others = atPhone(phone, exceptId);
    if (others.some((o) => lc(o.name) === lc(name))) {
      throw new AppError('DUPLICATE_PATIENT', 'This phone number already has a patient with that name', { phone_no: phone, name });
    }
    if (others.length >= 5) {
      throw new AppError('PHONE_LIMIT_REACHED', 'At most 5 patients can be registered under one phone number', { phone_no: phone });
    }
  }

  const inRange = (doc, { start, endExclusive }) => (!start || doc.date_time >= start) && (!endExclusive || doc.date_time < endExclusive);
  const visitsInRange = (range) => state.visits.filter((d) => inRange(d, range));

  // ---- patients ----------------------------------------------------------------------------
  const patients = {
    async findByRfid(rfid_id) {
      const key = normalizeRfid(rfid_id);
      const tag = state.rfids.get(key);
      if (!tag) throw new AppError('RFID_NOT_FOUND', 'Card not registered, contact admin', { rfid_id: key });
      if (!tag.is_active) throw new AppError('RFID_INACTIVE', 'This card has been deactivated, contact admin', { rfid_id: key });
      return viewOf(rowByRoll(tag.roll_no));
    },

    async findByPhone(phone_no) {
      const phone = normalizePhone(phone_no);
      return atPhone(phone).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 5).map(viewOf);
    },

    async findById(patient_id) {
      if (!isUuid(patient_id)) return null;
      const row = state.patients.get(patient_id.toLowerCase());
      return row ? viewOf(row) : null;
    },

    async search(q, { limit = 20 } = {}) {
      const n = checkLimit(limit, 20, 100);
      const text = typeof q === 'string' ? q.trim().toLowerCase() : '';
      if (!text) return [];
      const phoneQ = text.replace(/[\s\-().]/g, '');
      const hits = [...state.patients.values()].filter((r) => lc(r.name).includes(text)
        || (r.roll_no && lc(r.roll_no).includes(text))
        || (r.phone_no && phoneQ.length > 0 && r.phone_no.includes(phoneQ)));
      const rank = (r) => (lc(r.name) === text ? 0 : lc(r.name).startsWith(text) ? 1 : 2);
      hits.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
      return hits.slice(0, n).map(viewOf);
    },

    async createStudent(input) {
      const v = validateNewStudent(input, todayIst(clock()));
      if (!branchById(v.branch_id)) throw validationError('branch_id does not exist', { field: 'branch_id', value: v.branch_id });
      if (rowByRoll(v.roll_no)) throw new AppError('DUPLICATE_PATIENT', 'A student with this roll number already exists', { field: 'roll_no', roll_no: v.roll_no });
      if (v.rfid_id && state.rfids.has(v.rfid_id)) {
        throw new AppError('DUPLICATE_PATIENT', 'This RFID tag is already assigned', { field: 'rfid_id', rfid_id: v.rfid_id });
      }
      const now = clock();
      const row = {
        patient_id: randomUUID(), patient_type: 'STUDENT', name: v.name, sex: v.sex, dob: v.dob,
        age_at_registration: null, registered_on: todayIst(now),
        roll_no: v.roll_no, batch_year: v.batch_year, program: v.program, branch_id: v.branch_id,
        created_at: now, updated_at: now,
      };
      state.patients.set(row.patient_id, row);
      if (v.rfid_id) state.rfids.set(v.rfid_id, { rfid_id: v.rfid_id, roll_no: v.roll_no, is_active: true });
      return viewOf(row);
    },

    async createNonStudent(input) {
      const v = validateNewNonStudent(input);
      assertPhoneRules(v.name, v.phone_no, null);
      const now = clock();
      const row = {
        patient_id: randomUUID(), patient_type: 'NON_STUDENT', name: v.name, sex: v.sex, dob: null,
        age_at_registration: v.age, registered_on: todayIst(now),
        phone_no: v.phone_no, designation: v.designation, created_at: now, updated_at: now,
      };
      state.patients.set(row.patient_id, row);
      return viewOf(row);
    },

    async update(patient_id, patch, actor_user_id) {
      const row = isUuid(patient_id) ? state.patients.get(patient_id.toLowerCase()) : null;
      if (!row) throw new AppError('NOT_FOUND', 'Patient not found', { patient_id });
      const now = clock();
      const p = validatePatientPatch(patch, row.patient_type, todayIst(now));
      const before = viewOf(row);

      const next = { ...row };
      if ('name' in p) next.name = p.name;
      if ('sex' in p) next.sex = p.sex;
      if ('dob' in p) next.dob = p.dob;
      if ('age' in p) { next.age_at_registration = p.age; next.registered_on = todayIst(now); }
      if ('phone_no' in p) next.phone_no = p.phone_no;
      if ('designation' in p) next.designation = p.designation;
      if (row.patient_type === 'NON_STUDENT' && ('name' in p || 'phone_no' in p)) {
        assertPhoneRules(next.name, next.phone_no, row.patient_id);
      }

      Object.assign(row, next);
      const after = viewOf(row);
      if (JSON.stringify(before) === JSON.stringify(after)) return before; // nothing changed: no audit row
      row.updated_at = now;
      writeAudit(actor_user_id, 'patient', row.patient_id, before, after);
      return after;
    },
  };

  // ---- visits ------------------------------------------------------------------------------
  const visits = {
    async create(input) {
      const v = validateVisitCreate(input, labels);
      const view = await patients.findById(v.patient_id);
      if (!view) throw new AppError('NOT_FOUND', 'Patient not found', { patient_id: v.patient_id });
      const now = clock();
      if (!v.confirm_duplicate) {
        const last = state.visits.filter((d) => d.patient_id === v.patient_id)
          .reduce((m, d) => (!m || d.date_time > m ? d.date_time : m), null);
        if (last && isDuplicateVisit(last, now, windowMin)) {
          throw new AppError('DUPLICATE_VISIT_WARNING', 'This patient already has a visit in the last few minutes', { last_visit_at: last.toISOString() });
        }
      }
      const doc = buildVisitDoc({ visitId: randomUUID(), view, input: v, now });
      state.visits.push(doc);
      return clone(doc);
    },

    async findById(visit_id) {
      const doc = state.visits.find((d) => d.visit_id === visit_id);
      return doc ? clone(doc) : null;
    },

    async update(visit_id, patch, actor_user_id) {
      const doc = state.visits.find((d) => d.visit_id === visit_id);
      if (!doc) throw new AppError('NOT_FOUND', 'Visit not found', { visit_id });
      const p = validateVisitPatch(patch, labels);
      const before = clone(doc);
      const next = { ...doc, ...p };
      if (JSON.stringify(next) === JSON.stringify(doc)) return before;
      next.updated_at = clock();
      Object.assign(doc, next);
      writeAudit(actor_user_id, 'visit', visit_id, before, doc);
      return clone(doc);
    },

    async listByPatient(patient_id, { from, to } = {}) {
      const range = dateRangeUtc({ from, to });
      return visitsInRange(range)
        .filter((d) => d.patient_id === patient_id)
        .sort((a, b) => b.date_time - a.date_time)
        .map(clone);
    },

    /** -> [{ patient: PatientView, visits: Visit[] }]  (grouped per patient, visits oldest first) */
    async listForExport({ from, to } = {}) {
      const range = dateRangeUtc({ from, to });
      const byPatient = new Map();
      for (const d of visitsInRange(range).sort((a, b) => a.date_time - b.date_time)) {
        if (!byPatient.has(d.patient_id)) byPatient.set(d.patient_id, []);
        byPatient.get(d.patient_id).push(clone(d));
      }
      const entries = [];
      for (const [pid, list] of byPatient) {
        const patient = await patients.findById(pid);
        if (patient) entries.push({ patient, visits: list });
      }
      return entries.sort((a, b) => a.patient.name.localeCompare(b.patient.name) || a.patient.patient_id.localeCompare(b.patient.patient_id));
    },
  };

  // ---- reports (same results as the Mongo pipelines in ../pg-mongo/pipelines.js) -------------
  const countBy = (docs, keyFn) => {
    const m = new Map();
    for (const d of docs) { const k = keyFn(d); m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  };

  const reports = {
    async commonIssues({ from, to, limit } = {}) {
      const n = checkLimit(limit, 10, 100);
      const rows = [...countBy(visitsInRange(dateRangeUtc({ from, to })), (d) => d.health_issue)]
        .map(([health_issue, count]) => ({ health_issue, count }));
      rows.sort((a, b) => b.count - a.count || a.health_issue.localeCompare(b.health_issue));
      return rows.slice(0, n);
    },

    async visitsOverTime({ from, to, bucket } = {}) {
      const kind = checkBucket(bucket);
      return [...countBy(visitsInRange(dateRangeUtc({ from, to })), (d) => {
        const start = bucketStartYmd(d.date_time, kind);
        return kind === 'month' ? start.slice(0, 7) : start; // month buckets are YYYY-MM
      })]
        .map(([b, count]) => ({ bucket: b, count }))
        .sort((a, b) => a.bucket.localeCompare(b.bucket));
    },

    async peakHours({ from, to } = {}) {
      // Only hours that have visits; the client pads to 24 bars.
      return [...countBy(visitsInRange(dateRangeUtc({ from, to })), (d) => istParts(d.date_time).hour)]
        .map(([hour, count]) => ({ hour, count }))
        .sort((a, b) => a.hour - b.hour);
    },

    async frequentVisitors({ from, to, limit } = {}) {
      const n = checkLimit(limit, 10, 100);
      const groups = new Map();
      for (const d of visitsInRange(dateRangeUtc({ from, to })).sort((a, b) => b.date_time - a.date_time)) {
        const g = groups.get(d.patient_id);
        if (g) g.count += 1;
        else groups.set(d.patient_id, { patient_id: d.patient_id, name: d.snapshot.name, patient_type: d.patient_type, count: 1 });
      }
      return [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, n);
    },

    async visitsByBranch({ from, to } = {}) {
      const docs = visitsInRange(dateRangeUtc({ from, to })).filter((d) => d.patient_type === 'STUDENT')
        .sort((a, b) => b.date_time - a.date_time); // newest first: the latest snapshot supplies branch_name
      const groups = new Map();
      for (const d of docs) {
        const g = groups.get(d.snapshot.branch_id);
        if (g) g.count += 1;
        else groups.set(d.snapshot.branch_id, { branch_id: d.snapshot.branch_id, branch_name: d.snapshot.branch_name, count: 1 });
      }
      return [...groups.values()].sort((a, b) => b.count - a.count || a.branch_name.localeCompare(b.branch_name));
    },

    async visitsByBatch({ from, to } = {}) {
      const docs = visitsInRange(dateRangeUtc({ from, to })).filter((d) => d.patient_type === 'STUDENT');
      return [...countBy(docs, (d) => d.snapshot.batch_year)]
        .map(([batch_year, count]) => ({ batch_year, count }))
        .sort((a, b) => a.batch_year - b.batch_year);
    },
  };

  // ---- users / meta ------------------------------------------------------------------------
  const users = {
    async findByUsername(username) {
      const u = state.users.find((x) => x.username === username);
      return u ? { ...u } : null;
    },
    async create(input) {
      const v = validateUserInput(input ?? {});
      if (state.users.some((u) => u.username === v.username)) {
        throw validationError('username already exists', { field: 'username' });
      }
      const u = { user_id: nextUserId++, ...v };
      state.users.push(u);
      return { user_id: u.user_id, username: u.username, role: u.role };
    },
  };

  const meta = {
    async listBranches() {
      return clone(state.branches).sort((a, b) => a.branch_code.localeCompare(b.branch_code));
    },
    async listHealthIssues() {
      return publicHealthIssues();
    },
  };

  // ---- optional synthetic data -------------------------------------------------------------
  if (withSeedData) {
    const data = generateDataset({ end: todayIst(clock()), ...seedOptions });
    state.branches = clone([...BRANCHES.known, ...BRANCHES.synthetic]);
    const userIds = new Map();
    for (const u of DEV_USERS) {
      const id = nextUserId++;
      state.users.push({ user_id: id, username: u.username, password_hash: u.password_hash, role: u.role });
      userIds.set(u.username, id);
    }
    const created = new Date(0);
    for (const s of data.students) {
      state.patients.set(s.patient_id, {
        patient_id: s.patient_id, patient_type: 'STUDENT', name: s.name, sex: s.sex, dob: s.dob,
        age_at_registration: null, registered_on: s.registered_on, roll_no: s.roll_no, batch_year: s.batch_year,
        program: s.program, branch_id: s.branch_id, created_at: created, updated_at: created,
      });
      for (const t of s.rfid_tags) state.rfids.set(t.rfid_id, { rfid_id: t.rfid_id, roll_no: s.roll_no, is_active: t.is_active });
    }
    for (const n of data.nonStudents) {
      state.patients.set(n.patient_id, {
        patient_id: n.patient_id, patient_type: 'NON_STUDENT', name: n.name, sex: n.sex, dob: null,
        age_at_registration: n.age_at_registration, registered_on: n.registered_on,
        phone_no: n.phone_no, designation: n.designation, created_at: created, updated_at: created,
      });
    }
    for (const v of data.visits) {
      const { recorded_by_username, ...doc } = v;
      state.visits.push({ ...doc, recorded_by: userIds.get(recorded_by_username) });
    }
  }

  const repos = { patients, visits, reports, users, meta };
  // Test hook (non-enumerable so it never shows up when the object is spread or logged).
  Object.defineProperty(repos, '_state', { value: state, enumerable: false });
  return repos;
}
