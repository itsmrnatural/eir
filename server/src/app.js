import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';

import { loadConfig } from './config.js';
import { AppError } from './errors.js';
import { createLogger, sanitizeUrl } from './logger.js';
import { createAuth } from './middleware/auth.js';
import { validate } from './middleware/validate.js';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createServices } from './services/index.js';
import * as defaultFhir from './adapters/fhir.js';
import { authRouter } from './routes/auth.js';
import { patientsRouter } from './routes/patients.js';
import { visitsRouter } from './routes/visits.js';
import { reportsRouter } from './routes/reports.js';
import { metaRouter } from './routes/meta.js';
import { exportRouter } from './routes/export.js';

/**
 * @param {object}  deps
 * @param {object}  deps.repos     repository interface; the only way the server touches data
 * @param {object} [deps.config]   defaults to loadConfig() (reads process.env)
 * @param {object} [deps.logger]   pino logger
 * @param {object} [deps.fhir]     pure FHIR mapper; defaults to ./adapters/fhir.js
 */
export function createApp(deps = {}) {
  const { repos, fhir = defaultFhir } = deps;
  if (!repos) throw new Error('createApp({ repos }) requires a repository object (see the API contract)');
  const config = deps.config ?? loadConfig();
  const log = deps.logger ?? createLogger({ level: config.logLevel });

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.set('query parser', 'simple');
  app.set('trust proxy', config.trustProxy);

  /* ---- request logging (no bodies, no tokens, no phone/RFID values) ---- */
  app.use(
    pinoHttp({
      logger: log,
      genReqId: (req) => {
        const incoming = req.headers['x-request-id'];
        return typeof incoming === 'string' && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomUUID();
      },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: sanitizeUrl(req.originalUrl ?? req.url) }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      customProps: (req) => (req.user ? { user_id: req.user.user_id } : {}),
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      autoLogging: { ignore: (req) => req.url === '/healthz' },
    }),
  );
  app.use((req, res, next) => {
    res.setHeader('X-Request-Id', String(req.id));
    next();
  });

  /* ---- hardening ---- */
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: config.corsOrigins.includes('*') ? '*' : config.corsOrigins,
      methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['X-Request-Id', 'Retry-After'],
      maxAge: 600,
    }),
  );

  // Liveness only (no database access). Used by the Docker HEALTHCHECK.
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

  /* ---- wiring ---- */
  const services = createServices({ repos, config, fhir });
  const auth = createAuth({ repos, config });

  // Counts failed logins only (successful ones are skipped) per client IP. A throttled
  // login answers 429 RATE_LIMITED with Retry-After, using the standard error envelope.
  const loginLimiter = rateLimit({
    windowMs: config.loginRateLimit.windowMs,
    limit: config.loginRateLimit.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (req, res, next) => {
      const reset = req.rateLimit?.resetTime;
      const retryAfter = reset
        ? Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000))
        : Math.ceil(config.loginRateLimit.windowMs / 1000);
      res.set('Retry-After', String(retryAfter));
      next(
        new AppError('RATE_LIMITED', 'Too many failed login attempts. Please try again later.', {
          retry_after_seconds: retryAfter,
        }),
      );
    },
  });

  const ctx = { services, auth, validate };
  const api = express.Router();
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store'); // patient data must never be cached
    next();
  });
  api.use(express.json({ limit: config.bodyLimit }));
  api.use((req, _res, next) => {
    // req.is() returns false only when a body is present but is not JSON.
    if ((req.method === 'POST' || req.method === 'PATCH') && req.is('json') === false) {
      return next(new AppError('VALIDATION_ERROR', 'Content-Type must be application/json'));
    }
    return next();
  });
  api.use('/auth', authRouter({ ...ctx, loginLimiter }));
  api.use('/patients', patientsRouter(ctx));
  api.use('/visits', visitsRouter(ctx));
  api.use('/reports', reportsRouter(ctx));
  api.use('/meta', metaRouter(ctx));
  api.use('/export', exportRouter(ctx));
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(createErrorHandler(log));
  return app;
}
