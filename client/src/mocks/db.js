// In-memory mock backend state for MSW (and tests). Plain JS, no MSW import, so it can be exercised anywhere.
// Synthetic data: names carry "Demo" and phones are in a reserved test range.

export const IST_OFFSET_MS = 330 * 60_000; // Asia/Kolkata has no DST, so a fixed offset is exact
export const DUPLICATE_WINDOW_MIN = 10;

export const BRANCHES = [
  { branch_id: 1, branch_code: '210', branch_name: 'CSE' },
  { branch_id: 2, branch_code: '220', branch_name: 'ECE' },
  { branch_id: 3, branch_code: '221', branch_name: 'VLSI' },
];
export const HEALTH_ISSUES = [
  { code: 'FEVER', label: 'Fever' },
  { code: 'COLD_COUGH', label: 'Cold / Cough' },
  { code: 'HEADACHE', label: 'Headache' },
  { code: 'STOMACH', label: 'Stomach ache' },
  { code: 'INJURY', label: 'Minor injury' },
  { code: 'ALLERGY', label: 'Allergy' },
  { code: 'BODY_PAIN', label: 'Body pain' },
];
export const MOCK_USERS = [
  { user_id: 1, username: 'admin', password: 'admin123', role: 'ADMIN' },
  { user_id: 2, username: 'staff', password: 'staff123', role: 'STAFF' },
];
/** Cards the dev panel offers, one per error/success case the UI must handle. */
export const MOCK_RFIDS = [
  { id: 'RFID-0001', note: 'Aanya Demo: normal visit' },
  { id: 'RFID-0002', note: 'Kabir Demo: visited minutes ago, so a duplicate warning' },
  { id: 'RFID-DEAD', note: 'Deactivated card (RFID_INACTIVE)' },
  { id: 'RFID-NOPE', note: 'Unregistered card (RFID_NOT_FOUND)' },
];
export const FULL_PHONE = '9000000105'; // already has 5 people (PHONE_LIMIT_REACHED)

// ---------- auth token (mock only; the real server issues a JWT) ----------
export const makeMockToken = (u) =>
  `mock.${btoa(JSON.stringify({ user_id: u.user_id, username: u.username, role: u.role }))}`;
export function parseMockToken(t) {
  try {
    return t && t.startsWith('mock.') ? JSON.parse(atob(t.slice(5))) : null;
  } catch {
    return null;
  }
}

// ---------- helpers ----------
export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}
export const pid = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;

const istShift = (d) => new Date(new Date(d).getTime() + IST_OFFSET_MS);
export const istYMD = (d) => istShift(d).toISOString().slice(0, 10);
export const istHour = (d) => istShift(d).getUTCHours();

export function fullYears(fromYMD, now) {
  const a = new Date(`${fromYMD}T00:00:00Z`);
  const b = istShift(now);
  let y = b.getUTCFullYear() - a.getUTCFullYear();
  const before =
    b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate());
  if (before) y -= 1;
  return y;
}

// ---------- views (what the real repositories would return) ----------
export function toView(p, now = new Date()) {
  if (p.patient_type === 'STUDENT') {
    const b = BRANCHES.find((x) => x.branch_id === p.branch_id);
    return {
      patient_id: p.patient_id, patient_type: 'STUDENT', name: p.name, dob: p.dob,
      age: fullYears(p.dob, now), age_is_estimated: false, sex: p.sex,
      roll_no: p.roll_no, batch_year: p.batch_year, program: p.program,
      branch_id: p.branch_id, branch_code: b?.branch_code, branch_name: b?.branch_name, rfid_id: p.rfid_id,
    };
  }
  return {
    patient_id: p.patient_id, patient_type: 'NON_STUDENT', name: p.name,
    age: p.age_at_registration + fullYears(p.registered_on, now), age_is_estimated: true,
    sex: p.sex, phone_no: p.phone_no, designation: p.designation,
  };
}

export function makeSnapshot(p, at) {
  const v = toView(p, at);
  const s = { name: v.name, sex: v.sex, age_at_visit: v.age };
  if (p.patient_type === 'STUDENT') {
    Object.assign(s, { roll_no: v.roll_no, batch_year: v.batch_year, program: v.program, branch_id: v.branch_id, branch_name: v.branch_name });
  } else {
    Object.assign(s, { phone_no: v.phone_no, designation: v.designation });
  }
  return s;
}

