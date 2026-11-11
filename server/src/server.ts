import path from 'node:path';
import { assertProductionConfig, env } from './config/env';
import { connectDb, disconnectDb } from './db/connect';
import { startScheduler } from './jobs';
import { logger } from './lib/logger';
import { createApp } from './app';

/** Long-running server entry (local development, Railway, a VPS or a container). Vercel uses api/index.ts. */
async function main() {
  assertProductionConfig();
  await connectDb();
  // SERVE_CLIENT=1 serves client/dist from this process: one origin for the store, admin and API.
  const serveClient = process.env.SERVE_CLIENT ? path.resolve(__dirname, '../../client/dist') : undefined;
  const app = createApp({ serveClient });
  const server = app.listen(env.PORT, () => logger.info(`CELIBERY API listening on port ${env.PORT}`, { env: env.NODE_ENV, serveClient: Boolean(serveClient) }));
  // Slow-client protection (slowloris): headers must arrive within 20 s and a request within 2 min
  // (large local media uploads included). Keep-alive above the typical 60 s load-balancer idle timeout.
  server.headersTimeout = 20_000;
  server.requestTimeout = 120_000;
  server.keepAliveTimeout = 65_000;
  server.maxHeadersCount = 100;

  // No Vercel Cron here: run the scheduled jobs in-process unless an external cron calls /api/cron/*.
  const stopScheduler = env.DISABLE_INTERNAL_SCHEDULER || env.NODE_ENV === 'test' ? () => undefined : startScheduler();

  // Hosts send SIGTERM before replacing the process on every deploy: finish in-flight requests
  // (a checkout may be mid-transaction) before closing the database connection.
  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info(`Received ${signal}, shutting down`);
    stopScheduler();
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(() => {
      disconnectDb()
        .catch(() => undefined)
        .finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// A failed background task (a notification, a log write) must never take the whole store offline:
// log it and keep serving. Programming errors outside a request still restart the process.
process.on('unhandledRejection', (reason) => logger.error('Unhandled promise rejection', { err: reason instanceof Error ? reason.stack : String(reason) }));

main().catch((err) => {
  // Full stack on stderr: the most useful line in a host's deploy log when start-up fails.
  console.error('FAILED TO START SERVER:', err instanceof Error ? err.stack || err.message : err); // eslint-disable-line no-console
  process.exit(1);
});
