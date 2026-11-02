'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf,.png,.jpg,.jpeg,.webp,.pdf';
const MAX_FILES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

function problemWith(file: File): string | null {
  const name = file.name.toLowerCase();
  const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
  const isImage = /^image\/(png|jpeg|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/.test(name);
  if (!isPdf && !isImage) return `«${file.name}»: يُقبل PDF أو صور PNG / JPG / WebP فقط`;
  if (isPdf && file.size > MAX_PDF_BYTES) return `«${file.name}» أكبر من 20 ميجابايت`;
  if (!isPdf && file.size > MAX_IMAGE_BYTES) return `«${file.name}» أكبر من 10 ميجابايت`;
  return null;
}

function sizeLabel(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Upload box: pick files, drag and drop, or paste a screenshot (Ctrl+V).
 * Sends everything in one request to `endpoint` and refreshes the page on success.
 */
export function FileUploader({
  endpoint,
  submitLabel,
  withNote = false,
  noteLabel = 'ملاحظة للمشرف (اختياري)',
  initialNote = '',
  replaceWarning,
}: {
  endpoint: string;
  submitLabel: string;
  withNote?: boolean;
  noteLabel?: string;
  initialNote?: string;
  replaceWarning?: string;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: File[]) => {
    setDone(null);
    const problems = incoming.map(problemWith).filter((p): p is string => p !== null);
    const accepted = incoming.filter((f) => problemWith(f) === null);
    setError(problems.length > 0 ? problems.join(' — ') : null);
    setFiles((prev) => {
      const next = [...prev, ...accepted].slice(0, MAX_FILES);
      if (prev.length + accepted.length > MAX_FILES) setError(`الحد الأقصى ${MAX_FILES} ملفات`);
      return next;
    });
  }, []);

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const pasted = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (pasted.length === 0) return;
      e.preventDefault();
      addFiles(pasted.map((f, i) => new File([f], f.name && f.name !== 'image.png' ? f.name : `لقطة-شاشة-${Date.now()}-${i + 1}.png`, { type: f.type })));
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  async function submit() {
    if (files.length === 0) {
      setError('اختر ملفاً واحداً على الأقل');
      return;
    }
    if (replaceWarning && !window.confirm(replaceWarning)) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      files.forEach((f) => body.append('files', f, f.name));
      if (withNote) body.append('note', note);
      const res = await fetch(endpoint, { method: 'POST', body });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setError(data.error ?? 'تعذّر رفع الملفات، حاول مرة أخرى');
        return;
      }
      setFiles([]);
      setDone(data.message ?? 'تم الرفع بنجاح');
      router.refresh();
    } catch {
      setError('انقطع الاتصال، حاول مرة أخرى');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(Array.from(e.dataTransfer.files));
        }}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition ${dragging ? 'border-brand-600 bg-brand-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'}`}
      >
        <div className="text-sm font-semibold text-gray-800">اسحب الملفات هنا أو اضغط للاختيار</div>
        <div className="mt-1 text-xs text-gray-600">
          صور PNG / JPG / WebP حتى 10 ميجابايت، أو PDF حتى 20 ميجابايت — حتى {MAX_FILES} ملفات. يمكنك أيضاً لصق لقطة شاشة مباشرة (Ctrl+V)
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>

      {files.length > 0 ? (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="truncate">
                {f.type === 'application/pdf' ? '📄' : '🖼️'} <span className="ltr">{f.name}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-gray-500 ltr">{sizeLabel(f.size)}</span>
                <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                  إزالة
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {withNote ? (
        <div>
          <label className="label" htmlFor="submission-note">
            {noteLabel}
          </label>
          <textarea id="submission-note" className="field" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      ) : null}

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
      {done ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{done}</div> : null}

      <button type="button" className="btn btn-primary" disabled={busy || files.length === 0} onClick={submit}>
        {busy ? 'جارٍ الرفع…' : submitLabel}
      </button>
    </div>
  );
}
