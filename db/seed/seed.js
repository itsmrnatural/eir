#!/usr/bin/env node
// Loads the synthetic dataset (seed/generate.js) into PostgreSQL + MongoDB.
//   node seed/seed.js                 refuses to run if patients already exist
//   node seed/seed.js --reset         WIPES patients, users, branches, audit_log and all visits first
//   node seed/seed.js --end 2026-11-16 --seed 7      reproducible window / different random stream
//   node seed/seed.js --reset --visits 200000        volume test (more visits, same patients)
// ALL DATA IS SYNTHETIC (see generate.js). Dev users: admin/admin123 (ADMIN), staff/staff123 (STAFF).
import { pathToFileURL } from 'node:url';
import { connectAll } from '../lib/connect.js';
import { generateDataset, DEFAULT_SEED } from './generate.js';
import { BCRYPT_ROUNDS } from '../lib/dev-users.js';
import { istDateString } from '../lib/time.js';
import { withTx } from '../repositories/pg-mongo/pg-helpers.js';

const arg = (argv, name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };

export async function loadDataset({ pgPool, mongoDb, dataset, hash, log = () => {} }) {
  const userIds = new Map();
  await withTx(pgPool, async (c) => {
    for (const b of dataset.branches) {
      await c.query('INSERT INTO branch (branch_id, branch_code, branch_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [b.branch_id, b.branch_code, b.branch_name]);
    }
    for (const u of dataset.users) {
      const r = await c.query(
        `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)
         ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role RETURNING user_id`,
        [u.username, await hash(u.password), u.role],
      );
      userIds.set(u.username, r.rows[0].user_id);
    }
    for (const s of dataset.students) {
      await c.query(
        `INSERT INTO patient (patient_id, name, dob, sex, patient_type, registered_on) VALUES ($1, $2, $3, $4, 'STUDENT', $5)`,
        [s.patient_id, s.name, s.dob, s.sex, s.registered_on],
      );
      await c.query(
        `INSERT INTO student (patient_id, roll_no, batch_year, program, branch_id) VALUES ($1, $2, $3, $4, $5)`,
        [s.patient_id, s.roll_no, s.batch_year, s.program, s.branch_id],
      );
      for (const t of s.rfid_tags) { // old (inactive) card first, active card last
        await c.query('INSERT INTO student_rfid (rfid_id, roll_no, is_active) VALUES ($1, $2, $3)', [t.rfid_id, s.roll_no, t.is_active]);
      }
    }
    for (const n of dataset.nonStudents) {
      await c.query(
        `INSERT INTO patient (patient_id, name, age_at_registration, sex, patient_type, registered_on) VALUES ($1, $2, $3, $4, 'NON_STUDENT', $5)`,
        [n.patient_id, n.name, n.age_at_registration, n.sex, n.registered_on],
      );
      await c.query('INSERT INTO non_student (patient_id, phone_no, designation) VALUES ($1, $2, $3)', [n.patient_id, n.phone_no, n.designation]);
    }
  });
  log(`postgres: ${dataset.branches.length} branches, ${dataset.users.length} users, ${dataset.students.length} students, ${dataset.nonStudents.length} non-students`);

  const col = mongoDb.collection('visits');
  const docs = dataset.visits.map(({ recorded_by_username, ...doc }) => ({ ...doc, recorded_by: userIds.get(recorded_by_username) }));
  for (let i = 0; i < docs.length; i += 1000) await col.insertMany(docs.slice(i, i + 1000), { ordered: false });
  log(`mongo: ${docs.length} visits (${dataset.window.from} .. ${dataset.window.to})`);
}

async function main(argv) {
  if (argv.includes('--help')) { console.error('Usage: node seed/seed.js [--reset] [--end YYYY-MM-DD] [--seed N] [--visits N]'); return 1; }
  if (process.env.NODE_ENV === 'production') { console.error('refusing to load synthetic data with NODE_ENV=production'); return 1; }
  const dataset = generateDataset({
    seed: Number(arg(argv, '--seed', DEFAULT_SEED)), end: arg(argv, '--end', istDateString(new Date())), visits: Number(arg(argv, '--visits', 6000)),
  });
  const conn = await connectAll();
  try {
    const existing = Number((await conn.pgPool.query('SELECT COUNT(*) AS n FROM patient')).rows[0].n);
    if (argv.includes('--reset')) {
      console.log('--reset: wiping patients, users, branches, audit_log and all visits');
      await conn.pgPool.query('TRUNCATE audit_log, student_rfid, student, non_student, patient, users, branch RESTART IDENTITY CASCADE');
      await conn.mongoDb.collection('visits').deleteMany({});
    } else if (existing > 0) {
      console.error(`database already holds ${existing} patients; re-run with --reset to wipe and reload`);
      return 1;
    }
    const { default: bcrypt } = await import('bcryptjs');
    await loadDataset({ pgPool: conn.pgPool, mongoDb: conn.mongoDb, dataset, hash: (pw) => bcrypt.hash(pw, BCRYPT_ROUNDS), log: console.log });
    console.log('done. login: admin/admin123 (ADMIN) or staff/staff123 (STAFF) - development only');
    return 0;
  } finally {
    await conn.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(`error: ${e.message}`); process.exitCode = 1; });
}
