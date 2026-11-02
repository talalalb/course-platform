import { afterEach, describe, expect, it } from 'vitest';
import { databaseStorage, storage } from '@/lib/storage';

afterEach(() => {
  delete process.env.STORAGE_DRIVER;
});

describe('database file storage', () => {
  it('stores, reads and deletes files', async () => {
    const key = `submissions/2026/11/${crypto.randomUUID()}.png`;
    const data = Buffer.from([1, 2, 3, 250, 0, 7]);
    await databaseStorage.put(key, data);
    expect((await databaseStorage.get(key)).equals(data)).toBe(true);
    await databaseStorage.remove(key);
    await expect(databaseStorage.get(key)).rejects.toThrow();
  });

  it('is used when STORAGE_DRIVER=database, and rejects unsafe keys', async () => {
    process.env.STORAGE_DRIVER = 'database';
    const key = `attachments/2026/11/${crypto.randomUUID()}.pdf`;
    await storage.put(key, Buffer.from('%PDF-1.7'));
    expect((await databaseStorage.get(key)).toString()).toBe('%PDF-1.7');
    await expect(storage.put('../../etc/passwd', Buffer.from('x'))).rejects.toThrow();
    await storage.remove(key);
  });
});
