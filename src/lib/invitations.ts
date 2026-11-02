import { and, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { courses, groupStudents, groups, invitations, users } from '@/lib/db/schema';
import { appUrl } from '@/lib/app-url';
import { hashPassword } from '@/lib/auth/password';
import { generateToken, hashToken } from '@/lib/auth/tokens';

export const INVITE_TTL_DAYS = 7;

export class InviteError extends Error {}

function inviteExpiry(): Date {
  return new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function inviteUrl(token: string): string {
  return `${appUrl()}/invite/${token}`;
}

/**
 * Revokes earlier pending invitations for this e-mail. For a student invitation, only the ones for the same
 * course are replaced, so invitations to other courses keep working.
 */
async function revokePendingFor(email: string, courseId?: string) {
  const sameScope = courseId
    ? or(ne(invitations.role, 'student'), inArray(invitations.groupId, db.select({ id: groups.id }).from(groups).where(eq(groups.courseId, courseId))))
    : undefined;
  await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.email, email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), sameScope));
}

/** Adds an existing student account to a group, enforcing one group per course. */
export async function enrollStudent(studentId: string, groupId: string): Promise<void> {
  const group = await db.query.groups.findFirst({ where: eq(groups.id, groupId) });
  if (!group) throw new InviteError('المجموعة غير موجودة');
  const existing = await db.query.groupStudents.findFirst({
    where: and(eq(groupStudents.courseId, group.courseId), eq(groupStudents.studentId, studentId)),
  });
  if (existing) {
    throw new InviteError(
      existing.groupId === groupId
        ? 'الطالب موجود في هذه المجموعة'
        : 'الطالب مسجّل في مجموعة أخرى في نفس الدورة؛ استخدم «نقل» بدلاً من الإضافة',
    );
  }
  await db.insert(groupStudents).values({ groupId, courseId: group.courseId, studentId });
}

export type AddStudentResult = { kind: 'enrolled'; name: string } | { kind: 'invited'; token: string };

/** If the email belongs to an existing student, enrolls them; otherwise creates an invitation link. */
export async function addStudentToGroup(input: {
  name: string;
  email: string;
  groupId: string;
  createdBy: string;
}): Promise<AddStudentResult> {
  const group = await db.query.groups.findFirst({ where: eq(groups.id, input.groupId) });
  if (!group) throw new InviteError('المجموعة غير موجودة');
  const user = await db.query.users.findFirst({ where: eq(users.email, input.email) });
  if (user) {
    if (user.role !== 'student') throw new InviteError('هذا البريد مسجّل لحساب مشرف أو مدير');
    await enrollStudent(user.id, input.groupId);
    return { kind: 'enrolled', name: user.name };
  }
  await revokePendingFor(input.email, group.courseId);
  const token = generateToken();
  await db.insert(invitations).values({
    email: input.email,
    name: input.name,
    role: 'student',
    groupId: input.groupId,
    tokenHash: hashToken(token),
    expiresAt: inviteExpiry(),
    createdBy: input.createdBy,
  });
  return { kind: 'invited', token };
}

export async function inviteSupervisor(input: { name: string; email: string; createdBy: string }): Promise<string> {
  const user = await db.query.users.findFirst({ where: eq(users.email, input.email) });
  if (user) throw new InviteError('هذا البريد مسجّل مسبقاً');
  await revokePendingFor(input.email);
  const token = generateToken();
  await db.insert(invitations).values({
    email: input.email,
    name: input.name,
    role: 'supervisor',
    tokenHash: hashToken(token),
    expiresAt: inviteExpiry(),
    createdBy: input.createdBy,
  });
  return token;
}

/** Issues a fresh link for a pending invitation; the old link stops working immediately. */
export async function regenerateInvitation(invitationId: string): Promise<string> {
  const inv = await db.query.invitations.findFirst({ where: eq(invitations.id, invitationId) });
  if (!inv) throw new InviteError('الدعوة غير موجودة');
  if (inv.acceptedAt) throw new InviteError('تم قبول هذه الدعوة مسبقاً');
  const token = generateToken();
  await db
    .update(invitations)
    .set({ tokenHash: hashToken(token), expiresAt: inviteExpiry(), revokedAt: null })
    .where(eq(invitations.id, invitationId));
  return token;
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.id, invitationId), isNull(invitations.acceptedAt)));
}

/** Returns a usable invitation for display, or null. Reading never consumes the token. */
export async function findUsableInvitation(token: string) {
  if (!token || token.length > 200) return null;
  const rows = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      name: invitations.name,
      role: invitations.role,
      groupName: groups.name,
      courseTitle: courses.title,
    })
    .from(invitations)
    .leftJoin(groups, eq(groups.id, invitations.groupId))
    .leftJoin(courses, eq(courses.id, groups.courseId))
    .where(
      and(
        eq(invitations.tokenHash, hashToken(token)),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export type AcceptResult = { status: 'created'; userId: string } | { status: 'existing-account' };

/**
 * Accepts an invitation exactly once. The token is consumed in the same transaction that creates the
 * account, so a double click or a replayed link cannot create two accounts.
 */
export async function acceptInvitation(input: { token: string; name: string; password: string }): Promise<AcceptResult> {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const consumed = await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(
        and(
          eq(invitations.tokenHash, hashToken(input.token)),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .returning();
    const inv = consumed[0];
    if (!inv) throw new InviteError('رابط الدعوة غير صالح أو منتهي');

    const group = inv.groupId ? await tx.query.groups.findFirst({ where: eq(groups.id, inv.groupId) }) : undefined;
    const existing = await tx.query.users.findFirst({ where: eq(users.email, inv.email) });
    if (existing) {
      // Never sign someone in to an existing account from a link; just apply the membership.
      if (existing.role === 'student' && inv.role === 'student' && group) {
        await tx
          .insert(groupStudents)
          .values({ groupId: group.id, courseId: group.courseId, studentId: existing.id })
          .onConflictDoNothing();
      }
      return { status: 'existing-account' as const };
    }

    const [user] = await tx
      .insert(users)
      .values({ name: input.name, email: inv.email, passwordHash, role: inv.role })
      .returning({ id: users.id });
    if (inv.role === 'student' && group) {
      await tx.insert(groupStudents).values({ groupId: group.id, courseId: group.courseId, studentId: user.id });
    }
    if (inv.role === 'student') {
      // The same person may have been invited to other courses too: enrol them there as well.
      const others = await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(
          and(
            eq(invitations.email, inv.email),
            eq(invitations.role, 'student'),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, new Date()),
          ),
        )
        .returning({ groupId: invitations.groupId });
      for (const other of others) {
        if (!other.groupId) continue;
        const g = await tx.query.groups.findFirst({ where: eq(groups.id, other.groupId) });
        if (g) {
          await tx.insert(groupStudents).values({ groupId: g.id, courseId: g.courseId, studentId: user.id }).onConflictDoNothing();
        }
      }
    }
    return { status: 'created' as const, userId: user.id };
  });
}
