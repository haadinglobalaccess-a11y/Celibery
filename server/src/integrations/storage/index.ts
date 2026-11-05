import fs from 'node:fs/promises';
import path from 'node:path';
import { env, isProd } from '../../config/env';
import { safeKey } from '../../lib/media-rules';
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

function s3Creds(): Credentials {
  return { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, region: env.S3_REGION || 'auto', service: 's3' };
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
  if (provider === 's3' && (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY || !env.MEDIA_PUBLIC_BASE_URL)) {
    uploadsEnabled = false;
    reason = 'Direct uploads are disabled: S3 storage is selected but not fully configured on the server.';
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

