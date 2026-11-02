import { signOut } from '@/lib/auth/current-user';

/**
 * Logs out and goes back to the login page.
 * No origin check is needed: the session cookie is SameSite=Lax, so another site cannot send it with a POST.
 * The redirect is relative so it works behind any reverse proxy or domain.
 */
export async function POST() {
  await signOut();
  return new Response(null, { status: 303, headers: { Location: '/login' } });
}
