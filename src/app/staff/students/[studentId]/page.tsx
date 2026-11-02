import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { Badge, Card, EmptyState, PageHeader, StatCard, SubmissionStatusBadge, TableWrap } from '@/components/ui';
import { requireRole } from '@/lib/auth/current-user';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { computeStats, loadPairs } from '@/lib/metrics';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = { title: 'أداء الطالب' };

export default async function StudentPerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ course?: string }>;
}) {
  const user = await requireRole('admin', 'supervisor');
  const { studentId } = await params;
  const { course } = await searchParams;
  if (!isUuid(studentId)) notFound();

  const student = await db.query.users.findFirst({ where: eq(users.id, studentId) });
  if (!student || student.role !== 'student') notFound();

  // The supervisor scope limits the rows to courses where this supervisor supervises the student.
  const scope = user.role === 'admin' ? ({ kind: 'all' } as const) : ({ kind: 'supervisor', supervisorId: user.id } as const);
  const allPairs = await loadPairs(scope, { studentId });
  if (user.role === 'supervisor' && allPairs.length === 0) notFound();
  const pairs = isUuid(course) && allPairs.some((p) => p.courseId === course) ? allPairs.filter((p) => p.courseId === course) : allPairs;
  const stats = computeStats(pairs);
  const now = new Date();

  const byCourse = new Map<string, typeof pairs>();
  for (const p of pairs) byCourse.set(p.courseId, [...(byCourse.get(p.courseId) ?? []), p]);

  return (
    <>
      <PageHeader
        title={student.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="ltr">{student.email}</span>
            {!student.isActive ? <Badge tone="red">حساب موقوف</Badge> : null}
          </span>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="سلّم من المستحق" value={`${stats.submittedDue} من ${stats.due}`} />
        <StatCard label="نسبة التسليم" value={formatPercent(stats.submissionRate)} />
        <StatCard label="متأخر" value={stats.late} />
        <StatCard label="لم يُسلِّم" value={stats.missing} tone={stats.missing > 0 ? 'warn' : 'default'} />
        <StatCard label="متوسط الدرجات" value={formatPercent(stats.averageGrade)} />
      </div>

      {byCourse.size === 0 ? (
        <EmptyState>الطالب غير مسجّل في أي مجموعة حالياً.</EmptyState>
      ) : (
        <div className="space-y-6">
          {[...byCourse.values()].map((rows) => {
            const first = rows[0];
            const withAssignments = rows.filter((r) => r.assignmentId);
            return (
              <Card key={first.courseId} title={`${first.courseTitle} — ${first.groupName}`}>
                {withAssignments.length === 0 ? (
                  <EmptyState>لا توجد واجبات منشورة في هذه الدورة.</EmptyState>
                ) : (
                  <TableWrap>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>الواجب</th>
                          <th>آخر موعد</th>
                          <th>الحالة</th>
                          <th>الدرجة</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {withAssignments.map((r) => (
                          <tr key={r.assignmentId}>
                            <td>{r.assignmentTitle}</td>
                            <td className="text-xs">{formatDateTime(r.dueAt)}</td>
                            <td>
                              <SubmissionStatusBadge status={r.status} isLate={r.isLate} dueAt={r.dueAt as Date} now={now} />
                            </td>
                            <td>{r.grade !== null ? `${formatNumber(r.grade)} من ${r.maxScore}` : '—'}</td>
                            <td>
                              {r.submissionId ? (
                                <Link className="link text-xs" href={`/staff/submissions/${r.submissionId}`}>
                                  عرض الحل
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
            );
          })}
        </div>
      )}
    </>
  );
}
