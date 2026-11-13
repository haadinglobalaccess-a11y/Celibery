import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { bcryptCompare, bcryptHash, passwordPoolState } from '../../src/lib/password-hash';

describe('bcrypt worker pool', () => {
  it('runs on worker threads and is fully compatible with hashes made on the main thread', async () => {
    expect(env.PASSWORD_HASH_THREADS).toBeGreaterThan(0);
    const fromWorker = await bcryptHash('Correct horse 1!', 4);
    expect(passwordPoolState()).toMatchObject({ disabled: false });
    expect(passwordPoolState().workers).toBeGreaterThan(0);
    // Worker hash verifies with plain bcryptjs, and a main-thread hash verifies in the worker.
    expect(await bcrypt.compare('Correct horse 1!', fromWorker)).toBe(true);
    const fromMain = await bcrypt.hash('Correct horse 1!', 4);
    expect(await bcryptCompare('Correct horse 1!', fromMain)).toBe(true);
    expect(await bcryptCompare('wrong', fromMain)).toBe(false);
    expect(fromWorker).toMatch(/^\$2[aby]\$04\$/);
  });

  it('handles concurrent operations', async () => {
    const h = await bcrypt.hash('pw-123456', 4);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => bcryptCompare(i % 2 ? 'pw-123456' : 'nope', h)));
    expect(results.filter(Boolean)).toHaveLength(10);
  });

  it('sheds load with 503 SIGN_IN_BUSY instead of queueing without bound', async () => {
    const saved = env.PASSWORD_HASH_MAX_QUEUE;
    env.PASSWORD_HASH_MAX_QUEUE = 2;
    try {
      const h = await bcrypt.hash('x', 8);
      const settled = await Promise.allSettled(Array.from({ length: 6 }, () => bcryptCompare('x', h)));
      const busy = settled.filter((s) => s.status === 'rejected');
      expect(busy.length).toBeGreaterThan(0);
      expect((busy[0] as PromiseRejectedResult).reason).toMatchObject({ status: 503, code: 'SIGN_IN_BUSY' });
      expect(settled.some((s) => s.status === 'fulfilled' && s.value === true)).toBe(true);
    } finally {
      env.PASSWORD_HASH_MAX_QUEUE = saved;
    }
  });
});
