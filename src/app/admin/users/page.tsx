import type { Metadata } from 'next';
import Link from 'next/link';
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { ActionForm, ConfirmButton, SubmitButton } from '@/components/forms';
import { Badge, Card, EmptyState, PageHeader, TableWrap } from '@/components/ui';
import { requireRole } from '@/lib/auth/current-user';
import { db } from '@/lib/db';
import { groups, invitations, users } from '@/lib/db/schema';
import { formatDateTime } from '@/lib/format';
import {
  createPasswordResetAction,
  inviteSupervisorAction,
  regenerateInvitationAction,
  revokeInvitationAction,
  setUserActiveAction,
} from '../actions';

export const metadata: Metadata = { title: 'المستخدمون والدعوات' };

const ROLE_LABEL = { admin: 'مدير', supervisor: 'مشرف', student: 'طالب' } as const;
const FILTERS = [
  { value: '', label: 'الكل' },
  { value: 'student', label: 'الطلاب' },
  { value: 'supervisor', label: 'المشرفون' },
  { value: 'admin', label: 'المدراء' },
] as const;

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const me = await requireRole('admin');
  const { role } = await searchParams;
  const roleFilter = role === 'student' || role === 'supervisor' || role === 'admin' ? role : undefined;

  const userRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
      // Outer columns are written literally: drizzle renders interpolated columns of a single-table select unqualified.
      groupNames: sql<string | null>`(
        SELECT string_agg(c.title || ' — ' || g.name, '، ' ORDER BY c.title, g.name)
        FROM groups g JOIN courses c ON c.id = g.course_id
        WHERE g.id IN (SELECT gs.group_id FROM group_students gs WHERE gs.student_id = users.id
                       UNION SELECT gv.group_id FROM group_supervisors gv WHERE gv.supervisor_id = users.id)
      )`,
    })
    .from(users)
    .where(roleFilter ? eq(users.role, roleFilter) : undefined)
    .orderBy(asc(users.role), asc(users.name));

  const pending = await db
    .select({
      id: invitations.id,
      name: invitations.name,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      groupName: groups.name,
    })
    .from(invitations)
    .leftJoin(groups, eq(groups.id, invitations.groupId))
    .where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())))
    .orderBy(desc(invitations.createdAt));

  return (
    <>
      <PageHeader title="المستخدمون والدعوات" subtitle="الطلاب يُضافون من صفحة المجموعة، والمشرفون يُدعون من هنا" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card
            title={`المستخدمون (${userRows.length})`}
            actions={
              <div className="flex flex-wrap gap-1">
                {FILTERS.map((f) => (
                  <Link
                    key={f.value}
                    href={f.value ? `/admin/users?role=${f.value}` : '/admin/users'}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium ${(roleFilter ?? '') === f.value ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  >
                    {f.label}
                  </Link>
                ))}
              </div>
            }
          >
            {userRows.length === 0 ? (
              <EmptyState>لا يوجد مستخدمون.</EmptyState>
            ) : (
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr>
                      <th>الاسم</th>
                      <th>الدور</th>
                      <th>المجموعات</th>
                      <th>الحالة</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {userRows.map((u) => (
                      <tr key={u.id}>
                        <td>
                          {u.role === 'student' ? (
                            <Link className="link" href={`/staff/students/${u.id}`}>
                              {u.name}
                            </Link>
                          ) : (
                            <span className="font-medium">{u.name}</span>
                          )}
                          <div className="ltr text-xs text-gray-500">{u.email}</div>
                        </td>
                        <td>
                          <Badge tone={u.role === 'admin' ? 'purple' : u.role === 'supervisor' ? 'blue' : 'gray'}>{ROLE_LABEL[u.role]}</Badge>
                        </td>
                        <td className="text-xs">{u.groupNames ?? '—'}</td>
                        <td>{u.isActive ? <Badge tone="green">نشط</Badge> : <Badge tone="red">موقوف</Badge>}</td>
                        <td>
                          {u.id !== me.id ? (
                            <div className="flex flex-col items-start gap-2">
                              <form action={setUserActiveAction}>
                                <input type="hidden" name="userId" value={u.id} />
                                <input type="hidden" name="active" value={u.isActive ? 'false' : 'true'} />
                                <ConfirmButton
                                  variant={u.isActive ? 'danger' : 'secondary'}
                                  message={u.isActive ? `إيقاف حساب ${u.name}؟ لن يستطيع الدخول وتبقى بياناته محفوظة.${u.role === 'supervisor' ? ' وسيُزال من الإشراف على مجموعاته.' : ''}` : `إعادة تفعيل حساب ${u.name}؟`}
                                >
                                  {u.isActive ? 'إيقاف' : 'تفعيل'}
                                </ConfirmButton>
                              </form>
                              {u.isActive ? (
                                <ActionForm action={createPasswordResetAction}>
                                  <input type="hidden" name="userId" value={u.id} />
                                  <SubmitButton size="sm" variant="secondary" pendingText="جارٍ الإنشاء…">
                                    رابط كلمة مرور جديدة
                                  </SubmitButton>
                                </ActionForm>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">حسابك</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <Card title={`دعوات بانتظار القبول (${pending.length})`}>
            {pending.length === 0 ? (
              <EmptyState>لا توجد دعوات معلّقة.</EmptyState>
            ) : (
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr>
                      <th>المدعو</th>
                      <th>الدور</th>
                      <th>تنتهي</th>
                      <th>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((i) => (
                      <tr key={i.id}>
                        <td>
                          {i.name}
                          <div className="ltr text-xs text-gray-500">{i.email}</div>
                        </td>
                        <td className="text-xs">
                          {ROLE_LABEL[i.role]}
                          {i.groupName ? ` — ${i.groupName}` : ''}
                        </td>
                        <td className="text-xs">{formatDateTime(i.expiresAt)}</td>
                        <td>
                          <div className="flex flex-col gap-2">
                            <ActionForm action={regenerateInvitationAction}>
                              <input type="hidden" name="invitationId" value={i.id} />
                              <SubmitButton size="sm" variant="secondary">
                                رابط جديد
                              </SubmitButton>
                            </ActionForm>
                            <form action={revokeInvitationAction}>
                              <input type="hidden" name="invitationId" value={i.id} />
                              <ConfirmButton message="إلغاء هذه الدعوة؟ سيتوقف الرابط فوراً.">إلغاء</ConfirmButton>
                            </form>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            <p className="mt-3 text-xs text-gray-500">لأسباب أمنية لا نحتفظ بالروابط؛ «رابط جديد» ينشئ رابطاً جديداً ويوقف القديم.</p>
          </Card>
        </div>

        <Card title="دعوة مشرف">
          <ActionForm action={inviteSupervisorAction} className="space-y-3" resetOnSuccess>
            <div>
              <label className="label" htmlFor="sup-name">
                اسم المشرف
              </label>
              <input id="sup-name" name="name" className="field" required maxLength={100} />
            </div>
            <div>
              <label className="label" htmlFor="sup-email">
                البريد الإلكتروني
              </label>
              <input id="sup-email" name="email" type="email" className="field ltr text-left" required />
            </div>
            <SubmitButton>إنشاء رابط دعوة</SubmitButton>
            <p className="text-xs text-gray-500">بعد قبول الدعوة اربط المشرف بمجموعاته من صفحة كل مجموعة.</p>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
