import { describe, expect, it } from 'vitest';
import { bannerInput } from '../../src/modules/admin/admin.schemas';

describe('admin hero durations', () => {
  it('preserves positive image durations without the old caps', () => {
    for (const durationSec of [0.25, 3, 10, 30, 301, 3600]) {
      expect(bannerInput.parse({ placement: 'hero', durationSec }).durationSec).toBe(durationSec);
    }
  });
  it('preserves automatic video zero separately from custom durations', () => {
    for (const videoDurationSec of [0, 0.25, 20, 45, 90, 3600]) {
      expect(bannerInput.parse({ placement: 'hero', videoDurationSec }).videoDurationSec).toBe(videoDurationSec);
    }
    expect(bannerInput.parse({ placement: 'hero' }).videoDurationSec).toBe(0);
  });
  it('rejects invalid durations instead of silently truncating them', () => {
    for (const durationSec of [0, -1, NaN, Infinity]) expect(bannerInput.safeParse({ placement: 'hero', durationSec }).success).toBe(false);
    for (const videoDurationSec of [-1, NaN, Infinity]) expect(bannerInput.safeParse({ placement: 'hero', videoDurationSec }).success).toBe(false);
  });
});
