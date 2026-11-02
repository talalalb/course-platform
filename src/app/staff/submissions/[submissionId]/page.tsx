import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { ActionForm, ConfirmButton, SubmitButton } from '@/components/forms';
import { Badge, Card, FileName, Notice, PageHeader } from '@/components/ui';
import { requireRole } from '@/lib/auth/current-user';
import { getViewableSubmission } from '@/lib/authz';
import { db } from '@/lib/db';
import { courses, groupStudents, groups, reviews, submissionFiles, users } from '@/lib/db/schema';
import { formatBytes, formatDateTime } from '@/lib/format';
import { loadPairs, pendingReviews } from '@/lib/metrics';
import { isUuid } from '@/lib/validation';
import { reopenSubmissionAction, saveReviewAction } from '../../actions';

export const metadata: Metadata = { title: 'تصحيح الحل' };

export default async function ReviewPage({ params }: { params: Promise<{ submissionId: string }> }) {
  const user = await requireRole('admin', 'supervisor');
  const { submissionId } = await params;
  if (!isUuid(submissionId)) notFound();
  const row = await getViewableSubmission(user, submissionId);
  if (!row) notFound();
  const { submission, assignment } = row;

  const [student, course, files, review, membership] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, submission.studentId), columns: { id: true, name: true, email: true } }),
    db.query.courses.findFirst({ where: eq(courses.id, assignment.courseId), columns: { title: true } }),
    db.select().from(submissionFiles).where(eq(submissionFiles.submissionId, submission.id)).orderBy(asc(submissionFiles.createdAt)),
    db.query.reviews.findFirst({ where: eq(reviews.submissionId, submission.id) }),
    db
      .select({ groupName: groups.name })
      .from(groupStudents)
      .innerJoin(groups, eq(groups.id, groupStudents.groupId))
      .where(and(eq(groupStudents.studentId, submission.studentId), eq(groupStudents.courseId, assignment.courseId)))
      .limit(1),
  ]);

  const scope = user.role === 'admin' ? ({ kind: 'all' } as const) : ({ kind: 'supervisor', supervisorId: user.id } as const);
  const nextPending = pendingReviews(await loadPairs(scope, { courseId: assignment.courseId, assignmentId: assignment.id })).find(
    (p) => p.submissionId !== submission.id,
  );

  const images = files.filter((f) => f.mimeType.startsWith('image/'));
  const pdfs = files.filter((f) => f.mimeType === 'application/pdf');

  return (
    <>
      <PageHeader
        title={`حل ${student?.name ?? ''}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link className="link" href={`/staff/assignments/${assignment.id}`}>
              ← {assignment.title}
            </Link>
            <span className="text-gray-400">|</span>
            <span>{course?.title}</span>
            {membership[0] ? (
              <>
                <span className="text-gray-400">|</span>
                <span>{membership[0].groupName}</span>
              </>
            ) : null}
          </span>
        }
        actions={
          nextPending ? (
            <Link className="btn btn-secondary btn-sm" href={`/staff/submissions/${nextPending.submissionId}`}>
              الحل التالي بانتظار التصحيح ←
            </Link>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card
            title="الحل المرفوع"
            actions={
              <span className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                سُلِّم {formatDateTime(submission.submittedAt)}
                {submission.isLate ? <Badge tone="amber">متأخر</Badge> : <Badge tone="green">في الموعد</Badge>}
                {submission.status === 'reviewed' ? <Badge tone="green">تم التصحيح</Badge> : <Badge tone="blue">بانتظار التصحيح</Badge>}
              </span>
            }
          >
            {submission.note ? (
              <div className="mb-4 rounded-lg bg-gray-50 p-3 text-sm">
                <div className="mb-1 text-xs font-semibold text-gray-500">ملاحظة الطالب</div>
                <p className="whitespace-pre-wrap">{submission.note}</p>
              </div>
            ) : null}

            {pdfs.length > 0 ? (
              <ul className="mb-4 space-y-2">
                {pdfs.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                    <span className="truncate"><FileName name={f.originalName} mimeType={f.mimeType} /></span>
                    <span className="flex items-center gap-2">
                      <span className="ltr text-xs text-gray-400">{formatBytes(f.sizeBytes)}</span>
                      <a className="btn btn-secondary btn-sm" href={`/files/s/${f.id}`} target="_blank" rel="noopener">
                        فتح
                      </a>
                      <a className="btn btn-secondary btn-sm" href={`/files/s/${f.id}?download=1`}>
                        تنزيل
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="space-y-4">
              {images.map((f) => (
                <figure key={f.id} className="overflow-hidden rounded-lg border border-gray-200">
                  <a href={`/files/s/${f.id}`} target="_blank" rel="noopener" title="فتح بالحجم الكامل">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/files/s/${f.id}`} alt={f.originalName} className="block h-auto w-full bg-gray-50" loading="lazy" />
                  </a>
                  <figcaption className="flex items-center justify-between gap-2 bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
                    <span className="truncate"><FileName name={f.originalName} /></span>
                    <a className="link" href={`/files/s/${f.id}?download=1`}>
                      تنزيل
                    </a>
                  </figcaption>
                </figure>
              ))}
            </div>
            {files.length === 0 ? <p className="text-sm text-gray-500">لا توجد ملفات.</p> : null}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="التصحيح">
            <ActionForm action={saveReviewAction} className="space-y-4">
              <input type="hidden" name="submissionId" value={submission.id} />
              <div>
                <label className="label" htmlFor="grade">
                  الدرجة من {assignment.maxScore} <Badge tone="purple">للإدارة والمشرف فقط</Badge>
                </label>
                <input
                  id="grade"
                  name="grade"
                  inputMode="decimal"
                  className="field ltr"
                  defaultValue={review ? String(review.grade) : ''}
                  placeholder={`0 - ${assignment.maxScore}`}
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="feedback">
                  تعليق للطالب <Badge tone="green">يراه الطالب</Badge>
                </label>
                <textarea id="feedback" name="feedback" className="field" rows={5} defaultValue={review?.feedback ?? ''} maxLength={5000} />
              </div>
              <div>
                <label className="label" htmlFor="internalNote">
                  ملاحظة داخلية <Badge tone="purple">للإدارة والمشرف فقط</Badge>
                </label>
                <textarea id="internalNote" name="internalNote" className="field" rows={3} defaultValue={review?.internalNote ?? ''} maxLength={5000} />
              </div>
              <SubmitButton>{review ? 'تحديث التصحيح' : 'حفظ التصحيح'}</SubmitButton>
            </ActionForm>
            {review ? (
              <p className="mt-3 text-xs text-gray-400">آخر تصحيح: {formatDateTime(review.reviewedAt)}</p>
            ) : null}
          </Card>

          {submission.status === 'reviewed' ? (
            <Card title="إعادة فتح التسليم">
              <p className="mb-3 text-sm text-gray-600">يسمح للطالب برفع حل جديد (مثلاً إذا رفع ملفاً خاطئاً). يبقى التصحيح الحالي محفوظاً.</p>
              <form action={reopenSubmissionAction}>
                <input type="hidden" name="submissionId" value={submission.id} />
                <ConfirmButton variant="secondary" message="السماح للطالب بإعادة التسليم؟">
                  السماح بإعادة التسليم
                </ConfirmButton>
              </form>
            </Card>
          ) : null}

          <Notice tone="info">
            الطالب: <strong>{student?.name}</strong>
            <div className="ltr text-xs">{student?.email}</div>
            <Link className="link mt-2 inline-block text-xs" href={`/staff/students/${submission.studentId}?course=${assignment.courseId}`}>
              عرض أداء الطالب
            </Link>
          </Notice>
        </div>
      </div>
    </>
  );
}
