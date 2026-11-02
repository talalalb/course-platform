import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth/current-user';
import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Card, EmptyState, PageHeader, TableWrap } from '@/components/ui';
import { db } from '@/lib/db';
import { createCourseAction } from '../actions';

export const metadata: Metadata = { title: 'الدورات' };

export default async function CoursesPage() {
  // Each page checks access itself: a layout's redirect does not stop the page from rendering.
  await requireRole('admin');
  const result = await db.execute<{ id: string; title: string; groups: number; students: number; assignments: number }>(sql`
    SELECT c.id, c.title,
      (SELECT count(*)::int FROM groups g WHERE g.course_id = c.id) AS groups,
      (SELECT count(*)::int FROM group_students gs WHERE gs.course_id = c.id) AS students,
      (SELECT count(*)::int FROM assignments a WHERE a.course_id = c.id) AS assignments
    FROM courses c
    ORDER BY c.created_at DESC
  `);
  const list = result.rows;

  return (
    <>
      <PageHeader title="الدورات" subtitle="كل دورة تحتوي على مجموعات طلاب وواجبات" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title={`الدورات (${list.length})`}>
            {list.length === 0 ? (
              <EmptyState>لا توجد دورات بعد. أضف أول دورة من النموذج.</EmptyState>
            ) : (
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr>
                      <th>الدورة</th>
                      <th>المجموعات</th>
                      <th>الطلاب</th>
                      <th>الواجبات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link className="link" href={`/admin/courses/${c.id}`}>
                            {c.title}
                          </Link>
                        </td>
                        <td>{c.groups}</td>
                        <td>{c.students}</td>
                        <td>{c.assignments}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </div>
        <Card title="إضافة دورة">
          <ActionForm action={createCourseAction} className="space-y-3">
            <div>
              <label className="label" htmlFor="title">
                اسم الدورة
              </label>
              <input id="title" name="title" className="field" required maxLength={150} />
            </div>
            <div>
              <label className="label" htmlFor="description">
                وصف مختصر (اختياري)
              </label>
              <textarea id="description" name="description" className="field" rows={3} maxLength={2000} />
            </div>
            <SubmitButton>إضافة الدورة</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
