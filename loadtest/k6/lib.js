// Shared helpers for the CELIBERY k6 suite. See loadtest/README.md before running anything.
import http from 'k6/http';
import { check, fail } from 'k6';
import exec from 'k6/execution';

/**
 * BASE_URL, or BASE_URLS="http://127.0.0.1:4100,http://127.0.0.1:4101" to spread requests over several
 * instances round-robin PER REQUEST (a session created on one instance is used on the others — the
 * horizontal-scaling check).
 */
const BASES = (__ENV.BASE_URLS || __ENV.BASE_URL || 'http://127.0.0.1:4100').split(',').map((s) => s.trim().replace(/\/$/, ''));
let rr = 0;
const nextBase = () => BASES[(rr++ + exec.vu.idInTest) % BASES.length];
export const BASE = BASES[0];

// Guard: never aim this suite at production by accident.
for (const b of BASES) {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(b) && __ENV.ALLOW_REMOTE_STAGING !== '1') {
    fail(`Refusing to load-test ${b}. Local only, or set ALLOW_REMOTE_STAGING=1 for an authorised staging environment.`);
  }
}

export const FX = JSON.parse(open('../.fixtures.json'));

/**
 * Each virtual user presents its own client address (X-Forwarded-For; the server trusts exactly
 * TRUST_PROXY_HOPS=1 proxy), so per-IP rate limits behave as they would for many real shoppers
 * instead of throttling the whole test as one client. Rate limiting stays ON.
 */
// Per-VU random second octet: rate-limit counters live in MongoDB and survive between runs, so a
// later run must not inherit an earlier run's counters for the same simulated client.
const RUN_OCTET = 16 + Math.floor(Math.random() * 230);
export function clientIp() {
  const id = exec.vu.idInTest;
  return `10.${RUN_OCTET}.${(id >> 8) & 255}.${id & 255}`;
}

export function headers(extra = {}) {
  return { 'X-Forwarded-For': clientIp(), 'X-Requested-With': 'celibery', 'Content-Type': 'application/json', ...extra };
}

export const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function get(path, name, extra = {}) {
  const res = http.get(`${nextBase()}${path}`, { headers: headers(extra), tags: { name } });
  check(res, { [`${name} 2xx`]: (r) => r.status >= 200 && r.status < 300 });
  return res;
}

export function post(path, body, name, extra = {}) {
  const res = http.post(`${nextBase()}${path}`, JSON.stringify(body), { headers: headers(extra), tags: { name } });
  check(res, { [`${name} 2xx`]: (r) => r.status >= 200 && r.status < 300 });
  return res;
}

/** Session cookie from a login response (the cookie is Secure in production mode, so it is sent explicitly). */
export function sessionCookie(res) {
  const c = res.cookies && res.cookies.cel_session && res.cookies.cel_session[0];
  return c ? `cel_session=${c.value}` : null;
}

/**
 * Progressive stages for one target. Ramp up for RAMP, hold for HOLD, ramp down.
 * VUS / RAMP / HOLD come from the environment so every level is run the same way.
 */
export function stages() {
  const vus = Number(__ENV.VUS || 10);
  return [
    { duration: __ENV.RAMP || '30s', target: vus },
    { duration: __ENV.HOLD || '1m', target: vus },
    { duration: '10s', target: 0 },
  ];
}

/** Writes a compact JSON summary next to the stdout summary. */
export function summaryWriter(prefix) {
  return (data) => {
    const out = `loadtest/results/${prefix}-${__ENV.VUS || 10}vu.json`;
    const m = data.metrics;
    const d = m.http_req_duration ? m.http_req_duration.values : {};
    const compact = {
      script: prefix,
      vus: Number(__ENV.VUS || 10),
      requests: m.http_reqs ? m.http_reqs.values.count : 0,
      rps: m.http_reqs ? Number(m.http_reqs.values.rate.toFixed(1)) : 0,
      p50: d.med, p90: d['p(90)'], p95: d['p(95)'], p99: d['p(99)'], max: d.max,
      errorRate: m.http_req_failed ? m.http_req_failed.values.rate : null,
      checksPassRate: m.checks ? m.checks.values.rate : null,
      thresholds: Object.fromEntries(Object.entries(m).filter(([, v]) => v.thresholds).map(([k, v]) => [k, v.thresholds])),
      byEndpoint: Object.fromEntries(
        Object.entries(m)
          .filter(([k]) => k.startsWith('http_req_duration{name:'))
          .map(([k, v]) => [k.slice(23, -1), { p50: v.values.med, p95: v.values['p(95)'], p99: v.values['p(99)'] }]),
      ),
    };
    return { [out]: JSON.stringify(compact, null, 2), stdout: `\n${JSON.stringify(compact)}\n` };
  };
}
