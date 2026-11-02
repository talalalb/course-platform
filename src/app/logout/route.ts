import { NextResponse } from 'next/server';
import { signOut } from '@/lib/auth/current-user';
import { isSameOrigin } from '@/lib/http';

export async function POST(request: Request) {
  if (isSameOrigin(request)) {
    await signOut();
  }
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
