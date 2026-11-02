/**
 * Upload validation and processing.
 * - Only PNG, JPEG, WebP and PDF are accepted, detected from the file's bytes (never from its name or browser type).
 * - Images are decoded and re-encoded, which strips hidden metadata such as GPS location.
 * - PDFs must parse and must not be password-protected.
 */
import sharp from 'sharp';
import { EncryptedPDFError, PDFDocument } from 'pdf-lib';

export const MAX_FILES_PER_SUBMISSION = 5;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_EDGE = 4000;

export type DetectedType = 'png' | 'jpeg' | 'webp' | 'pdf';

export type ProcessedFile = {
  data: Buffer;
  mimeType: string;
  extension: string;
  originalName: string;
};

export class UploadError extends Error {}

export function detectType(buf: Buffer): DetectedType | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return 'pdf';
  return null;
}

/** Keeps a readable, safe display name (Arabic letters allowed) with the correct extension. */
export function cleanFileName(name: string, extension: string): string {
  const base = name
    .replace(/\.[^.]*$/, '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return `${base || 'file'}.${extension}`;
}

async function processImage(buf: Buffer, type: Exclude<DetectedType, 'pdf'>): Promise<{ data: Buffer }> {
  const meta = await sharp(buf, { limitInputPixels: MAX_IMAGE_PIXELS })
    .metadata()
    .catch(() => null);
  if (!meta) throw new UploadError('الصورة تالفة أو غير مدعومة');
  if (meta.format !== type) throw new UploadError('نوع الصورة غير مدعوم');
  try {
    const pipeline = sharp(buf, { limitInputPixels: MAX_IMAGE_PIXELS })
      .autoOrient()
      .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true });
    // sharp drops EXIF/GPS/XMP metadata on output unless asked to keep it.
    const data =
      type === 'png'
        ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
        : type === 'jpeg'
          ? await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
          : await pipeline.webp({ quality: 90 }).toBuffer();
    return { data };
  } catch {
    throw new UploadError('تعذّرت معالجة الصورة');
  }
}

async function checkPdf(buf: Buffer): Promise<void> {
  let pages = 0;
  try {
    const doc = await PDFDocument.load(buf, { updateMetadata: false });
    pages = doc.getPageCount();
  } catch (err) {
    if (err instanceof EncryptedPDFError || (err instanceof Error && /encrypted/i.test(err.message))) {
      throw new UploadError('ملف PDF محمي بكلمة مرور؛ احفظه بدون حماية ثم ارفعه');
    }
    throw new UploadError('ملف PDF تالف أو غير مدعوم');
  }
  if (pages < 1) throw new UploadError('ملف PDF فارغ أو تالف');
}

const MIME: Record<DetectedType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

const EXT: Record<DetectedType, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', pdf: 'pdf' };

/** Validates one uploaded file and returns the bytes that should be stored. Throws UploadError with an Arabic message. */
export async function processUpload(name: string, buf: Buffer): Promise<ProcessedFile> {
  const type = detectType(buf);
  if (!type) {
    throw new UploadError(`الملف «${name}» ليس صورة (PNG أو JPG أو WebP) ولا PDF`);
  }
  if (type === 'pdf') {
    if (buf.length > MAX_PDF_BYTES) throw new UploadError(`الملف «${name}» أكبر من 20 ميجابايت`);
    await checkPdf(buf).catch((err: Error) => {
      throw new UploadError(`«${name}»: ${err.message}`);
    });
    return { data: buf, mimeType: MIME.pdf, extension: EXT.pdf, originalName: cleanFileName(name, EXT.pdf) };
  }
  if (buf.length > MAX_IMAGE_BYTES) throw new UploadError(`الصورة «${name}» أكبر من 10 ميجابايت`);
  const { data } = await processImage(buf, type).catch((err: Error) => {
    throw new UploadError(`«${name}»: ${err.message}`);
  });
  return { data, mimeType: MIME[type], extension: EXT[type], originalName: cleanFileName(name, EXT[type]) };
}

/** Reads and validates every file from a multipart form field. */
export async function processFormFiles(entries: FormDataEntryValue[]): Promise<ProcessedFile[]> {
  const files = entries.filter((e): e is File => typeof e === 'object' && e !== null && 'arrayBuffer' in e && e.size > 0);
  if (files.length === 0) throw new UploadError('اختر ملفاً واحداً على الأقل');
  if (files.length > MAX_FILES_PER_SUBMISSION) {
    throw new UploadError(`الحد الأقصى ${MAX_FILES_PER_SUBMISSION} ملفات`);
  }
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_TOTAL_BYTES) throw new UploadError('مجموع حجم الملفات أكبر من 50 ميجابايت');
  const out: ProcessedFile[] = [];
  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    out.push(await processUpload(file.name || 'file', buf));
  }
  return out;
}
