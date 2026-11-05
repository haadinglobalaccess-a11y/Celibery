import { describe, expect, it } from 'vitest';
import { buildKeyRing, decryptSecret, encryptSecret, fingerprint, generateKey, keyId, maskSecret, needsReencryption, parseKey, SecretsError } from '../../src/lib/secrets';

const K1 = generateKey();
const K2 = generateKey();

describe('credential encryption (AES-256-GCM)', () => {
  it('round-trips and never stores the plaintext', () => {
    const ring = buildKeyRing(K1, '')!;
    const c = encryptSecret('sk_live_abcdef123456', ring, 'moyasar:live:secretKey');
    expect(c).not.toContain('sk_live_abcdef123456');
    expect(c.split(':')).toHaveLength(5);
    expect(decryptSecret(c, ring, 'moyasar:live:secretKey')).toBe('sk_live_abcdef123456');
  });

  it('uses a fresh IV every time', () => {
    const ring = buildKeyRing(K1, '')!;
    expect(encryptSecret('x', ring, 'a')).not.toBe(encryptSecret('x', ring, 'a'));
  });

  it('refuses a ciphertext moved to another field/provider (bound context)', () => {
    const ring = buildKeyRing(K1, '')!;
    const c = encryptSecret('secret', ring, 'moyasar:test:secretKey');
    expect(() => decryptSecret(c, ring, 'tabby:test:secretKey')).toThrow(SecretsError);
    expect(() => decryptSecret(c, ring, 'moyasar:live:secretKey')).toThrow(/decrypted/);
  });

  it('detects tampering', () => {
    const ring = buildKeyRing(K1, '')!;
    const parts = encryptSecret('secret', ring, 'ctx').split(':');
    const ct = Buffer.from(parts[4], 'base64');
    ct[0] ^= 0xff;
    parts[4] = ct.toString('base64');
    expect(() => decryptSecret(parts.join(':'), ring, 'ctx')).toThrow(/tampered|decrypted/);
  });

  it('supports key rotation through the previous-key list', () => {
    const old = buildKeyRing(K1, '')!;
    const c = encryptSecret('rotate-me', old, 'ctx');
    const rotated = buildKeyRing(K2, K1)!;
    expect(decryptSecret(c, rotated, 'ctx')).toBe('rotate-me');
    expect(needsReencryption(c, rotated)).toBe(true);
    expect(needsReencryption(encryptSecret('x', rotated, 'ctx'), rotated)).toBe(false);
    const withoutOld = buildKeyRing(K2, '')!;
    expect(() => decryptSecret(c, withoutOld, 'ctx')).toThrow(/not configured/);
  });

  it('validates the master key format', () => {
    expect(() => parseKey('short')).toThrow(/32 random bytes/);
    expect(parseKey('a'.repeat(64))).toHaveLength(32);
    expect(parseKey(K1)).toHaveLength(32);
    expect(keyId(parseKey(K1))).toMatch(/^[0-9a-f]{8}$/);
    expect(buildKeyRing('', '')).toBeNull();
  });

  it('masks secrets for display and fingerprints them without revealing them', () => {
    expect(maskSecret('sk_live_1234567890abcd')).toBe('sk_live_••••••••abcd');
    expect(maskSecret('abc')).toBe('•••');
    expect(maskSecret('')).toBe('');
    expect(maskSecret('plainsecretvalue99')).toBe('••••••••ue99');
    expect(fingerprint('a')).not.toBe(fingerprint('b'));
    expect(fingerprint('a')).toHaveLength(16);
  });
});
