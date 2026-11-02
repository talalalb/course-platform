import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { cleanFileName, detectType, processFormFiles, processUpload, UploadError } from '@/lib/uploads';

async function pngBytes() {
  return sharp({ create: { width: 40, height: 30, channels: 3, background: '#4f46e5' } }).png().toBuffer();
}

async function pdfBytes(opts: { encrypted?: boolean } = {}) {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  if (!opts.encrypted) return bytes;
  // Mark the document as encrypted the way real password-protected PDFs do.
  return Buffer.from(bytes.toString('latin1').replace('trailer\n<<', 'trailer\n<<\n/Encrypt << /Filter /Standard /V 1 /R 2 >>'), 'latin1');
}

describe('file type detection', () => {
  it('uses the bytes, not the name', async () => {
    expect(detectType(await pngBytes())).toBe('png');
    expect(detectType(await pdfBytes())).toBe('pdf');
    expect(detectType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(detectType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });

  it('rejects a web page renamed to .png', async () => {
    await expect(processUpload('evil.png', Buffer.from('<html><script>alert(1)</script></html>'))).rejects.toBeInstanceOf(UploadError);
  });
});

describe('images', () => {
  it('strips hidden metadata such as GPS location', async () => {
    const withExif = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ff0000' } })
      .jpeg()
      .withExif({ IFD0: { Artist: 'Someone', ImageDescription: 'GPS-SECRET' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const out = await processUpload('photo.jpg', withExif);
    expect(out.mimeType).toBe('image/jpeg');
    expect((await sharp(out.data).metadata()).exif).toBeUndefined();
    expect(out.data.includes(Buffer.from('GPS-SECRET'))).toBe(false);
  });

  it('rejects a corrupt image', async () => {
    const broken = Buffer.concat([(await pngBytes()).subarray(0, 40)]);
    await expect(processUpload('broken.png', broken)).rejects.toBeInstanceOf(UploadError);
  });
});

describe('PDFs', () => {
  it('accepts a normal PDF unchanged', async () => {
    const bytes = await pdfBytes();
    const out = await processUpload('answer.pdf', bytes);
    expect(out.mimeType).toBe('application/pdf');
    expect(out.data.equals(bytes)).toBe(true);
  });

  it('rejects password-protected PDFs', async () => {
    await expect(processUpload('locked.pdf', await pdfBytes({ encrypted: true }))).rejects.toThrow(/كلمة مرور/);
  });

  it('rejects a broken PDF', async () => {
    await expect(processUpload('broken.pdf', Buffer.from('%PDF-1.7\nnot really a pdf'))).rejects.toBeInstanceOf(UploadError);
  });
});

describe('limits and names', () => {
  it('limits the number of files', async () => {
    const png = await pngBytes();
    const files = Array.from({ length: 6 }, (_, i) => new File([png], `f${i}.png`, { type: 'image/png' }));
    await expect(processFormFiles(files)).rejects.toThrow(/5/);
    await expect(processFormFiles([])).rejects.toBeInstanceOf(UploadError);
  });

  it('rejects oversized PDFs', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(21 * 1024 * 1024)]);
    await expect(processUpload('big.pdf', big)).rejects.toThrow(/20/);
  });

  it('keeps Arabic names, drops path tricks and forces the real extension', () => {
    expect(cleanFileName('../../etc/passwd', 'pdf')).not.toContain('/');
    expect(cleanFileName('حل الواجب.exe', 'png')).toBe('حل الواجب.png');
    expect(cleanFileName('', 'pdf')).toBe('file.pdf');
  });
});
