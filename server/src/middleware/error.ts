import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
}

/** Central error handler. Internal details and stack traces are logged, never returned. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Some fields are invalid', details } });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ ok: false, error: { code: 'INVALID_ID', message: 'Invalid identifier' } });
  }
  const e = err as { code?: number; keyValue?: Record<string, unknown>; type?: string; status?: number };
  if (e?.code === 11000) {
    return res.status(409).json({ ok: false, error: { code: 'DUPLICATE', message: 'A record with this value already exists', details: { fields: Object.keys(e.keyValue ?? {}) } } });
  }
  if (e?.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }
  if (e?.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  }
  // Client errors raised by Express libraries in the standard http-errors shape (serve-static/send
  // refusing "../" traversal, body-parser charset/encoding errors, …): keep their 4xx status and log
  // one warning line. Before, each one was a 500 with an error-level stack trace, so a single crafted
  // URL could flood error logs and alerts. Only `expose: true` errors qualify — never upstream API
  // errors that happen to carry a status.
  const httpErr = err as { expose?: boolean; status?: number; statusCode?: number };
  const clientStatus = httpErr?.expose === true ? (httpErr.status ?? httpErr.statusCode) : undefined;
  if (typeof clientStatus === 'number' && clientStatus >= 400 && clientStatus < 500) {
    logger.warn('Client error', { path: req.path.slice(0, 200), method: req.method, status: clientStatus });
    const code = clientStatus === 404 ? 'NOT_FOUND' : clientStatus === 403 ? 'FORBIDDEN' : clientStatus === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
    return res.status(clientStatus).json({ ok: false, error: { code, message: 'The request could not be processed' } });
  }
  logger.error('Unhandled error', { path: req.path, method: req.method, err: err instanceof Error ? err.stack : String(err) });
  return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
}
