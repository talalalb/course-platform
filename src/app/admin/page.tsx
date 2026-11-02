import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth/current-user';
import { PerformanceDashboard } from '@/components/PerformanceDashboard';
import { PageHeader } from '@/components/ui';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = { title: 'لوحة المتابعة' };

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ course?: string }> }) {
  // Each page checks access itself: a layout's redirect does not stop the page from rendering.
  await requireRole('admin');
  const { course } = await searchParams;
  return (
    <>
      <PageHeader title="لوحة متابعة الإدارة" subtitle="أداء جميع الطلاب والمجموعات والمشرفين" />
      <PerformanceDashboard scope={{ kind: 'all' }} courseId={isUuid(course) ? course : undefined} basePath="/admin" />
    </>
  );
}
