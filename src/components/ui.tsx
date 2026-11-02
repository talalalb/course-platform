import Link from 'next/link';
import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {subtitle ? <div className="mt-1 text-sm text-gray-500">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
          {title ? <h2 className="text-base font-semibold text-gray-900">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function StatCard({ label, value, hint, tone = 'default' }: { label: string; value: ReactNode; hint?: string; tone?: 'default' | 'warn' | 'good' }) {
  const toneClass = tone === 'warn' ? 'text-amber-700' : tone === 'good' ? 'text-emerald-700' : 'text-gray-900';
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-400">{hint}</div> : null}
    </div>
  );
}

const badgeTones = {
  gray: 'bg-gray-100 text-gray-700',
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-red-50 text-red-700',
  purple: 'bg-violet-50 text-violet-700',
} as const;

export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: keyof typeof badgeTones }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeTones[tone]}`}>{children}</span>;
}

/** File names mix Arabic and Latin (extension); isolate them so they read correctly inside Arabic text. */
export function FileName({ name, mimeType }: { name: string; mimeType?: string }) {
  return (
    <>
      {mimeType ? (mimeType === 'application/pdf' ? '📄 ' : '🖼️ ') : null}
      <bdi dir="ltr">{name}</bdi>
    </>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">{children}</p>;
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="-mx-4 overflow-x-auto px-4">{children}</div>;
}

export function LinkButton({ href, children, variant = 'secondary', size }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary'; size?: 'sm' }) {
  return (
    <Link href={href} className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''}`}>
      {children}
    </Link>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'success' | 'error'; children: ReactNode }) {
  const tones = {
    info: 'border-blue-200 bg-blue-50 text-blue-800',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    error: 'border-red-200 bg-red-50 text-red-800',
  };
  return <div className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}

/** Student-facing status of one assignment. Never derived from the grade. */
export function SubmissionStatusBadge({
  status,
  isLate,
  dueAt,
  now = new Date(),
}: {
  status: 'submitted' | 'reviewed' | null;
  isLate?: boolean | null;
  dueAt: Date;
  now?: Date;
}) {
  if (status === 'reviewed') return <Badge tone="green">تم التصحيح</Badge>;
  if (status === 'submitted') return isLate ? <Badge tone="amber">تم التسليم (متأخر)</Badge> : <Badge tone="blue">تم التسليم</Badge>;
  if (dueAt.getTime() < now.getTime()) return <Badge tone="red">لم يُسلَّم</Badge>;
  return <Badge>لم يُسلَّم بعد</Badge>;
}
