import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __coursePool?: Pool; __courseDb?: Database };

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  return new Pool({ connectionString, max: 10 });
}

export function getPool(): Pool {
  if (!globalForDb.__coursePool) {
    globalForDb.__coursePool = createPool();
  }
  return globalForDb.__coursePool;
}

export function getDb(): Database {
  if (!globalForDb.__courseDb) {
    globalForDb.__courseDb = drizzle(getPool(), { schema });
  }
  return globalForDb.__courseDb;
}

/** Lazily-connected database instance (the pool is created on first use). */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});

export { schema };
