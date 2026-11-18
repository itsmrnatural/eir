import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { createTestRepositories } from './repos.js';

export const API = '/api/v1';
export const SECRET = 'test-secret-test-secret-test-secret-123';
export const PASSWORDS = { admin: 'admin-test-pass-1', staff: 'staff-test-pass-1' };
export const SEED = {
  rfid: 'TESTRFID0001',
  studentRoll: '251210001', // YY P BBB SSS -> synthetic
  student2Rfid: 'TESTRFID0002',
};

/** Uses only the repository interface, so it works with db's in-memory repositories. */
export async function seed(repos) {
  const hash = (pw) => bcrypt.hashSync(pw, 4); // cheap cost factor: tests only
  await repos.users.create({ username: 'admin', password_hash: hash(PASSWORDS.admin), role: 'ADMIN' });
  await repos.users.create({ username: 'staff', password_hash: hash(PASSWORDS.staff), role: 'STAFF' });

  const branches = await repos.meta.listBranches();
  const cse = branches.find((b) => b.branch_code === '210');
  await repos.patients.createStudent({
    name: 'Test Student One', dob: '2005-03-14', sex: 'F', roll_no: SEED.studentRoll,
    batch_year: 2025, program: 'UG', branch_id: cse.branch_id, rfid_id: SEED.rfid,
  });
  await repos.patients.createStudent({
    name: 'Test Student Two', dob: '2004-11-02', sex: 'M', roll_no: '241210002',
    batch_year: 2024, program: 'UG', branch_id: cse.branch_id, rfid_id: SEED.student2Rfid,
  });
  return { cseBranchId: cse.branch_id };
}

export async function login(app, username) {
  const res = await request(app).post(`${API}/auth/login`).send({ username, password: PASSWORDS[username] });
  if (res.status !== 200) throw new Error(`test login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body; // { token, user }
}

/**
 * Builds an app over fresh, seeded repositories.
 * @param {object} [opts]
 * @param {object} [opts.env]        extra env for loadConfig (e.g. LOGIN_RATE_LIMIT_MAX)
 * @param {object} [opts.fhir]       replace the FHIR mapper
 * @param {object} [opts.logStream]  capture log output (object with write())
 */
export async function buildHarness({ env = {}, fhir, logStream, wrapRepos } = {}) {
  let repos = createTestRepositories();
  const seeded = await seed(repos);
  if (wrapRepos) repos = wrapRepos(repos);

  const config = loadConfig({ JWT_SECRET: SECRET, NODE_ENV: 'test', LOG_LEVEL: 'silent', ...env });
  const logger = logStream
    ? createLogger({ level: 'info', stream: logStream })
    : createLogger({ level: 'silent' });
  const app = createApp({ repos, config, logger, ...(fhir ? { fhir } : {}) });

  const admin = await login(app, 'admin');
  const staff = await login(app, 'staff');
  const student = await repos.patients.findByRfid(SEED.rfid);
  const student2 = await repos.patients.findByRfid(SEED.student2Rfid);
  const issues = await repos.meta.listHealthIssues(); // tests never hard-code issue names

  const as = (who) => (who === 'admin' ? admin.token : who === 'staff' ? staff.token : null);
  /** api('staff').get('/meta/branches') */
  const api = (who) => {
    const token = as(who);
    const call = (method) => (path) => {
      const r = request(app)[method](`${API}${path}`);
      return token ? r.set('Authorization', `Bearer ${token}`) : r;
    };
    return { get: call('get'), post: call('post'), patch: call('patch'), delete: call('delete'), put: call('put') };
  };

  return { app, repos, config, admin, staff, student, student2, issues, api, ...seeded };
}

export function expectError(res, status, code) {
  if (res.status !== status || res.body?.error?.code !== code) {
    throw new Error(`expected ${status} ${code}, got ${res.status} ${JSON.stringify(res.body)}`);
  }
  const e = res.body.error;
  if (typeof e.message !== 'string' || typeof e.details !== 'object' || e.details === null) {
    throw new Error(`error envelope is malformed: ${JSON.stringify(res.body)}`);
  }
}
