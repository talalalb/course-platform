import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { FileUploader } from '@/components/FileUploader';
import { ConfirmButton } from '@/components/forms';
import { Card, FileName, LinkButton, PageHeader } from '@/components/ui';
import { db } from '@/lib/db';
import { assignmentFiles, assignments, courses } from '@/lib/db/schema';
import { formatBytes } from '@/lib/format';
import { isUuid } from '@/lib/validation';
import { deleteAssignmentAction, deleteAttachmentAction, updateAssignmentAction } from '../../actions';
import { AssignmentForm } from '../AssignmentForm';

export const metadata: Metadata = { title: 'تعديل الواجب' };

export default async function EditAssignmentPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await params;
  if (!isUuid(assignmentId)) notFound();
  const assignment = await db.query.assignments.findFirst({ where: eq(assignments.id, assignmentId) });
  if (!assignment) notFound();
  const course = await db.query.courses.findFirst({ where: eq(courses.id, assignment.courseId) });
  const files = await db
    .select()
    .from(assignmentFiles)
    .where(eq(assignmentFiles.assignmentId, assignment.id))
    .orderBy(asc(assignmentFiles.createdAt));

  return (
    <>
      <PageHeader
        title={assignment.title}
        subtitle={
          <Link className="link" href={`/admin/courses/${assignment.courseId}`}>
            ← {course?.title}
          </Link>
        }
        actions={<LinkButton href={`/staff/assignments/${assignment.id}`} variant="primary">عرض حلول الطلاب</LinkButton>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="بيانات الواجب">
            <AssignmentForm action={updateAssignmentAction} submitLabel="حفظ التعديلات" values={assignment} />
          </Card>
        </div>
        <div className="space-y-6">
          <Card title={`مرفقات الواجب (${files.length})`}>
            {files.length > 0 ? (
              <ul className="mb-4 space-y-2 text-sm">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2">
                    <a className="link truncate" href={`/files/a/${f.id}`} target="_blank" rel="noopener">
                      <FileName name={f.originalName} mimeType={f.mimeType} />
                    </a>
                    <span className="flex items-center gap-2">
                      <span className="ltr text-xs text-gray-400">{formatBytes(f.sizeBytes)}</span>
                      <form action={deleteAttachmentAction}>
                        <input type="hidden" name="fileId" value={f.id} />
                        <ConfirmButton message="حذف هذا المرفق؟">حذف</ConfirmButton>
                      </form>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <FileUploader endpoint={`/api/assignments/${assignment.id}/attachments`} submitLabel="رفع المرفقات" />
          </Card>
          <Card title="حذف الواجب">
            <p className="mb-3 text-sm text-gray-600">يحذف الواجب وكل حلول الطلاب ودرجاتهم نهائياً.</p>
            <form action={deleteAssignmentAction}>
              <input type="hidden" name="assignmentId" value={assignment.id} />
              <ConfirmButton message={`حذف «${assignment.title}» وكل حلوله نهائياً؟`}>حذف الواجب</ConfirmButton>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