export function makeVisit(p, when, health_issue, health_issue_is_custom, remedy, recorded_by) {
  const d = new Date(when);
  return {
    visit_id: uuid(), patient_id: p.patient_id, patient_type: p.patient_type, snapshot: makeSnapshot(p, d),
    date_time: d.toISOString(), health_issue, health_issue_is_custom, remedy, recorded_by,
    created_at: d.toISOString(), updated_at: d.toISOString(),
  };
}

// ---------- state + seed ----------
export const db = { patients: [], visits: [] };

function student(n, name, sex, dob, roll_no, batch_year, program, branch_id, rfid_id, rfid_active = true) {
  return { patient_id: pid(n), patient_type: 'STUDENT', name, sex, dob, roll_no, batch_year, program, branch_id, rfid_id, rfid_active };
}
function nonStudent(n, name, sex, age, phone_no, designation, registered_on = '2025-06-01') {
  return { patient_id: pid(n), patient_type: 'NON_STUDENT', name, sex, age_at_registration: age, registered_on, phone_no, designation };
}

function seedPatients() {
  return [
    student(1, 'Aanya Demo', 'F', '2006-03-14', '251210001', 2025, 'UG', 1, 'RFID-0001'),
    student(2, 'Kabir Demo', 'M', '2005-11-02', '241210002', 2024, 'UG', 1, 'RFID-0002'),
    student(3, 'Meera Demo', 'F', '2004-07-21', '231220003', 2023, 'UG', 2, 'RFID-0003'),
    student(4, 'Rohan Demo', 'M', '2000-01-30', '252221004', 2025, 'PG', 3, 'RFID-DEAD', false),
    student(5, 'Isha Demo', 'F', '2003-05-09', '221220005', 2022, 'UG', 2, 'RFID-0005'),
    student(6, 'Vikram Demo', 'M', '2005-09-17', '251220006', 2025, 'UG', 2, 'RFID-0006'),
    student(7, 'Nisha Demo', 'F', '2001-12-25', '242221007', 2024, 'PG', 3, 'RFID-0007'),
    student(8, 'Arjun Demo', 'M', '2004-02-11', '241210008', 2024, 'UG', 1, 'RFID-0008'),
    nonStudent(11, 'Sunita Demo', 'F', 45, '9000000101', 'FACULTY'),
    nonStudent(12, 'Mahesh Demo', 'M', 48, '9000000101', 'FACULTY'),
    nonStudent(13, 'Gopal Demo', 'M', 52, '9000000102', 'WORKER'),
    nonStudent(14, 'Lata Demo', 'F', 38, '9000000103', 'STAFF'),
    nonStudent(15, 'Demo Person One', 'F', 30, FULL_PHONE, 'STAFF'),
    nonStudent(16, 'Demo Person Two', 'M', 35, FULL_PHONE, 'WORKER'),
    nonStudent(17, 'Demo Person Three', 'F', 40, FULL_PHONE, 'STAFF'),
    nonStudent(18, 'Demo Person Four', 'M', 45, FULL_PHONE, 'WORKER'),
    nonStudent(19, 'Demo Person Five', 'F', 50, FULL_PHONE, 'OTHER'),
  ];
}

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const ISSUE_MIX = [
  ['Fever', 25, 'Paracetamol 500mg'], ['Cold / Cough', 25, 'Cetirizine 10mg'], ['Headache', 15, 'Paracetamol 500mg'],
  ['Stomach ache', 15, 'ORS + antacid'], ['Minor injury', 8, 'Antiseptic dressing'], ['Allergy', 6, 'Cetirizine 10mg'],
  ['Body pain', 6, 'Ibuprofen 400mg'],
];
const HOUR_POOL = [9, 10, 10, 11, 11, 11, 12, 12, 13, 14, 15, 16, 16, 17, 18]; // IST, clinic-like shape

