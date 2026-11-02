import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { passwordResets, sessions, users } from '@/lib/db/schema';
import { appUrl } from '@/lib/app-url';
import { hashPassword } from '@/lib/auth/password';
import { generateToken, hashToken } from '@/lib/auth/tokens';

export const RESET_TTL_HOURS = 48;

export class ResetError extends Error {}

export function resetUrl(token: string): string {
  return `${appUrl()}/reset/${token}`;
}

/** Creates a one-time password link for an active user; earlier unused links stop working. */
export async function createPasswordReset(userId: string, createdBy: string): Promise<string> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new ResetError('المستخدم غير موجود');
  if (!user.isActive) throw new ResetError('الحساب موقوف؛ فعّله أولاً');
  const token = generateToken();
  await db.transaction(async (tx) => {
    await tx
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)));
    await tx.insert(passwordResets).values({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000),
      createdBy,
    });
  });
  return token;
}

/** For display only; reading never uses up the link. */
export async function findUsableReset(token: string) {
  if (!token || token.length > 200) return null;
  const rows = await db
    .select({ name: users.name, email: users.email })
    .from(passwordResets)
    .innerJoin(users, eq(users.id, passwordResets.userId))
    .where(
      and(
        eq(passwordResets.tokenHash, hashToken(token)),
        isNull(passwordResets.usedAt),
        gt(passwordResets.expiresAt, new Date()),
        eq(users.isActive, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Sets the new password, uses up the link and signs the user out everywhere. Returns the user id. */
export async function completePasswordReset(token: string, password: string): Promise<string> {
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const [reset] = await tx
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResets.tokenHash, hashToken(token)),
          isNull(passwordResets.usedAt),
          gt(passwordResets.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!reset) throw new ResetError('الرابط غير صالح أو منتهي');
    const user = await tx.query.users.findFirst({ where: eq(users.id, reset.userId) });
    if (!user || !user.isActive) throw new ResetError('الحساب غير متاح');
    await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    await tx.delete(sessions).where(eq(sessions.userId, user.id));
    return user.id;
  });
}
