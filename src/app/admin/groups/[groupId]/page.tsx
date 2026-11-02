import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, eq, gt, isNull, ne } from 'drizzle-orm';
import { ActionForm, ConfirmButton, SubmitButton } from '@/components/forms';
import { Badge, Card, EmptyState, PageHeader, TableWrap } from '@/components/ui';
import { db } from '@/lib/db';
import { courses, groupStudents, groupSupervisors, groups, invitations, users } from '@/lib/db/schema';
import { formatDateTime } from '@/lib/format';
import { isUuid } from '@/lib/validation';
import {
  addStudentAction,
  assignSupervisorAction,
  deleteGroupAction,
  moveStudentAction,
  removeStudentAction,
  removeSupervisorAction,
  renameGroupAction,
} from '../../actions';

export const metadata: Metadata = { title: 'المجموعة' };

export default async function GroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  if (!isUuid(groupId)) notFound();
  const group = await db.query.groups.findFirst({ where: eq(groups.id, groupId) });
  if (!group) notFound();
  const course = await db.query.courses.findFirst({ where: eq(courses.id, group.courseId) });

  const [supervisors, students, allSupervisors, otherGroups, pendingInvites] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(groupSupervisors)
      .innerJoin(users, eq(users.id, groupSupervisors.supervisorId))
      .where(eq(groupSupervisors.groupId, groupId))
      .orderBy(asc(users.name)),
    db
      .select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive })
      .from(groupStudents)
      .innerJoin(users, eq(users.id, groupStudents.studentId))
      .where(eq(groupStudents.groupId, groupId))
      .orderBy(asc(users.name)),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.role, 'supervisor'), eq(users.isActive, true)))
      .orderBy(asc(users.name)),
    db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(and(eq(groups.courseId, group.courseId), ne(groups.id, groupId)))
      .orderBy(asc(groups.name)),
    db
      .select({ id: invitations.id, name: invitations.name, email: invitations.email, expiresAt: invitations.expiresAt })
      .from(invitations)
      .where(
        and(
          eq(invitations.groupId, groupId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(invitations.name)),
  ]);
  const available = allSupervisors.filter((s) => !supervisors.some((x) => x.id === s.id));

  return (
    <>
      <PageHeader
        title={group.name}
        subtitle={
          <Link href={`/admin/courses/${group.courseId}`} className="link">
            ← {course?.title}
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={`الطلاب (${students.length})`}>
            {students.length === 0 ? (
              <EmptyState>لا يوجد طلاب في هذه المجموعة بعد.</EmptyState>
            ) : (
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr>
                      <th>الاسم</th>
                      <th>البريد</th>
                      <th>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <Link className="link" href={`/staff/students/${s.id}?course=${group.courseId}`}>
                            {s.name}
                          </Link>{' '}
                          {!s.isActive ? <Badge tone="red">موقوف</Badge> : null}
                        </td>
                        <td className="ltr text-xs text-gray-600">{s.email}</td>
                        <td>
                          <div className="flex flex-wrap items-center gap-2">
                            {otherGroups.length > 0 ? (
                              <form action={moveStudentAction} className="flex items-center gap-1">
                                <input type="hidden" name="groupId" value={groupId} />
                                <input type="hidden" name="studentId" value={s.id} />
                                <select name="toGroupId" className="field w-auto py-1 text-xs" aria-label="نقل إلى">
                                  {otherGroups.map((g) => (
                                    <option key={g.id} value={g.id}>
                                      {g.name}
                                    </option>
                                  ))}
                                </select>
                                <ConfirmButton variant="secondary" message={`نقل ${s.name} إلى المجموعة المختارة؟`}>
                                  نقل
                                </ConfirmButton>
                              </form>
                            ) : null}
                            <form action={removeStudentAction}>
                              <input type="hidden" name="groupId" value={groupId} />
                              <input type="hidden" name="studentId" value={s.id} />
                              <ConfirmButton message={`إزالة ${s.name} من المجموعة؟ تبقى حلوله السابقة محفوظة.`}>إزالة</ConfirmButton>
                            </form>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            {pendingInvites.length > 0 ? (
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-semibold text-gray-700">دعوات لم تُقبل بعد</h3>
                <ul className="space-y-1 text-sm text-gray-600">
                  {pendingInvites.map((i) => (
                    <li key={i.id}>
                      {i.name} — <span className="ltr text-xs">{i.email}</span>{' '}
                      <span className="text-xs text-gray-400">(تنتهي {formatDateTime(i.expiresAt)})</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-gray-400">
                  لإعادة إرسال رابط أو إلغائه: صفحة <Link className="link" href="/admin/users">المستخدمون والدعوات</Link>.
                </p>
              </div>
            ) : null}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="إضافة طالب">
            <ActionForm action={addStudentAction} className="space-y-3" resetOnSuccess>
              <input type="hidden" name="groupId" value={groupId} />
              <div>
                <label className="label" htmlFor="student-name">
                  اسم الطالب
                </label>
                <input id="student-name" name="name" className="field" required maxLength={100} />
              </div>
              <div>
                <label className="label" htmlFor="student-email">
                  البريد الإلكتروني
                </label>
                <input id="student-email" name="email" type="email" className="field ltr text-left" required />
              </div>
              <SubmitButton>إضافة وإنشاء رابط دعوة</SubmitButton>
              <p className="text-xs text-gray-500">إذا كان للطالب حساب مسبق يُضاف مباشرة، وإلا يظهر لك رابط دعوة ترسله له.</p>
            </ActionForm>
          </Card>

          <Card title={`المشرفون (${supervisors.length} من 2)`}>
            {supervisors.length === 0 ? (
              <p className="mb-3 text-sm text-red-700">لا يوجد مشرف لهذه المجموعة.</p>
            ) : (
              <ul className="mb-3 space-y-2">
                {supervisors.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>{s.name}</span>
                    <form action={removeSupervisorAction}>
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="supervisorId" value={s.id} />
                      <ConfirmButton message={`إلغاء إشراف ${s.name} على هذه المجموعة؟`}>إلغاء</ConfirmButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            {supervisors.length < 2 ? (
              available.length > 0 ? (
                <ActionForm action={assignSupervisorAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="groupId" value={groupId} />
                  <select name="supervisorId" className="field flex-1" aria-label="اختر مشرفاً" required>
                    {available.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <SubmitButton size="sm">إضافة مشرف</SubmitButton>
                </ActionForm>
              ) : (
                <p className="text-xs text-gray-500">
                  لا يوجد مشرفون متاحون. ادعُ مشرفاً من صفحة <Link className="link" href="/admin/users">المستخدمون والدعوات</Link>.
                </p>
              )
            ) : null}
          </Card>

          <Card title="إعدادات المجموعة">
            <ActionForm action={renameGroupAction} className="space-y-3">
              <input type="hidden" name="groupId" value={groupId} />
              <div>
                <label className="label" htmlFor="group-name">
                  اسم المجموعة
                </label>
                <input id="group-name" name="name" className="field" defaultValue={group.name} required maxLength={100} />
              </div>
              <SubmitButton size="sm">حفظ الاسم</SubmitButton>
            </ActionForm>
            <form action={deleteGroupAction} className="mt-4 border-t border-gray-100 pt-4">
              <input type="hidden" name="groupId" value={groupId} />
              <ConfirmButton message="حذف المجموعة؟ يُزال الطلاب منها وتبقى حلولهم محفوظة.">حذف المجموعة</ConfirmButton>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
