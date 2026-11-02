import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { isSameOrigin, jsonError } from '@/lib/http';
import { isRateLimited } from '@/lib/rate-limit';
import { SubmissionError, submitAssignment } from '@/lib/submissions';
import { MAX_TOTAL_BYTES, processFormFiles, UploadError } from '@/lib/uploads';
import { isUuid } from '@/lib/validation';

/** Student submits (or replaces) the solution files for an assignment. */
export async function POST(request: Request, { params }: { params: Promise<{ assignmentId: string }> }) {
  if (!isSameOrigin(request)) return jsonError('طلب غير مسموح', 403);
  const user = await getCurrentUser();
  if (!user) return jsonError('انتهت الجلسة، سجّل الدخول مرة أخرى', 401);
  if (user.role !== 'student') return jsonError('التسليم متاح للطلاب فقط', 403);

  const { assignmentId } = await params;
  if (!isUuid(assignmentId)) return jsonError('الواجب غير موجود', 404);

  // Browsers always send Content-Length for these uploads; refusing requests without it keeps the size limit enforceable.
  const length = Number(request.headers.get('content-length') ?? '');
  if (!Number.isFinite(length) || length <= 0) return jsonError('تعذّر تحديد حجم الملفات، حاول مرة أخرى', 411);
  if (length > MAX_TOTAL_BYTES + 1024 * 1024) return jsonError('حجم الملفات أكبر من المسموح (50 ميجابايت)', 413);
  if (isRateLimited(`upload:${user.id}`, 30, 60 * 60 * 1000)) return jsonError('محاولات رفع كثيرة، حاول لاحقاً', 429);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError('تعذّر قراءة الملفات المرسلة', 400);
  }

  try {
    const files = await processFormFiles(form.getAll('files'));
    const noteValue = form.get('note');
    const note = typeof noteValue === 'string' ? noteValue.trim().slice(0, 2000) : '';
    const result = await submitAssignment({ student: user, assignmentId, files, note });
    return NextResponse.json(
      { message: result.late ? 'تم التسليم (بعد الموعد)' : 'تم التسليم بنجاح' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    if (err instanceof UploadError) return jsonError(err.message, 400);
    if (err instanceof SubmissionError) return jsonError(err.message, err.status);
    console.error('Submission failed', err);
    return jsonError('حدث خطأ غير متوقع، حاول مرة أخرى', 500);
  }
}
