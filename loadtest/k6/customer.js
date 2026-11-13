// Signed-in customers: login (bcrypt cost 12 — deliberately CPU-expensive), account order history,
// guest order tracking by access token. Each VU signs in once and reuses its session.
//
//   k6 run -e VUS=25 loadtest/k6/customer.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { BASE, FX, get, headers, pick, sessionCookie, stages, summaryWriter } from './lib.js';

export const options = {
  scenarios: { customers: { executor: 'ramping-vus', startVUs: 0, stages: stages(), gracefulRampDown: '10s' } },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:login}': ['p(95)<1500'],
    'http_req_duration{name:my-orders}': ['p(95)<500'],
    'http_req_duration{name:track}': ['p(95)<500'],
    'http_req_duration{name:me}': ['p(95)<300'],
  },
  summaryTrendStats: ['med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

let cookie = null;

export default function () {
  if (!cookie) {
    const email = FX.customers[(exec.vu.idInTest - 1) % FX.customers.length];
    const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password: FX.password }), { headers: headers(), tags: { name: 'login' } });
    check(res, { 'login 2xx': (r) => r.status === 200 });
    cookie = sessionCookie(res);
    if (!cookie) { sleep(2); return; }
  }
  get('/api/auth/me', 'me', { Cookie: cookie });
  sleep(1 + Math.random());
  get('/api/me/orders', 'my-orders', { Cookie: cookie });
  sleep(1 + Math.random() * 2);
  // Tracking-link visits are rarer than account page views (limit: 30 per 15 min per client).
  if (Math.random() < 0.3) {
    const o = pick(FX.orders);
    get(`/api/orders/${o.orderNumber}?token=${o.token}`, 'track');
  }
  sleep(2 + Math.random() * 2);
}

export const handleSummary = summaryWriter('customer');
