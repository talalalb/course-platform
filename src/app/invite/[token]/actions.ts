'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { homePathFor, signIn } from '@/lib/auth/current-user';
import { acceptInvitation, InviteError } from '@/lib/invitations';
import { clientIp } from '@/lib/http';
import { isRateLimited } from '@/lib/rate-limit';
import { firstError, nameField, passwordField, str } from '@/lib/validation';
import type { ActionState } from '@/components/forms';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const schema = z
  .object({ token: z.string().min(10).max(200), name: nameField, password: passwordField, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'كلمتا المرور غير متطابقتين', path: ['confirm'] });

export async function acceptInviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ip = clientIp(await headers());
  if (isRateLimited(`invite:${ip}`, 100, 15 * 60 * 1000)) {
    return { status: 'error', message: 'محاولات كثيرة، انتظر قليلاً ثم حاول مرة أخرى' };
  }
  const parsed = schema.safeParse({
    token: str(formData, 'token'),
    name: str(formData, 'name'),
    password: str(formData, 'password'),
    confirm: str(formData, 'confirm'),
  });
  if (!parsed.success) return { status: 'error', message: firstError(parsed.error) };

  let userId: string;
  try {
    const result = await acceptInvitation(parsed.data);
    if (result.status === 'existing-account') {
      return { status: 'success', message: 'لديك حساب مسبقاً وتمت إضافتك. سجّل الدخول بكلمة مرورك الحالية من صفحة الدخول.' };
    }
    userId = result.userId;
  } catch (err) {
    if (err instanceof InviteError) return { status: 'error', message: err.message };
    throw err;
  }
  await signIn(userId);
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { role: true } });
  redirect(homePathFor(user?.role ?? 'student'));
}
