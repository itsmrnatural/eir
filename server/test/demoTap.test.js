/**
 * Demo only feature: a phone posts a card id, open app screens receive it over Server-Sent Events.
 * Real sockets are used for the stream tests (supertest cannot hold a stream open).
 */
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { buildHarness, expectError, SECRET } from './helpers.js';

const KEY = 'demo-key-0123456789';
const DEMO_ENV = { DEMO_TAP: '1', DEMO_TAP_KEY: KEY };
const TAP = '/api/v1/demo/tap';

const servers = [];
const streams = [];
afterEach(async () => {
  streams.splice(0).forEach((s) => s.close());
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  servers.push(server);
  return server.address().port;
}

/** Opens GET /api/v1/demo/tap/stream and collects parsed SSE frames. */
function openStream(port, key) {
  return new Promise((resolve, reject) => {
    const frames = [];
    const waiters = [];
    let buffer = '';
    const req = http.get({ host: '127.0.0.1', port, path: `${TAP}/stream?key=${encodeURIComponent(key)}` }, (res) => {
      const api = {
        status: res.statusCode,
        headers: res.headers,
        frames,
        close: () => req.destroy(),
        next: (event) =>
          new Promise((ok, fail) => {
            const hit = frames.find((f) => f.event === event && !f.seen);
            if (hit) { hit.seen = true; return ok(hit); }
            const t = setTimeout(() => fail(new Error(`no "${event}" frame within 2s`)), 2000);
            waiters.push({ event, ok: (f) => { clearTimeout(t); ok(f); } });
            return undefined;
          }),
        body: '',
      };
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        api.body += chunk;
        buffer += chunk;
        let i;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(raw)?.[1];
          const data = /^data: (.+)$/m.exec(raw)?.[1];
          if (!ev) continue;
          const frame = { event: ev, data: data ? JSON.parse(data) : null };
          const w = waiters.findIndex((x) => x.event === ev);
          if (w >= 0) { frame.seen = true; waiters.splice(w, 1)[0].ok(frame); }
          frames.push(frame);
        }
      });
      streams.push(api);
      resolve(api);
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
  });
}

describe('demo tap relay: off by default', () => {
  it('is not mounted unless DEMO_TAP=1', async () => {
    const h = await buildHarness();
    expectError(await request(h.app).post(TAP).set('X-Demo-Key', KEY).send({ rfid_id: 'ABC' }), 404, 'NOT_FOUND');
    expectError(await request(h.app).get(`${TAP}/stream?key=${KEY}`), 404, 'NOT_FOUND');
    expect((await request(h.app).get('/demo/')).status).toBe(404);
    expect(h.app.locals.demoTapHub).toBeUndefined();
  });

  it('refuses to start with DEMO_TAP=1 and a missing or short key', () => {
    const base = { JWT_SECRET: SECRET, NODE_ENV: 'test' };
    expect(() => loadConfig({ ...base, DEMO_TAP: '1' })).toThrow(/DEMO_TAP_KEY/);
    expect(() => loadConfig({ ...base, DEMO_TAP: '1', DEMO_TAP_KEY: 'short' })).toThrow(/DEMO_TAP_KEY/);
    expect(loadConfig({ ...base, DEMO_TAP: '0' }).demoTap).toEqual({ enabled: false, key: undefined });
    expect(loadConfig({ ...base, DEMO_TAP: 'true', DEMO_TAP_KEY: KEY }).demoTap).toEqual({ enabled: true, key: KEY });
  });
});

describe('demo tap relay: POST /demo/tap', () => {
  it('rejects a missing or wrong key with 401 and never needs a login', async () => {
    const h = await buildHarness({ env: DEMO_ENV });
    expectError(await request(h.app).post(TAP).send({ rfid_id: 'ABC' }), 401, 'UNAUTHENTICATED');
    expectError(await request(h.app).post(TAP).set('X-Demo-Key', 'nope').send({ rfid_id: 'ABC' }), 401, 'UNAUTHENTICATED');
    // a staff JWT is not the demo key
    expectError(await request(h.app).post(TAP).set('Authorization', `Bearer ${h.staff.token}`).send({ rfid_id: 'ABC' }), 401, 'UNAUTHENTICATED');
  });

  it('accepts the key and reports how many screens received the tap (none yet)', async () => {
    const h = await buildHarness({ env: DEMO_ENV });
    const res = await request(h.app).post(TAP).set('X-Demo-Key', KEY).send({ rfid_id: '04:a1:2b:3c:4d:5e:80' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ delivered: 0 });
  });

  it('checks the key before the body, then validates the body strictly', async () => {
    const h = await buildHarness({ env: DEMO_ENV });
    expectError(await request(h.app).post(TAP).set('X-Demo-Key', 'nope').send({ rfid_id: '<script>' }), 401, 'UNAUTHENTICATED');
    const post = (body) => request(h.app).post(TAP).set('X-Demo-Key', KEY).send(body);
    expectError(await post({}), 400, 'VALIDATION_ERROR');
    expectError(await post({ rfid_id: '' }), 400, 'VALIDATION_ERROR');
    expectError(await post({ rfid_id: 'has space' }), 400, 'VALIDATION_ERROR');
    expectError(await post({ rfid_id: '<img src=x>' }), 400, 'VALIDATION_ERROR');
    expectError(await post({ rfid_id: 'A'.repeat(65) }), 400, 'VALIDATION_ERROR');
    expectError(await post({ rfid_id: 'ABC', extra: 1 }), 400, 'VALIDATION_ERROR');
  });

  it('throttles repeated wrong keys with 429 RATE_LIMITED but never blocks a correct key', async () => {
    const h = await buildHarness({ env: DEMO_ENV });
    for (let i = 0; i < 20; i += 1) {
      expectError(await request(h.app).post(TAP).set('X-Demo-Key', `wrong-${i}`).send({ rfid_id: 'ABC' }), 401, 'UNAUTHENTICATED');
    }
    expectError(await request(h.app).post(TAP).set('X-Demo-Key', 'wrong-again').send({ rfid_id: 'ABC' }), 429, 'RATE_LIMITED');
  });
});

