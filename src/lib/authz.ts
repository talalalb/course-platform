/**
 * The single place that decides who can see what.
 *
 * Rules:
 * - Admin: everything.
 * - Supervisor: only students who are in a group they supervise, and only inside that group's course.
 * - Student: only their own submissions, and only published assignments of courses they belong to.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  assignmentFiles,
  assignments,
  groupStudents,
  groupSupervisors,
  groups,
  submissionFiles,
  submissions,
} from '@/lib/db/schema';
import type { SessionUser } from '@/lib/auth/sessions';

type Viewer = Pick<SessionUser, 'id' | 'role'>;

export async function supervisedGroupIds(supervisorId: string): Promise<string[]> {
  const rows = await db
    .select({ groupId: groupSupervisors.groupId })
    .from(groupSupervisors)
    .where(eq(groupSupervisors.supervisorId, supervisorId));
  return rows.map((r) => r.groupId);
}

/** Courses in which the supervisor supervises at least one group. */
export async function supervisedCourseIds(supervisorId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ courseId: groups.courseId })
    .from(groups)
    .innerJoin(groupSupervisors, eq(groupSupervisors.groupId, groups.id))
    .where(eq(groupSupervisors.supervisorId, supervisorId));
  return rows.map((r) => r.courseId);
}

export async function studentCourseIds(studentId: string): Promise<string[]> {
  const rows = await db
    .select({ courseId: groupStudents.courseId })
    .from(groupStudents)
    .where(eq(groupStudents.studentId, studentId));
  return rows.map((r) => r.courseId);
}

/** True when the viewer is staff allowed to see this student's work in this course. */
export async function canStaffSeeStudentInCourse(viewer: Viewer, studentId: string, courseId: string): Promise<boolean> {
  if (viewer.role === 'admin') return true;
  if (viewer.role !== 'supervisor') return false;
  const rows = await db
    .select({ groupId: groupStudents.groupId })
    .from(groupStudents)
    .innerJoin(groupSupervisors, eq(groupSupervisors.groupId, groupStudents.groupId))
    .where(
      and(
        eq(groupStudents.studentId, studentId),
        eq(groupStudents.courseId, courseId),
        eq(groupSupervisors.supervisorId, viewer.id),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** True when the supervisor supervises the student in at least one course. */
export async function supervisorSeesStudent(supervisorId: string, studentId: string): Promise<boolean> {
  const rows = await db
    .select({ groupId: groupStudents.groupId })
    .from(groupStudents)
    .innerJoin(groupSupervisors, eq(groupSupervisors.groupId, groupStudents.groupId))
    .where(and(eq(groupStudents.studentId, studentId), eq(groupSupervisors.supervisorId, supervisorId)))
    .limit(1);
  return rows.length > 0;
}

type AssignmentRef = { id: string; courseId: string; isPublished: boolean };

export async function canViewAssignment(viewer: Viewer, assignment: AssignmentRef): Promise<boolean> {
  if (viewer.role === 'admin') return true;
  if (viewer.role === 'supervisor') {
    return (await supervisedCourseIds(viewer.id)).includes(assignment.courseId);
  }
  if (!assignment.isPublished) return false;
  return (await studentCourseIds(viewer.id)).includes(assignment.courseId);
}

export async function getViewableAssignment(viewer: Viewer, assignmentId: string) {
  const assignment = await db.query.assignments.findFirst({ where: eq(assignments.id, assignmentId) });
  if (!assignment) return null;
  return (await canViewAssignment(viewer, assignment)) ? assignment : null;
}

/** Loads a submission only if the viewer may see it; otherwise returns null (callers answer 404). */
export async function getViewableSubmission(viewer: Viewer, submissionId: string) {
  const rows = await db
    .select({ submission: submissions, assignment: assignments })
    .from(submissions)
    .innerJoin(assignments, eq(assignments.id, submissions.assignmentId))
    .where(eq(submissions.id, submissionId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (viewer.role === 'student') {
    return row.submission.studentId === viewer.id ? row : null;
  }
  const allowed = await canStaffSeeStudentInCourse(viewer, row.submission.studentId, row.assignment.courseId);
  return allowed ? row : null;
}

export async function getViewableSubmissionFile(viewer: Viewer, fileId: string) {
  const file = await db.query.submissionFiles.findFirst({ where: eq(submissionFiles.id, fileId) });
  if (!file) return null;
  const owner = await getViewableSubmission(viewer, file.submissionId);
  return owner ? file : null;
}

export async function getViewableAssignmentFile(viewer: Viewer, fileId: string) {
  const file = await db.query.assignmentFiles.findFirst({ where: eq(assignmentFiles.id, fileId) });
  if (!file) return null;
  const assignment = await getViewableAssignment(viewer, file.assignmentId);
  return assignment ? file : null;
}
