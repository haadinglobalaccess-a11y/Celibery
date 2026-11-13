import mongoose from 'mongoose';
import { env, isProd } from '../config/env';
import { logger } from '../lib/logger';

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
    watchConnection();
    cache.promise = mongoose
      .connect(uri, {
        dbName: env.MONGODB_DB_NAME,
        serverSelectionTimeoutMS: 10_000,
        // Per instance. Size it so (max instances × pool) stays under the cluster's connection limit
        // (PRODUCTION_CAPACITY_REPORT.md). Idle connections are closed so scaled-down or frozen
        // serverless instances do not hold Atlas connections open.
        maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
        minPoolSize: env.MONGODB_MIN_POOL_SIZE,
        maxIdleTimeMS: 60_000,
        // A request waiting for a free pooled connection fails after 10 s instead of hanging until
        // the platform timeout (Vercel: 30 s) — the client sees a clean 5xx and can retry.
        waitQueueTimeoutMS: 10_000,
      })
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

/**
 * Logs connection-state changes once per process (database outages and failovers show up in the
 * host's log stream). The driver reconnects by itself; requests during an outage get a 503 from
 * /api/health and a DATABASE_UNAVAILABLE / server error from the API, never a hang.
 */
let watching = false;
function watchConnection() {
  if (watching) return;
  watching = true;
  const c = mongoose.connection;
  c.on('disconnected', () => logger.warn('MongoDB disconnected'));
  c.on('reconnected', () => logger.info('MongoDB reconnected'));
  c.on('error', (err) => logger.error('MongoDB connection error', { err: String((err as Error)?.message ?? err) }));
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
