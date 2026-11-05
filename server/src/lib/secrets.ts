import crypto from 'node:crypto';

/**
 * Encryption at rest for merchant credentials (payment gateway keys, webhook secrets, courier
 * API keys) that administrators manage from the dashboard.
 *
 * - AES-256-GCM (authenticated): any tampering with the stored value makes decryption fail.
 * - The master key lives ONLY in the server environment (CREDENTIALS_ENCRYPTION_KEY), never in
 *   the database or the repository. Losing the key means re-entering the credentials; nothing
 *   else is affected.
 * - Every ciphertext is bound to its location (provider / mode / field) through GCM additional
 *   authenticated data, so a ciphertext copied into another field or provider will not decrypt.
 * - Key rotation: set the new key as CREDENTIALS_ENCRYPTION_KEY and keep the old one in
 *   CREDENTIALS_ENCRYPTION_KEY_PREVIOUS (comma separated) until `npm run migrate -- --reencrypt`
 *   has re-encrypted every value with the new key. Each value records the id of the key used.
 *
 * This module has no database or framework dependency so it can be unit tested in isolation.
 */

export const CIPHER_VERSION = 'v1';

export type KeyRing = { current: Buffer; previous: Buffer[] };

export class SecretsError extends Error {
  constructor(
    public code: 'NO_KEY' | 'BAD_KEY' | 'BAD_FORMAT' | 'UNKNOWN_KEY' | 'DECRYPT_FAILED',
    message: string,
  ) {
    super(message);
  }
}

/** Accepts a 32-byte key as base64 (44 chars), base64url or hex (64 chars). */
export function parseKey(raw: string): Buffer {
  const v = raw.trim();
  let buf: Buffer | null = null;
  if (/^[0-9a-f]{64}$/i.test(v)) buf = Buffer.from(v, 'hex');
  else if (/^[A-Za-z0-9+/_-]{43,44}={0,2}$/.test(v)) buf = Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (!buf || buf.length !== 32) {
    throw new SecretsError('BAD_KEY', 'The credentials encryption key must be 32 random bytes (base64 or 64 hex characters)');
  }
  return buf;
}

/** Short, non-secret identifier of a key (first 8 hex chars of its SHA-256). */
export function keyId(key: Buffer): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
}

export function buildKeyRing(current: string | undefined, previous: string | undefined): KeyRing | null {
  if (!current || !current.trim()) return null;
  return {
    current: parseKey(current),
    previous: (previous ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(parseKey),
  };
}

const aadFor = (context: string) => Buffer.from(`celibery-credentials:${context}`, 'utf8');

/** Encrypts a UTF-8 secret. `context` binds the value to where it is stored (e.g. "moyasar:live:secretKey"). */
export function encryptSecret(plain: string, ring: KeyRing, context: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ring.current, iv);
  cipher.setAAD(aadFor(context));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [CIPHER_VERSION, keyId(ring.current), iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(stored: string, ring: KeyRing, context: string): string {
  const parts = stored.split(':');
  if (parts.length !== 5 || parts[0] !== CIPHER_VERSION) throw new SecretsError('BAD_FORMAT', 'Stored credential has an unknown format');
  const [, kid, ivB64, tagB64, ctB64] = parts;
  const key = [ring.current, ...ring.previous].find((k) => keyId(k) === kid);
  if (!key) throw new SecretsError('UNKNOWN_KEY', `Stored credential was encrypted with key ${kid}, which is not configured`);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAAD(aadFor(context));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretsError('DECRYPT_FAILED', 'Stored credential could not be decrypted (wrong key or tampered value)');
  }
}

/** True when the value was encrypted with an older key and should be re-encrypted. */
export function needsReencryption(stored: string, ring: KeyRing): boolean {
  const kid = stored.split(':')[1];
  return Boolean(kid) && kid !== keyId(ring.current);
}

/**
 * Masked representation for the admin UI: keeps a recognisable prefix (e.g. "sk_live_") and
 * the last 4 characters, never more than a quarter of the value.
 */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return '';
  const v = String(value);
  if (v.length <= 8) return '•'.repeat(v.length);
  const prefixMatch = /^([a-z]{2,4}_(?:test|live)_)/i.exec(v);
  const prefix = prefixMatch ? prefixMatch[1] : '';
  const tail = v.slice(-4);
  return `${prefix}${'•'.repeat(8)}${tail}`;
}

/** Non-reversible fingerprint used to tie a verification result to the exact credential tested. */
export function fingerprint(value: string): string {
  return crypto.createHash('sha256').update(`celibery-fp:${value}`).digest('hex').slice(0, 16);
}

/** Generates a key suitable for CREDENTIALS_ENCRYPTION_KEY. */
export function generateKey(): string {
  return crypto.randomBytes(32).toString('base64');
}
