/**
 * Browser error reporting to Sentry (or a Sentry-compatible service) — no SDK, a few hundred bytes.
 *
 * On only when VITE_SENTRY_DSN is set at build time (the DSN is a public key; Sentry designs it to be
 * shipped to browsers). Reports uncaught errors, unhandled promise rejections and render errors
 * caught by the ErrorBoundary.
 *
 * Privacy: only the page path is sent — never the query string (order access tokens live there),
 * never form contents, cookies or storage. Token-like query values inside messages are masked.
 */
type Dsn = { url: string };

function parseDsn(raw: string | undefined): Dsn | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    const id = u.pathname.replace(/^\/+|\/+$/g, '').split('/').pop() ?? '';
    if (u.protocol !== 'https:' || !u.username || !/^\d+$/.test(id)) return null;
    // Key in the query string + a plain-text body = a "simple" request: no CORS preflight.
    return { url: `${u.origin}/api/${id}/envelope/?sentry_key=${encodeURIComponent(u.username)}&sentry_version=7&sentry_client=celibery-web%2F1.0` };
  } catch {
    return null;
  }
}

const DSN = parseDsn(import.meta.env.VITE_SENTRY_DSN as string | undefined);
const ENVIRONMENT = (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) || (import.meta.env.PROD ? 'production' : 'development');
const RELEASE = (import.meta.env.VITE_SENTRY_RELEASE as string | undefined) || undefined;

const MAX_PER_PAGE = 10;
let sent = 0;
const seen = new Set<string>();

const scrub = (s: string) => s.replace(/([?&](?:token|access_token|accessToken)=)[^&\s"']+/gi, '$1[redacted]').slice(0, 4000);

/** Noise that is not a CELIBERY bug: browser extensions, benign browser warnings, cancelled requests. */
function ignorable(message: string, stack: string): boolean {
  if (/chrome-extension:|moz-extension:|safari-(web-)?extension:/i.test(stack)) return true;
  if (/^Script error\.?$/i.test(message)) return true; // cross-origin script, no detail
  if (/ResizeObserver loop/i.test(message)) return true;
  if (/AbortError|The user aborted a request|signal is aborted/i.test(message)) return true;
  return false;
}

function uuid() {
  return (crypto.randomUUID?.() ?? `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`).replace(/-/g, '').slice(0, 32).padEnd(32, '0');
}

/** Reports one error. Never throws. */
export function reportError(error: unknown, context: Record<string, string> = {}) {
  try {
    if (!DSN || sent >= MAX_PER_PAGE) return;
    const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error)?.slice(0, 500) ?? 'Unknown error');
    const message = scrub(err.message || String(err));
    const stack = scrub(err.stack ?? '');
    if (ignorable(message, stack)) return;
    const key = `${err.name}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent++;
    const path = window.location.pathname;
    const event = {
      event_id: uuid(),
      timestamp: Date.now() / 1000,
      platform: 'javascript',
      level: 'error',
      environment: ENVIRONMENT,
      ...(RELEASE ? { release: RELEASE } : {}),
      request: { url: window.location.origin + path },
      tags: { area: path.startsWith('/admin') ? 'admin' : 'store', lang: document.documentElement.lang || '', ...context },
      exception: { values: [{ type: err.name || 'Error', value: message }] },
      extra: { stack },
    };
    const body = [JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }), JSON.stringify({ type: 'event' }), JSON.stringify(event)].join('\n');
    // keepalive: still delivered if the page is closing or reloading (ErrorBoundary's reload).
    void fetch(DSN.url, { method: 'POST', body, keepalive: true, mode: 'no-cors', credentials: 'omit' }).catch(() => undefined);
  } catch {
    /* reporting must never break the page */
  }
}

/** Global listeners for errors outside React rendering. Call once at start-up. */
export function installErrorReporting() {
  if (!DSN) return;
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, { source: 'window.onerror' }));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, { source: 'unhandledrejection' }));
}
