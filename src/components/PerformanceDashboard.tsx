import Link from 'next/link';
import { eq, inArray } from 'drizzle-orm';
import { AutoSubmitSelect } from '@/components/forms';
import { Badge, Card, EmptyState, StatCard, TableWrap } from '@/components/ui';
import { db } from '@/lib/db';
import { courses, groupSupervisors, groups, users } from '@/lib/db/schema';
import { formatDateTime, formatPercent } from '@/lib/format';
import {
  computeStats,
  loadPairs,
  needsAttention,
  pendingReviews,
  summarizeByAssignment,
  summarizeByGroup,
  summarizeByStudent,
  type Scope,
} from '@/lib/metrics';

function rateTone(rate: number | null): 'green' | 'amber' | 'red' | 'gray' {
  if (rate === null) return 'gray';
  if (rate >= 80) return 'green';
  if (rate >= 50) return 'amber';
  return 'red';
}

async function supervisorsByGroup(groupIds: string[]) {
  if (groupIds.length === 0) return new Map<string, { id: string; name: string }[]>();
  const rows = await db
    .select({ groupId: groupSupervisors.groupId, id: users.id, name: users.name })
    .from(groupSupervisors)
    .innerJoin(users, eq(users.id, groupSupervisors.supervisorId))
    .where(inArray(groupSupervisors.groupId, groupIds));
  const map = new Map<string, { id: string; name: string }[]>();
  for (const r of rows) map.set(r.groupId, [...(map.get(r.groupId) ?? []), { id: r.id, name: r.name }]);
  return map;
}

