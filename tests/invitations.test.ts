import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { courses, groupStudents, groups, invitations, users } from '@/lib/db/schema';
import { verifyPassword } from '@/lib/auth/password';
import { hashToken } from '@/lib/auth/tokens';
import {
  acceptInvitation,
  addStudentToGroup,
  enrollStudent,
  findUsableInvitation,
  inviteSupervisor,
  regenerateInvitation,
  revokeInvitation,
} from '@/lib/invitations';
import { makeUser, resetDb } from './fixtures';

let admin: Awaited<ReturnType<typeof makeUser>>;
let groupId: string;
let otherGroupId: string;

beforeEach(async () => {
  await resetDb();
  admin = await makeUser('admin', 'Admin');
  const [course] = await db.insert(courses).values({ title: 'C' }).returning();
  const [g1, g2] = await db
    .insert(groups)
    .values([
      { courseId: course.id, name: 'G1' },
      { courseId: course.id, name: 'G2' },
    ])
    .returning();
  groupId = g1.id;
  otherGroupId = g2.id;
});

async function invite(email = 'new@test.local') {
  const result = await addStudentToGroup({ name: 'New Student', email, groupId, createdBy: admin.id });
  if (result.kind !== 'invited') throw new Error('expected an invitation');
  return result.token;
}

describe('invitations', () => {
  it('stores only a hash of the token', async () => {
    const token = await invite();
    const rows = await db.select().from(invitations);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('viewing the invitation does not consume it, accepting does, and only once', async () => {
    const token = await invite();
    expect(await findUsableInvitation(token)).not.toBeNull();
    expect(await findUsableInvitation(token)).not.toBeNull();
    const result = await acceptInvitation({ token, name: 'New Student', password: 'long-password-1' });
    expect(result.status).toBe('created');
    await expect(acceptInvitation({ token, name: 'Again', password: 'long-password-1' })).rejects.toThrow();
    expect(await findUsableInvitation(token)).toBeNull();

    const user = await db.query.users.findFirst({ where: eq(users.email, 'new@test.local') });
    expect(user?.role).toBe('student');
    expect(await verifyPassword('long-password-1', user?.passwordHash)).toBe(true);
    const membership = await db.query.groupStudents.findFirst({ where: eq(groupStudents.studentId, user!.id) });
    expect(membership?.groupId).toBe(groupId);
  });

  it('two simultaneous acceptances create exactly one account', async () => {
    const token = await invite();
    const results = await Promise.allSettled([
      acceptInvitation({ token, name: 'A', password: 'long-password-1' }),
      acceptInvitation({ token, name: 'B', password: 'long-password-1' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.$count(users, eq(users.email, 'new@test.local'))).toBe(1);
  });

  it('expired and revoked invitations do not work', async () => {
    const token = await invite('expired@test.local');
    await db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) });
    await expect(acceptInvitation({ token, name: 'X', password: 'long-password-1' })).rejects.toThrow();

    const token2 = await invite('revoked@test.local');
    const [inv] = await db.select().from(invitations).where(eq(invitations.email, 'revoked@test.local'));
    await revokeInvitation(inv.id);
    expect(await findUsableInvitation(token2)).toBeNull();
    await expect(acceptInvitation({ token: token2, name: 'X', password: 'long-password-1' })).rejects.toThrow();
  });

  it('a new link replaces the old one', async () => {
    const oldToken = await invite();
    const [inv] = await db.select().from(invitations);
    const newToken = await regenerateInvitation(inv.id);
    expect(await findUsableInvitation(oldToken)).toBeNull();
    expect(await findUsableInvitation(newToken)).not.toBeNull();
  });

  it('adding an existing student enrolls them directly, once per course', async () => {
    const student = await makeUser('student', 'Existing');
    const result = await addStudentToGroup({ name: 'Existing', email: student.email, groupId, createdBy: admin.id });
    expect(result.kind).toBe('enrolled');
    await expect(enrollStudent(student.id, otherGroupId)).rejects.toThrow(/مجموعة أخرى/);
  });

  it('cannot invite an e-mail that belongs to a supervisor as a student', async () => {
    const sup = await makeUser('supervisor', 'Sup');
    await expect(addStudentToGroup({ name: 'Sup', email: sup.email, groupId, createdBy: admin.id })).rejects.toThrow();
  });

  it('inviting the same new person to another course keeps the first invitation and enrols both', async () => {
    const [course2] = await db.insert(courses).values({ title: 'C2' }).returning();
    const [g2] = await db.insert(groups).values({ courseId: course2.id, name: 'X' }).returning();
    const first = await invite('two@test.local');
    const second = await addStudentToGroup({ name: 'Two', email: 'two@test.local', groupId: g2.id, createdBy: admin.id });
    expect(second.kind).toBe('invited');
    expect(await findUsableInvitation(first)).not.toBeNull();
    await acceptInvitation({ token: first, name: 'Two', password: 'long-password-1' });
    const user = await db.query.users.findFirst({ where: eq(users.email, 'two@test.local') });
    const memberships = await db.select().from(groupStudents).where(eq(groupStudents.studentId, user!.id));
    expect(memberships.map((m) => m.groupId).sort()).toEqual([groupId, g2.id].sort());
  });

  it('a second invitation in the same course replaces the first', async () => {
    const first = await invite('same@test.local');
    await addStudentToGroup({ name: 'Same', email: 'same@test.local', groupId: otherGroupId, createdBy: admin.id });
    expect(await findUsableInvitation(first)).toBeNull();
  });

  it('supervisor invitations create supervisor accounts', async () => {
    const token = await inviteSupervisor({ name: 'Mentor', email: 'mentor@test.local', createdBy: admin.id });
    const result = await acceptInvitation({ token, name: 'Mentor', password: 'long-password-1' });
    expect(result.status).toBe('created');
    const user = await db.query.users.findFirst({ where: eq(users.email, 'mentor@test.local') });
    expect(user?.role).toBe('supervisor');
  });

  it('accepting for an e-mail that already has an account never signs anyone in', async () => {
    const token = await invite('late@test.local');
    await db.insert(users).values({ name: 'Late', email: 'late@test.local', role: 'student' });
    const result = await acceptInvitation({ token, name: 'Late', password: 'long-password-1' });
    expect(result.status).toBe('existing-account');
  });
});
