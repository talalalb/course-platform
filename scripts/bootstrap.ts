/**
 * Runs at every start (after migrations). Safe to run many times:
 * - LOAD_DEMO_DATA=true + DEMO_PASSWORD: loads the fictional demo data, only into an empty database and never
 *   when APP_ENV=production. Meant for a trial site.
 * - ADMIN_EMAIL + ADMIN_PASSWORD (+ ADMIN_NAME): creates the first admin if that e-mail has no account yet.
 *   An existing account is never changed (use `npm run create-admin` to reset a password on purpose).
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, getPool } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { hashPassword, PASSWORD_MIN_LENGTH } from '@/lib/auth/password';
import { loadDemoData } from './seed';

async function main() {
  if (process.env.LOAD_DEMO_DATA === 'true') {
    const password = process.env.DEMO_PASSWORD ?? '';
    if (process.env.APP_ENV === 'production') {
      console.log('[bootstrap] LOAD_DEMO_DATA is ignored because APP_ENV=production.');
    } else if (password.length < PASSWORD_MIN_LENGTH) {
      console.log(`[bootstrap] Set DEMO_PASSWORD (at least ${PASSWORD_MIN_LENGTH} characters) to load the demo data.`);
    } else if ((await db.$count(users)) > 0) {
      console.log('[bootstrap] Demo data skipped: the database already has accounts.');
    } else {
      await loadDemoData(password);
      console.log('[bootstrap] Demo data loaded (accounts: admin@demo.test, khalid@demo.test, abdullah@demo.test, ...).');
    }
  }

  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? '';
  if (email && adminPassword) {
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (existing) {
      console.log(`[bootstrap] Admin account ${email} already exists; not changed.`);
    } else if (adminPassword.length < PASSWORD_MIN_LENGTH || !email.includes('@')) {
      console.log(`[bootstrap] ADMIN_EMAIL / ADMIN_PASSWORD invalid (password needs ${PASSWORD_MIN_LENGTH}+ characters); admin not created.`);
    } else {
      await db.insert(users).values({
        email,
        name: (process.env.ADMIN_NAME ?? '').trim() || 'مدير المنصة',
        passwordHash: await hashPassword(adminPassword),
        role: 'admin',
      });
      console.log(`[bootstrap] Admin account ${email} created.`);
    }
  }
}

main()
  .catch((err) => {
    // Never block the site from starting because of the optional bootstrap.
    console.error('[bootstrap] failed:', err);
  })
  .finally(() => getPool().end());
