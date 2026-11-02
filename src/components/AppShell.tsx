import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SessionUser } from '@/lib/auth/sessions';

const NAV: Record<SessionUser['role'], { href: string; label: string }[]> = {
  admin: [
    { href: '/admin', label: 'لوحة المتابعة' },
    { href: '/admin/courses', label: 'الدورات والمجموعات' },
    { href: '/admin/users', label: 'المستخدمون والدعوات' },
  ],
  supervisor: [{ href: '/supervisor', label: 'لوحة المتابعة' }],
  student: [{ href: '/student', label: 'واجباتي' }],
};

const ROLE_LABEL: Record<SessionUser['role'], string> = {
  admin: 'مدير',
  supervisor: 'مشرف',
  student: 'طالب',
};

export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-5">
            <Link href="/" className="text-lg font-bold text-brand-700">
              منصة الدورات
            </Link>
            <nav className="flex flex-wrap items-center gap-1">
              {NAV[user.role].map((item) => (
                <Link key={item.href} href={item.href} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">
              {user.name} <span className="text-xs text-gray-400">({ROLE_LABEL[user.role]})</span>
            </span>
            <form action="/logout" method="post">
              <button type="submit" className="btn btn-secondary btn-sm">
                خروج
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
