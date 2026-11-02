/**
 * Creates the first admin account (or resets an existing admin's password).
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-password' ADMIN_NAME='اسمك' npm run create-admin
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { getPool } from '@/lib/db';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { hashPassword, PASSWORD_MIN_LENGTH } from '@/lib/auth/password';

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';
  const name = (process.env.ADMIN_NAME ?? '').trim() || 'مدير المنصة';
  if (!email || !email.includes('@')) throw new Error('Set ADMIN_EMAIL');
  if (password.length < PASSWORD_MIN_LENGTH) throw new Error(`ADMIN_PASSWORD must be at least ${PASSWORD_MIN_LENGTH} characters`);

  const passwordHash = await hashPassword(password);
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    if (existing.role !== 'admin') throw new Error('This e-mail belongs to a non-admin account');
    await db.update(users).set({ passwordHash, isActive: true, name }).where(eq(users.id, existing.id));
    console.log(`Admin ${email} updated.`);
  } else {
    await db.insert(users).values({ email, name, passwordHash, role: 'admin' });
    console.log(`Admin ${email} created.`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
