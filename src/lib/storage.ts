/**
 * File storage behind a tiny interface, so the local-disk driver used now can be swapped for
 * S3-compatible storage later without touching the rest of the app. The database stores only keys.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

function storageRoot(): string {
  return path.resolve(process.env.STORAGE_DIR ?? './storage');
}

function resolveKey(key: string): string {
  if (!/^[a-z0-9/_.-]+$/i.test(key) || key.includes('..') || key.startsWith('/')) {
    throw new Error('Invalid storage key');
  }
  const root = storageRoot();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage key');
  return full;
}

export const localStorage: Storage = {
  async put(key, data) {
    const full = resolveKey(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { flag: 'wx' });
  },
  async get(key) {
    return readFile(resolveKey(key));
  },
  async remove(key) {
    await rm(resolveKey(key), { force: true });
  },
};

export const storage: Storage = localStorage;

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
