import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateDataset } from '../seed/generate.js';
import { parseRollNo } from '../lib/rollno.js';
import { istParts, istDateString } from '../lib/time.js';
import { computeAge } from '../lib/age.js';
import { createInMemoryRepositories } from '../index.js';

const END = '2026-11-16';
const data = generateDataset({ end: END });
const digest = (d) => createHash('sha256').update(JSON.stringify(d)).digest('hex');

describe('synthetic dataset', () => {
  test('is reproducible for a fixed seed and end date, and the seed matters', () => {
    assert.equal(digest(generateDataset({ end: END })), digest(data));
    assert.notEqual(digest(generateDataset({ end: END, seed: 7 })), digest(data));
  });

  test('requested sizes', () => {
    assert.equal(data.students.length, 300);
    assert.equal(data.nonStudents.length, 60);
    assert.equal(data.visits.length, 6000);
    assert.deepEqual(data.users.map((u) => u.username), ['admin', 'staff']);
    assert.deepEqual(data.branches.map((b) => b.branch_code), ['210', '220', '221', '991', '992', '993']);
  });

  test('students: parseable roll numbers consistent with stored fields, fake serial range, unique tags, one active tag', () => {
    const rolls = new Set(); const tags = new Set();
    for (const s of data.students) {
      const p = parseRollNo(s.roll_no);
      assert.deepEqual([p.batch_year, p.program, p.branch_code], [s.batch_year, s.program, s.branch_code]);
      assert.ok(Number(p.serial) >= 901, 'synthetic serial range');
      assert.ok(!rolls.has(s.roll_no)); rolls.add(s.roll_no);
      assert.equal(s.rfid_tags.filter((t) => t.is_active).length, 1);
      for (const t of s.rfid_tags) { assert.match(t.rfid_id, /^SYN[0-9A-F]{8}$/); assert.ok(!tags.has(t.rfid_id)); tags.add(t.rfid_id); }
      assert.ok(s.dob < '2008-12-31' && s.dob > '1995-01-01');
    }
    assert.ok(data.students.some((s) => s.rfid_tags.length > 1), 'some students have a replaced card');
  });

  test('non-students: phones hold 1-5 people, at least one phone has 5, no duplicate names per phone, patterned fake numbers', () => {
    const byPhone = new Map();
    for (const n of data.nonStudents) {
      assert.match(n.phone_no, /^90000\d{5}$/);
      const list = byPhone.get(n.phone_no) ?? []; list.push(n); byPhone.set(n.phone_no, list);
    }
    const sizes = [...byPhone.values()].map((l) => l.length);
    assert.ok(Math.max(...sizes) === 5 && Math.min(...sizes) === 1);
    assert.ok(sizes.filter((x) => x >= 2).length >= 5);
    for (const l of byPhone.values()) assert.equal(new Set(l.map((n) => n.name.toLowerCase())).size, l.length);
  });

  test('visits: 6-month window, IST working-hour shape, issue mix, frequent visitors, snapshots, no duplicate-window hits', () => {
    const { from, to } = data.window;
    assert.equal(from, '2026-05-17');
    const hours = new Array(24).fill(0); const issues = new Map(); const perPatient = new Map();
    let weekend = 0;
    const lastAt = new Map();
    for (const v of data.visits) {
      const day = istDateString(v.date_time);
      assert.ok(day >= from && day <= to);
      const p = istParts(v.date_time); hours[p.hour] += 1; if (p.weekday === 0) weekend += 1;
      issues.set(v.health_issue, (issues.get(v.health_issue) ?? 0) + 1);
      perPatient.set(v.patient_id, (perPatient.get(v.patient_id) ?? 0) + 1);
      const prev = lastAt.get(v.patient_id) ?? [];
      assert.ok(prev.every((t) => Math.abs(t - v.date_time.getTime()) > 10 * 60 * 1000), 'visit inside the duplicate window');
      prev.push(v.date_time.getTime()); lastAt.set(v.patient_id, prev);
    }
    // mid-morning and after-lunch peaks, quiet early/late
    assert.ok(hours[10] + hours[11] > hours[9] + hours[12]);
    assert.ok(hours[14] + hours[15] > hours[13] * 2);
    assert.ok(hours[10] > hours[13] * 3);
    assert.equal(hours.slice(0, 8).reduce((a, b) => a + b, 0) + hours.slice(19).reduce((a, b) => a + b, 0), 0);
    assert.ok(weekend < 6000 * 0.01, 'Sundays are rare');
    // fever / cold / headache dominate
    const top3 = [...issues.entries()].filter(([k]) => ['Fever', 'Cold', 'Headache'].includes(k)).reduce((s, [, n]) => s + n, 0);
    assert.ok(top3 / 6000 > 0.4);
    const sorted = [...issues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k).sort();
    assert.deepEqual(sorted, ['Cold', 'Fever', 'Headache']);
    const custom = data.visits.filter((v) => v.health_issue_is_custom).length;
    assert.ok(custom > 150 && custom < 450);
    // a few frequent visitors
    const counts = [...perPatient.values()].sort((a, b) => b - a);
    assert.ok(counts[0] > 50 && counts[9] > 40, `top visitors ${counts.slice(0, 10)}`);
    assert.ok(counts[Math.floor(counts.length / 2)] < 25, 'the typical patient is far below the frequent ones');
  });

  test('every snapshot matches the patient and age rules at the visit date', () => {
    const students = new Map(data.students.map((s) => [s.patient_id, s]));
    const others = new Map(data.nonStudents.map((s) => [s.patient_id, s]));
    for (const v of data.visits.slice(0, 1500)) {
      if (v.patient_type === 'STUDENT') {
        const s = students.get(v.patient_id);
        assert.equal(v.snapshot.roll_no, s.roll_no);
        assert.equal(v.snapshot.age_at_visit, computeAge({ patient_type: 'STUDENT', dob: s.dob }, v.date_time).age);
        assert.deepEqual(Object.keys(v.snapshot).sort(), ['age_at_visit', 'batch_year', 'branch_id', 'branch_name', 'name', 'program', 'roll_no', 'sex']);
        assert.ok(istDateString(v.date_time) >= s.registered_on, 'no visits before admission');
      } else {
        const n = others.get(v.patient_id);
        assert.equal(v.snapshot.phone_no, n.phone_no);
        assert.deepEqual(Object.keys(v.snapshot).sort(), ['age_at_visit', 'designation', 'name', 'phone_no', 'sex']);
        assert.ok(istDateString(v.date_time) >= n.registered_on);
      }
    }
  });

  test('loads into the in-memory repositories for UI-less development', async () => {
    const repos = createInMemoryRepositories({ withSeedData: true, clock: () => new Date('2026-11-17T06:00:00Z') });
    assert.equal((await repos.users.findByUsername('admin')).role, 'ADMIN');
    assert.equal((await repos.users.findByUsername('staff')).role, 'STAFF');
    const s = data.students.find((x) => x.rfid_tags.length === 1);
    const view = await repos.patients.findByRfid(s.rfid_tags[0].rfid_id);
    assert.equal(view.roll_no, s.roll_no);
    const old = data.students.find((x) => x.rfid_tags.length > 1);
    await assert.rejects(repos.patients.findByRfid(old.rfid_tags.find((t) => !t.is_active).rfid_id), { code: 'RFID_INACTIVE' });
    const hours = await repos.reports.peakHours();
    assert.ok(hours.length > 0 && hours.length <= 24, 'only hours with visits are returned (no zero-fill)');
    assert.equal((await repos.reports.frequentVisitors({ limit: 5 })).length, 5);
  });
});
