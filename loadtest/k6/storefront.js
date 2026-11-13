// Anonymous shopper journey: homepage, listing, categories, product details, search, cart quote,
// checkout preparation. Read-heavy; the cart quote is server-authoritative pricing (no writes).
//
//   k6 run -e VUS=50 loadtest/k6/storefront.js
import { sleep, group } from 'k6';
import { FX, get, post, pick, stages, summaryWriter } from './lib.js';

const ENDPOINTS = ['home', 'settings', 'categories', 'category', 'products', 'product', 'search', 'quote', 'checkout-options'];

export const options = {
  scenarios: { shoppers: { executor: 'ramping-vus', startVUs: 0, stages: stages(), gracefulRampDown: '10s' } },
  thresholds: {
    // Acceptance criteria (see LOAD_TEST_REPORT.md): storefront reads p95 < 500 ms, p99 < 1.5 s, < 1 % errors.
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    ...Object.fromEntries(ENDPOINTS.map((n) => [`http_req_duration{name:${n}}`, ['p(95)<800']])),
  },
  summaryTrendStats: ['med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const think = () => sleep(1 + Math.random() * 2); // 1–3 s between page views, like a real shopper

export default function () {
  const lang = Math.random() < 0.7 ? 'ar' : 'en';
  group('landing', () => {
    get('/api/home', 'home');
    get('/api/settings/public', 'settings');
    get('/api/categories', 'categories');
  });
  think();
  const cat = pick(FX.categories);
  group('browse', () => {
    get(`/api/categories/${cat}`, 'category');
    get(`/api/products?category=${cat}&lang=${lang}&page=1&limit=24`, 'products');
  });
  think();
  if (Math.random() < 0.35) {
    get(`/api/products?q=${encodeURIComponent(pick(FX.searchTerms))}&lang=${lang}&limit=24`, 'search');
    think();
  }
  const p = pick(FX.products);
  get(`/api/products/${p.slug}`, 'product');
  think();
  if (Math.random() < 0.4) {
    const items = [{ productId: p.id, quantity: 1 }];
    if (Math.random() < 0.5) items.push({ productId: pick(FX.products).id, quantity: 2 });
    post('/api/cart/quote', { items, city: 'Riyadh' }, 'quote');
    if (Math.random() < 0.5) get('/api/checkout/options', 'checkout-options');
    think();
  }
}

export const handleSummary = summaryWriter('storefront');
