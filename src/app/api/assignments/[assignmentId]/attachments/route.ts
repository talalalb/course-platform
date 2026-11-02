import { count, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { db } from '@/lib/db';
import { assignmentFiles, assignments } from '@/lib/db/schema';
import { isSameOrigin, jsonError } from '@/lib/http';
import { newStorageKey, removeQuietly, storage } from '@/lib/storage';
import { MAX_TOTAL_BYTES, processFormFiles, UploadError } from '@/lib/uploads';
import { isUuid } from '@/lib/validation';

const MAX_ATTACHMENTS = 10;

/** Admin attaches files (instructions, templates) to an assignment. */
export async function POST(request: Request, { params }: { params: Promise<{ assignmentId: string }> }) {
  if (!isSameOrigin(request)) return jsonError('طلب غير مسموح', 403);
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') return jsonError('غير مصرح', 403);

  const { assignmentId } = await params;
  if (!isUuid(assignmentId)) return jsonError('الواجب غير موجود', 404);
  const assignment = await db.query.assignments.findFirst({ where: eq(assignments.id, assignmentId) });
  if (!assignment) return jsonError('الواجب غير موجود', 404);

  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_TOTAL_BYTES + 1024 * 1024) return jsonError('حجم الملفات أكبر من المسموح (50 ميجابايت)', 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError('تعذّر قراءة الملفات المرسلة', 400);
  }

  const stored: string[] = [];
  try {
    const files = await processFormFiles(form.getAll('files'));
    const [{ value: existing }] = await db
      .select({ value: count() })
      .from(assignmentFiles)
      .where(eq(assignmentFiles.assignmentId, assignmentId));
    if (existing + files.length > MAX_ATTACHMENTS) {
      return jsonError(`الحد الأقصى ${MAX_ATTACHMENTS} مرفقات لكل واجب`, 400);
    }
    const rows = [];
    for (const file of files) {
      const key = newStorageKey('attachments', file.extension);
      await storage.put(key, file.data);
      stored.push(key);
      rows.push({
        assignmentId,
        storageKey: key,
        originalName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.data.length,
      });
    }
    await db.insert(assignmentFiles).values(rows);
    return NextResponse.json({ message: 'تم رفع المرفقات' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    await removeQuietly(stored);
    if (err instanceof UploadError) return jsonError(err.message, 400);
    console.error('Attachment upload failed', err);
    return jsonError('حدث خطأ غير متوقع، حاول مرة أخرى', 500);
  }
}
