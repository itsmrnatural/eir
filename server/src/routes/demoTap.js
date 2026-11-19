/**
 * Demo only (switched on with DEMO_TAP=1 and a DEMO_TAP_KEY; absent otherwise).
 *
 *   POST /api/v1/demo/tap          phone -> server   body {rfid_id}, header X-Demo-Key
 *   GET  /api/v1/demo/tap/stream   server -> screens  Server-Sent Events, ?key=
 *   GET  /demo/                    the phone page (Web NFC reader), static files in ../demo
 *
 * These are not part of the API contract and are not in contract/openapi.yaml. They are protected
 * by a shared demo key instead of a login, because a phone page should not need a staff account.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { validate } from '../middleware/validate.js';

const tapBody = z
  .object({
    // Web NFC reports a serial like "04:a1:2b:3c:4d:5e:80". The student lookup upper-cases it.
    rfid_id: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9:_-]+$/, 'may only contain letters, digits, ":", "_" and "-"'),
  })
  .strict();

/** Constant-time comparison that also hides the length of the real key. */
function keyMatches(candidate, key) {
  if (typeof candidate !== 'string' || candidate === '') return false;
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(key).digest();
  return timingSafeEqual(a, b);
}

/** API part, mounted under /api/v1/demo */
export function demoTapRouter({ config, hub }) {
  const r = Router();

  // Wrong keys only (successful requests are skipped): stops key guessing, never blocks a working demo.
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_req, _res, next) => next(new AppError('RATE_LIMITED', 'Too many wrong demo keys. Wait a minute.')),
  });

  const requireKey = (read) => (req, _res, next) =>
    keyMatches(read(req), config.demoTap.key) ? next() : next(new AppError('UNAUTHENTICATED', 'Invalid demo key'));

  r.post(
    '/tap',
    limiter,
    requireKey((req) => req.get('x-demo-key')),
    validate({ body: tapBody }),
    (req, res) => {
      const delivered = hub.publish(req.valid.body.rfid_id);
      res.status(202).json({ delivered });
    },
  );

  r.get(
    '/tap/stream',
    limiter,
    requireKey((req) => req.query.key), // EventSource cannot send headers, so the key rides in the query
    (req, res, next) => {
      if (!hub.subscribe(req, res)) next(new AppError('RATE_LIMITED', 'Too many open demo screens'));
    },
  );

  return r;
}

// helmet's default CSP contains `upgrade-insecure-requests`, which would turn this page's own
// requests into https:// when it is opened over plain http://<laptop-ip>:4000 and break it.
// The page is static, has no inline script, and only talks to its own origin.
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Static phone page, mounted at /demo */
export function demoPageRouter() {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../demo');
  const r = Router();
  r.use((_req, res, next) => {
    res.set('Content-Security-Policy', PAGE_CSP);
    res.set('Cache-Control', 'no-store');
    next();
  });
  r.use(express.static(dir, { index: 'tap.html', etag: false, lastModified: false, dotfiles: 'ignore' }));
  return r;
}
