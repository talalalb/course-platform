/**
 * File storage behind a tiny interface, so the driver can change without touching the rest of the app.
 * The database only ever stores keys.
 *
 * STORAGE_DRIVER=local (default): files on disk under STORAGE_DIR — for a VPS / Docker volume.
 * STORAGE_DRIVER=database: files inside PostgreSQL — for hosts without a persistent disk (e.g. a free trial).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { storedFiles } from '@/lib/db/schema';

export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

function assertValidKey(key: string): void {
  if (!/^[a-z0-9/_.-]+$/i.test(key) || key.includes('..') || key.startsWith('/')) {
    throw new Error('Invalid storage key');
  }
}

function storageRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR ?? './storage');
}

function resolveKey(key: string): string {
  assertValidKey(key);
  const root = storageRoot();
  const full = path.resolve(/* turbopackIgnore: true */ root, key);
  if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage key');
  return full;
}

export const localStorage: Storage = {
  async put(key, data) {
    const full = resolveKey(key);
    await mkdir(/* turbopackIgnore: true */ path.dirname(full), { recursive: true });
    await writeFile(/* turbopackIgnore: true */ full, data, { flag: 'wx' });
  },
  async get(key) {
    return readFile(/* turbopackIgnore: true */ resolveKey(key));
  },
  async remove(key) {
    await rm(/* turbopackIgnore: true */ resolveKey(key), { force: true });
  },
};

export const databaseStorage: Storage = {
  async put(key, data) {
    assertValidKey(key);
    await db.insert(storedFiles).values({ key, data });
  },
  async get(key) {
    assertValidKey(key);
    const [row] = await db.select({ data: storedFiles.data }).from(storedFiles).where(eq(storedFiles.key, key)).limit(1);
    if (!row) throw new Error('File not found');
    return Buffer.from(row.data);
  },
  async remove(key) {
    assertValidKey(key);
    await db.delete(storedFiles).where(eq(storedFiles.key, key));
  },
};

function driver(): Storage {
  return process.env.STORAGE_DRIVER === 'database' ? databaseStorage : localStorage;
}

export const storage: Storage = {
  put: (key, data) => driver().put(key, data),
  get: (key) => driver().get(key),
  remove: (key) => driver().remove(key),
};

export function newStorageKey(prefix: 'submissions' | 'attachments', extension: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${prefix}/${yyyy}/${mm}/${randomUUID()}.${extension}`;
}

/** Best-effort removal; used after a database change has committed. */
export async function removeQuietly(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      try {
        await storage.remove(key);
      } catch (err) {
        console.error('Failed to remove stored file', key, err);
      }
    }),
  );
}
