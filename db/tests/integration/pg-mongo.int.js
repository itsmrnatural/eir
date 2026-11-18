// Integration tests against REAL PostgreSQL + MongoDB (schema.sql and mongo/init.js must already be applied).
//   docker compose up -d postgres mongo
//   DATABASE_URL=... MONGO_URL=... npm run test:integration
// Runs the same conformance suite as the in-memory repositories, then checks what only a real database can:
// constraints, triggers, the view, the Mongo validator, indexes, concurrency.
// The suite writes uniquely-named rows and visits dated 2001-xx; visits before 2002 are deleted on start.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { connectAll } from '../../lib/connect.js';
import { relinkRfid } from '../../lib/relink-rfid.js';
import { runConformance, expectCode } from '../conformance.js';

const enabled = Boolean(process.env.DATABASE_URL && process.env.MONGO_URL);
const rand = () => randomBytes(4).toString('hex');
const phone10 = (first) => first + Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('');

if (!enabled) {
  describe('pg-mongo integration', () => { it('skipped: set DATABASE_URL and MONGO_URL', { skip: true }, () => {}); });
} else {
  const conn = await connectAll();
  const { pgPool, mongoDb } = conn;
  const visits = mongoDb.collection('visits');
  await visits.deleteMany({ date_time: { $lt: new Date('2002-01-01T00:00:00Z') } });

  const clock = (() => { let t = new Date(); return { now: () => t, set: (d) => { t = new Date(d); } }; })();
  const { createRepositories } = await import('../../repositories/pg-mongo/index.js');
  const repos = createRepositories({ pgPool, mongoDb, clock: () => clock.now(), duplicateWindowMin: 10 });

  runConformance('postgres + mongodb', async () => ({
    repos,
    clock,
    deactivateRfid: (id) => pgPool.query('UPDATE student_rfid SET is_active = FALSE WHERE rfid_id = $1', [id]),
    audit: async (entity, id) => (await pgPool.query('SELECT * FROM audit_log WHERE entity = $1 AND entity_id = $2 ORDER BY audit_id', [entity, id])).rows,
  }));

  describe('postgres: constraints, triggers, view', () => {
    const sqlFails = async (text, params, expectedCode) => {
      await assert.rejects(pgPool.query(text, params), (e) => { assert.equal(e.code, expectedCode, e.message); return true; });
    };
    const newNonStudent = async (c, phone, name) => {
      const id = (await c.query(`INSERT INTO patient (name, age_at_registration, sex, patient_type) VALUES ($1, 30, 'M', 'NON_STUDENT') RETURNING patient_id`, [name])).rows[0].patient_id;
      await c.query(`INSERT INTO non_student (patient_id, phone_no, designation) VALUES ($1, $2, 'STAFF')`, [id, phone]);
      return id;
    };

    it('CHECK: a non-student must have age_at_registration, a student must have dob', async () => {
      await sqlFails(`INSERT INTO patient (name, sex, patient_type) VALUES ('x', 'M', 'NON_STUDENT')`, [], '23514');
      await sqlFails(`INSERT INTO patient (name, sex, patient_type) VALUES ('x', 'M', 'STUDENT')`, [], '23514');
      await sqlFails(`INSERT INTO patient (name, age_at_registration, sex, patient_type) VALUES ('x', 130, 'M', 'NON_STUDENT')`, [], '23514');
    });

    it('subtype rows must match patient_type and every patient needs its subtype row (checked at COMMIT)', async () => {
      const c = await pgPool.connect();
      try {
        await c.query('BEGIN');
        const id = (await c.query(`INSERT INTO patient (name, age_at_registration, sex, patient_type) VALUES ('Mismatch', 30, 'M', 'NON_STUDENT') RETURNING patient_id`)).rows[0].patient_id;
        await assert.rejects(c.query(`INSERT INTO student (patient_id, roll_no, batch_year, program, branch_id) VALUES ($1, 'MM1', 2024, 'UG', 1)`, [id]), { code: '23514' });
        await c.query('ROLLBACK');
        await c.query('BEGIN');
        await c.query(`INSERT INTO patient (name, age_at_registration, sex, patient_type) VALUES ('Orphan', 30, 'M', 'NON_STUDENT')`);
        await assert.rejects(c.query('COMMIT'), { code: '23514' });
      } finally {
        try { await c.query('ROLLBACK'); } catch { /* ignore */ }
        c.release();
      }
    });

    it('trigger: 6th person on a phone fails with HC001, same name fails with HC002', async () => {
      const phone = phone10('6');
      const c = await pgPool.connect();
      try {
        await c.query('BEGIN');
        for (let i = 0; i < 6; i += 1) await newNonStudent(c, phone, `Trig ${rand()} ${i}`);
        await assert.rejects(c.query('COMMIT'), { code: 'HC001' });
      } finally { try { await c.query('ROLLBACK'); } catch { /* ignore */ } c.release(); }

      const c2 = await pgPool.connect();
      try {
        await c2.query('BEGIN');
        await newNonStudent(c2, phone, 'Same Name');
        await newNonStudent(c2, phone, 'same name');
        await assert.rejects(c2.query('COMMIT'), { code: 'HC002' });
      } finally { try { await c2.query('ROLLBACK'); } catch { /* ignore */ } c2.release(); }
    });

    it('concurrent registrations on one phone: the advisory lock lets exactly the free slots through', async () => {
      const phone = phone10('5');
      for (let i = 0; i < 3; i += 1) await repos.patients.createNonStudent({ name: `Race Base ${rand()}`, age: 30, sex: 'F', phone_no: phone, designation: 'WORKER' });
      const results = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => repos.patients.createNonStudent({ name: `Race ${rand()} ${i}`, age: 30, sex: 'F', phone_no: phone, designation: 'WORKER' })));
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
      assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'PHONE_LIMIT_REACHED'));
      assert.equal((await repos.patients.findByPhone(phone)).length, 5);
    });

    it('partial unique index: one ACTIVE tag per student', async () => {
      const roll = `UQ${rand()}`;
      const s = await repos.patients.createStudent({ name: `Tag ${rand()}`, dob: '1990-05-05', sex: 'M', roll_no: roll, batch_year: 2024, program: 'UG', branch_id: 1, rfid_id: `UQ${rand()}` });
      await sqlFails('INSERT INTO student_rfid (rfid_id, roll_no, is_active) VALUES ($1, $2, TRUE)', [`UQ${rand()}`, roll], '23505');
      await pgPool.query('INSERT INTO student_rfid (rfid_id, roll_no, is_active) VALUES ($1, $2, FALSE)', [`UQ${rand()}`, roll]);
      assert.ok(s.rfid_id);
    });

    it('view patient_with_age computes age in Asia/Kolkata and flags estimates', async () => {
      const n = await repos.patients.createNonStudent({ name: `View ${rand()}`, age: 33, sex: 'F', phone_no: phone10('4'), designation: 'FACULTY' });
      await pgPool.query(`UPDATE patient SET registered_on = (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE - INTERVAL '800 days' WHERE patient_id = $1`, [n.patient_id]);
      const row = (await pgPool.query('SELECT age, age_is_estimated FROM patient_with_age WHERE patient_id = $1', [n.patient_id])).rows[0];
      assert.deepEqual([row.age, row.age_is_estimated], [35, true]); // 800 days = 2 full years
    });

    it('relink-rfid deactivates the old tag, activates the new one and audits', async () => {
      const roll = `RL${rand()}`;
      const oldTag = `RL${rand()}`.toUpperCase(); const newTag = `RL${rand()}`.toUpperCase();
      await repos.patients.createStudent({ name: `Relink ${rand()}`, dob: '1990-05-05', sex: 'M', roll_no: roll, batch_year: 2024, program: 'UG', branch_id: 1, rfid_id: oldTag });
      const r = await relinkRfid(pgPool, { roll_no: roll, new_rfid_id: newTag.toLowerCase() });
      assert.deepEqual([r.changed, r.old_rfid_id, r.new_rfid_id], [true, oldTag, newTag]);
      await expectCode(repos.patients.findByRfid(oldTag), 'RFID_INACTIVE');
      assert.equal((await repos.patients.findByRfid(newTag)).roll_no, roll);
      const audit = (await pgPool.query(`SELECT * FROM audit_log WHERE entity = 'student_rfid' AND entity_id = $1`, [roll])).rows;
      assert.equal(audit.length, 1);
      assert.deepEqual([audit[0].action, audit[0].before.rfid_id, audit[0].after.rfid_id], ['RELINK', oldTag, newTag]);
      assert.equal((await relinkRfid(pgPool, { roll_no: roll, new_rfid_id: newTag })).changed, false);
      const back = await relinkRfid(pgPool, { roll_no: roll, new_rfid_id: oldTag }); // re-activating an old card works
      assert.equal(back.changed, true);
      assert.equal((await repos.patients.findByRfid(oldTag)).roll_no, roll);
      const other = `RL${rand()}`;
      await repos.patients.createStudent({ name: `Other ${rand()}`, dob: '1990-05-05', sex: 'M', roll_no: other, batch_year: 2024, program: 'UG', branch_id: 1, rfid_id: `OT${rand()}`.toUpperCase() });
      await expectCode(relinkRfid(pgPool, { roll_no: other, new_rfid_id: oldTag }), 'DUPLICATE_PATIENT');
      await expectCode(relinkRfid(pgPool, { roll_no: 'NOPE', new_rfid_id: 'X1' }), 'NOT_FOUND');
    });
  });

  describe('mongodb: validator and indexes', () => {
    const good = () => ({
      visit_id: crypto.randomUUID(), patient_id: crypto.randomUUID(), patient_type: 'STUDENT',
      snapshot: { name: 'V', sex: 'M', age_at_visit: 20, roll_no: 'R1', batch_year: 2024, program: 'UG', branch_id: 1, branch_name: 'CSE' },
      date_time: new Date('2001-06-01T05:00:00Z'), health_issue: 'Fever', health_issue_is_custom: false, remedy: 'x',
      recorded_by: 1, created_at: new Date(), updated_at: new Date(),
    });
    const rejects = async (mutate) => { const d = good(); mutate(d); await assert.rejects(visits.insertOne(d), { code: 121 }); };

    it('accepts a valid document, rejects invalid ones', async () => {
      await visits.insertOne(good());
      await rejects((d) => { d.extra = 1; });
      await rejects((d) => { delete d.snapshot.age_at_visit; });
      await rejects((d) => { d.date_time = '2001-06-01'; });
      await rejects((d) => { d.visit_id = 'not-a-uuid'; });
      await rejects((d) => { d.patient_type = 'DOCTOR'; });
      await rejects((d) => { d.remedy = ''; });
      await rejects((d) => { delete d.snapshot.roll_no; });                       // student snapshot needs roll_no ...
      await rejects((d) => { d.patient_type = 'NON_STUDENT'; });                  // ... and a non-student needs phone_no/designation
      await visits.deleteMany({ date_time: { $lt: new Date('2002-01-01T00:00:00Z') } });
    });

    it('has the visit indexes, visit_id unique', async () => {
      const idx = await visits.indexes();
      const keys = idx.map((i) => JSON.stringify(i.key));
      for (const k of ['{"visit_id":1}', '{"patient_id":1,"date_time":-1}', '{"date_time":1}', '{"health_issue":1}', '{"snapshot.branch_id":1}', '{"snapshot.batch_year":1}']) assert.ok(keys.includes(k), k);
      assert.equal(idx.find((i) => JSON.stringify(i.key) === '{"visit_id":1}').unique, true);
    });
  });

  after(async () => { await conn.close(); });
}
