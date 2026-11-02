import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { FileUploader } from '@/components/FileUploader';
import { Badge, Card, FileName, Notice, PageHeader, SubmissionStatusBadge } from '@/components/ui';
import { requireRole } from '@/lib/auth/current-user';
import { getViewableAssignment } from '@/lib/authz';
import { db } from '@/lib/db';
import { assignmentFiles, courses } from '@/lib/db/schema';
import { formatBytes, formatDateTime } from '@/lib/format';
import { canStillSubmit, getOwnSubmission } from '@/lib/submissions';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = { title: 'الواجب' };

export default async function StudentAssignmentPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const student = await requireRole('student');
  const { assignmentId } = await params;
  if (!isUuid(assignmentId)) notFound();
  const assignment = await getViewableAssignment(student, assignmentId);
  if (!assignment) notFound();

  const [course, attachments, mine] = await Promise.all([
    db.query.courses.findFirst({ where: eq(courses.id, assignment.courseId), columns: { title: true } }),
    db.select().from(assignmentFiles).where(eq(assignmentFiles.assignmentId, assignment.id)).orderBy(asc(assignmentFiles.createdAt)),
    getOwnSubmission(student.id, assignment.id),
  ]);
  const now = new Date();
  // A submission that was reviewed and then reopened by staff can be uploaded again regardless of the deadline.
  const reopened = mine?.status === 'submitted' && mine.reviewedAt !== null;
  const check = canStillSubmit(assignment, mine ? { status: mine.status, isLate: mine.isLate, reopened } : null);

  return (
    <>
      <PageHeader
        title={assignment.title}
        subtitle={
          <Link className="link" href="/student">
            → {course?.title}
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="المطلوب">
            {assignment.description ? (
              <p className="whitespace-pre-wrap text-sm leading-7 text-gray-800">{assignment.description}</p>
            ) : (
              <p className="text-sm text-gray-400">بدون وصف.</p>
            )}
            {attachments.length > 0 ? (
              <div className="mt-4">
                <div className="mb-2 text-xs font-semibold text-gray-500">ملفات الواجب</div>
                <ul className="space-y-1 text-sm">
                  {attachments.map((f) => (
                    <li key={f.id}>
                      <a className="link" href={`/files/a/${f.id}`} target="_blank" rel="noopener">
                        <FileName name={f.originalName} mimeType={f.mimeType} />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          {mine?.status === 'reviewed' ? (
            <Card title="تعليق المشرف">
              {mine.feedback ? <p className="whitespace-pre-wrap text-sm leading-7">{mine.feedback}</p> : <p className="text-sm text-gray-500">تم تصحيح حلك.</p>}
              <p className="mt-3 text-xs text-gray-400">{formatDateTime(mine.reviewedAt)}</p>
            </Card>
          ) : null}

          {check.ok ? (
            <Card title={mine ? 'تعديل الحل' : 'تسليم الحل'}>
              {reopened ? (
                <div className="mb-4">
                  <Notice tone="success">أعاد المشرف فتح التسليم لك؛ يمكنك رفع حل جديد.</Notice>
                </div>
              ) : check.late ? (
                <div className="mb-4">
                  <Notice tone="warn">انتهى الموعد، وسيظهر تسليمك على أنه «متأخر».</Notice>
                </div>
              ) : null}
              {mine?.feedback ? (
                <div className="mb-4">
                  <Notice tone="info">
                    <div className="mb-1 font-semibold">ملاحظات المشرف السابقة</div>
                    <p className="whitespace-pre-wrap">{mine.feedback}</p>
                  </Notice>
                </div>
              ) : null}
              <FileUploader
                endpoint={`/api/assignments/${assignment.id}/submission`}
                submitLabel={mine ? 'استبدال الحل' : 'تسليم الحل'}
                withNote
                initialNote={mine?.note ?? ''}
                replaceWarning={mine ? 'سيتم استبدال ملفاتك السابقة بالملفات الجديدة. متابعة؟' : undefined}
              />
            </Card>
          ) : mine?.status === 'reviewed' ? null : (
            <Notice tone="error">{check.reason}</Notice>
          )}
        </div>

        <div className="space-y-6">
          <Card title="حالة الواجب">
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-gray-500">آخر موعد</dt>
                <dd>{formatDateTime(assignment.dueAt)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-gray-500">الحالة</dt>
                <dd>
                  <SubmissionStatusBadge status={mine?.status ?? null} isLate={mine?.isLate} dueAt={assignment.dueAt} now={now} />
                </dd>
              </div>
              {mine ? (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-gray-500">وقت التسليم</dt>
                  <dd>{formatDateTime(mine.submittedAt)}</dd>
                </div>
              ) : null}
              {!assignment.allowLate ? (
                <div className="text-xs text-gray-500">
                  <Badge tone="amber">لا يُقبل التسليم بعد الموعد</Badge>
                </div>
              ) : null}
            </dl>
          </Card>

          {mine ? (
            <Card title={`ملفاتك (${mine.files.length})`}>
              <ul className="space-y-2 text-sm">
                {mine.files.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2">
                    <a className="link truncate" href={`/files/s/${f.id}`} target="_blank" rel="noopener">
                      <FileName name={f.originalName} mimeType={f.mimeType} />
                    </a>
                    <span className="ltr text-xs text-gray-400">{formatBytes(f.sizeBytes)}</span>
                  </li>
                ))}
              </ul>
              {mine.note ? (
                <div className="mt-3 rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
                  <span className="font-semibold">ملاحظتك: </span>
                  {mine.note}
                </div>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
