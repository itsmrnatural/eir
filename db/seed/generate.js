// Synthetic dataset generator. Pure and deterministic: same options => identical output.
//
// EVERYTHING HERE IS FAKE (synthetic data only):
//   * names      - invented from syllables, not drawn from any list of real people
//   * roll nos   - real branch/batch layout but serials 901-999 only (a range no real cohort uses)
//   * phones     - patterned numbers 90000 000NN (visibly artificial)
//   * RFID tags  - "SYN" + 8 hex digits
//   * branches   - 210/220/221 are the real known codes; 991-993 are clearly fake
import { BRANCHES, HEALTH_ISSUES } from '../lib/reference-data.js';
import { programDigit, BATCH_YEAR_BASE } from '../lib/rollno.js';
import { computeAge } from '../lib/age.js';
import { buildSnapshot } from '../lib/domain.js';
import { addDaysYmd, istDateString, istMidnightUtc, istParts } from '../lib/time.js';
import { uuidV4FromBytes } from '../lib/ids.js';
import { DEV_USERS } from '../lib/dev-users.js';

export const DEFAULT_SEED = 20260101;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function helpers(rng) {
  const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const weighted = (items, weights) => {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = rng() * total;
    for (let i = 0; i < items.length; i += 1) { r -= weights[i]; if (r < 0) return items[i]; }
    return items[items.length - 1];
  };
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i -= 1) { const j = int(0, i); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const uuid = () => uuidV4FromBytes(Array.from({ length: 16 }, () => int(0, 255)));
  const hex = (n) => Array.from({ length: n }, () => '0123456789ABCDEF'[int(0, 15)]).join('');
  return { int, pick, weighted, shuffle, uuid, hex };
}

