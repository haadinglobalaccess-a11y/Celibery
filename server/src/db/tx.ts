import mongoose, { type ClientSession } from 'mongoose';
import { supportsTransactions } from './connect';

/**
 * Runs `fn` inside a MongoDB transaction when the deployment supports it (Atlas / replica set).
 * On a standalone server it runs without a session; callers that modify several documents
 * must then compensate on failure themselves (see order.service createOrder).
 */
export async function withTx<T>(fn: (session: ClientSession | undefined) => Promise<T>): Promise<T> {
  if (await supportsTransactions()) {
    const session = await mongoose.startSession();
    try {
      let result!: T;
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }
  return fn(undefined);
}
