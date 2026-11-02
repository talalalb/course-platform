'use server';

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { homePathFor, signIn } from '@/lib/auth/current-user';
import { verifyPassword } from '@/lib/auth/password';
import { isRateLimited, resetRateLimit } from '@/lib/rate-limit';
import { clientIp } from '@/lib/http';
import { str } from '@/lib/validation';
import type { ActionState } from '@/components/forms';

const GENERIC_ERROR = 'البريد الإلكتروني أو كلمة المرور غير صحيحة';

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = str(formData, 'email').trim().toLowerCase().slice(0, 254);
  const password = str(formData, 'password').slice(0, 200);
  if (!email || !password) return { status: 'error', message: 'أدخل البريد الإلكتروني وكلمة المرور' };

  const ip = clientIp(await headers());
  // Generous per-IP limit (a whole class may share one network); the per-e-mail limit stops password guessing.
  if (isRateLimited(`login:ip:${ip}`, 300, 15 * 60 * 1000) || isRateLimited(`login:email:${email}`, 8, 15 * 60 * 1000)) {
    return { status: 'error', message: 'محاولات كثيرة، انتظر قليلاً ثم حاول مرة أخرى' };
  }

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  // Always run the hash check so response time does not reveal whether the e-mail exists.
  const ok = await verifyPassword(password, user?.passwordHash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
  if (!user || !ok || !user.isActive) return { status: 'error', message: GENERIC_ERROR };

  resetRateLimit(`login:email:${email}`);
  await signIn(user.id);
  redirect(homePathFor(user.role));
}
