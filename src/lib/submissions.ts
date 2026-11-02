import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { assignments, reviews, submissionFiles, submissions } from '@/lib/db/schema';
import { getViewableAssignment, getViewableSubmission } from '@/lib/authz';
import { newStorageKey, removeQuietly, storage } from '@/lib/storage';
import type { ProcessedFile } from '@/lib/uploads';
import type { SessionUser } from '@/lib/auth/sessions';

export class SubmissionError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

type Student = Pick<SessionUser, 'id' | 'role'>;

/** Student-safe view of their own submission: never includes the grade or the internal note. */
export async function getOwnSubmission(studentId: string, assignmentId: string) {
  const rows = await db
    .select({
      id: submissions.id,
      status: submissions.status,
      isLate: submissions.isLate,
      note: submissions.note,
      submittedAt: submissions.submittedAt,
      feedback: reviews.feedback,
      reviewedAt: reviews.reviewedAt,
    })
    .from(submissions)
    .leftJoin(reviews, eq(reviews.submissionId, submissions.id))
    .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, studentId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const files = await db
    .select({
      id: submissionFiles.id,
      originalName: submissionFiles.originalName,
      mimeType: submissionFiles.mimeType,
      sizeBytes: submissionFiles.sizeBytes,
    })
    .from(submissionFiles)
    .where(eq(submissionFiles.submissionId, row.id))
    .orderBy(submissionFiles.createdAt);
  return { ...row, feedback: row.feedback ?? null, files };
}

export function canStillSubmit(
  assignment: { dueAt: Date; allowLate: boolean },
  existing: { status: 'submitted' | 'reviewed' } | null,
  now = new Date(),
): { ok: true; late: boolean } | { ok: false; reason: string } {
  if (existing?.status === 'reviewed') return { ok: false, reason: 'تم تصحيح الحل، لا يمكن تعديله' };
  const late = now.getTime() > assignment.dueAt.getTime();
  if (late && !assignment.allowLate) return { ok: false, reason: 'انتهى موعد التسليم' };
  return { ok: true, late };
}

/**
 * Creates or replaces the student's submission. Replacing removes the previous files.
 * Files are written to storage first and cleaned up if the database step fails.
 */
export async function submitAssignment(input: {
  student: Student;
  assignmentId: string;
  files: ProcessedFile[];
  note: string;
}): Promise<{ submissionId: string; late: boolean }> {
  if (input.student.role !== 'student') throw new SubmissionError('غير مصرح', 403);
  const assignment = await getViewableAssignment(input.student, input.assignmentId);
  if (!assignment) throw new SubmissionError('الواجب غير موجود', 404);
  if (input.files.length === 0) throw new SubmissionError('اختر ملفاً واحداً على الأقل');

  const stored: { key: string; file: ProcessedFile }[] = [];
  try {
    for (const file of input.files) {
      const key = newStorageKey('submissions', file.extension);
      await storage.put(key, file.data);
      stored.push({ key, file });
    }
  } catch (err) {
    await removeQuietly(stored.map((s) => s.key));
    throw err;
  }

  let oldKeys: string[] = [];
  try {
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(submissions)
        .where(and(eq(submissions.assignmentId, assignment.id), eq(submissions.studentId, input.student.id)))
        .for('update');
      const check = canStillSubmit(assignment, existing ?? null);
      if (!check.ok) throw new SubmissionError(check.reason, 409);

      let submissionId: string;
      if (existing) {
        const old = await tx
          .select({ key: submissionFiles.storageKey })
          .from(submissionFiles)
          .where(eq(submissionFiles.submissionId, existing.id));
        oldKeys = old.map((o) => o.key);
        await tx.delete(submissionFiles).where(eq(submissionFiles.submissionId, existing.id));
        await tx
          .update(submissions)
          .set({ note: input.note, isLate: check.late, submittedAt: new Date(), status: 'submitted' })
          .where(eq(submissions.id, existing.id));
        submissionId = existing.id;
      } else {
        const [created] = await tx
          .insert(submissions)
          .values({
            assignmentId: assignment.id,
            studentId: input.student.id,
            note: input.note,
            isLate: check.late,
          })
          .returning({ id: submissions.id });
        submissionId = created.id;
      }
      await tx.insert(submissionFiles).values(
        stored.map(({ key, file }) => ({
          submissionId,
          storageKey: key,
          originalName: file.originalName,
          mimeType: file.mimeType,
          sizeBytes: file.data.length,
        })),
      );
      return { submissionId, late: check.late };
    });
    await removeQuietly(oldKeys);
    return result;
  } catch (err) {
    await removeQuietly(stored.map((s) => s.key));
    throw err;
  }
}

export type ReviewInput = {
  submissionId: string;
  grade: number;
  feedback: string;
  internalNote: string;
};

export async function saveReview(staff: Pick<SessionUser, 'id' | 'role'>, input: ReviewInput): Promise<void> {
  if (staff.role !== 'admin' && staff.role !== 'supervisor') throw new SubmissionError('غير مصرح', 403);
  const row = await getViewableSubmission(staff, input.submissionId);
  if (!row) throw new SubmissionError('الحل غير موجود', 404);
  if (!Number.isFinite(input.grade) || input.grade < 0 || input.grade > row.assignment.maxScore) {
    throw new SubmissionError(`الدرجة يجب أن تكون بين 0 و ${row.assignment.maxScore}`);
  }
  const grade = Math.round(input.grade * 100) / 100;
  await db.transaction(async (tx) => {
    await tx
      .insert(reviews)
      .values({
        submissionId: row.submission.id,
        grade,
        feedback: input.feedback,
        internalNote: input.internalNote,
        reviewedBy: staff.id,
      })
      .onConflictDoUpdate({
        target: reviews.submissionId,
        set: {
          grade,
          feedback: input.feedback,
          internalNote: input.internalNote,
          reviewedBy: staff.id,
          reviewedAt: new Date(),
        },
      });
    await tx.update(submissions).set({ status: 'reviewed' }).where(eq(submissions.id, row.submission.id));
  });
}

/** Lets the student upload again (for example after a wrong file). The previous review stays for reference. */
export async function reopenSubmission(staff: Pick<SessionUser, 'id' | 'role'>, submissionId: string): Promise<void> {
  if (staff.role !== 'admin' && staff.role !== 'supervisor') throw new SubmissionError('غير مصرح', 403);
  const row = await getViewableSubmission(staff, submissionId);
  if (!row) throw new SubmissionError('الحل غير موجود', 404);
  await db.update(submissions).set({ status: 'submitted' }).where(eq(submissions.id, row.submission.id));
}

export async function getAssignment(assignmentId: string) {
  return db.query.assignments.findFirst({ where: eq(assignments.id, assignmentId) });
}
