import { Worker } from 'node:worker_threads';
import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { serviceUnavailable } from './errors';
import { logger } from './logger';

/**
 * bcrypt off the main thread.
 *
 * Same library (bcryptjs), same hashes, same cost factor — only WHERE it runs changes. One
 * cost-12 comparison costs ~0.5 s of CPU; run on the event loop it caps an instance at about two
 * sign-ins per second and stalls every other request meanwhile (LOAD_TEST_REPORT.md, customer
 * scenario). A small worker pool keeps the storefront responsive during a sign-in burst.
 *
 * Graceful degradation: when more than PASSWORD_HASH_MAX_QUEUE operations are already waiting, a
 * new sign-in is answered at once with 503 SIGN_IN_BUSY (retry in a few seconds) instead of queueing
 * until the platform timeout. If workers cannot start, everything falls back to the main thread
 * (the previous behaviour). PASSWORD_HASH_THREADS=0 disables the pool.
 */
type Job = { id: number; resolve: (v: unknown) => void; reject: (e: unknown) => void };
type Slot = { worker: Worker; pending: Map<number, Job> };

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const bcrypt = require(workerData.bcryptPath);
parentPort.on('message', async (m) => {
  try {
    const r = m.op === 'hash' ? await bcrypt.hash(m.a, m.b) : await bcrypt.compare(m.a, m.b);
    parentPort.postMessage({ id: m.id, ok: true, r });
  } catch (e) {
    parentPort.postMessage({ id: m.id, ok: false, e: String((e && e.message) || e) });
  }
});
`;

let slots: Slot[] = [];
let nextId = 1;
let disabled = false;
let queued = 0;

function threads() {
  return disabled ? 0 : env.PASSWORD_HASH_THREADS;
}

function spawn(): Slot | null {
  try {
    const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { bcryptPath: require.resolve('bcryptjs') } });
    worker.unref(); // never keeps the process alive at shutdown
    const slot: Slot = { worker, pending: new Map() };
    worker.on('message', (m: { id: number; ok: boolean; r?: unknown; e?: string }) => {
      const job = slot.pending.get(m.id);
      if (!job) return;
      slot.pending.delete(m.id);
      if (m.ok) job.resolve(m.r);
      else job.reject(new Error(m.e));
    });
    const fail = (err: unknown) => {
      slots = slots.filter((s) => s !== slot);
      for (const job of slot.pending.values()) job.reject(err);
      slot.pending.clear();
    };
    worker.on('error', (err) => {
      logger.error('Password hashing worker failed', { err: String(err?.message ?? err) });
      fail(err);
    });
    worker.on('exit', (code) => fail(new Error(`password worker exited (${code})`)));
    return slot;
  } catch (err) {
    logger.warn('Password hashing workers unavailable; hashing on the main thread', { err: String((err as Error)?.message ?? err) });
    disabled = true;
    return null;
  }
}

function pickSlot(): Slot | null {
  const want = threads();
  if (want <= 0) return null;
  while (slots.length < want) {
    const s = spawn();
    if (!s) return null;
    slots.push(s);
  }
  return slots.reduce((a, b) => (b.pending.size < a.pending.size ? b : a));
}

async function run<T>(op: 'hash' | 'compare', a: string, b: string | number, inline: () => Promise<T>): Promise<T> {
  if (queued >= env.PASSWORD_HASH_MAX_QUEUE) {
    throw serviceUnavailable('SIGN_IN_BUSY', 'Sign-in is very busy right now. Please try again in a few seconds.');
  }
  queued++;
  try {
    const slot = pickSlot();
    if (!slot) return await inline();
    const id = nextId++;
    try {
      return await new Promise<T>((resolve, reject) => {
        slot.pending.set(id, { id, resolve: resolve as (v: unknown) => void, reject });
        slot.worker.postMessage({ id, op, a, b });
      });
    } catch (err) {
      // A crashed worker must not fail a sign-in: answer this one on the main thread.
      logger.warn('Password worker job failed; retrying on the main thread', { err: String((err as Error)?.message ?? err) });
      return await inline();
    }
  } finally {
    queued--;
  }
}

export const bcryptHash = (password: string, rounds: number) => run<string>('hash', password, rounds, () => bcrypt.hash(password, rounds));
export const bcryptCompare = (password: string, hash: string) => run<boolean>('compare', password, hash, () => bcrypt.compare(password, hash));

/** Test/diagnostic hook: number of live workers and operations in progress. */
export const passwordPoolState = () => ({ workers: slots.length, queued, disabled });
