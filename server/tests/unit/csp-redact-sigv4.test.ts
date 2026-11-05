import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { API_CSP, buildCsp, cspDirectives, sanitizeOrigins } from '../../src/lib/csp';
import { redact, redactString } from '../../src/lib/redact';
import { presignUrl, signHeaders, signParts } from '../../src/integrations/storage/sigv4';

describe('Content-Security-Policy', () => {
  it('allows own bundles and the official player SDK hosts without inline scripts or eval', () => {
    const d = cspDirectives();
    expect(d['script-src']).toEqual(["'self'", 'https://www.youtube.com', 'https://s.ytimg.com', 'https://player.vimeo.com']);
    expect(buildCsp()).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
  });
  it('permits the fonts, media and video players the site actually uses', () => {
    const d = cspDirectives();
    expect(d['style-src']).toContain('https://fonts.googleapis.com');
    expect(d['font-src']).toContain('https://fonts.gstatic.com');
    expect(d['frame-src']).toEqual(['https://www.youtube-nocookie.com', 'https://player.vimeo.com']);
    expect(d['img-src']).toContain('https:');
    expect(d['media-src']).toContain('https:');
  });
  it('adds only well-formed https origins to connect-src', () => {
    expect(sanitizeOrigins(['https://acc.r2.cloudflarestorage.com', "'unsafe-inline'", 'http://x.com', 'https://a.com/path', '*', 'https://*.example.com', null])).toEqual([
      'https://acc.r2.cloudflarestorage.com',
      'https://*.example.com',
    ]);
    expect(buildCsp({ connectSrc: ['https://bucket.example.com'] })).toContain("connect-src 'self' https://bucket.example.com");
  });
  it('omits header-only directives for <meta> delivery and has a deny-all API policy', () => {
    const meta = buildCsp({ headerOnlyDirectives: false, reportUri: '/x' });
    expect(meta).not.toContain('frame-ancestors');
    expect(meta).not.toContain('report-uri');
    expect(API_CSP).toContain("default-src 'none'");
  });
});

describe('log redaction', () => {
  it('removes secrets by key name and by pattern', () => {
    const out = redact({ secretKey: 'sk_live_abc', password: 'x', nested: { authorization: 'Bearer abc', ok: 'fine' }, note: 'key sk_live_ABCDEF1234 used', enabled: true }) as Record<string, unknown>;
    expect(out.secretKey).toBe('[redacted]');
    expect(out.password).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).authorization).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).ok).toBe('fine');
    expect(out.note).toBe('key sk_live_[redacted] used');
    expect(out.enabled).toBe(true);
    expect(redactString('https://b/x?X-Amz-Signature=abc123&X-Amz-Credential=AKIA/2026')).not.toMatch(/abc123|AKIA/);
    expect(redactString('Basic c2tfdGVzdF94Og==')).toBe('Basic [redacted]');
    expect(redactString('mongodb+srv://user:private-password@cluster.example/test')).toBe('mongodb+srv://[redacted]@cluster.example/test');
  });
});

describe('S3 SigV4 signing (AWS published examples)', () => {
  it('matches the AWS Signature V4 example (IAM ListUsers)', () => {
    const p = signParts({
      method: 'GET',
      url: new URL('https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08'),
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8', host: 'iam.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
      payloadHash: crypto.createHash('sha256').update('').digest('hex'),
      creds: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'iam' },
      date: new Date(Date.UTC(2015, 7, 30, 12, 36, 0)),
    });
    expect(p.signature).toBe('5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
  });
  it('matches the S3 pre-signed URL example', () => {
    const url = presignUrl({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      creds: { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' },
      expiresSec: 86400,
      date: new Date(Date.UTC(2013, 4, 24)),
    });
    expect(new URL(url).searchParams.get('X-Amz-Signature')).toBe('aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
  });
  it('signs upload content-type into pre-signed PUT URLs and adds the payload hash header', () => {
    const url = new URL(presignUrl({ method: 'PUT', url: 'https://acc.r2.cloudflarestorage.com/bucket/media/2026/11/image-abcdefgh12345678.jpg', creds: { accessKeyId: 'A', secretAccessKey: 'B', region: 'auto' }, expiresSec: 900, headers: { 'content-type': 'image/jpeg' } }));
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    const h = signHeaders({ method: 'DELETE', url: 'https://acc.r2.cloudflarestorage.com/bucket/k', creds: { accessKeyId: 'A', secretAccessKey: 'B', region: 'auto' } });
    expect(h.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=A\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  });
});
