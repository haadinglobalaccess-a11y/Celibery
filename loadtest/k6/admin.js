// Staff using the Admin Dashboard: overview, order list/search, product list. Staff traffic is a
// handful of people, so this runs at low VU counts (default 5). One sign-in in setup().
//
//   k6 run -e VUS=5 loadtest/k6/admin.js
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { BASE, FX, get, sessionCookie, stages, summaryWriter } from './lib.js';

export const options = {
  scenarios: { staff: { executor: 'ramping-vus', startVUs: 0, stages: stages(), gracefulRampDown: '10s' } },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:admin-overview}': ['p(95)<1500'],
    'http_req_duration{name:admin-orders}': ['p(95)<800'],
    'http_req_duration{name:admin-orders-search}': ['p(95)<1500'],
    'http_req_duration{name:admin-products}': ['p(95)<800'],
  },
  summaryTrendStats: ['med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email: FX.admin, password: FX.password }), {
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'celibery', 'X-Forwarded-For': '10.250.0.1' },
  });
  const cookie = sessionCookie(res);
  if (!cookie) fail(`admin login failed: ${res.status} ${res.body}`);
  return { cookie };
}

export default function ({ cookie }) {
  const h = { Cookie: cookie };
  get('/api/admin/overview', 'admin-overview', h);
  sleep(2);
  get('/api/admin/orders?page=1&limit=25', 'admin-orders', h);
  sleep(1);
  const r = get(`/api/admin/orders?q=${encodeURIComponent('lt-user-1')}&page=1&limit=25`, 'admin-orders-search', h);
  check(r, { 'search returns json': (x) => x.headers['Content-Type'] && x.headers['Content-Type'].includes('json') });
  sleep(1);
  get('/api/admin/products?page=1&limit=25', 'admin-products', h);
  sleep(3);
}

export const handleSummary = summaryWriter('admin');
