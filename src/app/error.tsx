'use client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-bold text-gray-900">حدث خطأ</h1>
      <p className="text-sm text-gray-500">لم تكتمل العملية. حاول مرة أخرى، وإن تكرر الخطأ تواصل مع الإدارة.</p>
      <div className="flex gap-2">
        <button type="button" onClick={reset} className="btn btn-primary">
          إعادة المحاولة
        </button>
        <a href="/" className="btn btn-secondary">
          الرئيسية
        </a>
      </div>
    </div>
  );
}
