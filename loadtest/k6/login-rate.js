// Sustainable sign-in rate: RATE successful-or-not sign-ins per second for DURATION, open model
// (arrivals do not wait for earlier requests). Finds the rate where p95 stays under 1.5 s.
//   k6 run -e RATE=4 loadtest/k6/login-rate.js
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { BASE, FX } from './lib.js';

const BASES = (__ENV.BASE_URLS || BASE).split(',');
export const options = {
  scenarios: {
    logins: { executor: 'constant-arrival-rate', rate: Number(__ENV.RATE || 4), timeUnit: '1s', duration: __ENV.DURATION || '60s', preAllocatedVUs: 50, maxVUs: 400 },
  },
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<1500'] },
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max'],
};

const RUN = 16 + Math.floor(Math.random() * 230);
export default function () {
  const i = exec.scenario.iterationInTest;
  const email = FX.customers[i % FX.customers.length];
  const res = http.post(`${BASES[i % BASES.length]}/api/auth/login`, JSON.stringify({ email, password: FX.password }), {
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'celibery', 'X-Forwarded-For': `10.${RUN}.${(i >> 8) & 255}.${i & 255}` },
  });
  check(res, { 'signed in': (r) => r.status === 200, 'busy (503)': (r) => r.status === 503 });
}

export function handleSummary(data) {
  const d = data.metrics.http_req_duration.values;
  const line = { rate: Number(__ENV.RATE || 4), instances: BASES.length, requests: data.metrics.http_reqs.values.count, p50: d.med, p95: d['p(95)'], p99: d['p(99)'], errorRate: data.metrics.http_req_failed.values.rate };
  return { [`loadtest/results/login-rate-${line.rate}ps-${line.instances}inst.json`]: JSON.stringify(line, null, 2), stdout: JSON.stringify(line) + '\n' };
}
