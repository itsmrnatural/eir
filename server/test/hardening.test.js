import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { API, PASSWORDS, SEED, buildHarness, expectError } from './helpers.js';
import { createApp } from '../src/app.js';

describe('createApp', () => {
  it('refuses to start without repositories', () => {
    expect(() => createApp({})).toThrow(/repos/);
  });
});

describe('security headers, caching and request ids', () => {
  it('sets helmet headers, hides x-powered-by and forbids caching of API responses', async () => {
    const h = await buildHarness();
    const res = await h.api('staff').get('/meta/branches');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns an X-Request-Id and echoes a sane client-supplied one', async () => {
    const h = await buildHarness();
    const generated = await h.api('staff').get('/meta/branches');
    expect(generated.headers['x-request-id']).toMatch(/^[\w-]{8,}$/);
    const echoed = await h.api('staff').get('/meta/branches').set('X-Request-Id', 'req-abc-123');
    expect(echoed.headers['x-request-id']).toBe('req-abc-123');
  });

  it('GET /healthz is public and does not touch the repositories', async () => {
    const h = await buildHarness();
    const res = await request(h.app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('CORS (from CORS_ORIGIN)', () => {
  it('allows a configured origin, including the preflight', async () => {
    const h = await buildHarness({ env: { CORS_ORIGIN: 'https://hc.example.test, http://localhost:5173' } });
    const pre = await request(h.app)
      .options(`${API}/visits`)
      .set('Origin', 'https://hc.example.test')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('https://hc.example.test');
    expect(pre.headers['access-control-allow-headers'].toLowerCase()).toContain('authorization');
  });

  it('does not grant access to other origins', async () => {
    const h = await buildHarness({ env: { CORS_ORIGIN: 'https://hc.example.test' } });
    const res = await request(h.app).get(`${API}/meta/branches`).set('Origin', 'https://evil.example.test');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('central error handler', () => {
  it('malformed JSON -> 400 VALIDATION_ERROR', async () => {
    const h = await buildHarness();
    const res = await request(h.app).post(`${API}/auth/login`).set('Content-Type', 'application/json').send('{"username": ');
    expectError(res, 400, 'VALIDATION_ERROR');
  });

  it('non-JSON body on POST -> 400 VALIDATION_ERROR', async () => {
    const h = await buildHarness();
    const res = await request(h.app).post(`${API}/auth/login`).set('Content-Type', 'text/plain').send('username=admin');
    expectError(res, 400, 'VALIDATION_ERROR');
  });

  it('oversized body -> 400 VALIDATION_ERROR', async () => {
    const h = await buildHarness();
    const res = await request(h.app).post(`${API}/auth/login`).send({ username: 'a', password: 'x'.repeat(200_000) });
    expectError(res, 400, 'VALIDATION_ERROR');
  });

  it('unknown route -> 404 NOT_FOUND in the error envelope', async () => {
    const h = await buildHarness();
    expectError(await request(h.app).get(`${API}/nope`), 404, 'NOT_FOUND');
    expectError(await request(h.app).get('/nope'), 404, 'NOT_FOUND');
  });

  it('unexpected exceptions -> 500 INTERNAL with a generic message (no leak)', async () => {
    const h = await buildHarness();
    vi.spyOn(h.repos.meta, 'listBranches').mockRejectedValue(new Error('password=hunter2 connect ECONNREFUSED 10.0.0.5:5432'));
    const res = await h.api('staff').get('/meta/branches');
    expectError(res, 500, 'INTERNAL');
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|ECONNREFUSED|10\.0\.0\.5/);
  });

  it('401 responses carry WWW-Authenticate: Bearer', async () => {
    const h = await buildHarness();
    const res = await h.api(null).get('/auth/me');
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });
});

describe('logging never contains credentials or patient identifiers', () => {
  it('keeps passwords, tokens, phone numbers, RFID tags and search terms out of the logs', async () => {
    const lines = [];
    const h = await buildHarness({ logStream: { write: (chunk) => lines.push(String(chunk)) } });

    const login = await request(h.app).post(`${API}/auth/login`).send({ username: 'admin', password: PASSWORDS.admin });
    await request(h.app).post(`${API}/auth/login`).send({ username: 'admin', password: 'wrong-password-xyz' });
    const token = login.body.token;
    await request(h.app).get(`${API}/patients/by-phone/9000000001`).set('Authorization', `Bearer ${token}`);
    await request(h.app).get(`${API}/patients/by-rfid/${SEED.rfid}`).set('Authorization', `Bearer ${token}`);
    await request(h.app).get(`${API}/patients?q=Secret%20Search%20Term`).set('Authorization', `Bearer ${token}`);
    await new Promise((r) => setTimeout(r, 50)); // let pino-http flush on 'finish'

    const all = lines.join('\n');
    expect(all.length).toBeGreaterThan(0);
    for (const secret of [PASSWORDS.admin, 'wrong-password-xyz', token, '9000000001', SEED.rfid, 'Secret', 'Search%20Term']) {
      expect(all.includes(secret), `log leaked ${secret}`).toBe(false);
    }
    expect(all).toContain('/by-phone/:phone_no');
    expect(all).toContain('/by-rfid/:rfid_id');
    expect(all).toContain('"statusCode":200');
  });
});
