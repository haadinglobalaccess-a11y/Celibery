# 10 — Performance and Scalability

## 1. What was measured in this audit
**Load testing was not performed against production** (the rules forbid flooding production), and **no staging environment exists**. The only live measurement is a small sequential sample: 8 requests per endpoint, one at a time, from the audit workstation, with the network location relative to Railway unknown. Times are full `curl` totals, including TLS.

| Endpoint | Samples (s) | Min | Median | Max |
|---|---|---|---|---|
| `/api/home` | 7.97, 2.53, 1.17, 3.38, 3.55, 2.01, 1.39, 1.79 | 1.17 | ≈ 2.27 | 7.97 |
| `/api/categories` | 1.14, 0.60, 0.97, 0.82, 1.01, 1.18, 0.73, 0.85 | 0.60 | ≈ 0.91 | 1.18 |
| `/api/products?limit=24` | 1.66, 1.24, 1.32, 1.16, 2.17, 6.40, 2.48, 1.37 | 1.16 | ≈ 1.52 | 6.40 |
| `/api/settings/public` | 0.63, 0.83, 0.65, 0.88, 1.18, 0.87, 3.19, 2.53 | 0.63 | ≈ 0.88 | 3.19 |
| `/api/health/live` (no DB) | 0.66 | | | |
| Storefront `/` | 2.39 | | | |

**Interpretation.** About 0.6 s of every request is network and TLS overhead, which is the floor set by `/health/live`. Endpoints backed by the database add roughly 0.3–1.6 s at the median, with multi-second outliers. That suggests a distant database or region, cold caches (`PUBLIC_CACHE_TTL_SECONDS` default 30 s), or an under-sized instance. **This is indicative only (M-03).** n = 8 is too small for p95/p99, and those percentiles are **not reported**.

## 2. Prior evidence (not re-run; not production)
`LOAD_TEST_REPORT.md`, `PRODUCTION_CAPACITY_REPORT.md` and `SCALABILITY_REMEDIATION_REPORT.md` (13 Nov 2026) used k6 scripts in `loadtest/k6/` against a **local laptop** API and database with synthetic data. Examples: storefront 500 VUs at p95 554 ms; 1,000 VUs CPU-bound at p95 1.6 s; sign-in moved to bcrypt worker threads (p95 10.3 s → 569 ms at the same load); 0 duplicate orders under checkout load. These show the code scales reasonably on one core. **They say nothing about the Railway instance size, the Atlas tier or network latency.** I make no claim about supported user counts.

## 3. Code-level scalability features (verified in source)
- Public payload cache with cross-instance invalidation on admin writes (`lib/public-cache.ts`), with warm-up on start.
- Mongo-backed shared rate limits; a per-instance global limiter.
- bcrypt in a worker pool with a bounded queue (503 `SIGN_IN_BUSY` instead of collapse).
- Pool sizing, idle closing and wait-queue timeouts on the DB.
- Pagination and limits on every list; indexes on hot paths ([05](05_DATABASE_AND_DATA_INTEGRITY.md)).
- Metrics endpoint (`/api/health/metrics`): **disabled in production** (no token set). Enable it for capacity monitoring.

## 4. Frontend weight
Initial ≈ 127 KB gzip JS + 42.5 KB gzip CSS; admin lazy-loaded; assets cached immutably ([03](03_FRONTEND_AUDIT.md) §5). Core Web Vitals: **NOT MEASURED**.

## 5. Required before claiming capacity
1. A staging environment identical to production (region, instance, Atlas tier).
2. Run `loadtest/k6/storefront.js`, `customer.js`, `checkout.js` and `admin.js` at 1–5, 10–25 and 50 VUs against staging with sandbox payments and no real emails. Record request volume, p50/p95/p99, error rate, throughput, plus CPU, memory and Atlas metrics.
3. Lighthouse or WebPageTest from a Saudi location for the homepage, product page and checkout.

**Status: Performance PARTIAL (slow live sample), Scalability NOT VERIFIED.**
