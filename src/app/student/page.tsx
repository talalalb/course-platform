import type { Metadata } from 'next';
import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { Card, EmptyState, PageHeader, SubmissionStatusBadge, TableWrap } from '@/components/ui';
import { requireRole } from '@/lib/auth/current-user';
import { db } from '@/lib/db';
import { assignments, courses, groupStudents, groups, submissions } from '@/lib/db/schema';
import { formatDateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'واجباتي' };

export default async function StudentHome() {
  const student = await requireRole('student');
  const memberships = await db
    .select({ courseId: courses.id, courseTitle: courses.title, courseDescription: courses.description, groupName: groups.name })
    .from(groupStudents)
    .innerJoin(courses, eq(courses.id, groupStudents.courseId))
    .innerJoin(groups, eq(groups.id, groupStudents.groupId))
    .where(eq(groupStudents.studentId, student.id))
    .orderBy(courses.title);

  // Only status fields are read here; grades are never loaded for students.
  const rows = await db
    .select({
      id: assignments.id,
      courseId: assignments.courseId,
      title: assignments.title,
      dueAt: assignments.dueAt,
      allowLate: assignments.allowLate,
      status: submissions.status,
      isLate: submissions.isLate,
    })
    .from(groupStudents)
    .innerJoin(assignments, and(eq(assignments.courseId, groupStudents.courseId), eq(assignments.isPublished, true)))
    .leftJoin(submissions, and(eq(submissions.assignmentId, assignments.id), eq(submissions.studentId, student.id)))
    .where(eq(groupStudents.studentId, student.id));

  const now = new Date();
  const sortRows = (list: typeof rows) =>
    [...list].sort((a, b) => {
      const aOpen = a.dueAt > now;
      const bOpen = b.dueAt > now;
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      return aOpen ? a.dueAt.getTime() - b.dueAt.getTime() : b.dueAt.getTime() - a.dueAt.getTime();
    });
  const todo = rows.filter((r) => !r.status && (r.dueAt > now || r.allowLate));

  return (
    <>
      <PageHeader
        title={`مرحباً ${student.name}`}
        subtitle={todo.length > 0 ? `واجبات بانتظار التسليم: ${todo.length}` : 'لا توجد واجبات بانتظار التسليم'}
      />
      {memberships.length === 0 ? (
        <EmptyState>لم تتم إضافتك لأي مجموعة بعد. تواصل مع الإدارة.</EmptyState>
      ) : (
        <div className="space-y-6">
          {memberships.map((m) => {
            const list = sortRows(rows.filter((r) => r.courseId === m.courseId));
            return (
              <Card key={m.courseId} title={`${m.courseTitle} — ${m.groupName}`}>
                {m.courseDescription ? <p className="mb-3 text-sm text-gray-600">{m.courseDescription}</p> : null}
                {list.length === 0 ? (
                  <EmptyState>لا توجد واجبات بعد.</EmptyState>
                ) : (
                  <TableWrap>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>الواجب</th>
                          <th>آخر موعد</th>
                          <th>الحالة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((a) => (
                          <tr key={a.id}>
                            <td>
                              <Link className="link" href={`/student/assignments/${a.id}`}>
                                {a.title}
                              </Link>
                            </td>
                            <td className="text-xs">{formatDateTime(a.dueAt)}</td>
                            <td>
                              <SubmissionStatusBadge status={a.status} isLate={a.isLate} dueAt={a.dueAt} now={now} />
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
