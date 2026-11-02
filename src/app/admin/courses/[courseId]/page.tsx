import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { ActionForm, ConfirmButton, SubmitButton } from '@/components/forms';
import { Badge, Card, EmptyState, LinkButton, PageHeader, TableWrap } from '@/components/ui';
import { db } from '@/lib/db';
import { assignments, courses } from '@/lib/db/schema';
import { formatDateTime } from '@/lib/format';
import { isUuid } from '@/lib/validation';
import { createGroupAction, deleteCourseAction, updateCourseAction } from '../../actions';

export const metadata: Metadata = { title: 'تفاصيل الدورة' };

export default async function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  if (!isUuid(courseId)) notFound();
  const course = await db.query.courses.findFirst({ where: eq(courses.id, courseId) });
  if (!course) notFound();

  const groupRows = await db.execute<{ id: string; name: string; students: number; supervisors: string | null }>(sql`
    SELECT g.id, g.name,
      (SELECT count(*)::int FROM group_students gs WHERE gs.group_id = g.id) AS students,
      (SELECT string_agg(u.name, '، ' ORDER BY u.name) FROM group_supervisors s JOIN users u ON u.id = s.supervisor_id WHERE s.group_id = g.id) AS supervisors
    FROM groups g WHERE g.course_id = ${courseId}
    ORDER BY g.name
  `);
  const assignmentRows = await db
    .select({
      id: assignments.id,
      title: assignments.title,
      dueAt: assignments.dueAt,
      isPublished: assignments.isPublished,
      submitted: sql<number>`(SELECT count(*)::int FROM submissions s WHERE s.assignment_id = ${assignments.id})`,
    })
    .from(assignments)
    .where(eq(assignments.courseId, courseId))
    .orderBy(desc(assignments.dueAt), asc(assignments.title));
  const now = new Date();

  return (
    <>
      <PageHeader
        title={course.title}
        subtitle={
          <Link href="/admin/courses" className="link">
            ← كل الدورات
          </Link>
        }
        actions={<LinkButton href={`/admin?course=${course.id}`}>لوحة متابعة الدورة</LinkButton>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={`المجموعات (${groupRows.rows.length})`}>
            {groupRows.rows.length === 0 ? (
              <EmptyState>لا توجد مجموعات. أضف مجموعة ثم أضف إليها الطلاب والمشرفين.</EmptyState>
            ) : (
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr>
                      <th>المجموعة</th>
                      <th>المشرفون</th>
                      <th>الطلاب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupRows.rows.map((g) => (
                      <tr key={g.id}>
                        <td>
                          <Link className="link" href={`/admin/groups/${g.id}`}>
                            {g.name}
                          </Link>
                        </td>
                        <td className="text-xs">{g.supervisors ?? <Badge tone="red">بدون مشرف</Badge>}</td>
                        <td>{g.students}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            <ActionForm action={createGroupAction} className="mt-4 flex flex-wrap items-end gap-2" resetOnSuccess>
              <input type="hidden" name="courseId" value={course.id} />
              <div className="min-w-48 flex-1">
                <label className="label" htmlFor="group-name">
                  مجموعة جديدة
                </label>
                <input id="group-name" name="name" className="field" placeholder="مثال: المجموعة أ" required maxLength={100} />
              </div>
              <SubmitButton>إضافة مجموعة</SubmitButton>
            </ActionForm>
          </Card>

          <Card title={`الواجبات (${assignmentRows.length})`} actions={<LinkButton href={`/admin/assignments/new?course=${course.id}`} variant="primary" size="sm">+ واجب جديد</LinkButton>}>
            {assignmentRows.length === 0 ? (
              <EmptyState>لا توجد واجبات بعد.</EmptyState>
            ) : (
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr>
                      <th>الواجب</th>
                      <th>آخر موعد</th>
                      <th>الحلول</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignmentRows.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <Link className="link" href={`/admin/assignments/${a.id}`}>
                            {a.title}
                          </Link>{' '}
                          {!a.isPublished ? <Badge>مسودة</Badge> : a.dueAt > now ? <Badge tone="blue">مفتوح</Badge> : <Badge>منتهي</Badge>}
                        </td>
                        <td className="text-xs">{formatDateTime(a.dueAt)}</td>
                        <td>{a.submitted}</td>
                        <td>
                          <Link className="link text-xs" href={`/staff/assignments/${a.id}`}>
                            عرض الحلول
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="بيانات الدورة">
            <ActionForm action={updateCourseAction} className="space-y-3">
              <input type="hidden" name="courseId" value={course.id} />
              <div>
                <label className="label" htmlFor="title">
                  اسم الدورة
                </label>
                <input id="title" name="title" className="field" defaultValue={course.title} required maxLength={150} />
              </div>
              <div>
                <label className="label" htmlFor="description">
                  الوصف
                </label>
                <textarea id="description" name="description" className="field" rows={4} defaultValue={course.description} maxLength={2000} />
              </div>
              <SubmitButton>حفظ</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="حذف الدورة">
            <p className="mb-3 text-sm text-gray-600">يحذف الدورة بكل مجموعاتها وواجباتها وحلول الطلاب نهائياً.</p>
            <form action={deleteCourseAction}>
              <input type="hidden" name="courseId" value={course.id} />
              <ConfirmButton message={`حذف دورة «${course.title}» بكل محتواها نهائياً؟`}>حذف الدورة</ConfirmButton>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
