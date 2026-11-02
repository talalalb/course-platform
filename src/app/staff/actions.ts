'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionState } from '@/components/forms';
import { assertRole } from '@/lib/auth/current-user';
import { reopenSubmission, saveReview, SubmissionError } from '@/lib/submissions';
import { str, uuidField } from '@/lib/validation';

const reviewSchema = z.object({
  submissionId: uuidField,
  grade: z
    .string()
    .trim()
    .min(1, 'أدخل الدرجة')
    .transform((v) => Number(v.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace('٫', '.').replace(',', '.')))
    .refine((n) => Number.isFinite(n), 'الدرجة يجب أن تكون رقماً'),
  feedback: z.string().trim().max(5000, 'التعليق طويل جداً'),
  internalNote: z.string().trim().max(5000, 'الملاحظة طويلة جداً'),
});

export async function saveReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const staff = await assertRole('admin', 'supervisor');
  const parsed = reviewSchema.safeParse({
    submissionId: str(formData, 'submissionId'),
    grade: str(formData, 'grade'),
    feedback: str(formData, 'feedback'),
    internalNote: str(formData, 'internalNote'),
  });
  if (!parsed.success) return { status: 'error', message: parsed.error.issues[0]?.message ?? 'بيانات غير صحيحة' };
  try {
    await saveReview(staff, parsed.data);
  } catch (err) {
    if (err instanceof SubmissionError) return { status: 'error', message: err.message };
    throw err;
  }
  revalidatePath(`/staff/submissions/${parsed.data.submissionId}`);
  return { status: 'success', message: 'تم حفظ التصحيح. الطالب يرى التعليق فقط، ولا يرى الدرجة أو الملاحظة الداخلية.' };
}

export async function reopenSubmissionAction(formData: FormData): Promise<void> {
  const staff = await assertRole('admin', 'supervisor');
  const submissionId = uuidField.parse(str(formData, 'submissionId'));
  await reopenSubmission(staff, submissionId);
  revalidatePath(`/staff/submissions/${submissionId}`);
}
