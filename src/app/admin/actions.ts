'use server';

import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ActionState } from '@/components/forms';
import { assertRole } from '@/lib/auth/current-user';
import { deleteAllSessionsForUser } from '@/lib/auth/sessions';
import { db } from '@/lib/db';
import {
  assignmentFiles,
  assignments,
  courses,
  groupStudents,
  groupSupervisors,
  groups,
  reviews,
  submissionFiles,
  submissions,
  users,
} from '@/lib/db/schema';
import {
  addStudentToGroup,
  inviteSupervisor,
  inviteUrl,
  InviteError,
  regenerateInvitation,
  revokeInvitation,
} from '@/lib/invitations';
import { createPasswordReset, RESET_TTL_HOURS, ResetError, resetUrl } from '@/lib/password-reset';
import { removeQuietly } from '@/lib/storage';
import { zonedLocalToUtc } from '@/lib/time';
import { emailField, firstError, nameField, str, uuidField } from '@/lib/validation';

const MAX_SUPERVISORS_PER_GROUP = 2;

function fail(message: string): ActionState {
  return { status: 'error', message };
}

// ---------- Courses ----------

const courseSchema = z.object({
  title: z.string().trim().min(2, 'اسم الدورة قصير جداً').max(150),
  description: z.string().trim().max(2000),
});

export async function createCourseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole('admin');
  const parsed = courseSchema.safeParse({ title: str(formData, 'title'), description: str(formData, 'description') });
  if (!parsed.success) return fail(firstError(parsed.error));
  const [course] = await db.insert(courses).values(parsed.data).returning({ id: courses.id });
  revalidatePath('/admin/courses');
  redirect(`/admin/courses/${course.id}`);
}

export async function updateCourseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole('admin');
  const id = uuidField.safeParse(str(formData, 'courseId'));
  const parsed = courseSchema.safeParse({ title: str(formData, 'title'), description: str(formData, 'description') });
  if (!id.success) return fail('الدورة غير موجودة');
  if (!parsed.success) return fail(firstError(parsed.error));
  await db.update(courses).set(parsed.data).where(eq(courses.id, id.data));
  revalidatePath(`/admin/courses/${id.data}`);
  return { status: 'success', message: 'تم حفظ التعديلات' };
}

/** Collects stored file keys of everything under the given assignments, so they can be deleted from storage. */
async function fileKeysForAssignments(assignmentIds: string[]): Promise<string[]> {
  if (assignmentIds.length === 0) return [];
  const attachmentKeys = await db
    .select({ key: assignmentFiles.storageKey })
    .from(assignmentFiles)
    .where(inArray(assignmentFiles.assignmentId, assignmentIds));
  const submissionKeys = await db
    .select({ key: submissionFiles.storageKey })
    .from(submissionFiles)
    .innerJoin(submissions, eq(submissions.id, submissionFiles.submissionId))
    .where(inArray(submissions.assignmentId, assignmentIds));
  return [...attachmentKeys, ...submissionKeys].map((r) => r.key);
}

export async function deleteCourseAction(formData: FormData): Promise<void> {
  await assertRole('admin');
  const id = uuidField.parse(str(formData, 'courseId'));
  const assignmentIds = (await db.select({ id: assignments.id }).from(assignments).where(eq(assignments.courseId, id))).map((a) => a.id);
  const keys = await fileKeysForAssignments(assignmentIds);
  await db.delete(courses).where(eq(courses.id, id));
  await removeQuietly(keys);
  revalidatePath('/admin/courses');
  redirect('/admin/courses');
}

// ---------- Groups ----------

const groupNameSchema = z.string().trim().min(1, 'اكتب اسم المجموعة').max(100);

export async function createGroupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole('admin');
  const courseId = uuidField.safeParse(str(formData, 'courseId'));
  const name = groupNameSchema.safeParse(str(formData, 'name'));
  if (!courseId.success) return fail('الدورة غير موجودة');
  if (!name.success) return fail(firstError(name.error));
  const exists = await db.query.groups.findFirst({ where: and(eq(groups.courseId, courseId.data), eq(groups.name, name.data)) });
  if (exists) return fail('يوجد مجموعة بنفس الاسم في هذه الدورة');
  await db.insert(groups).values({ courseId: courseId.data, name: name.data });
  revalidatePath(`/admin/courses/${courseId.data}`);
  return { status: 'success', message: 'تمت إضافة المجموعة' };
}