function seedVisits(now) {
  const rand = prng(42);
  const out = [];
  const total = ISSUE_MIX.reduce((a, r) => a + r[1], 0);
  for (let i = 0; i < 180; i += 1) {
    const p = db.patients[Math.floor(rand() ** 1.6 * db.patients.length)]; // a few frequent visitors
    let roll = rand() * total;
    const issue = ISSUE_MIX.find((r) => (roll -= r[1]) < 0) ?? ISSUE_MIX[0];
    const daysAgo = 1 + Math.floor(rand() * 60); // never today, so live demos never hit the duplicate rule by accident
    const hour = HOUR_POOL[Math.floor(rand() * HOUR_POOL.length)];
    const minute = Math.floor(rand() * 60);
    const istMidnightAsUtc = Date.parse(`${istYMD(now - daysAgo * 86_400_000)}T00:00:00Z`);
    const when = istMidnightAsUtc + (hour * 60 + minute) * 60_000 - IST_OFFSET_MS;
    out.push(makeVisit(p, when, issue[0], false, issue[2], 2));
  }
  // Kabir visited 3 minutes ago: tapping RFID-0002 triggers DUPLICATE_VISIT_WARNING.
  out.push(makeVisit(db.patients[1], now - 3 * 60_000, 'Fever', false, 'Paracetamol 500mg', 2));
  return out.sort((a, b) => a.date_time.localeCompare(b.date_time));
}

export function resetMockDb(now = Date.now()) {
  db.patients = seedPatients();
  db.visits = seedVisits(now);
}
resetMockDb();

// ---------- queries used by handlers ----------
export const findPatient = (id) => db.patients.find((p) => p.patient_id === id);
export const lastVisitOf = (patient_id) =>
  db.visits.filter((v) => v.patient_id === patient_id).sort((a, b) => b.date_time.localeCompare(a.date_time))[0];

export function visitsInRange(from, to) {
  return db.visits.filter((v) => {
    const d = istYMD(v.date_time);
    return (!from || d >= from) && (!to || d <= to);
  });
}

// ---------- reports ----------
const tally = (rows, keyFn) => {
  const m = new Map();
  rows.forEach((r) => {
    const k = keyFn(r);
    m.set(k, (m.get(k) ?? 0) + 1);
  });
  return m;
};
const byCountDesc = (a, b) => b.count - a.count;

export const commonIssues = (from, to, limit = 10) =>
  [...tally(visitsInRange(from, to), (v) => v.health_issue)]
    .map(([health_issue, count]) => ({ health_issue, count }))
    .sort(byCountDesc).slice(0, limit);

// Only hours that have visits are returned, so the client has to fill the empty hours itself.
export const peakHours = (from, to) =>
  [...tally(visitsInRange(from, to), (v) => istHour(v.date_time))]
    .map(([hour, count]) => ({ hour, count })).sort((a, b) => a.hour - b.hour);

export function frequentVisitors(from, to, limit = 10) {
  const m = new Map();
  visitsInRange(from, to).forEach((v) => {
    const e = m.get(v.patient_id) ?? { patient_id: v.patient_id, name: v.snapshot.name, patient_type: v.patient_type, count: 0 };
    e.count += 1;
    m.set(v.patient_id, e);
  });
  return [...m.values()].sort(byCountDesc).slice(0, limit);
}

export const visitsByBranch = (from, to) =>
  [...tally(visitsInRange(from, to).filter((v) => v.snapshot.branch_id != null), (v) => v.snapshot.branch_id)]
    .map(([branch_id, count]) => ({ branch_id, branch_name: BRANCHES.find((b) => b.branch_id === branch_id)?.branch_name ?? String(branch_id), count }))
    .sort(byCountDesc);

export const visitsByBatch = (from, to) =>
  [...tally(visitsInRange(from, to).filter((v) => v.snapshot.batch_year != null), (v) => v.snapshot.batch_year)]
    .map(([batch_year, count]) => ({ batch_year, count })).sort((a, b) => a.batch_year - b.batch_year);

function weekStart(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}
export function visitsOverTime(from, to, bucket = 'day') {
  const key = (v) => {
    const ymd = istYMD(v.date_time);
    return bucket === 'month' ? ymd.slice(0, 7) : bucket === 'week' ? weekStart(ymd) : ymd;
  };
  return [...tally(visitsInRange(from, to), key)]
    .map(([b, count]) => ({ bucket: b, count })).sort((a, b) => a.bucket.localeCompare(b.bucket));
}
