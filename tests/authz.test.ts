import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { groupStudents, submissionFiles } from '@/lib/db/schema';
import {
  canStaffSeeStudentInCourse,
  getViewableAssignment,
  getViewableSubmission,
  getViewableSubmissionFile,
} from '@/lib/authz';
import { loadPairs } from '@/lib/metrics';
import { buildWorld } from './fixtures';

let w: Awaited<ReturnType<typeof buildWorld>>;

beforeAll(async () => {
  w = await buildWorld();
});

const viewer = (u: { id: string; role: 'admin' | 'supervisor' | 'student' }) => ({ id: u.id, role: u.role });

describe('submission visibility', () => {
  it('a student sees only their own submission', async () => {
    expect(await getViewableSubmission(viewer(w.alice), w.aliceA.id)).not.toBeNull();
    expect(await getViewableSubmission(viewer(w.alice), w.bobA.id)).toBeNull();
    expect(await getViewableSubmission(viewer(w.bob), w.aliceA.id)).toBeNull();
  });

  it('both supervisors of a group see its students, nobody else in the course does', async () => {
    expect(await getViewableSubmission(viewer(w.s1), w.aliceA.id)).not.toBeNull();
    expect(await getViewableSubmission(viewer(w.s2), w.bobA.id)).not.toBeNull();
    expect(await getViewableSubmission(viewer(w.s3), w.aliceA.id)).toBeNull();
    expect(await getViewableSubmission(viewer(w.s1), w.carolA.id)).toBeNull();
    expect(await getViewableSubmission(viewer(w.s3), w.carolA.id)).not.toBeNull();
  });

  it("supervising a student in one course grants nothing in the student's other course", async () => {
    expect(await getViewableSubmission(viewer(w.s1), w.aliceB.id)).toBeNull();
    expect(await canStaffSeeStudentInCourse(viewer(w.s1), w.alice.id, w.courseB.id)).toBe(false);
    expect(await getViewableSubmission(viewer(w.s3), w.aliceB.id)).not.toBeNull();
  });

  it('the admin sees everything', async () => {
    for (const s of [w.aliceA, w.bobA, w.carolA, w.aliceB]) {
      expect(await getViewableSubmission(viewer(w.admin), s.id)).not.toBeNull();
    }
  });

  it('file access follows the submission rule', async () => {
    const [file] = await db
      .insert(submissionFiles)
      .values({ submissionId: w.aliceA.id, storageKey: 'submissions/x/y/test.png', originalName: 'a.png', mimeType: 'image/png', sizeBytes: 1 })
      .returning();
    expect(await getViewableSubmissionFile(viewer(w.alice), file.id)).not.toBeNull();
    expect(await getViewableSubmissionFile(viewer(w.s2), file.id)).not.toBeNull();
    expect(await getViewableSubmissionFile(viewer(w.bob), file.id)).toBeNull();
    expect(await getViewableSubmissionFile(viewer(w.s3), file.id)).toBeNull();
  });

  it('visibility follows the current group when a student moves', async () => {
    await db
      .update(groupStudents)
      .set({ groupId: w.a2.id })
      .where(and(eq(groupStudents.groupId, w.a1.id), eq(groupStudents.studentId, w.bob.id)));
    expect(await getViewableSubmission(viewer(w.s1), w.bobA.id)).toBeNull();
    expect(await getViewableSubmission(viewer(w.s3), w.bobA.id)).not.toBeNull();
    // move back for the other tests
    await db
      .update(groupStudents)
      .set({ groupId: w.a1.id })
      .where(and(eq(groupStudents.groupId, w.a2.id), eq(groupStudents.studentId, w.bob.id)));
  });

  it('the database refuses a membership whose course does not match the group', async () => {
    await expect(
      db.insert(groupStudents).values({ groupId: w.a1.id, courseId: w.courseB.id, studentId: w.carol.id }),
    ).rejects.toThrow();
  });

  it('a student cannot be in two groups of the same course', async () => {
    await expect(
      db.insert(groupStudents).values({ groupId: w.a2.id, courseId: w.courseA.id, studentId: w.alice.id }),
    ).rejects.toThrow();
  });
});

describe('assignment visibility', () => {
  it('students see published assignments of their own courses only', async () => {
    expect(await getViewableAssignment(viewer(w.carol), w.hwA.id)).not.toBeNull();
    expect(await getViewableAssignment(viewer(w.carol), w.hwB.id)).toBeNull();
    expect(await getViewableAssignment(viewer(w.alice), w.draftA.id)).toBeNull();
  });

  it('staff see assignments of courses they supervise; admin sees drafts', async () => {
    expect(await getViewableAssignment(viewer(w.s1), w.hwA.id)).not.toBeNull();
    expect(await getViewableAssignment(viewer(w.s1), w.hwB.id)).toBeNull();
    expect(await getViewableAssignment(viewer(w.admin), w.draftA.id)).not.toBeNull();
  });
});

describe('dashboard scope', () => {
  it("a supervisor's dashboard rows contain only their own students", async () => {
    const rows = await loadPairs({ kind: 'supervisor', supervisorId: w.s1.id });
    const students = new Set(rows.map((r) => r.studentId));
    expect(students).toEqual(new Set([w.alice.id, w.bob.id]));
    expect(rows.every((r) => r.courseId === w.courseA.id)).toBe(true);
  });

  it('the admin dashboard covers every active student and never shows unpublished work', async () => {
    const rows = await loadPairs({ kind: 'all' });
    expect(new Set(rows.map((r) => r.studentId))).toEqual(new Set([w.alice.id, w.bob.id, w.carol.id]));
    expect(rows.some((r) => r.assignmentId === w.draftA.id)).toBe(false);
  });

  it('a grade is only counted once the submission is reviewed', async () => {
    const rows = await loadPairs({ kind: 'all' }, { assignmentId: w.hwA.id, courseId: w.courseA.id });
    const carol = rows.find((r) => r.studentId === w.carol.id);
    const alice = rows.find((r) => r.studentId === w.alice.id && r.assignmentId === w.hwA.id);
    expect(carol?.grade).toBe(40);
    expect(alice?.grade).toBeNull();
  });
});
