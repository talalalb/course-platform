import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { assignments, courses, groupStudents, groupSupervisors, groups, reviews, submissions, users } from '@/lib/db/schema';
import type { Role } from '@/lib/db/schema';

export async function resetDb() {
  await db.execute(sql`TRUNCATE users, courses, invitations, sessions RESTART IDENTITY CASCADE`);
}

export async function makeUser(role: Role, name: string) {
  const [u] = await db
    .insert(users)
    .values({ name, email: `${name.toLowerCase()}@test.local`, role, passwordHash: null })
    .returning();
  return u;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Two courses:
 *  - Course A: group A1 (supervisors S1 + S2) with students alice, bob; group A2 (supervisor S3) with carol.
 *  - Course B: group B1 (supervisor S3) with alice.
 * Each course has a published assignment with a deadline in the past, plus course A has an unpublished one.
 */
export async function buildWorld() {
  await resetDb();
  const admin = await makeUser('admin', 'Admin');
  const s1 = await makeUser('supervisor', 'Sup1');
  const s2 = await makeUser('supervisor', 'Sup2');
  const s3 = await makeUser('supervisor', 'Sup3');
  const alice = await makeUser('student', 'Alice');
  const bob = await makeUser('student', 'Bob');
  const carol = await makeUser('student', 'Carol');

  const [courseA, courseB] = await db.insert(courses).values([{ title: 'Course A' }, { title: 'Course B' }]).returning();
  const [a1, a2, b1] = await db
    .insert(groups)
    .values([
      { courseId: courseA.id, name: 'A1' },
      { courseId: courseA.id, name: 'A2' },
      { courseId: courseB.id, name: 'B1' },
    ])
    .returning();
  await db.insert(groupSupervisors).values([
    { groupId: a1.id, supervisorId: s1.id },
    { groupId: a1.id, supervisorId: s2.id },
    { groupId: a2.id, supervisorId: s3.id },
    { groupId: b1.id, supervisorId: s3.id },
  ]);
  await db.insert(groupStudents).values([
    { groupId: a1.id, courseId: courseA.id, studentId: alice.id },
    { groupId: a1.id, courseId: courseA.id, studentId: bob.id },
    { groupId: a2.id, courseId: courseA.id, studentId: carol.id },
    { groupId: b1.id, courseId: courseB.id, studentId: alice.id },
  ]);
  const now = Date.now();
  const [hwA, hwB, draftA, openA] = await db
    .insert(assignments)
    .values([
      { courseId: courseA.id, title: 'HW A', dueAt: new Date(now - 2 * DAY) },
      { courseId: courseB.id, title: 'HW B', dueAt: new Date(now - 2 * DAY) },
      { courseId: courseA.id, title: 'Draft A', dueAt: new Date(now + 5 * DAY), isPublished: false },
      { courseId: courseA.id, title: 'Open A', dueAt: new Date(now + 5 * DAY) },
    ])
    .returning();

  const [aliceA, bobA, carolA, aliceB] = await db
    .insert(submissions)
    .values([
      { assignmentId: hwA.id, studentId: alice.id, submittedAt: new Date(now - 3 * DAY) },
      { assignmentId: hwA.id, studentId: bob.id, submittedAt: new Date(now - 1 * DAY), isLate: true },
      { assignmentId: hwA.id, studentId: carol.id, submittedAt: new Date(now - 3 * DAY), status: 'reviewed' },
      { assignmentId: hwB.id, studentId: alice.id, submittedAt: new Date(now - 3 * DAY) },
    ])
    .returning();
  await db.insert(reviews).values({ submissionId: carolA.id, grade: 40, feedback: 'Needs work', internalNote: 'SECRET-NOTE', reviewedBy: s3.id });

  return { admin, s1, s2, s3, alice, bob, carol, courseA, courseB, a1, a2, b1, hwA, hwB, draftA, openA, aliceA, bobA, carolA, aliceB };
}
