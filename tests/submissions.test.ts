import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { assignments, submissionFiles, submissions } from '@/lib/db/schema';
import { getOwnSubmission, reopenSubmission, saveReview, submitAssignment } from '@/lib/submissions';
import type { ProcessedFile } from '@/lib/uploads';
import { buildWorld } from './fixtures';
import { TEST_STORAGE_DIR } from './env';

let w: Awaited<ReturnType<typeof buildWorld>>;

beforeEach(async () => {
  w = await buildWorld();
});

const file = (name = 'a.png'): ProcessedFile => ({
  data: Buffer.from('fake-but-already-validated-bytes'),
  mimeType: 'image/png',
  extension: 'png',
  originalName: name,
});
const as = (u: { id: string; role: 'admin' | 'supervisor' | 'student' }) => ({ id: u.id, role: u.role });
const stored = (key: string) => existsSync(path.join(TEST_STORAGE_DIR, key));

describe('submitting', () => {
  it('creates a submission and replaces files on resubmission', async () => {
    const first = await submitAssignment({ student: as(w.carol), assignmentId: w.openA.id, files: [file('one.png')], note: 'v1' });
    const [firstFile] = await db.select().from(submissionFiles).where(eq(submissionFiles.submissionId, first.submissionId));
    expect(stored(firstFile.storageKey)).toBe(true);
    expect(first.late).toBe(false);

    const second = await submitAssignment({ student: as(w.carol), assignmentId: w.openA.id, files: [file('two.png'), file('three.png')], note: 'v2' });
    expect(second.submissionId).toBe(first.submissionId);
    const files = await db.select().from(submissionFiles).where(eq(submissionFiles.submissionId, first.submissionId));
    expect(files.map((f) => f.originalName).sort()).toEqual(['three.png', 'two.png']);
    expect(stored(firstFile.storageKey)).toBe(false);
  });

  it('marks submissions after the deadline as late, or refuses them when late work is off', async () => {
    const late = await submitAssignment({ student: as(w.carol), assignmentId: w.hwB.id, files: [file()], note: '' }).catch((e) => e);
    // Carol is not in course B at all
    expect(late).toBeInstanceOf(Error);

    const res = await submitAssignment({ student: as(w.bob), assignmentId: w.hwA.id, files: [file()], note: '' });
    expect(res.late).toBe(true);

    await db.update(assignments).set({ allowLate: false }).where(eq(assignments.id, w.hwA.id));
    await expect(submitAssignment({ student: as(w.bob), assignmentId: w.hwA.id, files: [file()], note: '' })).rejects.toThrow(/انتهى/);
  });

  it('refuses changes after the work is reviewed, until staff reopen it', async () => {
    await expect(submitAssignment({ student: as(w.carol), assignmentId: w.hwA.id, files: [file()], note: '' })).rejects.toThrow(/تصحيح/);
    await reopenSubmission(as(w.s3), w.carolA.id);
    const res = await submitAssignment({ student: as(w.carol), assignmentId: w.hwA.id, files: [file()], note: '' });
    expect(res.submissionId).toBe(w.carolA.id);
  });

  it('students cannot submit to unpublished assignments or as staff', async () => {
    await expect(submitAssignment({ student: as(w.alice), assignmentId: w.draftA.id, files: [file()], note: '' })).rejects.toThrow();
    await expect(submitAssignment({ student: as(w.s1), assignmentId: w.openA.id, files: [file()], note: '' })).rejects.toThrow();
  });
});

describe('grades stay hidden from students', () => {
  it("the student's own view has feedback but no grade or internal note", async () => {
    const own = await getOwnSubmission(w.carol.id, w.hwA.id);
    expect(own?.feedback).toBe('Needs work');
    expect(own).not.toHaveProperty('grade');
    expect(own).not.toHaveProperty('internalNote');
    expect(JSON.stringify(own)).not.toContain('SECRET-NOTE');
  });
});

describe('reviewing', () => {
  it('a group supervisor can grade; others cannot', async () => {
    await saveReview(as(w.s2), { submissionId: w.bobA.id, grade: 88.5, feedback: 'Good', internalNote: 'note' });
    const row = await db.query.submissions.findFirst({ where: eq(submissions.id, w.bobA.id) });
    expect(row?.status).toBe('reviewed');
    await expect(saveReview(as(w.s3), { submissionId: w.bobA.id, grade: 10, feedback: '', internalNote: '' })).rejects.toThrow();
    await expect(saveReview(as(w.alice), { submissionId: w.aliceA.id, grade: 100, feedback: '', internalNote: '' })).rejects.toThrow();
  });

  it('rejects grades outside 0..max', async () => {
    await expect(saveReview(as(w.s1), { submissionId: w.aliceA.id, grade: 101, feedback: '', internalNote: '' })).rejects.toThrow();
    await expect(saveReview(as(w.s1), { submissionId: w.aliceA.id, grade: -1, feedback: '', internalNote: '' })).rejects.toThrow();
    await expect(saveReview(as(w.s1), { submissionId: w.aliceA.id, grade: Number.NaN, feedback: '', internalNote: '' })).rejects.toThrow();
  });
});
