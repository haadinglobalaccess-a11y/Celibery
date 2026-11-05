import { describe, expect, it } from 'vitest';
import { canonicalMime, imageDimensions, mediaKey, sniffMedia } from '../../src/lib/media-sniff';
import { checkMediaUrl, classifyVideoUrl, videoUrlError } from '../../src/lib/media-url';
import { safeKey, validateUploadParts as validate } from '../../src/lib/media-rules';

const MB = 1024 * 1024;
const validateUploadParts = (kind: 'image' | 'video', parts: Parameters<typeof validate>[1]) => validate(kind, parts, { imageBytes: 10 * MB, videoBytes: 100 * MB });

const bytes = (...parts: (number[] | string)[]) => {
  const out: number[] = [];
  for (const p of parts) typeof p === 'string' ? out.push(...Buffer.from(p, 'latin1')) : out.push(...p);
  return new Uint8Array(out);
};
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16le = (n: number) => [n & 255, (n >> 8) & 255];

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], u32(13), 'IHDR', u32(1200), u32(800), [8, 6, 0, 0, 0]);
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], [0, 16], 'JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0], [0xff, 0xc0, 0, 17, 8], [0x02, 0x58], [0x03, 0x20], [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
const GIF = bytes('GIF89a', u16le(320), u16le(240), [0, 0, 0]);
const WEBP = bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0], [0, 0, 0, 0], [0x7f, 0x07, 0x00], [0xaf, 0x04, 0x00]);
const MP4 = bytes([0, 0, 0, 0x20], 'ftyp', 'isom', [0, 0, 2, 0], 'isomiso2mp41');
const MOV = bytes([0, 0, 0, 0x14], 'ftyp', 'qt  ', [0, 0, 0, 0], 'qt  ');
const WEBM = bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0x82, 0x84], 'webm', [0x42, 0x87]);
const SVG = bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = bytes('<!doctype html><html><script>alert(1)</script></html>');
const PDF = bytes('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj');

describe('upload content sniffing (magic bytes)', () => {
  it('recognises allowed images and videos by content', () => {
    expect(sniffMedia(PNG)).toEqual({ mime: 'image/png', kind: 'image', ext: 'png' });
    expect(sniffMedia(JPEG)?.mime).toBe('image/jpeg');
    expect(sniffMedia(GIF)?.mime).toBe('image/gif');
    expect(sniffMedia(WEBP)?.mime).toBe('image/webp');
    expect(sniffMedia(MP4)).toEqual({ mime: 'video/mp4', kind: 'video', ext: 'mp4' });
    expect(sniffMedia(WEBM)?.mime).toBe('video/webm');
  });
  it('rejects SVG, HTML, PDF, QuickTime and junk regardless of the file name', () => {
    expect(sniffMedia(SVG)).toBeNull();
    expect(sniffMedia(HTML)).toBeNull();
    expect(sniffMedia(PDF)).toBeNull();
    expect(sniffMedia(MOV)).toBeNull();
    expect(sniffMedia(new Uint8Array(4))).toBeNull();
  });
  it('reads image dimensions from headers', () => {
    expect(imageDimensions(PNG)).toEqual({ width: 1200, height: 800 });
    expect(imageDimensions(GIF)).toEqual({ width: 320, height: 240 });
    expect(imageDimensions(JPEG)).toEqual({ width: 800, height: 600 });
    expect(imageDimensions(WEBP)).toEqual({ width: 1920, height: 1200 });
    expect(imageDimensions(MP4)).toBeNull();
  });
  it('normalises declared types', () => {
    expect(canonicalMime('image/JPG')).toBe('image/jpeg');
    expect(canonicalMime('video/mp4; codecs="avc1"')).toBe('video/mp4');
  });
});

describe('storage keys', () => {
  it('are random, typed and never derived from the uploaded file name', () => {
    const k = mediaKey('image', 'png', 'AbCdEf123456_-xy', new Date('2026-11-03'));
    expect(k).toBe('media/2026/11/image-AbCdEf123456_-xy.png');
    expect(safeKey(k)).toBe(k);
    expect(safeKey(k.replace('.png', '-w480.webp'))).toBeTruthy();
  });
  it('reject traversal and foreign paths', () => {
    expect(() => safeKey('../etc/passwd')).toThrow();
    expect(() => safeKey('media/2026/11/../../x.png')).toThrow();
    expect(() => safeKey('media/2026/11/image-short.png')).toThrow();
    expect(() => safeKey('uploads/evil.html')).toThrow();
  });
});

