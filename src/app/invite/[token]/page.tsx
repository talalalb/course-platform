import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/forms';
import { findUsableInvitation } from '@/lib/invitations';
import { acceptInviteAction } from './actions';

export const metadata: Metadata = { title: 'قبول الدعوة' };

const ROLE_LABEL = { admin: 'مدير', supervisor: 'مشرف', student: 'طالب' } as const;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Viewing this page never uses up the invitation; only submitting the form does.
  const invitation = await findUsableInvitation(token);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-xl font-bold text-gray-900">منصة الدورات</h1>
        {!invitation ? (
          <div className="mt-4 space-y-3 text-sm text-gray-600">
            <p>رابط الدعوة غير صالح أو انتهت صلاحيته. تواصل مع الإدارة لإرسال رابط جديد.</p>
            <Link href="/login" className="link">
              الذهاب لصفحة الدخول
            </Link>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-gray-600">
              أنت مدعو بصفة <strong>{ROLE_LABEL[invitation.role]}</strong>
              {invitation.courseTitle ? (
                <>
                  {' '}
                  في دورة <strong>{invitation.courseTitle}</strong> — {invitation.groupName}
                </>
              ) : null}
              . أكمل بياناتك لإنشاء حسابك.
            </p>
            <ActionForm action={acceptInviteAction} className="mt-6 space-y-4">
              <input type="hidden" name="token" value={token} />
              <div>
                <label className="label" htmlFor="invite-email">
                  البريد الإلكتروني
                </label>
                <input id="invite-email" className="field ltr bg-gray-50 text-left" value={invitation.email} readOnly disabled />
              </div>
              <div>
                <label className="label" htmlFor="name">
                  الاسم الكامل
                </label>
                <input id="name" name="name" className="field" defaultValue={invitation.name} required minLength={2} maxLength={100} />
              </div>
              <div>
                <label className="label" htmlFor="password">
                  كلمة المرور (8 أحرف على الأقل)
                </label>
                <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className="field ltr text-left" />
              </div>
              <div>
                <label className="label" htmlFor="confirm">
                  تأكيد كلمة المرور
                </label>
                <input id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" className="field ltr text-left" />
              </div>
              <SubmitButton pendingText="جارٍ إنشاء الحساب…">إنشاء الحساب</SubmitButton>
            </ActionForm>
          </>
        )}
      </div>
    </div>
  );
}
