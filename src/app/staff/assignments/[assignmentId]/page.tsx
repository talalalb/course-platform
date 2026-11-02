import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { Badge, Card, EmptyState, FileName, LinkButton, PageHeader, StatCard, SubmissionStatusBadge, TableWrap } from '@/components/ui';
import { requireRole } from '@/lib/auth/current-user';
import { getViewableAssignment } from '@/lib/authz';
import { db } from '@/lib/db';
import { assignmentFiles, courses } from '@/lib/db/schema';
import { formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { computeStats, loadPairs } from '@/lib/metrics';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = { title: 'حلول الواجب' };

export default async function AssignmentSubmissionsPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const user = await requireRole('admin', 'supervisor');
  const { assignmentId } = await params;
  if (!isUuid(assignmentId)) notFound();
  const assignment = await getViewableAssignment(user, assignmentId);
  if (!assignment) notFound();

  const scope = user.role === 'admin' ? ({ kind: 'all' } as const) : ({ kind: 'supervisor', supervisorId: user.id } as const);
  const [course, attachments, pairs] = await Promise.all([
    db.query.courses.findFirst({ where: eq(courses.id, assignment.courseId), columns: { title: true } }),
    db.select().from(assignmentFiles).where(eq(assignmentFiles.assignmentId, assignment.id)).orderBy(asc(assignmentFiles.createdAt)),
    loadPairs(scope, { courseId: assignment.courseId, assignmentId: assignment.id }),
  ]);
  const rows = pairs.filter((p) => p.assignmentId === assignment.id);
  const stats = computeStats(rows);
  const now = new Date();

  return (
    <>
      <PageHeader
        title={assignment.title}
        subtitle={
          <span>
            {course?.title} — آخر موعد: {formatDateTime(assignment.dueAt)} {assignment.dueAt > now ? <Badge tone="blue">مفتوح</Badge> : <Badge>منتهي</Badge>}
            {!assignment.isPublished ? <> <Badge>غير منشور</Badge></> : null}
          </span>
        }
        actions={user.role === 'admin' ? <LinkButton href={`/admin/assignments/${assignment.id}`}>تعديل الواجب</LinkButton> : null}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="سلّموا" value={`${stats.submitted} / ${rows.length}`} />
        <StatCard label="بانتظار التصحيح" value={stats.pending} tone={stats.pending > 0 ? 'warn' : 'default'} />
        <StatCard label="متأخر" value={stats.late} />
        <StatCard label="متوسط الدرجات" value={formatPercent(stats.averageGrade)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="الطلاب">
            {rows.length === 0 ? (
              <EmptyState>لا يوجد طلاب في نطاقك لهذه الدورة.</EmptyState>
            ) : (
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr>
                      <th>الطالب</th>
                      <th>المجموعة</th>
                      <th>الحالة</th>
                      <th>وقت التسليم</th>
                      <th>الدرجة</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.studentId}>
                        <td>
                          <Link className="link" href={`/staff/students/${r.studentId}?course=${assignment.courseId}`}>
                            {r.studentName}
                          </Link>
                        </td>
                        <td className="text-xs">{r.groupName}</td>
                        <td>
                          <SubmissionStatusBadge status={r.status} isLate={r.isLate} dueAt={assignment.dueAt} now={now} />
                        </td>
                        <td className="text-xs">{formatDateTime(r.submittedAt)}</td>
                        <td className="ltr">{r.grade !== null ? `${formatNumber(r.grade)} / ${assignment.maxScore}` : '—'}</td>
                        <td>
                          {r.submissionId ? (
                            <Link className={`btn btn-sm ${r.status === 'submitted' ? 'btn-primary' : 'btn-secondary'}`} href={`/staff/submissions/${r.submissionId}`}>
                              {r.status === 'submitted' ? 'تصحيح' : 'عرض'}
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </div>
        <Card title="تفاصيل الواجب">
          {assignment.description ? <p className="whitespace-pre-wrap text-sm text-gray-700">{assignment.description}</p> : <p className="text-sm text-gray-400">بدون وصف.</p>}
          <p className="mt-3 text-xs text-gray-500">الدرجة الكاملة: {assignment.maxScore}</p>
          {attachments.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm">
              {attachments.map((f) => (
                <li key={f.id}>
                  <a className="link" href={`/files/a/${f.id}`} target="_blank" rel="noopener">
                    <FileName name={f.originalName} mimeType={f.mimeType} />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>
    </>
  );
}
