import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-bold text-gray-900">الصفحة غير موجودة</h1>
      <p className="text-sm text-gray-500">قد يكون الرابط خاطئاً، أو ليست لديك صلاحية لعرض هذه الصفحة.</p>
      <Link href="/" className="btn btn-primary">
        العودة للرئيسية
      </Link>
    </div>
  );
}