export async function renameGroupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole('admin');
  const groupId = uuidField.safeParse(str(formData, 'groupId'));
  const name = groupNameSchema.safeParse(str(formData, 'name'));
  if (!groupId.success) return fail('المجموعة غير موجودة');
  if (!name.success) return fail(firstError(name.error));
  const group = await db.query.groups.findFirst({ where: eq(groups.id, groupId.data) });
  if (!group) return fail('المجموعة غير موجودة');
  const clash = await db.query.groups.findFirst({ where: and(eq(groups.courseId, group.courseId), eq(groups.name, name.data)) });
  if (clash && clash.id !== group.id) return fail('يوجد مجموعة بنفس الاسم في هذه الدورة');
  await db.update(groups).set({ name: name.data }).where(eq(groups.id, group.id));
  revalidatePath(`/admin/groups/${group.id}`);
  return { status: 'success', message: 'تم حفظ الاسم' };
}

export async function deleteGroupAction(formData: FormData): Promise<void> {
  await assertRole('admin');
  const groupId = uuidField.parse(str(formData, 'groupId'));
  const group = await db.query.groups.findFirst({ where: eq(groups.id, groupId) });
  if (!group) redirect('/admin/courses');
  // Students' past submissions stay; they simply leave the group.
  await db.delete(groups).where(eq(groups.id, groupId));
  revalidatePath(`/admin/courses/${group.courseId}`);
  redirect(`/admin/courses/${group.courseId}`);
}

export async function assignSupervisorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole('admin');
  const groupId = uuidField.safeParse(str(formData, 'groupId'));
  const supervisorId = uuidField.safeParse(str(formData, 'supervisorId'));
  if (!groupId.success || !supervisorId.success) return fail('اختر المشرف');
  const supervisor = await db.query.users.findFirst({ where: eq(users.id, supervisorId.data) });
  if (!supervisor || supervisor.role !== 'supervisor' || !supervisor.isActive) return fail('المستخدم المختار ليس مشرفاً نشطاً');
  try {
    await db.transaction(async (tx) => {
      // Lock the group row so two admins cannot push it past the limit at the same time.
      const [group] = await tx.select().from(groups).where(eq(groups.id, groupId.data)).for('update');
      if (!group) throw new InviteError('المجموعة غير موجودة');
      const [{ value }] = await tx.select({ value: count() }).from(groupSupervisors).where(eq(groupSupervisors.groupId, group.id));
      const already = await tx.query.groupSupervisors.findFirst({
        where: and(eq(groupSupervisors.groupId, group.id), eq(groupSupervisors.supervisorId, supervisor.id)),
      });
      if (already) throw new InviteError('هذا المشرف مضاف مسبقاً');
      if (value >= MAX_SUPERVISORS_PER_GROUP) throw new InviteError('لكل مجموعة مشرفان كحد أقصى');
      await tx.insert(groupSupervisors).values({ groupId: group.id, supervisorId: supervisor.id });
    });
  } catch (err) {
    if (err instanceof InviteError) return fail(err.message);
    throw err;
  }
  revalidatePath(`/admin/groups/${groupId.data}`);
  return { status: 'success', message: `تمت إضافة ${supervisor.name} كمشرف` };
}

export async function removeSupervisorAction(formData: FormData): Promise<void> {
  await assertRole('admin');
  const groupId = uuidField.parse(str(formData, 'groupId'));
  const supervisorId = uuidField.parse(str(formData, 'supervisorId'));
  await db
    .delete(groupSupervisors)
    .where(and(eq(groupSupervisors.groupId, groupId), eq(groupSupervisors.supervisorId, supervisorId)));
  revalidatePath(`/admin/groups/${groupId}`);
}

// ---------- Students ----------

export async function addStudentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await assertRole('admin');
  const parsed = z
    .object({ groupId: uuidField, name: nameField, email: emailField })
    .safeParse({ groupId: str(formData, 'groupId'), name: str(formData, 'name'), email: str(formData, 'email') });
  if (!parsed.success) return fail(firstError(parsed.error));
  try {
    const result = await addStudentToGroup({ ...parsed.data, createdBy: admin.id });
    revalidatePath(`/admin/groups/${parsed.data.groupId}`);
    if (result.kind === 'enrolled') {
      return { status: 'success', message: `${result.name} لديه حساب مسبقاً وتمت إضافته للمجموعة مباشرة` };
    }
    return {
      status: 'success',
      message: 'تم إنشاء رابط الدعوة (صالح 7 أيام). أرسله للطالب عبر البريد أو الواتساب:',
      link: inviteUrl(result.token),
    };
  } catch (err) {
    if (err instanceof InviteError) return fail(err.message);
    throw err;
  }
}

