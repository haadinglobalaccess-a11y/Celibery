import path from 'node:path';
import { assertProductionConfig, env } from './config/env';
import { connectDb } from './db/connect';
import { logger } from './lib/logger';
import { createApp } from './app';

async function main() {
  assertProductionConfig();
  await connectDb();
  // SERVE_CLIENT=1 serves client/dist from this process (useful outside Vercel).
  const serveClient = process.env.SERVE_CLIENT ? path.resolve(__dirname, '../../client/dist') : undefined;
  const app = createApp({ serveClient });
  app.listen(env.PORT, () => logger.info(`CELIBERY API listening on http://localhost:${env.PORT}`, { env: env.NODE_ENV }));
}

main().catch((err) => {
  console.error('FAILED TO START SERVER - FULL ERROR:');
  if (err instanceof Error) {
    console.error(err.stack || err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
});

