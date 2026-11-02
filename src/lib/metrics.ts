/**
 * Performance numbers for the dashboards. One query returns every (student, assignment) pair in scope;
 * the aggregation happens in TypeScript so the rules are easy to read and test.
 *
 * Definitions
 * - "Due" assignment: published and its deadline has passed.
 * - Submission rate: due assignments with a submission / due assignments.
 * - Missing: due assignment with no submission.
 * - Average grade: mean of grade / max score (in %) over reviewed submissions.
 * - Pending review: a submission waiting for the supervisor.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

export type Scope = { kind: 'all' } | { kind: 'supervisor'; supervisorId: string };

export type PairRow = {
  groupId: string;
  groupName: string;
  courseId: string;
  courseTitle: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  assignmentId: string | null;
  assignmentTitle: string | null;
  dueAt: Date | null;
  maxScore: number | null;
  submissionId: string | null;
  status: 'submitted' | 'reviewed' | null;
  isLate: boolean | null;
  submittedAt: Date | null;
  grade: number | null;
};

export async function loadPairs(scope: Scope, filters: { courseId?: string; studentId?: string; assignmentId?: string } = {}): Promise<PairRow[]> {
  const conditions = [sql`u.is_active`];
  if (scope.kind === 'supervisor') {
    conditions.push(sql`gs.group_id IN (SELECT group_id FROM group_supervisors WHERE supervisor_id = ${scope.supervisorId})`);
  }
  if (filters.courseId) conditions.push(sql`gs.course_id = ${filters.courseId}`);
  if (filters.studentId) conditions.push(sql`gs.student_id = ${filters.studentId}`);
  const assignmentFilter = filters.assignmentId ? sql` AND a.id = ${filters.assignmentId}` : sql``;

  const result = await db.execute<{
    group_id: string;
    group_name: string;
    course_id: string;
    course_title: string;
    student_id: string;
    student_name: string;
    student_email: string;
    assignment_id: string | null;
    assignment_title: string | null;
    due_at: Date | string | null;
    max_score: number | null;
    submission_id: string | null;
    status: 'submitted' | 'reviewed' | null;
    is_late: boolean | null;
    submitted_at: Date | string | null;
    grade: number | null;
  }>(sql`
    SELECT gs.group_id, g.name AS group_name, gs.course_id, c.title AS course_title,
           u.id AS student_id, u.name AS student_name, u.email AS student_email,
           a.id AS assignment_id, a.title AS assignment_title, a.due_at, a.max_score,
           s.id AS submission_id, s.status, s.is_late, s.submitted_at,
           CASE WHEN s.status = 'reviewed' THEN r.grade ELSE NULL END AS grade
    FROM group_students gs
    JOIN groups g ON g.id = gs.group_id
    JOIN courses c ON c.id = gs.course_id
    JOIN users u ON u.id = gs.student_id
    LEFT JOIN assignments a ON a.course_id = gs.course_id AND a.is_published${assignmentFilter}
    LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = gs.student_id
    LEFT JOIN reviews r ON r.submission_id = s.id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY c.title, g.name, u.name, a.due_at
  `);

  const toDate = (v: Date | string | null) => (v === null ? null : v instanceof Date ? v : new Date(v));
  return result.rows.map((r) => ({
    groupId: r.group_id,
    groupName: r.group_name,
    courseId: r.course_id,
    courseTitle: r.course_title,
    studentId: r.student_id,
    studentName: r.student_name,
    studentEmail: r.student_email,
    assignmentId: r.assignment_id,
    assignmentTitle: r.assignment_title,
    dueAt: toDate(r.due_at),
    maxScore: r.max_score === null ? null : Number(r.max_score),
    submissionId: r.submission_id,
    status: r.status,
    isLate: r.is_late,
    submittedAt: toDate(r.submitted_at),
    grade: r.grade === null ? null : Number(r.grade),
  }));
}

export type Stats = {
  due: number;
  submittedDue: number;
  submitted: number;
  late: number;
  missing: number;
  pending: number;
  reviewed: number;
  submissionRate: number | null;
  averageGrade: number | null;
};

export function emptyStats(): Stats {
  return { due: 0, submittedDue: 0, submitted: 0, late: 0, missing: 0, pending: 0, reviewed: 0, submissionRate: null, averageGrade: null };
}

export function computeStats(rows: PairRow[], now = new Date()): Stats {
  const s = emptyStats();
  let gradeSum = 0;
  for (const r of rows) {
    if (!r.assignmentId || !r.dueAt) continue;
    const isDue = r.dueAt.getTime() <= now.getTime();
    const hasSubmission = r.submissionId !== null;
    if (isDue) s.due += 1;
    if (hasSubmission) {
      s.submitted += 1;
      if (isDue) s.submittedDue += 1;
      if (r.isLate) s.late += 1;
      if (r.status === 'submitted') s.pending += 1;
      if (r.status === 'reviewed' && r.grade !== null && r.maxScore) {
        s.reviewed += 1;
        gradeSum += (r.grade / r.maxScore) * 100;
      }
    } else if (isDue) {
      s.missing += 1;
    }
  }
  s.submissionRate = s.due > 0 ? (s.submittedDue / s.due) * 100 : null;
  s.averageGrade = s.reviewed > 0 ? gradeSum / s.reviewed : null;
  return s;
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  return map;
}

export type StudentSummary = Stats & {
  studentId: string;
  studentName: string;
  studentEmail: string;
  courseId: string;
  courseTitle: string;
  groupId: string;
  groupName: string;
};

export function summarizeByStudent(rows: PairRow[], now = new Date()): StudentSummary[] {
  return [...groupBy(rows, (r) => `${r.studentId}:${r.courseId}`).values()].map((list) => {
    const first = list[0];
    return {
      ...computeStats(list, now),
      studentId: first.studentId,
      studentName: first.studentName,
      studentEmail: first.studentEmail,
      courseId: first.courseId,
      courseTitle: first.courseTitle,
      groupId: first.groupId,
      groupName: first.groupName,
    };
  });
}

export type GroupSummary = Stats & {
  groupId: string;
  groupName: string;
  courseId: string;
  courseTitle: string;
  students: number;
};

export function summarizeByGroup(rows: PairRow[], now = new Date()): GroupSummary[] {
  return [...groupBy(rows, (r) => r.groupId).values()].map((list) => {
    const first = list[0];
    return {
      ...computeStats(list, now),
      groupId: first.groupId,
      groupName: first.groupName,
      courseId: first.courseId,
      courseTitle: first.courseTitle,
      students: new Set(list.map((r) => r.studentId)).size,
    };
  });
}

export type AssignmentSummary = Stats & {
  assignmentId: string;
  assignmentTitle: string;
  courseTitle: string;
  dueAt: Date;
  students: number;
};

export function summarizeByAssignment(rows: PairRow[], now = new Date()): AssignmentSummary[] {
  const withAssignment = rows.filter((r) => r.assignmentId !== null);
  return [...groupBy(withAssignment, (r) => r.assignmentId as string).values()]
    .map((list) => {
      const first = list[0];
      return {
        ...computeStats(list, now),
        assignmentId: first.assignmentId as string,
        assignmentTitle: first.assignmentTitle ?? '',
        courseTitle: first.courseTitle,
        dueAt: first.dueAt as Date,
        students: new Set(list.map((r) => r.studentId)).size,
      };
    })
    .sort((a, b) => b.dueAt.getTime() - a.dueAt.getTime());
}

/** Students who missed work or whose average is below 60%. */
export function needsAttention(students: StudentSummary[]): StudentSummary[] {
  return students
    .filter((s) => s.missing > 0 || (s.averageGrade !== null && s.averageGrade < 60))
    .sort((a, b) => b.missing - a.missing || (a.averageGrade ?? 101) - (b.averageGrade ?? 101));
}

export type PendingItem = {
  submissionId: string;
  studentId: string;
  studentName: string;
  groupName: string;
  assignmentId: string;
  assignmentTitle: string;
  courseTitle: string;
  submittedAt: Date | null;
  isLate: boolean;
};

export function pendingReviews(rows: PairRow[]): PendingItem[] {
  return rows
    .filter((r) => r.submissionId && r.status === 'submitted')
    .map((r) => ({
      submissionId: r.submissionId as string,
      studentId: r.studentId,
      studentName: r.studentName,
      groupName: r.groupName,
      assignmentId: r.assignmentId as string,
      assignmentTitle: r.assignmentTitle ?? '',
      courseTitle: r.courseTitle,
      submittedAt: r.submittedAt,
      isLate: Boolean(r.isLate),
    }))
    .sort((a, b) => (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0));
}
