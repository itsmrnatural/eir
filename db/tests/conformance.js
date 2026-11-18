// Repository conformance suite: one set of behavioural tests, run against both implementations.
//   tests/in-memory.test.js            -> createInMemoryRepositories()          (runs in `npm test`)
//   tests/integration/pg-mongo.int.js  -> createRepositories({pgPool,mongoDb})  (needs the databases)
//
// The factory returns { repos, clock, deactivateRfid(rfid), audit(entity, id), close? } where
//   clock.set(date) moves the injected clock, clock.now() reads it.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { istDateString } from '../lib/time.js';
import { addDaysYmd } from '../lib/time.js';

const rand = (n = 6) => randomBytes(n).toString('hex').toUpperCase();
const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const newPhone = () => `7${digits(9)}`;
const ist = (s) => new Date(new Date(`${s.replace(' ', 'T')}:00Z`).getTime() - 330 * 60 * 1000); // 'YYYY-MM-DD HH:MM' IST -> Date

export async function expectCode(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    return true;
  });
}

export function runConformance(label, makeContext) {
  describe(`repositories conformance: ${label}`, () => {
    let ctx; let repos; let clock; let uid = 0; let branches; let userId;
    const run = rand(3);

    const studentInput = (over = {}) => {
      uid += 1;
      return {
        name: `Conf Student ${run} ${uid}`, dob: addDaysYmd(istDateString(new Date()), -(20 * 365 + 120)), sex: 'F',
        roll_no: `C${run}${String(uid).padStart(4, '0')}`, batch_year: 2024, program: 'UG', branch_id: branches[0].branch_id,
        rfid_id: `CF${run}${String(uid).padStart(4, '0')}`, ...over,
      };
    };
    const nonStudentInput = (over = {}) => {
      uid += 1;
      return { name: `Conf Person ${run} ${uid}`, age: 40, sex: 'M', phone_no: newPhone(), designation: 'STAFF', ...over };
    };
    const issue = (over = {}) => ({ health_issue: 'Fever', health_issue_is_custom: false, remedy: 'Paracetamol 500mg', recorded_by: userId, ...over });

    before(async () => {
      ctx = await makeContext();
      ({ repos, clock } = ctx);
      branches = await repos.meta.listBranches();
      const u = await repos.users.create({ username: `conf_${run}`, password_hash: '$2b$10$KSVRHJ8PXfZ3wlA9RgDu.eQtil2OyCQaLwt2DGrkME.ws2rU24mei', role: 'STAFF' });
      userId = u.user_id;
    });

    describe('students and RFID', () => {
      it('creates a student and finds it by RFID, id and search', async () => {
        const input = studentInput();
        const created = await repos.patients.createStudent(input);
        assert.equal(created.patient_type, 'STUDENT');
        assert.equal(created.age, 20);
        assert.equal(created.age_is_estimated, false);
        assert.equal(created.roll_no, input.roll_no);
        assert.equal(created.rfid_id, input.rfid_id);
        assert.equal(created.branch_id, input.branch_id);
        assert.equal(created.branch_code, branches[0].branch_code);
        assert.equal(created.dob, input.dob);
        assert.equal('phone_no' in created, false);
        assert.match(created.patient_id, /^[0-9a-f-]{36}$/);

        assert.deepEqual(await repos.patients.findByRfid(input.rfid_id), created);
        assert.deepEqual(await repos.patients.findByRfid(` ${input.rfid_id.toLowerCase()} `), created, 'scan is trimmed and case-insensitive');
        assert.deepEqual(await repos.patients.findById(created.patient_id), created);
        assert.equal(await repos.patients.findById('not-a-uuid'), null);
        assert.equal(await repos.patients.findById('00000000-0000-4000-8000-000000000000'), null);

        for (const q of [input.name.toUpperCase(), input.roll_no, input.roll_no.slice(2, 8), `student ${run}`]) {
          const hits = await repos.patients.search(q);
          assert.ok(hits.some((h) => h.patient_id === created.patient_id), `search "${q}" should find the student`);
        }
        assert.deepEqual(await repos.patients.search('   '), []);
        assert.deepEqual(await repos.patients.search('%'), [], 'LIKE wildcards are escaped');
      });

      it('RFID_NOT_FOUND and RFID_INACTIVE', async () => {
        await expectCode(repos.patients.findByRfid(`NOPE${rand()}`), 'RFID_NOT_FOUND');
        const input = studentInput();
        await repos.patients.createStudent(input);
        await ctx.deactivateRfid(input.rfid_id);
        await expectCode(repos.patients.findByRfid(input.rfid_id), 'RFID_INACTIVE');
      });

      it('rejects duplicate roll_no and duplicate RFID', async () => {
        const a = studentInput();
        await repos.patients.createStudent(a);
        await expectCode(repos.patients.createStudent(studentInput({ roll_no: a.roll_no })), 'DUPLICATE_PATIENT');
        await expectCode(repos.patients.createStudent(studentInput({ rfid_id: a.rfid_id })), 'DUPLICATE_PATIENT');
        await expectCode(repos.patients.createStudent(studentInput({ branch_id: 31999 })), 'VALIDATION_ERROR');
        await expectCode(repos.patients.createStudent(studentInput({ sex: 'X' })), 'VALIDATION_ERROR');
      });
    });

    describe('non-students and phone rules', () => {
      it('creates a non-student with an estimated age and finds them by phone', async () => {
        const input = nonStudentInput({ phone_no: `+91 ${digits(5)}-${digits(5)}` });
        const created = await repos.patients.createNonStudent(input);
        assert.equal(created.patient_type, 'NON_STUDENT');
        assert.equal(created.age, 40);
        assert.equal(created.age_is_estimated, true);
        assert.equal(created.designation, 'STAFF');
        assert.equal(created.phone_no, input.phone_no.replace(/[\s-]/g, ''));
        assert.equal('roll_no' in created, false);
        assert.equal('dob' in created, false);
        assert.equal(created.age_at_registration, 40);
        assert.equal(created.registered_on, istDateString(clock.now()));

        const byPhone = await repos.patients.findByPhone(created.phone_no);
        assert.deepEqual(byPhone, [created]);
        assert.deepEqual(await repos.patients.findByPhone(input.phone_no), [created], 'formatting does not matter');
        const hits = await repos.patients.search(created.phone_no.slice(-6));
        assert.ok(hits.some((h) => h.patient_id === created.patient_id));
      });

      it('allows 5 people per phone, rejects the 6th and duplicate names', async () => {
        const phone = newPhone();
        for (let i = 0; i < 5; i += 1) await repos.patients.createNonStudent(nonStudentInput({ phone_no: phone, name: `Shared ${run} ${i}` }));
        await expectCode(repos.patients.createNonStudent(nonStudentInput({ phone_no: phone, name: `Shared ${run} 6` })), 'PHONE_LIMIT_REACHED');
        await expectCode(repos.patients.createNonStudent(nonStudentInput({ phone_no: phone, name: `shared ${run} 0` })), 'DUPLICATE_PATIENT');
        assert.equal((await repos.patients.findByPhone(phone)).length, 5);
        // same name under a different phone is fine
        await repos.patients.createNonStudent(nonStudentInput({ name: `Shared ${run} 0` }));
      });

      it('validates input', async () => {
        await expectCode(repos.patients.createNonStudent(nonStudentInput({ age: 121 })), 'VALIDATION_ERROR');
        await expectCode(repos.patients.createNonStudent(nonStudentInput({ age: 4.5 })), 'VALIDATION_ERROR');
        await expectCode(repos.patients.createNonStudent(nonStudentInput({ designation: 'BOSS' })), 'VALIDATION_ERROR');
        await expectCode(repos.patients.createNonStudent(nonStudentInput({ phone_no: '12' })), 'VALIDATION_ERROR');
        await expectCode(repos.patients.createNonStudent(nonStudentInput({ name: '   ' })), 'VALIDATION_ERROR');
      });
    });

    describe('patient updates', () => {
      it('patches a student, writes an audit row, refuses non-patchable fields', async () => {
        const s = await repos.patients.createStudent(studentInput());
        const after = await repos.patients.update(s.patient_id, { name: `Renamed ${run}`, sex: 'M', dob: '2004-02-29' }, userId);
        assert.equal(after.name, `Renamed ${run}`);
        assert.equal(after.sex, 'M');
        assert.equal(after.dob, '2004-02-29');
        const rows = await ctx.audit('patient', s.patient_id);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].action, 'UPDATE');
        assert.equal(rows[0].actor_user_id, userId);
        assert.equal(rows[0].before.name, s.name);
        assert.equal(rows[0].after.name, `Renamed ${run}`);

        for (const bad of [{ roll_no: 'X' }, { patient_type: 'NON_STUDENT' }, { rfid_id: 'ZZZ' }, { age: 30 }, { phone_no: '9876543210' }, { colour: 'red' }, {}]) {
          await expectCode(repos.patients.update(s.patient_id, bad, userId), 'VALIDATION_ERROR');
        }
        const same = await repos.patients.update(s.patient_id, { name: `Renamed ${run}` }, userId);
        assert.equal(same.name, `Renamed ${run}`);
        assert.equal((await ctx.audit('patient', s.patient_id)).length, 1, 'a no-op patch writes no audit row');
        await expectCode(repos.patients.update('00000000-0000-4000-8000-000000000000', { name: 'x' }, userId), 'NOT_FOUND');
      });

      it('patches a non-student: age resets the estimate, phone move re-checks the limit', async () => {
        const n = await repos.patients.createNonStudent(nonStudentInput());
        const aged = await repos.patients.update(n.patient_id, { age: 51, designation: 'FACULTY' }, userId);
        assert.equal(aged.age, 51);
        assert.equal(aged.age_at_registration, 51);
        assert.equal(aged.designation, 'FACULTY');
        await expectCode(repos.patients.update(n.patient_id, { dob: '1990-01-01' }, userId), 'VALIDATION_ERROR');

        const full = newPhone();
        for (let i = 0; i < 5; i += 1) await repos.patients.createNonStudent(nonStudentInput({ phone_no: full, name: `Full ${run} ${i}` }));
        await expectCode(repos.patients.update(n.patient_id, { phone_no: full }, userId), 'PHONE_LIMIT_REACHED');
        const dup = await repos.patients.createNonStudent(nonStudentInput({ name: `Dup ${run}` }));
        // duplicate-name is reported before the limit (more useful: the person is already registered there)
        await expectCode(repos.patients.update(dup.patient_id, { phone_no: full, name: `full ${run} 3` }, userId), 'DUPLICATE_PATIENT');
        const moved = await repos.patients.update(dup.patient_id, { phone_no: n.phone_no }, userId);
        assert.equal(moved.phone_no, n.phone_no);
        await expectCode(repos.patients.update(moved.patient_id, { name: n.name.toUpperCase() }, userId), 'DUPLICATE_PATIENT');
      });
    });

    describe('visits', () => {
      it('creates visits with a snapshot, server-set time, and the duplicate-visit rule', async () => {
        const s = await repos.patients.createStudent(studentInput());
        const n = await repos.patients.createNonStudent(nonStudentInput());
        clock.set(new Date());
        const t0 = clock.now();

        const v = await repos.visits.create(issue({ patient_id: s.patient_id }));
        assert.equal(v.date_time.getTime(), t0.getTime());
        assert.equal(v.patient_type, 'STUDENT');
        assert.equal(v.recorded_by, userId);
        assert.equal(v.health_issue_is_custom, false);
        assert.deepEqual(v.snapshot, {
          name: s.name, sex: s.sex, age_at_visit: s.age, roll_no: s.roll_no, batch_year: 2024, program: 'UG',
          branch_id: s.branch_id, branch_name: branches[0].branch_name,
        });
        assert.deepEqual(await repos.visits.findById(v.visit_id), v);
        assert.equal(await repos.visits.findById('missing'), null);

        const vn = await repos.visits.create(issue({ patient_id: n.patient_id, health_issue: 'Ear pain', health_issue_is_custom: true }));
        assert.deepEqual(vn.snapshot, { name: n.name, sex: 'M', age_at_visit: 40, phone_no: n.phone_no, designation: 'STAFF' });
        assert.equal(vn.health_issue_is_custom, true);

        // duplicate within the window
        clock.set(new Date(t0.getTime() + 5 * 60 * 1000));
        await assert.rejects(repos.visits.create(issue({ patient_id: s.patient_id })), (err) => {
          assert.equal(err.code, 'DUPLICATE_VISIT_WARNING');
          assert.equal(new Date(err.details.last_visit_at).getTime(), t0.getTime());
          return true;
        });
        const confirmed = await repos.visits.create(issue({ patient_id: s.patient_id, confirm_duplicate: true }));
        assert.ok(confirmed.visit_id);
        // outside the window (10 min after the latest visit)
        clock.set(new Date(clock.now().getTime() + 11 * 60 * 1000));
        await repos.visits.create(issue({ patient_id: s.patient_id }));
        assert.equal((await repos.visits.listByPatient(s.patient_id)).length, 3);
      });

      it('validates visit input', async () => {
        const s = await repos.patients.createStudent(studentInput());
        clock.set(new Date());
        await expectCode(repos.visits.create(issue({ patient_id: s.patient_id, health_issue: 'Not on the list' })), 'VALIDATION_ERROR');
        await expectCode(repos.visits.create(issue({ patient_id: s.patient_id, remedy: ' ' })), 'VALIDATION_ERROR');
        await expectCode(repos.visits.create(issue({ patient_id: s.patient_id, recorded_by: 'me' })), 'VALIDATION_ERROR');
        await expectCode(repos.visits.create(issue({ patient_id: 'nope' })), 'VALIDATION_ERROR');
        await expectCode(repos.visits.create(issue({ patient_id: '00000000-0000-4000-8000-000000000000' })), 'NOT_FOUND');
      });

      it('lets an admin correct a visit and audits it', async () => {
        const s = await repos.patients.createStudent(studentInput());
        clock.set(new Date());
        const v = await repos.visits.create(issue({ patient_id: s.patient_id }));
        const fixed = await repos.visits.update(v.visit_id, { health_issue: 'Cold', remedy: 'Cetirizine 10mg' }, userId);
        assert.equal(fixed.health_issue, 'Cold');
        assert.equal(fixed.remedy, 'Cetirizine 10mg');
        assert.equal(fixed.health_issue_is_custom, false);
        assert.equal(fixed.date_time.getTime(), v.date_time.getTime(), 'date_time is never editable');
        const custom = await repos.visits.update(v.visit_id, { health_issue: 'Hiccups' }, userId);
        assert.equal(custom.health_issue_is_custom, true);

        const rows = await ctx.audit('visit', v.visit_id);
        assert.equal(rows.length, 2);
        assert.equal(rows[0].before.health_issue, 'Fever');
        assert.equal(rows[0].after.health_issue, 'Cold');

        await repos.visits.update(v.visit_id, { remedy: 'Cetirizine 10mg' }, userId);
        assert.equal((await ctx.audit('visit', v.visit_id)).length, 2, 'no-op edit writes no audit row');
        await expectCode(repos.visits.update(v.visit_id, { date_time: new Date() }, userId), 'VALIDATION_ERROR');
        await expectCode(repos.visits.update(v.visit_id, {}, userId), 'VALIDATION_ERROR');
        await expectCode(repos.visits.update('missing', { remedy: 'x' }, userId), 'NOT_FOUND');
      });

      it('lists a patient history newest first with inclusive IST day boundaries', async () => {
        const s = await repos.patients.createStudent(studentInput());
        const stamps = ['2001-02-10 23:59', '2001-02-11 00:01', '2001-02-11 23:59', '2001-02-12 00:00'];
        for (const st of stamps) { clock.set(ist(st)); await repos.visits.create(issue({ patient_id: s.patient_id, confirm_duplicate: true })); }
        const all = await repos.visits.listByPatient(s.patient_id);
        assert.deepEqual(all.map((d) => d.date_time.getTime()), stamps.map((x) => ist(x).getTime()).reverse());
        const day11 = await repos.visits.listByPatient(s.patient_id, { from: '2001-02-11', to: '2001-02-11' });
        assert.equal(day11.length, 2);
        assert.equal((await repos.visits.listByPatient(s.patient_id, { from: '2001-02-12' })).length, 1);
        assert.equal((await repos.visits.listByPatient(s.patient_id, { to: '2001-02-10' })).length, 1);
        await expectCode(repos.visits.listByPatient(s.patient_id, { from: '2001-02-12', to: '2001-02-11' }), 'VALIDATION_ERROR');
        await expectCode(repos.visits.listByPatient(s.patient_id, { from: '2001-2-1' }), 'VALIDATION_ERROR');
      });
    });

    describe('reports and export (fixture in March 2001 IST)', () => {
      const RANGE = { from: '2001-03-05', to: '2001-04-04' };
      let s1; let s2; let s3; let n1;

      before(async () => {
        clock.set(new Date());
        s1 = await repos.patients.createStudent(studentInput({ name: `Rep Alpha ${run}`, batch_year: 2024, branch_id: branches[0].branch_id }));
        s2 = await repos.patients.createStudent(studentInput({ name: `Rep Bravo ${run}`, batch_year: 2025, branch_id: branches[0].branch_id }));
        s3 = await repos.patients.createStudent(studentInput({ name: `Rep Charlie ${run}`, batch_year: 2024, branch_id: branches[1].branch_id }));
        n1 = await repos.patients.createNonStudent(nonStudentInput({ name: `Rep Delta ${run}` }));
        const plan = [
          ['2001-03-05 10:05', s1, 'Fever'], ['2001-03-05 10:40', s2, 'Fever'], ['2001-03-06 14:10', s1, 'Cold'],
          ['2001-03-06 10:55', n1, 'Fever'], ['2001-03-10 23:59', s3, 'Headache'], ['2001-03-12 00:01', s1, 'Headache'],
          ['2001-04-02 15:00', s1, 'Fever'],
        ];
        for (const [when, p, h] of plan) { clock.set(ist(when)); await repos.visits.create(issue({ patient_id: p.patient_id, health_issue: h })); }
      });

      // Restore the shared clock so later suites see real-world birth dates again.
      after(() => clock.set(new Date()));

      it('commonIssues', async () => {
        assert.deepEqual(await repos.reports.commonIssues({ ...RANGE, limit: 10 }), [
          { health_issue: 'Fever', count: 4 }, { health_issue: 'Headache', count: 2 }, { health_issue: 'Cold', count: 1 },
        ]);
        assert.deepEqual(await repos.reports.commonIssues({ ...RANGE, limit: 1 }), [{ health_issue: 'Fever', count: 4 }]);
        assert.deepEqual(await repos.reports.commonIssues({ from: '2001-03-12', to: '2001-03-12' }), [{ health_issue: 'Headache', count: 1 }]);
      });

      it('peakHours groups by IST hour and returns only hours with visits (no zero-fill)', async () => {
        const rows = await repos.reports.peakHours(RANGE);
        assert.deepEqual(rows, [
          { hour: 0, count: 1 }, { hour: 10, count: 3 }, { hour: 14, count: 1 },
          { hour: 15, count: 1 }, { hour: 23, count: 1 },
        ]);
      });

      it('visitsOverTime: day, week (Monday start) and month buckets, sparse', async () => {
        const days = await repos.reports.visitsOverTime({ ...RANGE, bucket: 'day' });
        assert.deepEqual(days, [
          { bucket: '2001-03-05', count: 2 }, { bucket: '2001-03-06', count: 2 }, { bucket: '2001-03-10', count: 1 },
          { bucket: '2001-03-12', count: 1 }, { bucket: '2001-04-02', count: 1 },
        ]);
        assert.deepEqual(await repos.reports.visitsOverTime({ ...RANGE, bucket: 'week' }), [
          { bucket: '2001-03-05', count: 5 }, { bucket: '2001-03-12', count: 1 }, { bucket: '2001-04-02', count: 1 },
        ]);
        assert.deepEqual(await repos.reports.visitsOverTime({ ...RANGE, bucket: 'month' }), [
          { bucket: '2001-03', count: 6 }, { bucket: '2001-04', count: 1 },
        ]);
        await expectCode(repos.reports.visitsOverTime({ ...RANGE, bucket: 'year' }), 'VALIDATION_ERROR');
      });

      it('frequentVisitors', async () => {
        const rows = await repos.reports.frequentVisitors({ ...RANGE, limit: 3 });
        assert.deepEqual(rows.map((r) => [r.name, r.patient_type, r.count]), [
          [s1.name, 'STUDENT', 4], [s2.name, 'STUDENT', 1], [s3.name, 'STUDENT', 1],
        ]);
        assert.equal(rows[0].patient_id, s1.patient_id);
      });

      it('visitsByBranch counts students only; visitsByBatch is oldest first', async () => {
        assert.deepEqual(await repos.reports.visitsByBranch(RANGE), [
          { branch_id: branches[0].branch_id, branch_name: branches[0].branch_name, count: 5 },
          { branch_id: branches[1].branch_id, branch_name: branches[1].branch_name, count: 1 },
        ]);
        assert.deepEqual(await repos.reports.visitsByBatch(RANGE), [{ batch_year: 2024, count: 5 }, { batch_year: 2025, count: 1 }]);
      });

      it('listForExport groups visits per patient, oldest first', async () => {
        const entries = await repos.visits.listForExport(RANGE);
        assert.deepEqual(entries.map((e) => e.patient.name), [s1.name, s2.name, s3.name, n1.name]);
        const first = entries[0];
        assert.equal(first.patient.patient_id, s1.patient_id);
        assert.equal(first.visits.length, 4);
        assert.deepEqual(first.visits.map((v) => v.date_time.getTime()), [...first.visits.map((v) => v.date_time.getTime())].sort((a, b) => a - b));
        assert.deepEqual((await repos.visits.listForExport({ from: '2001-03-10', to: '2001-03-10' })).map((e) => e.patient.name), [s3.name]);
        assert.deepEqual(await repos.visits.listForExport({ from: '1990-01-01', to: '1990-01-02' }), []);
      });
    });

    describe('users and meta', () => {
      const hash = '$2b$10$6x2vW/nwxTGQ/qmGwtqtC.0kHnXG0eeGvCmR.8DKO.8BxNbkzVGnS';
      it('creates and finds users', async () => {
        const name = `user_${run}_${(uid += 1)}`;
        const created = await repos.users.create({ username: name, password_hash: hash, role: 'ADMIN' });
        assert.deepEqual(Object.keys(created).sort(), ['role', 'user_id', 'username']);
        const found = await repos.users.findByUsername(name);
        assert.equal(found.password_hash, hash);
        assert.equal(found.role, 'ADMIN');
        assert.equal(await repos.users.findByUsername(`nobody_${run}`), null);
        await expectCode(repos.users.create({ username: name, password_hash: hash, role: 'ADMIN' }), 'VALIDATION_ERROR');
        await expectCode(repos.users.create({ username: `x_${run}`, password_hash: 'plaintext', role: 'ADMIN' }), 'VALIDATION_ERROR');
        await expectCode(repos.users.create({ username: `y_${run}`, password_hash: hash, role: 'ROOT' }), 'VALIDATION_ERROR');
      });

      it('lists branches and health issues', async () => {
        const codes = (await repos.meta.listBranches()).map((b) => b.branch_code);
        for (const c of ['210', '220', '221']) assert.ok(codes.includes(c), `branch ${c}`);
        const issues = await repos.meta.listHealthIssues();
        assert.ok(issues.length >= 15);
        assert.deepEqual(Object.keys(issues[0]).sort(), ['code', 'label']);
        assert.ok(issues.some((i) => i.label === 'Fever'));
      });
    });

    it('closes', async () => { await ctx.close?.(); });
  });
}
