import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { sessions, users } from '@/lib/db/schema';
import { verifyPassword } from '@/lib/auth/password';
import { createSessionRecord, findUserBySessionToken } from '@/lib/auth/sessions';
import { completePasswordReset, createPasswordReset, findUsableReset } from '@/lib/password-reset';
import { makeUser, resetDb } from './fixtures';

let admin: Awaited<ReturnType<typeof makeUser>>;
let student: Awaited<ReturnType<typeof makeUser>>;

beforeEach(async () => {
  await resetDb();
  admin = await makeUser('admin', 'Admin');
  student = await makeUser('student', 'Forgetful');
});

describe('password reset links', () => {
  it('sets a new password once, and signs the user out everywhere', async () => {
    const { token: sessionToken } = await createSessionRecord(student.id);
    const token = await createPasswordReset(student.id, admin.id);
    expect(await findUsableReset(token)).not.toBeNull(); // viewing does not use it up
    await completePasswordReset(token, 'brand-new-password');

    const updated = await db.query.users.findFirst({ where: eq(users.id, student.id) });
    expect(await verifyPassword('brand-new-password', updated?.passwordHash)).toBe(true);
    expect(await findUserBySessionToken(sessionToken)).toBeNull();
    expect(await db.$count(sessions, eq(sessions.userId, student.id))).toBe(0);
    await expect(completePasswordReset(token, 'another-password')).rejects.toThrow();
  });

  it('a newer link cancels the older one', async () => {
    const first = await createPasswordReset(student.id, admin.id);
    const second = await createPasswordReset(student.id, admin.id);
    expect(await findUsableReset(first)).toBeNull();
    expect(await findUsableReset(second)).not.toBeNull();
  });

  it('does not work for deactivated accounts', async () => {
    const token = await createPasswordReset(student.id, admin.id);
    await db.update(users).set({ isActive: false }).where(eq(users.id, student.id));
    expect(await findUsableReset(token)).toBeNull();
    await expect(completePasswordReset(token, 'brand-new-password')).rejects.toThrow();
    await expect(createPasswordReset(student.id, admin.id)).rejects.toThrow();
  });
});
