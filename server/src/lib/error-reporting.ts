import crypto from 'node:crypto';
import { redact, redactString } from './redact';

/**
 * Error reporting to Sentry (or any Sentry-compatible service, e.g. GlitchTip) — no SDK.
 *
 * Uses Sentry's documented envelope endpoint over HTTPS, so it works the same on Vercel serverless
 * functions and on a long-running server, and adds no dependency. Turned on only when SENTRY_DSN is
 * set; otherwise every function here is a no-op.
 *
 * What is sent: the error message and stack, level, environment, release, the request id and the
 * (already redacted) log metadata. Never request bodies, cookies or headers, never query strings
 * (order access tokens live there). Secrets are stripped again with lib/redact.ts.
 *
 * Every `logger.error(...)` is reported (lib/logger.ts), which covers unhandled 500s, payment amount
 * mismatches, duplicate payments, failed jobs and refund problems — set alert rules in Sentry.
 */
export type Dsn = { endpoint: string; publicKey: string; dsn: string };

/** Parses https://<publicKey>@<host>/<projectId>. Returns null for anything else. */
export function parseDsn(raw: string | undefined | null): Dsn | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    const projectId = u.pathname.replace(/^\/+|\/+$/g, '');
    if (u.protocol !== 'https:' || !u.username || !/^\d+$/.test(projectId.split('/').pop() ?? '')) return null;
    const prefix = projectId.includes('/') ? projectId.slice(0, projectId.lastIndexOf('/') + 1) : '';
    const id = projectId.split('/').pop()!;
    return { endpoint: `${u.protocol}//${u.host}/${prefix}api/${id}/envelope/`, publicKey: u.username, dsn: raw.trim() };
  } catch {
    return null;
  }
}

type Frame = { function?: string; filename?: string; lineno?: number; colno?: number; in_app?: boolean };

/** V8 stack text → Sentry frames (oldest first, as Sentry expects). */
export function parseStack(stack: string): { type: string; value: string; frames: Frame[] } {
  const lines = stack.split('\n');
  const head = lines[0] ?? '';
  const m = /^([A-Za-z_$][\w$.]*?)(?::\s(.*))?$/.exec(head.trim());
  const frames: Frame[] = [];
  for (const line of lines.slice(1)) {
    const f = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!f) continue;
    const filename = f[2];
    frames.push({ function: f[1] || '?', filename, lineno: Number(f[3]), colno: Number(f[4]), in_app: !/node_modules|node:/.test(filename) });
  }
  return { type: m?.[1] || 'Error', value: scrubTokens(redactString(m?.[2] ?? head)).slice(0, 1000), frames: frames.reverse().slice(-50) };
}

/** Order links carry the guest access token in the query string: never send it anywhere. */
export const scrubTokens = (s: string) => s.replace(/([?&](?:token|access_token|accessToken)=)[^&\s"']+/gi, '$1[redacted]');

const looksLikeStack = (v: unknown): v is string => typeof v === 'string' && /\n\s+at /.test(v);

export type ReportInput = {
  level: 'error' | 'warning' | 'info';
  message: string;
  meta?: Record<string, unknown>;
  requestId?: string;
  environment: string;
  release?: string;
  platform?: 'node' | 'javascript';
};

/** Builds the Sentry event (pure; unit tested). */
export function buildEvent(input: ReportInput, eventId = crypto.randomUUID().replace(/-/g, '')) {
  const meta = (redact(input.meta ?? {}) as Record<string, unknown>) ?? {};
  const stackKey = Object.keys(meta).find((k) => looksLikeStack(meta[k]));
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) if (k !== stackKey) extra[k] = typeof v === 'string' ? scrubTokens(v).slice(0, 2000) : v;
  // A "path" in the metadata never carries a query string (order tokens).
  if (typeof extra.path === 'string') extra.path = extra.path.split('?')[0];
  const tags: Record<string, string> = {};
  if (input.requestId) tags.request_id = input.requestId;
  for (const k of ['event', 'provider', 'method', 'order', 'orderNumber']) if (typeof meta[k] === 'string') tags[k] = String(meta[k]).slice(0, 200);
  const message = scrubTokens(redactString(input.message)).slice(0, 1000);
  const event: Record<string, unknown> = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: input.platform ?? 'node',
    level: input.level,
    logger: 'celibery',
    environment: input.environment,
    ...(input.release ? { release: input.release } : {}),
    tags,
    extra,
    // Groups identical log messages together instead of by stack.
    fingerprint: stackKey ? ['{{ default }}'] : [message],
  };
  if (stackKey) {
    const ex = parseStack(meta[stackKey] as string);
    event.exception = { values: [{ type: ex.type, value: ex.value, stacktrace: { frames: ex.frames } }] };
    event.message = { formatted: message };
  } else {
    event.message = { formatted: message };
  }
  return event;
}

export function envelope(event: Record<string, unknown>, dsn: Dsn): string {
  return [JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString(), dsn: dsn.dsn }), JSON.stringify({ type: 'event' }), JSON.stringify(event)].join('\n');
}

/**
 * Flood protection: at most `max` events per minute per instance, and the same message only once
 * per minute (an outage must not burn the Sentry quota or slow every failing request).
 */
export function createThrottle(max = 30, windowMs = 60_000, now = () => Date.now()) {
  let windowStart = now();
  let count = 0;
  const seen = new Map<string, number>();
  return (key: string): boolean => {
    const t = now();
    if (t - windowStart >= windowMs) {
      windowStart = t;
      count = 0;
    }
    const last = seen.get(key);
    if (last !== undefined && t - last < windowMs) return false;
    if (count >= max) return false;
    count++;
    seen.set(key, t);
    if (seen.size > 500) for (const [k, v] of seen) if (t - v >= windowMs) seen.delete(k);
    return true;
  };
}

// ---- Runtime (reads process.env directly: config/env.ts imports the logger) --------------------

const dsn = parseDsn(process.env.SENTRY_DSN);
const environment = process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development';
const release = process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || undefined;
const allow = createThrottle();
const pending = new Set<Promise<void>>();
let warned = false;

export const errorReportingEnabled = () => Boolean(dsn) && process.env.NODE_ENV !== 'test';

/** Sends one event. Never throws, never logs through the logger (no loops), gives up after 3 s. */
export function reportEvent(input: Omit<ReportInput, 'environment' | 'release'>): Promise<void> {
  if (!dsn || !errorReportingEnabled()) return Promise.resolve();
  if (!allow(`${input.level}:${input.message}`)) return Promise.resolve();
  const event = buildEvent({ ...input, environment, release });
  const p = fetch(dsn.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=celibery-reporter/1.0`,
    },
    body: envelope(event, dsn),
    signal: AbortSignal.timeout(3000),
  })
    .then((r) => {
      if (!r.ok && !warned) {
        warned = true;
        // Direct console (not the logger): a reporting problem must never be reported again (loop).
        // eslint-disable-next-line no-console
        console.warn(JSON.stringify({ level: 'warn', msg: `Error reporting rejected by the service (${r.status}); check SENTRY_DSN` }));
      }
    })
    .catch(() => undefined)
    .finally(() => pending.delete(p));
  pending.add(p);
  return p;
}

/** Waits (up to `ms`) for events still being sent — before a serverless response or process exit. */
export async function flushErrorReports(ms = 2000): Promise<void> {
  if (!pending.size) return;
  await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, ms).unref?.())]);
}