export async function removeStudentAction(formData: FormData): Promise<void> {
  await assertRole('admin');
  const groupId = uuidField.parse(str(formData, 'groupId'));
  const studentId = uuidField.parse(str(formData, 'studentId'));
  await db.delete(groupStudents).where(and(eq(groupStudents.groupId, groupId), eq(groupStudents.studentId, studentId)));
  revalidatePath(`/admin/groups/${groupId}`);
}

export async function moveStudentAction(formData: FormData): Promise<void> {
  await assertRole('admin');
  const fromGroupId = uuidField.parse(str(formData, 'groupId'));
  const studentId = uuidField.parse(str(formData, 'studentId'));
  const toGroupId = uuidField.parse(str(formData, 'toGroupId'));
  const [from, to] = await Promise.all([
    db.query.groups.findFirst({ where: eq(groups.id, fromGroupId) }),
    db.query.groups.findFirst({ where: eq(groups.id, toGroupId) }),
  ]);
  if (!from || !to || from.courseId !== to.courseId) throw new Error('لا يمكن النقل إلا بين مجموعات نفس الدورة');
  await db
    .update(groupStudents)
    .set({ groupId: to.id })
    .where(and(eq(groupStudents.groupId, from.id), eq(groupStudents.studentId, studentId)));
  revalidatePath(`/admin/groups/${from.id}`);
  revalidatePath(`/admin/groups/${to.id}`);
}

// ---------- Users & invitations ----------

export async function inviteSupervisorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await assertRole('admin');
  const parsed = z
    .object({ name: nameField, email: emailField })
    .safeParse({ name: str(formData, 'name'), email: str(formData, 'email') });
  if (!parsed.success) return fail(firstError(parsed.error));
  try {
    const token = await inviteSupervisor({ ...parsed.data, createdBy: admin.id });
    revalidatePath('/admin/users');
    return {
      status: 'success',
      message: 'تم إنشاء رابط دعوة المشرف (صالح 7 أيام). أرسله له:',
      link: inviteUrl(token),
    };
  } catch (err) {
    if (err instanceof InviteError) return fail(err.message);
    throw err;
  }
}

export async function regenerateInvitationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole('admin');
  const id = uuidField.safeParse(str(formData, 'invitationId'));
  if (!id.success) return fail('الدعوة غير موجودة');
  try {
    const token = await regenerateInvitation(id.data);
    revalidatePath('/admin/users');
    return { status: 'success', message: 'رابط جديد (الرابط السابق لم يعد يعمل):', link: inviteUrl(token) };
  } catch (err) {
    if (err instanceof InviteError) return fail(err.message);
    throw err;
  }
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  await assertRole('admin');
  const id = uuidField.parse(str(formData, 'invitationId'));
  await revokeInvitation(id);
  revalidatePath('/admin/users');
}

export async function setUserActiveAction(formData: FormData): Promise<void> {
  const admin = await assertRole('admin');
  const userId = uuidField.parse(str(formData, 'userId'));
  const active = str(formData, 'active') === 'true';
  if (userId === admin.id) throw new Error('لا يمكنك إيقاف حسابك');
  await db.update(users).set({ isActive: active }).where(eq(users.id, userId));
  if (!active) {
    await deleteAllSessionsForUser(userId);
    // A suspended supervisor no longer counts as a group's supervisor (the admin re-links after reactivation).
    await db.delete(groupSupervisors).where(eq(groupSupervisors.supervisorId, userId));
  }
  revalidatePath('/admin/users');
}

// ---------- Assignments ----------

const assignmentSchema = z.object({
  courseId: uuidField,
  title: z.string().trim().min(2, 'عنوان الواجب قصير جداً').max(200),
  description: z.string().trim().max(10_000),
  dueAt: z.string().min(1, 'حدّد موعد التسليم'),
  maxScore: z.coerce.number().int('الدرجة الكاملة رقم صحيح').min(1, 'الدرجة الكاملة يجب أن تكون 1 أو أكثر').max(1000),
});

