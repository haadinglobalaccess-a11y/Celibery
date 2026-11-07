// Vercel serverless entry point. All /api/* requests (and /sitemap.xml) are rewritten here
// (and /robots.txt) and handled by the same Express application used for local development.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/src/app';
import { assertProductionConfig } from '../server/src/config/env';
import { connectDb } from '../server/src/db/connect';
import { logger } from '../server/src/lib/logger';

assertProductionConfig();
const app = createApp();

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await connectDb();
  } catch {
    logger.error('Database connection unavailable');
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '5');
    res.end(JSON.stringify({ ok: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Service temporarily unavailable. Please try again.' } }));
    return;
  }
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
