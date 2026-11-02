'use server';

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ActionState } from '@/components/forms';
import { homePathFor, signIn } from '@/lib/auth/current-user';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { completePasswordReset, ResetError } from '@/lib/password-reset';
import { isRateLimited } from '@/lib/rate-limit';
import { firstError, passwordField, str } from '@/lib/validation';

const schema = z
  .object({ token: z.string().min(10).max(200), password: passwordField, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'كلمتا المرور غير متطابقتين', path: ['confirm'] });

export async function resetPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  if (isRateLimited(`reset:${ip}`, 20, 15 * 60 * 1000)) {
    return { status: 'error', message: 'محاولات كثيرة، انتظر قليلاً ثم حاول مرة أخرى' };
  }
  const parsed = schema.safeParse({ token: str(formData, 'token'), password: str(formData, 'password'), confirm: str(formData, 'confirm') });
  if (!parsed.success) return { status: 'error', message: firstError(parsed.error) };

  let userId: string;
  try {
    userId = await completePasswordReset(parsed.data.token, parsed.data.password);
  } catch (err) {
    if (err instanceof ResetError) return { status: 'error', message: err.message };
    throw err;
  }
  await signIn(userId);
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { role: true } });
  redirect(homePathFor(user?.role ?? 'student'));
}
