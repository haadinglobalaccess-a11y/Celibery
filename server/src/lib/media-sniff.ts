/**
 * Identifies uploaded media from its first bytes ("magic numbers") instead of trusting the file
 * name or the browser-declared type. Anything that is not one of the allowed image/video formats
 * is rejected — including SVG (can carry scripts), HTML, PDF, archives and executables.
 * Pure module (no I/O), unit tested.
 */
export type SniffResult = { mime: string; kind: 'image' | 'video'; ext: string };

export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'] as const;
export const ALLOWED_VIDEO_MIME = ['video/mp4', 'video/webm'] as const;
export const ALLOWED_MIME: readonly string[] = [...ALLOWED_IMAGE_MIME, ...ALLOWED_VIDEO_MIME];

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));
const startsWith = (b: Uint8Array, bytes: number[], offset = 0) => bytes.every((x, i) => b[offset + i] === x);

const MP4_BRANDS = ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4VP', 'dash', 'mmp4', 'MSNV'];

export function sniffMedia(input: Uint8Array): SniffResult | null {
  const b = input;
  if (b.length < 12) return null;
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', kind: 'image', ext: 'jpg' };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', kind: 'image', ext: 'png' };
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return { mime: 'image/gif', kind: 'image', ext: 'gif' };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { mime: 'image/webp', kind: 'image', ext: 'webp' };
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand === 'avif' || brand === 'avis') return { mime: 'image/avif', kind: 'image', ext: 'avif' };
    // QuickTime (.mov) is deliberately not accepted: not every browser plays it. Convert to MP4.
    if (MP4_BRANDS.includes(brand)) return { mime: 'video/mp4', kind: 'video', ext: 'mp4' };
    return null;
  }
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) {
    // EBML container: WebM declares its DocType "webm" near the start (Matroska says "matroska").
    const head = ascii(b, 0, Math.min(b.length, 64));
    if (head.includes('webm')) return { mime: 'video/webm', kind: 'video', ext: 'webm' };
    return null;
  }
  return null;
}

/** Normalises browser-declared types (e.g. image/jpg) to the canonical MIME. */
export function canonicalMime(declared: string): string {
  const d = declared.toLowerCase().split(';')[0].trim();
  if (d === 'image/jpg' || d === 'image/pjpeg') return 'image/jpeg';
  return d;
}

export function kindOfMime(mime: string): 'image' | 'video' | null {
  if ((ALLOWED_IMAGE_MIME as readonly string[]).includes(mime)) return 'image';
  if ((ALLOWED_VIDEO_MIME as readonly string[]).includes(mime)) return 'video';
  return null;
}

/** Pixel dimensions from the header of PNG, GIF, WebP and JPEG files (null when not found in the bytes given). */
export function imageDimensions(b: Uint8Array): { width: number; height: number } | null {
  const r = sniffMedia(b);
  if (!r || r.kind !== 'image') return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (r.mime === 'image/png' && b.length >= 24) return { width: dv.getUint32(16), height: dv.getUint32(20) };
    if (r.mime === 'image/gif') return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
    if (r.mime === 'image/webp' && b.length >= 30) {
      const chunk = ascii(b, 12, 4);
      if (chunk === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (chunk === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
      if (chunk === 'VP8L') {
        const bits = dv.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
    if (r.mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1];
        const len = dv.getUint16(i + 2);
        // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
        }
        i += 2 + len;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Safe, random object key: never derived from the uploaded file name. */
export function mediaKey(kind: 'image' | 'video', ext: string, random: string, now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `media/${y}/${m}/${kind}-${random}.${ext.replace(/[^a-z0-9]/gi, '').toLowerCase()}`;
}

export const EXT_FOR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};