describe('upload request validation', () => {
  it('accepts an image with WebP variants and a video with a poster', () => {
    expect(validateUploadParts('image', [{ role: 'original', contentType: 'image/jpeg', size: 1000 }, { role: 'w480', contentType: 'image/webp', size: 200 }])).toBeNull();
    expect(validateUploadParts('video', [{ role: 'original', contentType: 'video/mp4', size: 5_000_000 }, { role: 'poster', contentType: 'image/jpeg', size: 9000 }])).toBeNull();
  });
  it('rejects wrong types, oversized files and malformed requests', () => {
    expect(validateUploadParts('image', [{ role: 'original', contentType: 'image/svg+xml', size: 10 }])).toMatch(/not accepted/);
    expect(validateUploadParts('image', [{ role: 'original', contentType: 'text/html', size: 10 }])).toMatch(/not accepted/);
    expect(validateUploadParts('video', [{ role: 'original', contentType: 'video/quicktime', size: 10 }])).toMatch(/not accepted/);
    expect(validateUploadParts('image', [{ role: 'original', contentType: 'image/png', size: 11 * 1024 * 1024 }])).toMatch(/too large/);
    expect(validateUploadParts('image', [{ role: 'w480', contentType: 'image/webp', size: 10 }])).toMatch(/original/);
    expect(validateUploadParts('image', [{ role: 'original', contentType: 'image/png', size: 10 }, { role: 'poster', contentType: 'image/png', size: 10 }])).toMatch(/poster/);
    expect(validateUploadParts('image', [{ role: 'original', contentType: 'image/png', size: 0 }])).toMatch(/empty/);
    expect(validateUploadParts('image', [{ role: '../x', contentType: 'image/png', size: 10 }])).toMatch(/Unknown part/);
  });
});

describe('external media URLs', () => {
  it('accepts https and site paths only', () => {
    expect(checkMediaUrl('https://cdn.example.com/a.jpg').ok).toBe(true);
    expect(checkMediaUrl('/placeholders/hero.svg').ok).toBe(true);
    expect(checkMediaUrl('http://cdn.example.com/a.jpg').ok).toBe(false);
    expect(checkMediaUrl('javascript:alert(1)').ok).toBe(false);
    expect(checkMediaUrl('//evil.example/a.jpg').ok).toBe(false);
    expect(checkMediaUrl('https://user:pass@example.com/a.jpg').ok).toBe(false);
    expect(checkMediaUrl('https://example.com/a.jpg" onerror="x').ok).toBe(false);
  });
  it('classifies video sources and builds privacy-friendly embeds', () => {
    expect(classifyVideoUrl('https://cdn.example.com/hero.mp4?v=2')).toEqual({ type: 'file', url: 'https://cdn.example.com/hero.mp4?v=2' });
    expect(classifyVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({ type: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(classifyVideoUrl('https://youtu.be/dQw4w9WgXcQ')?.type).toBe('youtube');
    expect(classifyVideoUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.type).toBe('youtube');
    const yt = classifyVideoUrl('https://youtu.be/dQw4w9WgXcQ');
    expect(yt && 'embedUrl' in yt && yt.embedUrl.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?')).toBe(true);
    expect(classifyVideoUrl('https://vimeo.com/123456789')).toMatchObject({ type: 'vimeo', id: '123456789' });
    expect(classifyVideoUrl('https://example.com/page.html')).toBeNull();
    expect(classifyVideoUrl('https://www.youtube.com/watch?v=bad')).toBeNull();
    expect(classifyVideoUrl('https://example.com/movie.mov')).toBeNull();
    expect(videoUrlError('')).toBeNull();
    expect(videoUrlError('https://example.com/x')).toMatch(/YouTube/);
  });
});


describe('Vimeo unlisted campaign links', () => {
  it('preserves the privacy hash from both supported URL forms', () => {
    for (const url of ['https://vimeo.com/59777392/ab882a04fd', 'https://player.vimeo.com/video/59777392?h=ab882a04fd']) {
      const source = classifyVideoUrl(url);
      expect(source?.type).toBe('vimeo');
      expect(source && source.type !== 'file' && new URL(source.embedUrl).searchParams.get('h')).toBe('ab882a04fd');
    }
  });
  it('rejects malformed privacy hashes', () => {
    expect(classifyVideoUrl('https://player.vimeo.com/video/59777392?h=invalid%26hash')).toBeNull();
  });
});
