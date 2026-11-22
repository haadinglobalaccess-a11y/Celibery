import { describe, expect, it } from 'vitest';
import { staffMfaRequired } from '../../src/config/env';

describe('staff two-factor requirement', () => {
  it('is off unless explicitly switched on (testing phase)', () => {
    expect(staffMfaRequired({})).toBe(false);
    expect(staffMfaRequired({ STAFF_MFA_REQUIRED: '' })).toBe(false);
    expect(staffMfaRequired({ STAFF_MFA_REQUIRED: 'false' })).toBe(false);
  });

  it('is required when STAFF_MFA_REQUIRED is true (handover to the client)', () => {
    expect(staffMfaRequired({ STAFF_MFA_REQUIRED: 'true' })).toBe(true);
    expect(staffMfaRequired({ STAFF_MFA_REQUIRED: ' YES ' })).toBe(true);
    expect(staffMfaRequired({ STAFF_MFA_REQUIRED: '1' })).toBe(true);
  });
});
