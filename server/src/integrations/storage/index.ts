import fs from 'node:fs/promises';
import path from 'node:path';
import { env, isProd } from '../../config/env';
import { safeKey } from '../../lib/media-rules';
import { randomToken } from '../../lib/tokens';
import { integration } from '../credentials';
import type { CredentialCheck } from '../payments/types';
import { presignUrl, signHeaders, UNSIGNED_PAYLOAD, type Credentials } from './sigv4';

/**
 * Media storage behind one small interface, so the provider can change (local disk → S3 →
 * Cloudflare R2 → …) without touching the media library or the admin.
 *
 *  - "s3":    any S3-compatible bucket. Uploads go straight from the admin's browser to the bucket
 *             through short-lived pre-signed URLs (the file never passes through the API, so the
 *             serverless request-size limit does not apply and the storage keys never leave the
 *             server). Files are served from MEDIA_PUBLIC_BASE_URL (bucket public URL or CDN).
 *  - "local": a directory on the server's disk, served at /media/… — development and single
 *             servers with a persistent disk only (refused on serverless production hosting).
 *
 * Large files are never stored in MongoDB: the database keeps only the URL and metadata.
 */
export type UploadTarget = { method: 'PUT'; url: string; headers: Record<string, string>; direct: boolean };

export interface StorageProvider {
  readonly name: 'local' | 's3';
  publicUrl(key: string): string;
  /** Where the browser should PUT the file. */
  uploadTarget(key: string, contentType: string, assetId: string): Promise<UploadTarget>;
  /** Server-side write (local uploads). */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** First bytes + total size of a stored object (null when it does not exist). */
  head(key: string, bytes: number): Promise<{ size: number; head: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

export function localDir() {
  return env.MEDIA_LOCAL_DIR || path.resolve(__dirname, '../../../../uploads');
}

const localProvider: StorageProvider = {
  name: 'local',
  publicUrl: (key) => `/${safeKey(key)}`,
  async uploadTarget(key, contentType, assetId) {
    safeKey(key);
    return { method: 'PUT', url: `/api/admin/media/${assetId}/content?key=${encodeURIComponent(key)}`, headers: { 'Content-Type': contentType, 'X-Requested-With': 'celibery' }, direct: false };
  },
  async put(key, body) {
    const file = path.join(localDir(), safeKey(key));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body, { mode: 0o644 });
  },
  async head(key, bytes) {
    const file = path.join(localDir(), safeKey(key));
    try {
      const stat = await fs.stat(file);
      const fh = await fs.open(file, 'r');
      try {
        const buf = Buffer.alloc(Math.min(bytes, stat.size));
        await fh.read(buf, 0, buf.length, 0);
        return { size: stat.size, head: buf, contentType: '' };
      } finally {
        await fh.close();
      }
    } catch {
      return null;
    }
  },
  async delete(key) {
    await fs.rm(path.join(localDir(), safeKey(key)), { force: true });
  },
};

/**
 * Signing key: the key pair managed in Admin → Settings → Hosting & data when one is enabled there,
 * otherwise S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY from the server environment.
 */
function s3KeyPair(): { accessKeyId: string; secretAccessKey: string } | null {
  const i = integration('s3');
  if (!i.enabled || !i.values.accessKeyId || !i.values.secretAccessKey) return null;
  return { accessKeyId: i.values.accessKeyId, secretAccessKey: i.values.secretAccessKey };
}

function s3Creds(pair = s3KeyPair()): Credentials {
  if (!pair) throw new Error('No media storage access key is configured');
  return { ...pair, region: env.S3_REGION || 'auto', service: 's3' };
}

/** Bucket location settings that must come from the server environment (see credentials/definitions). */
export function s3LocationConfigured() {
  return Boolean(env.S3_ENDPOINT && env.S3_BUCKET && env.MEDIA_PUBLIC_BASE_URL);
}

/**
 * Tests a key pair against the configured bucket the way uploads use it: writes a tiny probe
 * object, then deletes it. Nothing else in the bucket is read or changed.
 */
export async function verifyS3(values: Record<string, string>): Promise<CredentialCheck> {
  if (!s3LocationConfigured()) return { ok: false, status: 'failed', message: 'S3_ENDPOINT, S3_BUCKET and MEDIA_PUBLIC_BASE_URL must be set on the server first' };
  if (!values.accessKeyId || !values.secretAccessKey) return { ok: false, status: 'failed', message: 'Access key ID and secret are required' };
  const creds = s3Creds({ accessKeyId: values.accessKeyId, secretAccessKey: values.secretAccessKey });
  try {
    // A key in the same shape as real media keys (safeKey), under a period no upload ever uses.
    const url = objectUrl(`media/0000/00/healthcheck-${randomToken(12)}.txt`);
    const put = await fetch(url, {
      method: 'PUT',
      headers: signHeaders({ method: 'PUT', url, creds, payloadHash: UNSIGNED_PAYLOAD, headers: { 'content-type': 'text/plain' } }),
      body: 'ok',
      signal: AbortSignal.timeout(20_000),
    });
    if (!put.ok) return { ok: false, status: 'failed', message: put.status === 403 ? 'Access denied: the key cannot write to the bucket' : `The bucket rejected the test upload (${put.status})` };
    const del = await fetch(url, { method: 'DELETE', headers: signHeaders({ method: 'DELETE', url, creds }), signal: AbortSignal.timeout(20_000) });
    if (!del.ok && del.status !== 404) return { ok: false, status: 'failed', message: `Upload works but deleting failed (${del.status}) — the key also needs delete permission` };
    return { ok: true, status: 'ok', message: `Write and delete verified on bucket ${env.S3_BUCKET}` };
  } catch (e) {
    return { ok: false, status: 'failed', message: `Could not reach the storage endpoint: ${String((e as Error).message).slice(0, 150)}` };
  }
}

function objectUrl(key: string) {
  const endpoint = new URL(env.S3_ENDPOINT);
  const k = safeKey(key);
  if (env.S3_FORCE_PATH_STYLE) return `${endpoint.origin}/${env.S3_BUCKET}/${k}`;
  return `${endpoint.protocol}//${env.S3_BUCKET}.${endpoint.host}/${k}`;
}

const s3Provider: StorageProvider = {
  name: 's3',
  publicUrl: (key) => `${env.MEDIA_PUBLIC_BASE_URL.replace(/\/$/, '')}/${safeKey(key)}`,
  async uploadTarget(key, contentType) {
    const url = presignUrl({ method: 'PUT', url: objectUrl(key), creds: s3Creds(), expiresSec: 15 * 60, headers: { 'content-type': contentType } });
    return { method: 'PUT', url, headers: { 'Content-Type': contentType }, direct: true };
  },
  async put(key, body, contentType) {
    const url = objectUrl(key);
    const headers = signHeaders({ method: 'PUT', url, creds: s3Creds(), payloadHash: UNSIGNED_PAYLOAD, headers: { 'content-type': contentType, 'cache-control': 'public, max-age=31536000, immutable' } });
    const res = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(body), signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Storage upload failed (${res.status})`);
  },
  async head(key, bytes) {
    const url = objectUrl(key);
    const headers = signHeaders({ method: 'GET', url, creds: s3Creds(), headers: { range: `bytes=0-${bytes - 1}` } });
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new Error(`Storage read failed (${res.status})`);
    const head = Buffer.from(await res.arrayBuffer()).subarray(0, bytes);
    const range = res.headers.get('content-range'); // bytes 0-63/12345
    const size = range ? Number(range.split('/')[1]) : Number(res.headers.get('content-length') ?? head.length);
    return { size, head, contentType: res.headers.get('content-type') ?? '' };
  },
  async delete(key) {
    const url = objectUrl(key);
    const headers = signHeaders({ method: 'DELETE', url, creds: s3Creds() });
    const res = await fetch(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed (${res.status})`);
  },
};

