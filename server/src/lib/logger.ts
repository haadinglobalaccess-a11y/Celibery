/* eslint-disable no-console */
import { isTest } from '../config/env';
import { redact, redactString } from './redact';
import { reportEvent } from './error-reporting';
import { currentRequestId } from './request-context';

type Level = 'info' | 'warn' | 'error';

function log(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (isTest && level !== 'error') return;
  // Secrets (keys, tokens, passwords, cookies, signed URLs) are stripped from every log line.
  const requestId = currentRequestId();
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg: redactString(msg), ...(requestId ? { requestId } : {}), ...((redact(meta ?? {}) as Record<string, unknown>) ?? {}) });
  if (level === 'error') {
    console.error(line);
    // Error tracking (Sentry, when SENTRY_DSN is set): every error-level line becomes an event.
    void reportEvent({ level: 'error', message: msg, meta, requestId });
  } else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
};
