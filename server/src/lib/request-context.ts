import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Per-request correlation id. Every log line written while a request is handled carries it
 * (lib/logger.ts), the response returns it in `X-Request-Id`, and 500 errors include it, so a
 * customer's "error reference" leads straight to the matching log lines.
 *
 * An incoming X-Request-Id (from a proxy/CDN) is reused only if it is a short token of safe
 * characters — never arbitrary client text in the logs.
 */
type Ctx = { requestId: string };
const store = new AsyncLocalStorage<Ctx>();

const SAFE_ID = /^[A-Za-z0-9._:-]{8,100}$/;

export const currentRequestId = (): string | undefined => store.getStore()?.requestId;

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.get('x-request-id');
  const requestId = incoming && SAFE_ID.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', requestId);
  store.run({ requestId }, next);
}