export function storageStatus() {
  const provider = env.MEDIA_STORAGE;
  let uploadsEnabled = true;
  let reason = '';
  if (provider === 'local' && isProd && !env.ALLOW_LOCAL_MEDIA_STORAGE) {
    uploadsEnabled = false;
    reason = 'Direct uploads are disabled: local disk storage is not persistent on this hosting. The developer must configure S3-compatible storage (MEDIA_STORAGE=s3). Image and video URLs still work.';
  }
  if (provider === 's3' && !s3LocationConfigured()) {
    uploadsEnabled = false;
    reason = 'Direct uploads are disabled: S3 storage is selected but S3_ENDPOINT, S3_BUCKET or MEDIA_PUBLIC_BASE_URL is missing on the server.';
  } else if (provider === 's3' && !s3KeyPair()) {
    uploadsEnabled = false;
    reason = 'Direct uploads are disabled: no storage access key is enabled. A Super Administrator can add one in Settings → Hosting & data.';
  }
  return {
    provider,
    uploadsEnabled,
    reason,
    maxImageMb: env.MEDIA_MAX_IMAGE_MB,
    maxVideoMb: env.MEDIA_MAX_VIDEO_MB,
    publicBaseUrl: provider === 's3' ? env.MEDIA_PUBLIC_BASE_URL : '',
  };
}

export function storage(): StorageProvider | null {
  if (!storageStatus().uploadsEnabled) return null;
  return env.MEDIA_STORAGE === 's3' ? s3Provider : localProvider;
}

/** Origin the browser uploads to (needed in the Content-Security-Policy connect-src). */
export function uploadOrigin(): string | null {
  if (env.MEDIA_STORAGE !== 's3' || !env.S3_ENDPOINT) return null;
  try {
    const e = new URL(env.S3_ENDPOINT);
    return env.S3_FORCE_PATH_STYLE ? e.origin : `${e.protocol}//${env.S3_BUCKET}.${e.host}`;
  } catch {
    return null;
  }
}