function parseAssignment(formData: FormData) {
  const parsed = assignmentSchema.safeParse({
    courseId: str(formData, 'courseId'),
    title: str(formData, 'title'),
    description: str(formData, 'description'),
    dueAt: str(formData, 'dueAt'),
    maxScore: str(formData, 'maxScore') || '100',
  });
  if (!parsed.success) return { error: firstError(parsed.error) } as const;
  const dueAt = zonedLocalToUtc(parsed.data.dueAt);
  if (!dueAt) return { error: 'موعد التسليم غير صحيح' } as const;
  return {
    data: {
      ...parsed.data,
      dueAt,
      allowLate: formData.get('allowLate') === 'on',
      isPublished: formData.get('isPublished') === 'on',
    },
  } as const;
}

export async function createAssignmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await assertRole('admin');
  const parsed = parseAssignment(formData);
  if ('error' in parsed) return fail(parsed.error ?? 'بيانات غير صحيحة');
  const course = await db.query.courses.findFirst({ where: eq(courses.id, parsed.data.courseId) });
  if (!course) return fail('الدورة غير موجودة');
  const [created] = await db
    .insert(assignments)
    .values({ ...parsed.data, createdBy: admin.id })
    .returning({ id: assignments.id });
  revalidatePath(`/admin/courses/${course.id}`);
  redirect(`/admin/assignments/${created.id}`);
}

export async function updateAssignmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole('admin');
  const id = uuidField.safeParse(str(formData, 'assignmentId'));
  if (!id.success) return fail('الواجب غير موجود');
  const parsed = parseAssignment(formData);
  if ('error' in parsed) return fail(parsed.error ?? 'بيانات غير صحيحة');
  const existing = await db.query.assignments.findFirst({ where: eq(assignments.id, id.data) });
  if (!existing) return fail('الواجب غير موجود');
  const { courseId: _ignored, ...changes } = parsed.data;
  if (changes.maxScore !== existing.maxScore) {
    const [{ value: graded }] = await db
      .select({ value: count() })
      .from(reviews)
      .innerJoin(submissions, eq(submissions.id, reviews.submissionId))
      .where(eq(submissions.assignmentId, id.data));
    if (graded > 0) return fail('لا يمكن تغيير الدرجة الكاملة بعد بدء التصحيح');
  }
  await db.update(assignments).set(changes).where(eq(assignments.id, id.data));
  if (changes.dueAt.getTime() !== existing.dueAt.getTime()) {
    // Late / on-time follows the new deadline.
    await db
      .update(submissions)
      .set({ isLate: sql`${submissions.submittedAt} > ${changes.dueAt}` })
      .where(eq(submissions.assignmentId, id.data));
  }
  revalidatePath(`/admin/assignments/${id.data}`);
  revalidatePath(`/admin/courses/${existing.courseId}`);
  return { status: 'success', message: 'تم حفظ الواجب' };
}

export async function deleteAssignmentAction(formData: FormData): Promise<void> {
  await assertRole('admin');
  const id = uuidField.parse(str(formData, 'assignmentId'));
  const existing = await db.query.assignments.findFirst({ where: eq(assignments.id, id) });
  if (!existing) redirect('/admin/courses');
  const keys = await fileKeysForAssignments([id]);
  await db.delete(assignments).where(eq(assignments.id, id));
  await removeQuietly(keys);
  revalidatePath(`/admin/courses/${existing.courseId}`);
  redirect(`/admin/courses/${existing.courseId}`);
}

export async function deleteAttachmentAction(formData: FormData): Promise<void> {
  await assertRole('admin');
  const fileId = uuidField.parse(str(formData, 'fileId'));
  const [deleted] = await db.delete(assignmentFiles).where(eq(assignmentFiles.id, fileId)).returning();
  if (deleted) {
    await removeQuietly([deleted.storageKey]);
    revalidatePath(`/admin/assignments/${deleted.assignmentId}`);
  }
}

// ---------- Password reset links ----------

export async function createPasswordResetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await assertRole('admin');
  const userId = uuidField.safeParse(str(formData, 'userId'));
  if (!userId.success) return fail('المستخدم غير موجود');
  try {
    const token = await createPasswordReset(userId.data, admin.id);
    return {
      status: 'success',
      message: `رابط تعيين كلمة مرور (صالح ${RESET_TTL_HOURS} ساعة ولمرة واحدة). أرسله لصاحب الحساب:`,
      link: resetUrl(token),
    };
  } catch (err) {
    if (err instanceof ResetError) return fail(err.message);
    throw err;
  }
}