describe('demo tap relay: stream', () => {
  it('rejects a bad key and does not open a stream', async () => {
    const h = await buildHarness({ env: DEMO_ENV });
    const port = await listen(h.app);
    const s = await openStream(port, 'nope');
    expect(s.status).toBe(401);
    expect(h.app.locals.demoTapHub.size).toBe(0);
  });

  it('delivers a tap from POST to every open stream', async () => {
    const h = await buildHarness({ env: DEMO_ENV });
    const port = await listen(h.app);

    const a = await openStream(port, KEY);
    const b = await openStream(port, KEY);
    expect(a.status).toBe(200);
    expect(a.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(a.headers['cache-control']).toMatch(/no-cache/);
    await a.next('hello');
    await b.next('hello');
    expect(h.app.locals.demoTapHub.size).toBe(2);

    const res = await request(`http://127.0.0.1:${port}`).post(TAP).set('X-Demo-Key', KEY).send({ rfid_id: '04:a1:2b:3c' });
    expect(res.body).toEqual({ delivered: 2 });

    for (const s of [a, b]) {
      const tap = await s.next('tap');
      expect(tap.data.rfid_id).toBe('04:a1:2b:3c');
      expect(Number.isNaN(Date.parse(tap.data.at))).toBe(false);
    }
  });

  it('forgets a screen when it disconnects', async () => {
    const h = await buildHarness({ env: DEMO_ENV });
    const port = await listen(h.app);
    const a = await openStream(port, KEY);
    await a.next('hello');
    expect(h.app.locals.demoTapHub.size).toBe(1);
    a.close();
    await new Promise((r) => setTimeout(r, 150));
    expect(h.app.locals.demoTapHub.size).toBe(0);
    const res = await request(`http://127.0.0.1:${port}`).post(TAP).set('X-Demo-Key', KEY).send({ rfid_id: 'ABC' });
    expect(res.body).toEqual({ delivered: 0 });
  });

  it('closeAll() ends open streams so shutdown is not held up', async () => {
    const h = await buildHarness({ env: DEMO_ENV });
    const port = await listen(h.app);
    const a = await openStream(port, KEY);
    await a.next('hello');
    h.app.locals.demoTapHub.closeAll();
    await new Promise((r) => setTimeout(r, 150));
    expect(h.app.locals.demoTapHub.size).toBe(0);
  });

  it('caps the number of open screens', async () => {
    const h = await buildHarness({ env: DEMO_ENV });
    const port = await listen(h.app);
    const open = [];
    for (let i = 0; i < 20; i += 1) open.push(await openStream(port, KEY));
    const extra = await openStream(port, KEY);
    expect(extra.status).toBe(429);
  });
});

describe('demo tap relay: phone page', () => {
  it('serves the page and script with a CSP that works over plain http', async () => {
    const h = await buildHarness({ env: DEMO_ENV });
    const page = await request(h.app).get('/demo/');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.text).toContain('Phone card reader');
    expect(page.text).not.toMatch(/<script>[^<]/); // no inline script: the CSP forbids it
    const csp = page.headers['content-security-policy'];
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('upgrade-insecure-requests'); // would break http://<laptop-ip>:4000
    expect(page.headers['cache-control']).toBe('no-store');

    const js = await request(h.app).get('/demo/tap.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
  });

  it('does not expose other files or directory listings', async () => {
    const h = await buildHarness({ env: DEMO_ENV });
    expect((await request(h.app).get('/demo/../config.js')).status).toBe(404);
    expect((await request(h.app).get('/demo/.env')).status).toBe(404);
  });
});

describe('demo tap relay: privacy', () => {
  it('keeps the demo key and card ids out of the access log', async () => {
    const lines = [];
    const h = await buildHarness({ env: DEMO_ENV, logStream: { write: (l) => lines.push(l) } });
    const port = await listen(h.app);
    const s = await openStream(port, KEY);
    await s.next('hello');
    await request(`http://127.0.0.1:${port}`).post(TAP).set('X-Demo-Key', KEY).send({ rfid_id: 'SECRETCARD99' });
    s.close();
    await new Promise((r) => setTimeout(r, 200));
    const log = lines.join('');
    expect(log).toContain('/api/v1/demo/tap'); // requests are logged ...
    expect(log).not.toContain(KEY); // ... without the key (query strings are stripped)
    expect(log).not.toContain('SECRETCARD99');
  });
});
