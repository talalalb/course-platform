import { getCurrentUser } from '@/lib/auth/current-user';
import { getViewableAssignmentFile, getViewableSubmissionFile } from '@/lib/authz';
import { storage } from '@/lib/storage';
import { isUuid } from '@/lib/validation';

function notFound() {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

/** RFC 6266 header with an ASCII fallback and the real (possibly Arabic) name. */
function contentDisposition(type: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file';
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Every uploaded file is served through here, after a permission check.
 * /files/s/<id> = submission file, /files/a/<id> = assignment attachment. Add ?download=1 to download.
 */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return notFound();
  const { kind, id } = await params;
  if (!isUuid(id) || (kind !== 's' && kind !== 'a')) return notFound();

  const file = kind === 's' ? await getViewableSubmissionFile(user, id) : await getViewableAssignmentFile(user, id);
  if (!file) return notFound();

  let data: Buffer;
  try {
    data = await storage.get(file.storageKey);
  } catch {
    return notFound();
  }

  const download = new URL(request.url).searchParams.get('download') === '1';
  const isImage = file.mimeType.startsWith('image/');
  const headers: Record<string, string> = {
    'Content-Type': file.mimeType,
    'Content-Length': String(data.length),
    'Content-Disposition': contentDisposition(download ? 'attachment' : 'inline', file.originalName),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  if (isImage) {
    headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";
  }
  return new Response(new Uint8Array(data), { status: 200, headers });
}
