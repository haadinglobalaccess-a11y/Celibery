import { describe, expect, it } from 'vitest';
import { inferModeFromKey, missingRequired, validateFieldValue } from '../../src/integrations/credentials/definitions';

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
});
