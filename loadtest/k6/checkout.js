// Order placement (cash on delivery) — WRITES ORDERS. Synthetic local/staging databases only.
// Exercises the real transaction: quote → stock reservation → order insert → inventory movements.
// Also replays each request once with the same idempotency key to prove no duplicate order is made.
//
//   k6 run -e VUS=20 loadtest/k6/checkout.js
import { check, fail, sleep } from 'k6';
import exec from 'k6/execution';
import { FX, pick, post, stages, summaryWriter } from './lib.js';

if (__ENV.ALLOW_ORDER_WRITES !== '1') fail('checkout.js creates orders: set ALLOW_ORDER_WRITES=1 (synthetic database only).');

export const options = {
  scenarios: { buyers: { executor: 'ramping-vus', startVUs: 0, stages: stages(), gracefulRampDown: '10s' } },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:checkout}': ['p(95)<1500', 'p(99)<3000'],
    'http_req_duration{name:checkout-replay}': ['p(95)<500'],
    'checks{check:no duplicate order}': ['rate==1'],
  },
  summaryTrendStats: ['med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const RUN = Math.floor(Math.random() * 99);

export default function () {
  const vu = exec.vu.idInTest;
  const it = exec.vu.iterationInScenario;
  // A fresh valid Saudi mobile per order: the open-COD-orders-per-phone cap is not what is measured here.
  // Random per-run prefix: earlier runs' open COD orders must not trip the per-phone cap (3 open orders).
  const phone = `05${String((RUN * 1000000 + vu * 1000 + it) % 100000000).padStart(8, '0')}`;
  const key = `k6-${vu}-${it}-${Date.now()}`.padEnd(20, 'x');
  const p = pick(FX.products);
  const body = {
    idempotencyKey: key,
    items: [{ productId: p.id, quantity: 1 }],
    contact: { name: 'Load Test Buyer', email: `k6-${vu}@loadtest.invalid`, phone },
    shippingAddress: { fullName: 'Load Test Buyer', phone, city: 'Riyadh', district: 'Synthetic', street: 'Load Test Street', buildingNumber: '1', postalCode: '', shortAddress: '', notes: '' },
    paymentMethod: 'cod',
    lang: 'en',
  };
  post('/api/cart/quote', { items: body.items, city: 'Riyadh', paymentMethod: 'cod' }, 'quote');
  const first = post('/api/checkout', body, 'checkout');
  const replay = post('/api/checkout', body, 'checkout-replay');
  const a = first.json('data.order.orderNumber');
  const b = replay.json('data.order.orderNumber');
  check(replay, { 'no duplicate order': () => Boolean(a) && a === b && replay.json('data.replayed') === true });
  // Order + replay = 2 checkout calls per iteration; 7–10 s pauses keep each buyer below the 20/min per-client checkout limit (rate limiting stays on).
  sleep(7 + Math.random() * 3);
}

export const handleSummary = summaryWriter('checkout');
