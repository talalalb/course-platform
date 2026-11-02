import path from 'node:path';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://course:course@127.0.0.1:5432/course_platform_test';
export const TEST_STORAGE_DIR = path.resolve(process.cwd(), 'storage-test');

export function applyTestEnv() {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.STORAGE_DIR = TEST_STORAGE_DIR;
  process.env.APP_URL = 'http://localhost:3000';
  process.env.APP_TIMEZONE = 'Asia/Riyadh';
  process.env.APP_ENV = 'test';
}
