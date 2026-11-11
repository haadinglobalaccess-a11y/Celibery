import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateRecoveryCodes, hotp, otpauthUri, verifyTotp } from '../../src/lib/totp';

// RFC 4226 / RFC 6238 test secret "12345678901234567890" (ASCII).
const RFC_SECRET = Buffer.from('12345678901234567890');
const B32 = base32Encode(RFC_SECRET);

describe('TOTP (RFC 6238)', () => {
  it('round-trips base32', () => {
    expect(B32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(B32).equals(RFC_SECRET)).toBe(true);
  });

  it('matches the RFC 4226 HOTP vectors', () => {
    expect(['755224', '287082', '359152', '969429', '338314'].map((_, i) => hotp(RFC_SECRET, i))).toEqual(['755224', '287082', '359152', '969429', '338314']);
  });

  it('matches the RFC 6238 SHA-1 vectors (last 6 digits)', () => {
    expect(verifyTotp(B32, '287082', { now: 59_000, window: 0 })).toBe(1);
    expect(verifyTotp(B32, '081804', { now: 1111111109_000, window: 0 })).toBe(37037036);
    expect(verifyTotp(B32, '005924', { now: 1234567890_000, window: 0 })).toBe(41152263);
  });

  it('accepts ±1 step of clock drift, refuses older steps and malformed codes', () => {
    const now = 1234567890_000;
    const prev = hotp(RFC_SECRET, 41152262);
    expect(verifyTotp(B32, prev, { now })).toBe(41152262);
    expect(verifyTotp(B32, prev, { now, afterStep: 41152262 })).toBeNull(); // replay
    expect(verifyTotp(B32, hotp(RFC_SECRET, 41152260), { now })).toBeNull(); // too old
    expect(verifyTotp(B32, '12345', { now })).toBeNull();
    expect(verifyTotp(B32, 'abcdef', { now })).toBeNull();
  });

  it('builds an otpauth URI and unique recovery codes', () => {
    expect(otpauthUri(B32, 'a@b.co')).toMatch(/^otpauth:\/\/totp\/CELIBERY%20Admin%3Aa%40b\.co\?secret=GEZD.*&issuer=CELIBERY%20Admin/);
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
  });
});
