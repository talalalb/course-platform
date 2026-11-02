import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ActionForm, SubmitButton } from '@/components/forms';
import { getCurrentUser, homePathFor } from '@/lib/auth/current-user';
import { loginAction } from './actions';

export const metadata: Metadata = { title: 'تسجيل الدخول' };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(homePathFor(user.role));
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-xl font-bold text-gray-900">منصة الدورات</h1>
        <p className="mt-1 text-sm text-gray-500">سجّل الدخول للمتابعة</p>
        <ActionForm action={loginAction} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="email">
              البريد الإلكتروني
            </label>
            <input id="email" name="email" type="email" required autoComplete="email" className="field ltr text-left" />
          </div>
          <div>
            <label className="label" htmlFor="password">
              كلمة المرور
            </label>
            <input id="password" name="password" type="password" required autoComplete="current-password" className="field ltr text-left" />
          </div>
          <SubmitButton pendingText="جارٍ الدخول…">دخول</SubmitButton>
        </ActionForm>
        <p className="mt-6 text-xs text-gray-400">الحسابات تُنشأ بدعوة من الإدارة فقط. نسيت كلمة المرور؟ اطلب من الإدارة رابط تعيين كلمة مرور جديدة.</p>
      </div>
    </div>
  );
}
