import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { Card, PageHeader } from '@/components/ui';
import { db } from '@/lib/db';
import { courses } from '@/lib/db/schema';
import { isUuid } from '@/lib/validation';
import { createAssignmentAction } from '../../actions';
import { AssignmentForm } from '../AssignmentForm';

export const metadata: Metadata = { title: 'واجب جديد' };

export default async function NewAssignmentPage({ searchParams }: { searchParams: Promise<{ course?: string }> }) {
  const { course: courseId } = await searchParams;
  if (!isUuid(courseId)) notFound();
  const course = await db.query.courses.findFirst({ where: eq(courses.id, courseId) });
  if (!course) notFound();

  const defaultDue = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  defaultDue.setUTCHours(20, 59, 0, 0); // 23:59 Riyadh time

  return (
    <>
      <PageHeader
        title="واجب جديد"
        subtitle={
          <Link className="link" href={`/admin/courses/${course.id}`}>
            ← {course.title}
          </Link>
        }
      />
      <div className="max-w-2xl">
        <Card>
          <AssignmentForm
            action={createAssignmentAction}
            submitLabel="إنشاء الواجب"
            values={{ courseId: course.id, title: '', description: '', dueAt: defaultDue, maxScore: 100, allowLate: true, isPublished: true }}
          />
          <p className="mt-4 text-xs text-gray-500">يمكنك إرفاق ملفات للواجب (PDF أو صور) بعد إنشائه.</p>
        </Card>
      </div>
    </>
  );
}
