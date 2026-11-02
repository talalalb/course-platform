import { getCurrentUser } from '@/lib/auth/current-user';
import { toCsv } from '@/lib/csv';
import { loadPairs, summarizeByStudent } from '@/lib/metrics';
import { isUuid } from '@/lib/validation';

/** Student performance as a CSV file that opens in Excel. Supervisors only get their own students. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'admin' && user.role !== 'supervisor')) {
    return new Response('Not found', { status: 404 });
  }
  const course = new URL(request.url).searchParams.get('course');
  const scope = user.role === 'admin' ? ({ kind: 'all' } as const) : ({ kind: 'supervisor', supervisorId: user.id } as const);
  const pairs = await loadPairs(scope, { courseId: isUuid(course) ? course : undefined });
  const students = summarizeByStudent(pairs).sort(
    (a, b) => a.courseTitle.localeCompare(b.courseTitle, 'ar') || a.groupName.localeCompare(b.groupName, 'ar') || a.studentName.localeCompare(b.studentName, 'ar'),
  );

  const rows: (string | number | null)[][] = [
    ['الطالب', 'البريد الإلكتروني', 'الدورة', 'المجموعة', 'الواجبات المستحقة', 'المسلَّمة منها', 'متأخر', 'لم يُسلِّم', 'بانتظار التصحيح', 'نسبة التسليم %', 'متوسط الدرجات %'],
    ...students.map((s) => [
      s.studentName,
      s.studentEmail,
      s.courseTitle,
      s.groupName,
      s.due,
      s.submittedDue,
      s.late,
      s.missing,
      s.pending,
      s.submissionRate === null ? '' : Math.round(s.submissionRate),
      s.averageGrade === null ? '' : Math.round(s.averageGrade * 10) / 10,
    ]),
  ];

  const date = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="students-performance-${date}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
