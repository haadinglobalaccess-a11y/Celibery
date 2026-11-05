import mongoose from 'mongoose';
import { env, isProd } from '../config/env';

// Query-selector injection (e.g. {"$gt": ""}) is prevented at the edge: every request body,
// query and route parameter is parsed by a zod schema that only admits primitive values
// where filters are built, and strictQuery drops unknown filter paths.
mongoose.set('strictQuery', true);

type Cache = { promise: Promise<typeof mongoose> | null };
const g = globalThis as unknown as { __celiberyMongo?: Cache };
const cache: Cache = g.__celiberyMongo ?? (g.__celiberyMongo = { promise: null });

/** Connects once per process (cached across serverless invocations). */
export async function connectDb(uri = env.MONGODB_URI): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (!uri) throw new Error('MONGODB_URI is not configured');
  if (mongoose.connection.readyState === 0) {
    cache.promise = null;
    delete (globalThis as { __celiberyTx?: boolean }).__celiberyTx;
  }
  if (!cache.promise) {
    cache.promise = mongoose
      .connect(uri, { dbName: env.MONGODB_DB_NAME, serverSelectionTimeoutMS: 10_000, maxPoolSize: 10 })
      .then(async connection => {
        if (isProd && !(await supportsTransactions())) {
          await mongoose.disconnect();
          throw new Error('Production MongoDB must support transactions (replica set or sharded cluster)');
        }
        return connection;
      })
      .catch((err) => {
        cache.promise = null;
        throw err;
      });
  }
  return cache.promise;
}

export async function disconnectDb() {
  cache.promise = null;
  delete (globalThis as { __celiberyTx?: boolean }).__celiberyTx;
  await mongoose.disconnect();
}

export const databaseReady = () => mongoose.connection.readyState === 1;

/** Whether the connected deployment supports multi-document transactions (replica set / Atlas). */
export async function supportsTransactions(): Promise<boolean> {
  const g2 = globalThis as unknown as { __celiberyTx?: boolean };
  if (g2.__celiberyTx !== undefined) return g2.__celiberyTx;
  try {
    const admin = mongoose.connection.db!.admin();
    const hello = (await admin.command({ hello: 1 })) as { setName?: string; msg?: string };
    g2.__celiberyTx = Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch {
    g2.__celiberyTx = false;
  }
  return g2.__celiberyTx;
}
