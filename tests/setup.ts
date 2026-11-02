import { afterAll } from 'vitest';
import { applyTestEnv } from './env';

applyTestEnv();

afterAll(async () => {
  const { getPool } = await import('@/lib/db');
  await getPool().end();
  (globalThis as { __coursePool?: unknown; __courseDb?: unknown }).__coursePool = undefined;
  (globalThis as { __coursePool?: unknown; __courseDb?: unknown }).__courseDb = undefined;
});