const ONSETS = ['b', 'd', 'g', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'ch', 'sh', 'kr', 'tr', 'br'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ai', 'ou', 'ea'];
const CODAS = ['', '', '', 'n', 'r', 'l', 'm', 's', 'k', 'th'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function makeNameFactory({ int, pick }) {
  const used = new Set();
  const part = (syll) => cap(Array.from({ length: syll }, (_, i) => pick(ONSETS) + pick(VOWELS) + (i === syll - 1 ? pick(CODAS) : '')).join(''));
  return () => {
    for (;;) {
      const name = `${part(int(2, 3))} ${part(int(2, 3))}`;
      if (!used.has(name)) { used.add(name); return name; }
    }
  };
}

const DOW_WEIGHT = [0.05, 1.1, 1.1, 1.0, 1.0, 0.9, 0.3]; // Sun..Sat (IST)
const HOUR_WEIGHT = { 8: 0.02, 9: 0.07, 10: 0.16, 11: 0.14, 12: 0.07, 13: 0.04, 14: 0.13, 15: 0.12, 16: 0.07, 17: 0.03, 18: 0.01 };

const ISSUE_WEIGHT = {
  Fever: 17, Cold: 15, Headache: 14, Cough: 9, 'Stomach ache': 7, 'Sore throat': 6, 'Body ache': 5, Allergy: 4,
  'Nausea / Vomiting': 3, Diarrhoea: 3, 'Skin rash': 3, 'Minor injury': 3, Toothache: 2, 'Eye irritation': 2, Dizziness: 2,
};
const CUSTOM_WEIGHT = 5; // percent of visits that use free-text "Other"
const CUSTOM_ISSUES = ['Ear pain', 'Insect bite', 'Muscle sprain', 'Nosebleed', 'Minor burn'];
const REMEDIES = {
  Fever: ['Paracetamol 500mg', 'Paracetamol 650mg'],
  Cold: ['Cetirizine 10mg', 'Antihistamine tablet + steam inhalation'],
  Cough: ['Cough syrup 10ml', 'Throat lozenges', 'Dextromethorphan syrup 10ml'],
  Headache: ['Paracetamol 500mg', 'Rest and hydration advised'],
  'Sore throat': ['Throat lozenges', 'Warm saline gargle advised'],
  'Stomach ache': ['Antacid tablet', 'Drotaverine 40mg'],
  'Nausea / Vomiting': ['Ondansetron 4mg', 'ORS sachet'],
  Diarrhoea: ['ORS sachet', 'ORS sachet + zinc 20mg'],
  'Body ache': ['Paracetamol 500mg', 'Ibuprofen 400mg'],
  Allergy: ['Cetirizine 10mg', 'Levocetirizine 5mg'],
  'Skin rash': ['Calamine lotion', 'Antihistamine tablet'],
  'Minor injury': ['Antiseptic dressing', 'Povidone-iodine and bandage'],
  Toothache: ['Paracetamol 500mg', 'Advised to see a dentist'],
  'Eye irritation': ['Lubricating eye drops', 'Cold compress advised'],
  Dizziness: ['ORS sachet', 'Rest for 30 minutes'],
};
const CUSTOM_REMEDIES = ['Paracetamol 500mg', 'Rest advised', 'Antiseptic dressing', 'Referred to hospital'];

/**
 * @param {{seed?:number, end?:string, students?:number, nonStudents?:number, visits?:number, days?:number}} [opts]
 *   end = last day of the visit window (YYYY-MM-DD, IST); defaults to today. Pass it for byte-identical output.
 */
export function generateDataset({
  seed = DEFAULT_SEED, end = istDateString(new Date()), students: nStudents = 300, nonStudents: nNon = 60, visits: nVisits = 6000, days = 183,
} = {}) {
  const rng = mulberry32(seed);
  const h = helpers(rng);
  const newName = makeNameFactory(h);
  const start = addDaysYmd(end, -days);
  const endParts = istParts(istMidnightUtc(end));

  const branches = [...BRANCHES.known, ...BRANCHES.synthetic].map((b) => ({ ...b }));
  const branchByCode = new Map(branches.map((b) => [b.branch_code, b]));
  const branchWeights = { 210: 30, 220: 25, 221: 10, 991: 15, 992: 12, 993: 8 };

  // ---- students --------------------------------------------------------------------------
  const latestBatch = endParts.month >= 8 ? endParts.year : endParts.year - 1;
  const batches = [latestBatch - 3, latestBatch - 2, latestBatch - 1, latestBatch];
  const serials = new Map();
  const usedTags = new Set();
  const newTag = () => { for (;;) { const t = `SYN${h.hex(8)}`; if (!usedTags.has(t)) { usedTags.add(t); return t; } } };

  const students = [];
  while (students.length < nStudents) {
    const batch_year = h.weighted(batches, [20, 25, 28, 27]);
    const program = batch_year >= latestBatch - 1 && rng() < 0.15 ? 'PG' : 'UG';
    const code = h.weighted(Object.keys(branchWeights), Object.values(branchWeights));
    const cell = `${batch_year}-${program}-${code}`;
    const serial = serials.get(cell) ?? 901;
    if (serial > 999) continue; // cell full, draw again
    serials.set(cell, serial + 1);
    const roll_no = `${String(batch_year - BATCH_YEAR_BASE).padStart(2, '0')}${programDigit(program)}${code}${serial}`;
    const birthYear = batch_year - (program === 'UG' ? h.int(18, 20) : h.int(21, 24));
    const dob = `${birthYear}-${String(h.int(1, 12)).padStart(2, '0')}-${String(h.int(1, 28)).padStart(2, '0')}`;
    const tags = [{ rfid_id: newTag(), is_active: true }];
    if (rng() < 0.02) tags.unshift({ rfid_id: newTag(), is_active: false }); // a replaced (old) card
    students.push({
      patient_id: h.uuid(), name: newName(), sex: h.weighted(['M', 'F', 'Other'], [62, 36, 2]), dob,
      registered_on: `${batch_year}-08-01`, roll_no, batch_year, program,
      branch_id: branchByCode.get(code).branch_id, branch_code: code, rfid_tags: tags,
    });
  }

  // ---- non-students: phone groups of 1..5 -----------------------------------------------------
  const groupSizes = [];
  let remaining = nNon;
  for (const size of [5, 4, 3, 3, 2, 2, 2, 2, 2, 2]) if (size <= remaining) { groupSizes.push(size); remaining -= size; }
  while (remaining > 0) { groupSizes.push(1); remaining -= 1; }

  const nonStudents = [];
  groupSizes.forEach((size, gi) => {
    const phone_no = `90000${String(gi + 1).padStart(5, '0')}`;
    for (let k = 0; k < size; k += 1) {
      nonStudents.push({
        patient_id: h.uuid(), name: newName(), sex: h.weighted(['M', 'F', 'Other'], [55, 43, 2]),
        age_at_registration: h.int(24, 64), registered_on: addDaysYmd(end, -h.int(30, 700)),
        phone_no, designation: h.weighted(['STAFF', 'FACULTY', 'WORKER', 'OTHER'], [35, 25, 30, 10]),
      });
    }
  });

  // ---- visit population --------------------------------------------------------------------
  const people = [
    ...students.map((s) => ({ kind: 'STUDENT', rec: s, since: s.registered_on })),
    ...nonStudents.map((n) => ({ kind: 'NON_STUDENT', rec: n, since: n.registered_on })),
  ].map((p) => ({ ...p, weight: 0.2 + -Math.log(1 - rng()), times: [] }));
  // a few frequent visitors
  for (const p of h.shuffle(people.filter((x) => x.kind === 'STUDENT')).slice(0, 8)) p.weight = 4 + rng() * 2;
  for (const p of h.shuffle(people.filter((x) => x.kind === 'NON_STUDENT')).slice(0, 2)) p.weight = 4 + rng() * 2;

  const dayList = [];
  const monthFactor = new Map();
  for (let d = start; d <= end; d = addDaysYmd(d, 1)) {
    const parts = istParts(istMidnightUtc(d));
    const mk = d.slice(0, 7);
    if (!monthFactor.has(mk)) monthFactor.set(mk, 0.85 + rng() * 0.3);
    dayList.push({ ymd: d, weight: DOW_WEIGHT[parts.weekday] * monthFactor.get(mk) * (0.85 + rng() * 0.3) });
  }
  const hours = Object.keys(HOUR_WEIGHT).map(Number);
  const hourWeights = hours.map((x) => HOUR_WEIGHT[x]);
  const labelWeights = HEALTH_ISSUES.map((i) => ISSUE_WEIGHT[i.label] ?? 1);
  const branchName = new Map(branches.map((b) => [b.branch_id, b.branch_name]));
  const MIN_GAP_MS = 30 * 60 * 1000; // comfortably above the 10 min duplicate window

  const visits = [];
  let guard = 0;
  while (visits.length < nVisits && guard < nVisits * 200) {
    guard += 1;
    const day = h.weighted(dayList, dayList.map((d) => d.weight));
    const eligible = people.filter((p) => p.since <= day.ymd);
    if (eligible.length === 0) continue;
    const person = h.weighted(eligible, eligible.map((p) => p.weight));
    const secondOfDay = h.weighted(hours, hourWeights) * 3600 + h.int(0, 3599);
    const at = new Date(istMidnightUtc(day.ymd).getTime() + secondOfDay * 1000);
    if (person.times.some((t) => Math.abs(t - at.getTime()) < MIN_GAP_MS)) continue;
    person.times.push(at.getTime());

    const custom = rng() * 100 < CUSTOM_WEIGHT;
    const health_issue = custom ? h.pick(CUSTOM_ISSUES) : h.weighted(HEALTH_ISSUES, labelWeights).label;
    const remedy = custom ? h.pick(CUSTOM_REMEDIES) : h.pick(REMEDIES[health_issue]);

    const r = person.rec;
    const base = person.kind === 'STUDENT'
      ? { patient_type: 'STUDENT', dob: r.dob }
      : { patient_type: 'NON_STUDENT', age_at_registration: r.age_at_registration, registered_on: r.registered_on };
    const { age } = computeAge(base, at);
    const view = {
      patient_id: r.patient_id, patient_type: person.kind, name: r.name, sex: r.sex, age,
      roll_no: r.roll_no, batch_year: r.batch_year, program: r.program, branch_id: r.branch_id,
      branch_name: branchName.get(r.branch_id), phone_no: r.phone_no, designation: r.designation,
    };
    visits.push({
      visit_id: h.uuid(), patient_id: r.patient_id, patient_type: person.kind, snapshot: buildSnapshot(view),
      date_time: at, health_issue, health_issue_is_custom: custom, remedy,
      recorded_by_username: rng() < 0.9 ? 'staff' : 'admin', created_at: at, updated_at: at,
    });
  }
  visits.sort((a, b) => a.date_time - b.date_time);

  return {
    seed, window: { from: start, to: end }, branches, students, nonStudents, visits,
    users: DEV_USERS.map(({ username, password, role }) => ({ username, password, role })),
  };
}
