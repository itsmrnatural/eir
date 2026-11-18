import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { API, SECRET, PASSWORDS, buildHarness, expectError } from './helpers.js';

const login = (app, body) => request(app).post(`${API}/auth/login`).send(body);

describe('POST /auth/login', () => {
  it('returns a 1-hour JWT and the user (never the hash)', async () => {
    const { app } = await buildHarness();
    const res = await login(app, { username: 'admin', password: PASSWORDS.admin });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toMatchObject({ username: 'admin', role: 'ADMIN' });
    expect(res.body.user.user_id).toBeDefined();
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    const claims = jwt.verify(res.body.token, SECRET);
    expect(claims.exp - claims.iat).toBe(3600);
  });

  it('401 UNAUTHENTICATED for a wrong password and for an unknown user, with the same message', async () => {
    const { app } = await buildHarness();
    const wrong = await login(app, { username: 'admin', password: 'nope' });
    const unknown = await login(app, { username: 'ghost', password: 'nope' });
    expectError(wrong, 401, 'UNAUTHENTICATED');
    expectError(unknown, 401, 'UNAUTHENTICATED');
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('400 VALIDATION_ERROR for missing fields and for unexpected fields', async () => {
    const { app } = await buildHarness();
    expectError(await login(app, { username: 'admin' }), 400, 'VALIDATION_ERROR');
    expectError(await login(app, {}), 400, 'VALIDATION_ERROR');
    expectError(await login(app, { username: 'admin', password: PASSWORDS.admin, role: 'ADMIN' }), 400, 'VALIDATION_ERROR');
  });

  it('rate-limits FAILED logins: 429 RATE_LIMITED + Retry-After, even for a correct password afterwards', async () => {
    const { app } = await buildHarness({ env: { LOGIN_RATE_LIMIT_MAX: '3' } });
    for (let i = 0; i < 3; i += 1) {
      expectError(await login(app, { username: 'admin', password: 'wrong' }), 401, 'UNAUTHENTICATED');
    }
    const blocked = await login(app, { username: 'admin', password: PASSWORDS.admin });
    expectError(blocked, 429, 'RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.body.error.details.retry_after_seconds).toBeGreaterThan(0);
  });

  it('does not count successful logins towards the limit', async () => {
    const { app } = await buildHarness({ env: { LOGIN_RATE_LIMIT_MAX: '2' } });
    for (let i = 0; i < 5; i += 1) {
      expect((await login(app, { username: 'staff', password: PASSWORDS.staff })).status).toBe(200);
    }
  });
});

describe('authentication middleware', () => {
  it('GET /auth/me returns the caller', async () => {
    const h = await buildHarness();
    const res = await h.api('staff').get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user_id: h.staff.user.user_id, username: 'staff', role: 'STAFF' });
  });

  it.each([
    ['no header', undefined],
    ['wrong scheme', 'Basic abc'],
    ['garbage token', 'Bearer not.a.jwt'],
  ])('401 for %s', async (_label, header) => {
    const { app } = await buildHarness();
    const r = request(app).get(`${API}/auth/me`);
    if (header) r.set('Authorization', header);
    expectError(await r, 401, 'UNAUTHENTICATED');
  });

  it('401 for an expired token', async () => {
    const h = await buildHarness();
    const token = jwt.sign(
      { username: 'admin', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) - 10 },
      SECRET,
      { subject: String(h.admin.user.user_id) },
    );
    const res = await request(h.app).get(`${API}/auth/me`).set('Authorization', `Bearer ${token}`);
    expectError(res, 401, 'UNAUTHENTICATED');
    expect(res.body.error.message).toMatch(/expired/i);
  });

  it('401 for a token signed with another secret and for alg=none', async () => {
    const h = await buildHarness();
    const sub = String(h.admin.user.user_id);
    const forged = jwt.sign({ username: 'admin', role: 'ADMIN' }, 'some-other-secret-some-other-secret', { subject: sub });
    expectError(await request(h.app).get(`${API}/auth/me`).set('Authorization', `Bearer ${forged}`), 401, 'UNAUTHENTICATED');

    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ username: 'admin', role: 'ADMIN', sub })}.`;
    expectError(await request(h.app).get(`${API}/auth/me`).set('Authorization', `Bearer ${none}`), 401, 'UNAUTHENTICATED');
  });

  it('uses the role in the database, not the one in the token (demotion is immediate)', async () => {
    const h = await buildHarness();
    const original = h.repos.users.findByUsername.bind(h.repos.users);
    vi.spyOn(h.repos.users, 'findByUsername').mockImplementation(async (u) => {
      const user = await original(u);
      return user && { ...user, role: 'STAFF' };
    });
    expectError(await h.api('admin').get('/reports/common-issues'), 403, 'FORBIDDEN');
  });

  it('401 once the account no longer exists', async () => {
    const h = await buildHarness();
    vi.spyOn(h.repos.users, 'findByUsername').mockResolvedValue(null);
    expectError(await h.api('staff').get('/auth/me'), 401, 'UNAUTHENTICATED');
  });
});
