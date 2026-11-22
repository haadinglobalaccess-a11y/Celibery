import { describe, expect, it, vi } from 'vitest';
import { dsnOrigin } from '../../src/lib/csp';
import { buildEvent, createThrottle, envelope, parseDsn, parseStack, scrubTokens } from '../../src/lib/error-reporting';

const DSN = 'https://abc123public@o4500.ingest.de.sentry.io/4507001';

describe('error reporting (Sentry envelope, no SDK)', () => {
  it('parses a Sentry DSN into the envelope endpoint', () => {
    expect(parseDsn(DSN)).toEqual({ endpoint: 'https://o4500.ingest.de.sentry.io/api/4507001/envelope/', publicKey: 'abc123public', dsn: DSN });
    // Self-hosted with a path prefix (GlitchTip / Sentry behind a sub-path).
    expect(parseDsn('https://key@errors.example.com/sentry/12')?.endpoint).toBe('https://errors.example.com/sentry/api/12/envelope/');
  });

  it('rejects anything that is not an https DSN with a key and numeric project', () => {
    for (const bad of ['', 'not a url', 'http://key@host/1', 'https://host/1', 'https://key@host/abc']) expect(parseDsn(bad)).toBeNull();
  });

  it('turns a V8 stack into Sentry frames (oldest first, app frames marked)', () => {
    const stack = 'TypeError: x is not a function\n    at handler (/app/server/src/modules/orders/order.service.ts:10:5)\n    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)\n    at node:internal/process/task_queues:95:5';
    const r = parseStack(stack);
    expect(r.type).toBe('TypeError');
    expect(r.value).toBe('x is not a function');
    expect(r.frames.at(-1)).toMatchObject({ function: 'handler', lineno: 10, colno: 5, in_app: true });
    expect(r.frames[0].in_app).toBe(false);
  });

  it('builds an event with the stack as an exception, request id tag and redacted metadata', () => {
    const e = buildEvent({
      level: 'error',
      message: 'Unhandled error',
      requestId: 'req-12345678',
      environment: 'production',
      release: 'abc',
      meta: { path: '/api/orders/CEL-100001?token=SECRETTOKEN', err: 'Error: boom\n    at f (/app/a.ts:1:2)', password: 'hunter2', note: 'link https://x/track?order=1&token=TOK123' },
    });
    expect(e.level).toBe('error');
    expect(e.environment).toBe('production');
    expect((e.tags as Record<string, string>).request_id).toBe('req-12345678');
    expect((e.exception as { values: { value: string }[] }).values[0].value).toBe('boom');
    const json = JSON.stringify(e);
    for (const secret of ['hunter2', 'SECRETTOKEN', 'TOK123']) expect(json).not.toContain(secret);
    expect((e.extra as Record<string, string>).path).toBe('/api/orders/CEL-100001');
  });

  it('a log message without a stack is grouped by its message', () => {
    const e = buildEvent({ level: 'error', message: 'Payment amount mismatch', environment: 'production', meta: { paymentId: 'p1' } });
    expect(e.exception).toBeUndefined();
    expect(e.fingerprint).toEqual(['Payment amount mismatch']);
  });

  it('envelope is three JSON lines: header, item header, event', () => {
    const lines = envelope({ event_id: 'e1' }, parseDsn(DSN)!).split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toMatchObject({ event_id: 'e1', dsn: DSN });
    expect(JSON.parse(lines[1])).toEqual({ type: 'event' });
  });

  it('scrubs order access tokens from URLs', () => {
    expect(scrubTokens('/en/track?order=CEL-1&token=abc&x=1')).toBe('/en/track?order=CEL-1&token=[redacted]&x=1');
  });

  it('throttle: same message once per minute, at most N events per minute', () => {
    let t = 0;
    const allow = createThrottle(3, 60_000, () => t);
    expect(allow('a')).toBe(true);
    expect(allow('a')).toBe(false); // duplicate
    expect(allow('b')).toBe(true);
    expect(allow('c')).toBe(true);
    expect(allow('d')).toBe(false); // cap
    t = 61_000;
    expect(allow('a')).toBe(true); // new window
  });

  it('CSP allows the browser to send to the DSN origin only', () => {
    expect(dsnOrigin(DSN)).toBe('https://o4500.ingest.de.sentry.io');
    expect(dsnOrigin('')).toBeNull();
    expect(dsnOrigin('http://k@host/1')).toBeNull();
  });
});

describe('reportEvent sends to the service', () => {
  it('POSTs one envelope with the auth header; disabled without a DSN', async () => {
    vi.resetModules();
    const prev = { dsn: process.env.SENTRY_DSN, env: process.env.NODE_ENV };
    process.env.SENTRY_DSN = DSN;
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return new Response('{}', { status: 200 });
    });
    try {
      const mod = await import('../../src/lib/error-reporting');
      process.env.NODE_ENV = 'development'; // the test suite itself never reports
      await mod.reportEvent({ level: 'error', message: 'Checkout failed', meta: { orderNumber: 'CEL-100001' } });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://o4500.ingest.de.sentry.io/api/4507001/envelope/');
      expect(String((calls[0].init.headers as Record<string, string>)['X-Sentry-Auth'])).toContain('sentry_key=abc123public');
      const event = JSON.parse(String(calls[0].init.body).split('\n')[2]);
      expect(event.message.formatted).toBe('Checkout failed');
      expect(event.tags.orderNumber).toBe('CEL-100001');
    } finally {
      process.env.NODE_ENV = prev.env;
      if (prev.dsn === undefined) delete process.env.SENTRY_DSN;
      else process.env.SENTRY_DSN = prev.dsn;
      fetchMock.mockRestore();
      vi.resetModules();
    }
    const off = await import('../../src/lib/error-reporting');
    expect(off.errorReportingEnabled()).toBe(false);
  });
});
