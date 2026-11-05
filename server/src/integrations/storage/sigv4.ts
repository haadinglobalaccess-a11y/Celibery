import crypto from 'node:crypto';

/**
 * AWS Signature Version 4 for S3-compatible storage (AWS S3, Cloudflare R2, DigitalOcean
 * Spaces, Wasabi, MinIO…). Implemented with node:crypto so no SDK dependency is needed.
 * Pure module, verified against AWS's published signing examples in the unit tests.
 */
export type Credentials = { accessKeyId: string; secretAccessKey: string; region: string; service?: string };

const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();
export const sha256Hex = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');
export const EMPTY_SHA256 = sha256Hex('');
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

/** RFC 3986 encoding as required by SigV4 (encodes everything except A-Z a-z 0-9 - _ . ~). */
export function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** S3 canonical URI: each path segment encoded once, slashes kept. */
export function canonicalUri(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) => rfc3986(decodeURIComponent(seg)))
    .join('/') || '/';
}

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

export function amzDate(d: Date): { long: string; short: string } {
  const long = d.toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '');
  return { long, short: long.slice(0, 8) };
}

function signingKey(secret: string, short: string, region: string, service: string) {
  const kDate = hmac('AWS4' + secret, short);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function canonicalHeaders(headers: Record<string, string>) {
  const entries = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    canonical: entries.map(([k, v]) => `${k}:${v}\n`).join(''),
    signed: entries.map(([k]) => k).join(';'),
  };
}

/** Builds the string to sign and signature for a request (exported for tests). */
export function signParts(opts: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  creds: Credentials;
  date: Date;
}) {
  const service = opts.creds.service ?? 's3';
  const { long, short } = amzDate(opts.date);
  const { canonical, signed } = canonicalHeaders(opts.headers);
  const canonicalRequest = [opts.method.toUpperCase(), canonicalUri(opts.url.pathname), canonicalQuery(opts.url.searchParams), canonical, signed, opts.payloadHash].join('\n');
  const scope = `${short}/${opts.creds.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', long, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(opts.creds.secretAccessKey, short, opts.creds.region, service)).update(stringToSign, 'utf8').digest('hex');
  return { canonicalRequest, stringToSign, signature, signedHeaders: signed, scope, long };
}

/** Signs a request with an Authorization header. Returns the headers to send. */
export function signHeaders(opts: { method: string; url: string; headers?: Record<string, string>; payloadHash?: string; creds: Credentials; date?: Date }) {
  const url = new URL(opts.url);
  const date = opts.date ?? new Date();
  const payloadHash = opts.payloadHash ?? EMPTY_SHA256;
  const headers: Record<string, string> = { ...(opts.headers ?? {}), host: url.host, 'x-amz-date': amzDate(date).long };
  if ((opts.creds.service ?? 's3') === 's3') headers['x-amz-content-sha256'] = payloadHash;
  const p = signParts({ method: opts.method, url, headers, payloadHash, creds: opts.creds, date });
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${opts.creds.accessKeyId}/${p.scope}, SignedHeaders=${p.signedHeaders}, Signature=${p.signature}`,
  };
}

/**
 * Pre-signed URL (query-string authentication) — lets the admin's browser upload a file straight
 * to the bucket without the file passing through the API (serverless body limits) and without
 * exposing the storage keys. `headers` (e.g. content-type) become part of the signature.
 */
export function presignUrl(opts: { method: string; url: string; creds: Credentials; expiresSec: number; headers?: Record<string, string>; date?: Date }) {
  const url = new URL(opts.url);
  const date = opts.date ?? new Date();
  const service = opts.creds.service ?? 's3';
  const { long, short } = amzDate(date);
  const headers: Record<string, string> = { ...(opts.headers ?? {}), host: url.host };
  const { signed } = canonicalHeaders(headers);
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  url.searchParams.set('X-Amz-Credential', `${opts.creds.accessKeyId}/${short}/${opts.creds.region}/${service}/aws4_request`);
  url.searchParams.set('X-Amz-Date', long);
  url.searchParams.set('X-Amz-Expires', String(opts.expiresSec));
  url.searchParams.set('X-Amz-SignedHeaders', signed);
  const p = signParts({ method: opts.method, url, headers, payloadHash: UNSIGNED_PAYLOAD, creds: opts.creds, date });
  url.searchParams.set('X-Amz-Signature', p.signature);
  return url.toString();
}
