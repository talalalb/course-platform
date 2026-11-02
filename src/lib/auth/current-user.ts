import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { appUrl } from '@/lib/app-url';
import type { Role } from '@/lib/db/schema';
import { createSessionRecord, deleteSessionByToken, findUserBySessionToken, type SessionUser } from './sessions';

export const SESSION_COOKIE = 'cp_session';

function cookieSecure(): boolean {
  return appUrl().startsWith('https://');
}

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  return findUserBySessionToken(store.get(SESSION_COOKIE)?.value);
});

export async function signIn(userId: string): Promise<void> {
  const { token, expiresAt } = await createSessionRecord(userId);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    path: '/',
    expires: expiresAt,
  });
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSessionByToken(token);
  store.delete(SESSION_COOKIE);
}

export function homePathFor(role: Role): string {
  if (role === 'admin') return '/admin';
  if (role === 'supervisor') return '/supervisor';
  return '/student';
}

/** For pages and server actions: redirects to /login when signed out. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/** Redirects users with another role to their own home page. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(homePathFor(user.role));
  return user;
}

/** For server actions: throws instead of redirecting, so a forged request fails loudly. */
export async function assertRole(...roles: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user || !roles.includes(user.role)) {
    throw new Error('غير مصرح');
  }
  return user;
}
