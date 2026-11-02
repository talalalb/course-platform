import type { Metadata } from 'next';
import { PerformanceDashboard } from '@/components/PerformanceDashboard';
import { PageHeader } from '@/components/ui';
import { requireRole } from '@/lib/auth/current-user';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = { title: 'لوحة المتابعة' };

export default async function SupervisorDashboard({ searchParams }: { searchParams: Promise<{ course?: string }> }) {
  const user = await requireRole('supervisor');
  const { course } = await searchParams;
  return (
    <>
      <PageHeader title="لوحة متابعة المشرف" subtitle="طلاب مجموعاتك فقط" />
      <PerformanceDashboard
        scope={{ kind: 'supervisor', supervisorId: user.id }}
        courseId={isUuid(course) ? course : undefined}
        basePath="/supervisor"
      />
    </>
  );
}
