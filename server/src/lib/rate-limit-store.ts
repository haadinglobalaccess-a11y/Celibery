import mongoose from 'mongoose';
import { MemoryStore, type ClientRateLimitInfo, type Options, type Store } from 'express-rate-limit';
import { logger } from './logger';

/**
 * Shared rate-limit store for express-rate-limit, backed by the application's own MongoDB (no
 * extra service such as Redis is needed). Every serverless invocation on Vercel and every Railway
 * replica increments the same counter, so limits hold across instances.
 *
 * Fixed window per key: one atomic findOneAndUpdate (update pipeline) increments the counter or
 * starts a new window. Expired counters are removed by a TTL index (models/Security.ts).
 *
 * If MongoDB is unreachable or slow, the store falls back to a per-instance in-memory counter
 * (logged as `rate_limit.store_unavailable`): requests are still limited per instance instead
 * of either being blocked for everybody or passing unlimited.
 */
const COLLECTION = 'rate_limits';
const OP_TIMEOUT_MS = 1500;
let lastWarnAt = 0;

function warnOnce(err: unknown) {
  const now = Date.now();
  if (now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  logger.warn('security:rate_limit.store_unavailable', { security: true, event: 'rate_limit.store_unavailable', err: String((err as Error)?.message ?? err).slice(0, 200) });
}

export class MongoRateLimitStore implements Store {
  windowMs = 60_000;
  /** Counts are shared between instances. */
  localKeys = false;
  readonly prefix: string;
  private fallback = new MemoryStore();

  constructor(prefix: string) {
    this.prefix = `${prefix}:`;
  }

  init(options: Options) {
    this.windowMs = options.windowMs;
    this.fallback.init(options);
  }

  private available() {
    return mongoose.connection.readyState === 1 && Boolean(mongoose.connection.db);
  }

  private col() {
    return mongoose.connection.db!.collection<{ _id: string; hits: number; resetAt: Date }>(COLLECTION);
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    if (!this.available()) return this.fallback.increment(key);
    const now = new Date();
    const nextReset = new Date(now.getTime() + this.windowMs);
    const live = { $gt: ['$resetAt', now] };
    try {
      const doc = await this.col().findOneAndUpdate(
        { _id: this.prefix + key },
        [
          {
            $set: {
              hits: { $cond: [live, { $add: [{ $ifNull: ['$hits', 0] }, 1] }, 1] },
              resetAt: { $cond: [live, '$resetAt', nextReset] },
            },
          },
        ],
        { upsert: true, returnDocument: 'after', maxTimeMS: OP_TIMEOUT_MS },
      );
      if (!doc) return this.fallback.increment(key);
      return { totalHits: doc.hits, resetTime: doc.resetAt };
    } catch (err) {
      // Two first hits racing on a new key: one upsert loses with a duplicate key — retry once.
      if ((err as { code?: number }).code === 11000) return this.increment(key);
      warnOnce(err);
      return this.fallback.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    if (!this.available()) return this.fallback.decrement(key);
    try {
      await this.col().updateOne({ _id: this.prefix + key, hits: { $gt: 0 } }, { $inc: { hits: -1 } }, { maxTimeMS: OP_TIMEOUT_MS });
    } catch (err) {
      warnOnce(err);
      await this.fallback.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    await this.fallback.resetKey(key);
    if (!this.available()) return;
    try {
      await this.col().deleteOne({ _id: this.prefix + key }, { maxTimeMS: OP_TIMEOUT_MS });
    } catch (err) {
      warnOnce(err);
    }
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    if (!this.available()) return this.fallback.get(key);
    const doc = await this.col().findOne({ _id: this.prefix + key }, { maxTimeMS: OP_TIMEOUT_MS }).catch(() => null);
    if (!doc || doc.resetAt <= new Date()) return undefined;
    return { totalHits: doc.hits, resetTime: doc.resetAt };
  }
}
