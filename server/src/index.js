/**
 * Process entry point. This is the only file in server/ that imports `pg` or `mongodb`:
 * it builds the repositories via createRepositories() from ../../db and hands them to
 * createApp({ repos }). Everything else sees the repository interface.
 */
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createApp } from './app.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(label, fn, logger, { attempts = 15, delayMs = 2000 } = {}) {
  for (let i = 1; ; i += 1) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      logger.warn({ attempt: i, of: attempts }, `${label} not ready yet, retrying`);
      await sleep(delayMs);
    }
  }
}

async function importDb() {
  try {
    // ESM cannot import a bare directory, so the entry file is named explicitly (see ASSUMPTIONS.md).
    return await import('../../db/index.js');
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' && String(err.message).includes('/db/')) {
      throw new Error('Cannot load ../../db/index.js. Is db/ present and are its dependencies installed?');
    }
    throw err;
  }
}

async function buildRepos(config, logger) {
  const db = await importDb();

  if (config.reposMode === 'memory') {
    logger.warn('REPOS=memory: using in-memory repositories. Development only; data is lost on restart.');
    return { repos: db.createInMemoryRepositories(), close: async () => {} };
  }

  if (!config.databaseUrl) throw new Error('Invalid configuration: DATABASE_URL is required when REPOS=real');
  if (!config.mongoUrl) throw new Error('Invalid configuration: MONGO_URL is required when REPOS=real');

  const { default: pg } = await import('pg');
  const { MongoClient } = await import('mongodb');

  const pgPool = new pg.Pool({ connectionString: config.databaseUrl });
  const mongoClient = new MongoClient(config.mongoUrl);

  await withRetry('PostgreSQL', async () => (await pgPool.connect()).release(), logger);
  await withRetry('MongoDB', () => mongoClient.connect(), logger);

  const repos = db.createRepositories({ pgPool, mongoDb: mongoClient.db(config.mongoDb) });
  return {
    repos,
    close: async () => {
      await Promise.allSettled([pgPool.end(), mongoClient.close()]);
    },
  };
}

async function main() {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });
  const { repos, close } = await buildRepos(config, logger);
  const app = createApp({ repos, config, logger });

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env, repos: config.reposMode }, 'server listening');
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => {
      logger.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);
    force.unref();
    app.locals.demoTapHub?.closeAll(); // open demo streams would otherwise hold shutdown until the force timeout
    server.close(async (err) => {
      try {
        await close();
      } catch (e) {
        logger.error({ err: e }, 'error while closing database connections');
      }
      process.exit(err ? 1 : 0);
    });
    server.closeIdleConnections?.();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
    shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    process.exit(1);
  });
}

main().catch((err) => {
  // Logger may not exist yet (bad config), so write plainly. Never include secrets here.
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