export async function PerformanceDashboard({
  scope,
  courseId,
  basePath,
}: {
  scope: Scope;
  courseId?: string;
  basePath: string;
}) {
  const isAdmin = scope.kind === 'all';
  const now = new Date();

  // Courses offered in the filter: all for admin, supervised ones for a supervisor.
  const courseOptions =
    scope.kind === 'all'
      ? await db.select({ id: courses.id, title: courses.title }).from(courses).orderBy(courses.title)
      : await db
          .selectDistinct({ id: courses.id, title: courses.title })
          .from(courses)
          .innerJoin(groups, eq(groups.courseId, courses.id))
          .innerJoin(groupSupervisors, eq(groupSupervisors.groupId, groups.id))
          .where(eq(groupSupervisors.supervisorId, scope.supervisorId))
          .orderBy(courses.title);
  const selectedCourse = courseId && courseOptions.some((c) => c.id === courseId) ? courseId : undefined;

  const pairs = await loadPairs(scope, { courseId: selectedCourse });
  const overall = computeStats(pairs, now);
  const students = summarizeByStudent(pairs, now).sort((a, b) => a.studentName.localeCompare(b.studentName, 'ar'));
  const groupSummaries = summarizeByGroup(pairs, now);
  const assignmentSummaries = summarizeByAssignment(pairs, now);
  const attention = needsAttention(students);
  const pending = pendingReviews(pairs);
  const supMap = await supervisorsByGroup(groupSummaries.map((g) => g.groupId));

  let userCounts: { supervisors: number; courses: number; groups: number } | null = null;
  if (isAdmin) {
    const [supCount, courseCount, groupCount] = await Promise.all([
      db.$count(users, eq(users.role, 'supervisor')),
      db.$count(courses),
      db.$count(groups),
    ]);
    userCounts = { supervisors: supCount, courses: courseCount, groups: groupCount };
  }

  // Supervisor workload (admin view).
  const supervisorRows = new Map<string, { name: string; groups: string[]; students: number; pending: number; reviewed: number }>();
  if (isAdmin) {
    for (const g of groupSummaries) {
      for (const s of supMap.get(g.groupId) ?? []) {
        const row = supervisorRows.get(s.id) ?? { name: s.name, groups: [], students: 0, pending: 0, reviewed: 0 };
        row.groups.push(g.groupName);
        row.students += g.students;
        row.pending += g.pending;
        row.reviewed += g.reviewed;
        supervisorRows.set(s.id, row);
      }
    }
  }

  const exportHref = `/staff/export${selectedCourse ? `?course=${selectedCourse}` : ''}`;
  const studentHref = (studentId: string, cId: string) => `/staff/students/${studentId}?course=${cId}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form method="get" action={basePath}>
          <AutoSubmitSelect
            name="course"
            label="الدورة:"
            defaultValue={selectedCourse ?? ''}
            options={[{ value: '', label: 'كل الدورات' }, ...courseOptions.map((c) => ({ value: c.id, label: c.title }))]}
          />
        </form>
        <a href={exportHref} className="btn btn-secondary btn-sm">
          ⬇ تصدير إلى Excel
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={isAdmin ? 'الطلاب' : 'طلابي'} value={new Set(students.map((s) => s.studentId)).size} />
        <StatCard label="بانتظار التصحيح" value={overall.pending} tone={overall.pending > 0 ? 'warn' : 'default'} />
        <StatCard label="نسبة التسليم" value={formatPercent(overall.submissionRate)} hint="من الواجبات التي انتهى موعدها" />
        <StatCard label="متوسط الدرجات" value={formatPercent(overall.averageGrade)} hint="للحلول المصححة" />
        {userCounts ? (
          <>
            <StatCard label="المشرفون" value={userCounts.supervisors} />
            <StatCard label="الدورات" value={userCounts.courses} />
            <StatCard label="المجموعات" value={userCounts.groups} />
            <StatCard label="تسليمات متأخرة" value={overall.late} />
          </>
        ) : (
          <>
            <StatCard label="تسليمات متأخرة" value={overall.late} />
            <StatCard label="واجبات لم تُسلَّم" value={overall.missing} tone={overall.missing > 0 ? 'warn' : 'default'} />
          </>
        )}
      </div>

      <Card title={`بانتظار التصحيح (${pending.length})`}>
        {pending.length === 0 ? (
          <EmptyState>لا توجد حلول بانتظار التصحيح 🎉</EmptyState>
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>الطالب</th>
                  <th>المجموعة</th>
                  <th>الواجب</th>
                  <th>وقت التسليم</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pending.slice(0, 15).map((p) => (
                  <tr key={p.submissionId}>
                    <td>{p.studentName}</td>
                    <td>{p.groupName}</td>
                    <td>{p.assignmentTitle}</td>
                    <td>
                      {formatDateTime(p.submittedAt)} {p.isLate ? <Badge tone="amber">متأخر</Badge> : null}
                    </td>
                    <td>
                      <Link className="btn btn-primary btn-sm" href={`/staff/submissions/${p.submissionId}`}>
                        تصحيح
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pending.length > 15 ? <p className="mt-2 text-xs text-gray-500">يُعرض أقدم 15 حلاً فقط.</p> : null}
          </TableWrap>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="المجموعات">
          {groupSummaries.length === 0 ? (
            <EmptyState>لا توجد مجموعات بها طلاب.</EmptyState>
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>المجموعة</th>
                    <th>المشرف</th>
                    <th>الطلاب</th>
                    <th>التسليم</th>
                    <th>المتوسط</th>
                    <th>بانتظار</th>
                  </tr>
                </thead>
                <tbody>
                  {groupSummaries.map((g) => (
                    <tr key={g.groupId}>
                      <td>
                        <div className="font-medium">{g.groupName}</div>
                        <div className="text-xs text-gray-500">{g.courseTitle}</div>
                      </td>
                      <td className="text-xs">{(supMap.get(g.groupId) ?? []).map((s) => s.name).join('، ') || <Badge tone="red">بدون مشرف</Badge>}</td>
                      <td>{g.students}</td>
                      <td>
                        <Badge tone={rateTone(g.submissionRate)}>{formatPercent(g.submissionRate)}</Badge>
                      </td>
                      <td>{formatPercent(g.averageGrade)}</td>
                      <td>{g.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card title="طلاب يحتاجون متابعة">
          {attention.length === 0 ? (
            <EmptyState>لا يوجد طلاب متأخرون أو بمتوسط أقل من 60%.</EmptyState>
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>الطالب</th>
                    <th>المجموعة</th>
                    <th>لم يُسلِّم</th>
                    <th>المتوسط</th>
                  </tr>
                </thead>
                <tbody>
                  {attention.slice(0, 15).map((s) => (
                    <tr key={`${s.studentId}:${s.courseId}`}>
                      <td>
                        <Link className="link" href={studentHref(s.studentId, s.courseId)}>
                          {s.studentName}
                        </Link>
                      </td>
                      <td className="text-xs">{s.groupName}</td>
                      <td>{s.missing > 0 ? <Badge tone="red">{s.missing}</Badge> : 0}</td>
                      <td>{s.averageGrade !== null && s.averageGrade < 60 ? <Badge tone="red">{formatPercent(s.averageGrade)}</Badge> : formatPercent(s.averageGrade)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>

      {isAdmin ? (
        <Card title="المشرفون">
          {supervisorRows.size === 0 ? (
            <EmptyState>لم يُربط أي مشرف بمجموعة بعد.</EmptyState>
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>المشرف</th>
                    <th>المجموعات</th>
                    <th>الطلاب</th>
                    <th>بانتظار التصحيح</th>
                    <th>تم تصحيحه</th>
                  </tr>
                </thead>
                <tbody>
                  {[...supervisorRows.entries()].map(([id, s]) => (
                    <tr key={id}>
                      <td className="font-medium">{s.name}</td>
                      <td className="text-xs">{s.groups.join('، ')}</td>
                      <td>{s.students}</td>
                      <td>{s.pending > 0 ? <Badge tone="amber">{s.pending}</Badge> : 0}</td>
                      <td>{s.reviewed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      ) : null}

      <Card title="الواجبات">
        {assignmentSummaries.length === 0 ? (
          <EmptyState>لا توجد واجبات منشورة.</EmptyState>
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>الواجب</th>
                  <th>آخر موعد</th>
                  <th>سلّم</th>
                  <th>متأخر</th>
                  <th>تم تصحيحه</th>
                  <th>المتوسط</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {assignmentSummaries.map((a) => (
                  <tr key={a.assignmentId}>
                    <td>
                      <div className="font-medium">{a.assignmentTitle}</div>
                      <div className="text-xs text-gray-500">{a.courseTitle}</div>
                    </td>
                    <td className="text-xs">
                      {formatDateTime(a.dueAt)}
                      {a.dueAt > now ? <div><Badge tone="blue">مفتوح</Badge></div> : null}
                    </td>
                    <td>
                      {a.submitted} / {a.students}
                    </td>
                    <td>{a.late}</td>
                    <td>{a.reviewed}</td>
                    <td>{formatPercent(a.averageGrade)}</td>
                    <td>
                      <Link className="link text-xs" href={`/staff/assignments/${a.assignmentId}`}>
                        الحلول
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card title={isAdmin ? 'أداء الطلاب' : 'أداء طلابي'}>
        {students.length === 0 ? (
          <EmptyState>لا يوجد طلاب بعد.</EmptyState>
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>الطالب</th>
                  <th>المجموعة</th>
                  <th>سلّم / المستحق</th>
                  <th>متأخر</th>
                  <th>لم يُسلِّم</th>
                  <th>المتوسط</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={`${s.studentId}:${s.courseId}`}>
                    <td>
                      <Link className="link" href={studentHref(s.studentId, s.courseId)}>
                        {s.studentName}
                      </Link>
                    </td>
                    <td className="text-xs">
                      {s.groupName}
                      <div className="text-gray-400">{s.courseTitle}</div>
                    </td>
                    <td>
                      {s.submittedDue} / {s.due}
                    </td>
                    <td>{s.late}</td>
                    <td>{s.missing > 0 ? <Badge tone="red">{s.missing}</Badge> : 0}</td>
                    <td>{formatPercent(s.averageGrade)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
