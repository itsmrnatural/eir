// Connection helper for the command-line scripts (the server builds its own connections).
// Environment: DATABASE_URL, MONGO_URL, MONGO_DB (default health_centre)  - see .env.example
import { createRepositories } from '../repositories/pg-mongo/index.js';

export async function connectAll({
  databaseUrl = process.env.DATABASE_URL, mongoUrl = process.env.MONGO_URL, mongoDbName = process.env.MONGO_DB || 'health_centre',
  needMongo = true,
} = {}) {
  if (!databaseUrl) throw new Error('DATABASE_URL is not set (see db/.env.example)');
  if (needMongo && !mongoUrl) throw new Error('MONGO_URL is not set (see db/.env.example)');
  const { default: pg } = await import('pg');
  const pgPool = new pg.Pool({ connectionString: databaseUrl });
  let mongoClient = null;
  let mongoDb = null;
  if (needMongo) {
    const { MongoClient } = await import('mongodb');
    mongoClient = new MongoClient(mongoUrl);
    await mongoClient.connect();
    mongoDb = mongoClient.db(mongoDbName);
  }
  return {
    pgPool, mongoClient, mongoDb,
    repos: needMongo ? createRepositories({ pgPool, mongoDb }) : null,
    async close() { await pgPool.end(); if (mongoClient) await mongoClient.close(); },
  };
}
