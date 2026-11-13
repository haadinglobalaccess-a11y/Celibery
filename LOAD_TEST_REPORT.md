# CELIBERY — Load Test Report (k6)

**Date:** 13 November 2026 · **Tool:** k6 v0.54.0 · **Scripts:** `loadtest/k6/*.js` · **Raw results:** `loadtest/results/` (JSON summary, k6 log and resource samples per run)

## 1. Environment and honesty notes

- **Hardware:** one Windows laptop (12 logical cores) running **k6, MongoDB 7.0.24 (single-node replica set) and the API at the same time**, so they compete for CPU. Production hardware, network latency and Atlas behaviour differ. These numbers compare before/after on equal terms; they are **not** a production capacity guarantee.
- **Data:** synthetic only (`loadtest/seed-synthetic.ts`): 1,217 products, 2,001 users, 60,000 orders, growing to 72,703 with the checkout tests.
- **Server:** production build (`node dist/server.js`, `NODE_ENV=production`), **rate limiting ON**. Each virtual user presents its own client IP via `X-Forwarded-For` (trusted 1 hop), as distinct shoppers would.
- **Virtual users (VUs) are simulated concurrent browsers with think time (1–3 s between pages).** They are not registered users or daily visitors. 1,000 VUs ≈ 1,000 people actively clicking at the same moment.
- **Run-to-run variance is large on this laptop.** Identical code was run twice at the top levels. The later runs (after ~4 h of continuous load) were 20–50% slower. Both are reported, and the conclusions use the worse one.

## 2. Acceptance thresholds

| Scenario | Threshold |
|---|---|
| Storefront (all requests) | p95 < 500 ms, p99 < 1,500 ms, errors < 1% |
| Each storefront endpoint | p95 < 800 ms |
| Sign-in | p95 < 1,500 ms |
| Account / tracking | p95 < 500 ms |
| Checkout | p95 < 1,500 ms, p99 < 3,000 ms; idempotent replay p95 < 500 ms; **0 duplicate orders** |
| Admin | overview p95 < 1,500 ms, lists < 800 ms, search < 1,500 ms |

## 3. Storefront: before vs after (one API instance)

| VUs | Before: req/s · p95 · p99 · err | After (final run): req/s · p95 · p99 · err | Pass? |
|---|---|---|---|
| 10 | 7.3 · 322 ms · 354 ms · 0% | 7.4 · **28 ms** · 38 ms · 0% | ✅ |
| 50 | – | 37.3 · 25 ms · 36 ms · 0% | ✅ |
| 100 | 68 · 459 ms · 1,014 ms · 0% | 74 · **33 ms** · 45 ms · 0% | ✅ |
| 250 | 100 (saturated) · **3,998 ms** · 4,755 ms · 0% | 180.8 · **37 ms** · 52 ms · 0% | ✅ |
| 500 | – | 321.7 · 554 ms · 700 ms · 0% (earlier run: 367.7 · 54 ms · 124 ms) | ⚠️ p95 just above 500 ms in the final run |
| 1,000 | – | 337.8 · 4,012 ms · 4,749 ms · 0% (earlier run: 459.7 · 1,902 ms · 2,199 ms) | ❌ saturated |

Homepage endpoint at 250 VUs: p95 **4,821 ms → 9 ms**.

At 1,000 VUs the instance is CPU-bound (API ~97–100% of one core), with up to 966 requests waiting for a pooled connection. A 4× larger pool (40) gave 465 vs 460 req/s, so the pool is not the limit.

### Two instances (horizontal scaling), round-robin per request

| VUs | Run | req/s | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|---|
| 1,000 | earlier | 645.1 | 18 ms | **339 ms** | 807 ms | 0% ✅ |
| 1,000 | final | 526.4 | 35 ms | 1,611 ms | 2,130 ms | 0% ❌ p95 |

With two instances, throughput rose by 40–56% over one instance, with zero errors in both runs.

## 4. Customer sign-in, account, tracking (two instances)

**Before** (bcrypt on the event loop): see SCALABILITY_AUDIT_REPORT.md §2. At 250 VUs: 91.4% errors; `/me` p95 32 s.

**After** (worker threads, load shedding; 60 s ramp):

| VUs | Errors | login p50 / p95 | `/me` p95 | my-orders p95 | track p95 |
|---|---|---|---|---|---|
| 10 | 0% | 603 / 626 ms | 7 ms | 13 ms | 24 ms |
| 50 | 0% | 609 / 643 ms | 7 ms | 11 ms | 26 ms |
| 100 | 0% | 603 / 641 ms | 7 ms | 12 ms | 25 ms |
| 250 | 0.1% | 10,002 / 16,044 ms | 8 ms | 11 ms | 14 ms |

At 250 VUs, 250 sign-ins arrive within 60 s, above capacity. Sign-in queues, but the rest of the site stays fast. Before, everything collapsed.

**Sustainable sign-in rate** (constant arrival, 45 s, open model):

