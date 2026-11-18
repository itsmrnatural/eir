import { z } from 'zod';

const DEFAULT_CORS_ORIGIN = 'http://localhost:5173,http://localhost:8080';

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  JWT_SECRET: z.string({ required_error: 'JWT_SECRET is required' }).min(1, 'JWT_SECRET is required'),
  CORS_ORIGIN: z.string().default(DEFAULT_CORS_ORIGIN),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Number of reverse-proxy hops to trust for client IP (rate limiting). 'false' = trust none.
  TRUST_PROXY: z.string().default('false'),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  LOGIN_RATE_LIMIT_WINDOW_MIN: z.coerce.number().positive().default(15),
  // 'real' = PostgreSQL + MongoDB via ../../db ; 'memory' = createInMemoryRepositories() (dev only)
  REPOS: z.enum(['real', 'memory']).default('real'),
  DATABASE_URL: z.string().optional(),
  MONGO_URL: z.string().optional(),
  MONGO_DB: z.string().default('health_centre'),
});

function parseTrustProxy(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v; // e.g. 'loopback' or a subnet list, passed straight to Express
}

/**
 * Read and validate configuration from environment variables.
 * Throws a single readable Error if something is wrong.
 */
export function loadConfig(env = process.env) {
  // Treat empty strings (e.g. `PORT=` in a compose file) as "unset".
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ''),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  if (isProduction && e.JWT_SECRET.length < 16) {
    throw new Error('Invalid configuration: JWT_SECRET must be at least 16 characters in production');
  }

  return Object.freeze({
    env: e.NODE_ENV,
    isProduction,
    port: e.PORT,
    jwtSecret: e.JWT_SECRET,
    jwtExpiresIn: '1h',
    corsOrigins: e.CORS_ORIGIN.split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    logLevel: e.LOG_LEVEL,
    loginRateLimit: {
      max: e.LOGIN_RATE_LIMIT_MAX,
      windowMs: Math.round(e.LOGIN_RATE_LIMIT_WINDOW_MIN * 60 * 1000),
    },
    bodyLimit: '100kb',
    reposMode: e.REPOS,
    databaseUrl: e.DATABASE_URL,
    mongoUrl: e.MONGO_URL,
    mongoDb: e.MONGO_DB,
  });
}
