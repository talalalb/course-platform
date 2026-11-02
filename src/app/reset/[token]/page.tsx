import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/forms';
import { findUsableReset } from '@/lib/password-reset';
import { resetPasswordAction } from './actions';

export const metadata: Metadata = { title: 'تعيين كلمة مرور جديدة' };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reset = await findUsableReset(token);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-xl font-bold text-gray-900">تعيين كلمة مرور جديدة</h1>
        {!reset ? (
          <div className="mt-4 space-y-3 text-sm text-gray-600">
            <p>الرابط غير صالح أو انتهت صلاحيته. اطلب رابطاً جديداً من الإدارة.</p>
            <Link href="/login" className="link">
              الذهاب لصفحة الدخول
            </Link>
          </div>
        ) : (
          <ActionForm action={resetPasswordAction} className="mt-6 space-y-4">
            <input type="hidden" name="token" value={token} />
            <p className="text-sm text-gray-600">
              الحساب: <strong>{reset.name}</strong> — <bdi dir="ltr">{reset.email}</bdi>
            </p>
            <div>
              <label className="label" htmlFor="password">
                كلمة المرور الجديدة (8 أحرف على الأقل)
              </label>
              <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className="field ltr text-left" />
            </div>
            <div>
              <label className="label" htmlFor="confirm">
                تأكيد كلمة المرور
              </label>
              <input id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" className="field ltr text-left" />
            </div>
            <SubmitButton pendingText="جارٍ الحفظ…">حفظ كلمة المرور والدخول</SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