| Configuration | 1 / s | 2 / s | 3 / s | 4 / s | 6 / s | 8 / s |
|---|---|---|---|---|---|---|
| Before: main thread, 1 instance | p95 652 ms ✅ | **p95 10.3 s** ❌ | p95 34.6 s ❌ | | | |
| After: 1 instance | | p95 569 ms ✅ | **p95 596 ms ✅** | p95 8.4 s ❌ | | |
| After: 2 instances | | | | p95 584 ms ✅ | **p95 1,030 ms ✅** | p95 12.7 s ❌ |

**Verified: 3 sign-ins/s per instance (was 1/s).** The bcrypt cost factor (12) was not lowered.

## 5. Checkout (COD orders written through the real transaction; two instances)

Each iteration sends a quote, places an order, then **replays the same request** (same idempotency key).

| VUs | req/s | checkout p50 / p95 / p99 | replay p95 | Errors | "no duplicate order" check |
|---|---|---|---|---|---|
| 10 | 2.9 | 36 / 60 / 95 ms | 16 ms | 0% | 100% |
| 50 | 14.1 | 57 / 76 / 89 ms | 20 ms | 0% | 100% |
| 100 | 28.1 | 41 / 79 / 116 ms | 20 ms | 0.5%¹ | 99.4%¹ |
| 250 | 69.7 | 48 / 116 / 150 ms | 29 ms | 0% | 100% |
| 500 | 127.7 (≈ 42 orders/s) | 672 / 1,198 / 1,385 ms | 242 ms | 0% | 100% |

¹ The 0.5% failures are 422 `TOO_MANY_OPEN_ORDERS`. The test's random per-run phone prefix collided with an earlier run's open COD orders: the anti-abuse cap working as designed, not a defect.

**Integrity after all checkout runs:** 12,703 orders created through the API, **0 duplicate idempotency keys, exactly 12,703 `order_reserve` inventory movements** (one per order).

Two earlier attempts were discarded as **test-design errors** (not app defects):
- COD was disabled in store settings (the default).
- Order + replay exceeded the 20/min per-client checkout limit, giving 429s. Those runs still showed 0 duplicates in 4,728 orders.

## 6. Admin APIs (two instances; staff are few, so low VU counts)

| VUs | overview p95 | orders list p95 | order search p95 | products p95 | Errors | mongod CPU |
|---|---|---|---|---|---|---|
| 5 | 672 ms | 135 ms | 530 ms | 37 ms | 0% | 0.8 core |
| 10 | 757 ms | 194 ms | 704 ms | 26 ms | 0% | 1.7 cores |
| 25 | 894 ms | 283 ms | 664 ms | 70 ms | 0% | **4.2 cores** |

All thresholds pass. The database cost of admin aggregations is the main remaining database-side item (DATABASE_PERFORMANCE_REPORT.md §3).

## 7. Resource usage (from `/api/health/metrics` and `serverStatus`, sampled every 2 s)

| Run | API CPU (one core) | API RSS max | DB connections max | Pool waiting max |
|---|---|---|---|---|
| Storefront 250 VUs, 1 instance | 56% | 245 MB | 21 | 0 |
| Storefront 500 VUs, 1 instance | 95% | 383 MB | 21 | 115 |
| Storefront 1,000 VUs, 1 instance | 97% | 470 MB | 21 | 966 |
| Storefront 1,000 VUs, 2 instances | 86% (instance A) | 481 MB | 31 | – |
| Checkout 500 VUs, 2 instances | 91% | 384 MB | – | 74 |

**Measurement caveats:**
- Event-loop p99 stayed at 35–42 ms in every run, including idle. That is the Windows timer granularity floor, not real blocking.
- Timeout rate: 0 timeouts in every after-fix run except the customer 250-VU login queue (0.1%).

## 8. Conclusions

- **Verified on this laptop within all thresholds:** 250 concurrent storefront VUs per instance (both runs, p95 ≤ 37 ms, ~180 req/s).
- **Within thresholds in one of two runs:** 500 VUs per instance and 1,000 VUs on two instances.
- **Not supported by one instance:** 1,000 VUs.
- **Verified rates:** 3 sign-ins/s per instance; ~42 COD orders/s on two instances without errors or duplicates.
- **This does not prove production capacity.** Repeat on staging that mirrors production (same Atlas tier and region, same Railway/Vercel plan) before quoting numbers to anyone:

```bash
LOADTEST_MONGODB_URI=... LOADTEST_DB_NAME=celibery_loadtest npx tsx loadtest/seed-synthetic.ts --allow-remote-staging
ALLOW_REMOTE_STAGING=1 BASE_URL=https://staging... k6 run -e VUS=250 loadtest/k6/storefront.js
```

**Never point the suite at production.** The scripts refuse non-local URLs unless `ALLOW_REMOTE_STAGING=1` is set, and `checkout.js` writes orders only with `ALLOW_ORDER_WRITES=1`.
