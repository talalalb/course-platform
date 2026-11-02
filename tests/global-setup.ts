import { rm } from 'node:fs/promises';
import { runMigrations } from '../scripts/migrate';
import { TEST_DATABASE_URL, TEST_STORAGE_DIR } from './env';

/** Runs once: brings the test database schema up to date and clears test files. */
export default async function setup() {
  await runMigrations(TEST_DATABASE_URL);
  await rm(TEST_STORAGE_DIR, { recursive: true, force: true });
}
