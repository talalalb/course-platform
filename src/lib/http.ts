import { NextResponse } from 'next/server';

/** Rejects cross-site POSTs to route handlers (server actions have this check built in). */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * The visitor's IP for rate limiting. Uses the right-most X-Forwarded-For entry, which is the one added by our own
 * reverse proxy (earlier entries can be set by the client). Run the app behind a proxy that sets this header.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const last = forwarded?.split(',').at(-1)?.trim();
  return last || headers.get('x-real-ip') || 'local';
}
