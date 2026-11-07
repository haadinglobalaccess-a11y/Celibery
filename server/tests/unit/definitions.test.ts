import { describe, expect, it } from 'vitest';
import { inferModeFromKey, missingRequired, validateFieldValue, verificationSubject } from '../../src/integrations/credentials/definitions';
import { robotsTxt } from '../../src/modules/catalog/catalog.controller';

describe('integration credential rules', () => {
  it('Moyasar keys must match the selected mode', () => {
    expect(validateFieldValue('moyasar', 'secretKey', 'test', 'sk_test_abc123')).toBeNull();
    expect(validateFieldValue('moyasar', 'secretKey', 'live', 'sk_test_abc123')).toMatch(/sk_live_/);
    expect(validateFieldValue('moyasar', 'secretKey', 'test', 'sk_live_abc123')).toMatch(/sk_test_/);
    expect(validateFieldValue('moyasar', 'publishableKey', 'live', 'pk_live_abc')).toBeNull();
    expect(validateFieldValue('moyasar', 'publishableKey', 'live', 'sk_live_abc')).toMatch(/pk_live_/);
  });
  it('Tabby rejects test keys in live mode and live keys in test mode', () => {
    expect(validateFieldValue('tabby', 'secretKey', 'live', 'sk_test_x1')).toMatch(/test key/);
    expect(validateFieldValue('tabby', 'secretKey', 'test', 'sk_abcdef')).toMatch(/live key/);
    expect(validateFieldValue('tabby', 'secretKey', 'live', 'sk_abcdef')).toBeNull();
    expect(validateFieldValue('tabby', 'merchantCode', 'live', 'CELIBERY_SA')).toBeNull();
  });
  it('rejects whitespace, unknown fields and over-long values', () => {
    expect(validateFieldValue('moyasar', 'secretKey', 'test', 'sk_test_a b')).toMatch(/spaces/);
    expect(validateFieldValue('moyasar', 'nope', 'test', 'x')).toMatch(/Unknown/);
    expect(validateFieldValue('imile', 'apiKey', 'live', 'x'.repeat(401))).toMatch(/too long/);
  });
  it('infers legacy env mode and lists missing required fields', () => {
    expect(inferModeFromKey('sk_test_1')).toBe('test');
    expect(inferModeFromKey('sk_live_1')).toBe('live');
    expect(missingRequired('tabby', { secretKey: true })).toEqual(['merchantCode']);
    expect(missingRequired('moyasar', { secretKey: true })).toEqual([]);
  });
  it('SMTP settings: host name, port range and sender address', () => {
    expect(validateFieldValue('smtp', 'host', 'live', 'smtp.office365.com')).toBeNull();
    expect(validateFieldValue('smtp', 'host', 'live', 'https://smtp.example.com')).toMatch(/host name/);
    expect(validateFieldValue('smtp', 'host', 'live', 'smtp.example.com:587')).toMatch(/host name/);
    expect(validateFieldValue('smtp', 'port', 'live', '587')).toBeNull();
    expect(validateFieldValue('smtp', 'port', 'live', '0')).toMatch(/between 1 and 65535/);
    expect(validateFieldValue('smtp', 'port', 'live', '70000')).toMatch(/between 1 and 65535/);
    // The sender may contain a display name with spaces, but never line breaks (header injection).
    expect(validateFieldValue('smtp', 'from', 'live', 'CELIBERY International <no-reply@celibery.sa>')).toBeNull();
    expect(validateFieldValue('smtp', 'from', 'live', 'no-reply@celibery.sa')).toBeNull();
    expect(validateFieldValue('smtp', 'from', 'live', 'CELIBERY\r\nBcc: x@evil.test <a@b.co>')).toMatch(/line breaks/);
    expect(validateFieldValue('smtp', 'from', 'live', 'not an address')).toMatch(/email address/);
    expect(validateFieldValue('smtp', 'user', 'live', 'a user')).toMatch(/spaces/);
    expect(missingRequired('smtp', { host: true, port: true })).toEqual(['from']);
  });
  it('WhatsApp settings: numeric phone number ID, template name and language codes', () => {
    expect(validateFieldValue('whatsapp', 'phoneNumberId', 'live', '109876543210')).toBeNull();
    expect(validateFieldValue('whatsapp', 'phoneNumberId', 'live', '+966500000000')).toMatch(/numeric ID/);
    expect(validateFieldValue('whatsapp', 'orderTemplate', 'live', 'order_update')).toBeNull();
    expect(validateFieldValue('whatsapp', 'orderTemplate', 'live', 'Order-Update')).toMatch(/lowercase/);
    expect(validateFieldValue('whatsapp', 'templateLangEn', 'live', 'en_US')).toBeNull();
    expect(validateFieldValue('whatsapp', 'templateLangAr', 'live', 'arabic')).toMatch(/Language codes/);
    expect(missingRequired('whatsapp', { phoneNumberId: true })).toEqual(['accessToken', 'orderTemplate']);
  });
  it('a verification covers every connection value for SMTP, and only the secret key for gateways (unchanged)', () => {
    const base = { host: 'smtp.a.test', port: '587', user: 'u', pass: 'p', from: 'a@b.co' };
    expect(verificationSubject('smtp', base)).not.toBe(verificationSubject('smtp', { ...base, host: 'smtp.b.test' }));
    expect(verificationSubject('smtp', base)).not.toBe(verificationSubject('smtp', { ...base, pass: 'q' }));
    expect(verificationSubject('smtp', base)).toBe(verificationSubject('smtp', { ...base, from: 'c@d.co' })); // sender is not part of the handshake
    expect(verificationSubject('moyasar', { secretKey: 'sk_test_1', publishableKey: 'pk' })).toBe('sk_test_1');
  });
});

describe('robots.txt', () => {
  it('blocks only AI crawlers when AI access is turned off, always keeps private paths out, and uses an absolute sitemap', () => {
    const on = robotsTxt(true, 'https://celibery.sa/');
    const off = robotsTxt(false, 'https://celibery.sa');
    expect(on).toContain('Sitemap: https://celibery.sa/sitemap.xml');
    expect(on).toContain('User-agent: GPTBot\nAllow: /\nDisallow: /admin\n');
    expect(off).toContain('User-agent: GPTBot\nDisallow: /\n');
    expect(off).toContain('User-agent: *\nAllow: /\nDisallow: /admin\n');
    expect(off.match(/Disallow: \/api\//g)!.length).toBe(1);
  });
});
