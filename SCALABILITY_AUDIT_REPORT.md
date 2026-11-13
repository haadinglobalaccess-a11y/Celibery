# CELIBERY — Scalability Audit Report (Baseline)

**Date:** 13 November 2026 · **Baseline commit:** `ca76f9a` (main) · **Environment:** isolated local MongoDB 7.0.24 single-node replica set + production build of the API (`NODE_ENV=production`, rate limiting ON). Synthetic data only. Production was not accessed or load-tested.

## 1. Verified architecture

| Layer | Actual implementation |
|---|---|
| Frontend | React 18 + Vite 7 SPA, React Router 7. Admin dashboard lazy-loaded. |
| API | Express 4 (TypeScript), one app used by two entry points: `api/index.ts` (Vercel serverless) and `server/src/server.ts` (Railway / long-running) |
| Database | MongoDB via Mongoose 8. Replica set required in production (transactions). |
| Sessions | Signed HttpOnly JWT cookie naming a **server-side Session document** (revocable) |
| Rate limits | `express-rate-limit` with a **MongoDB-backed shared store** (per-IP global burst limit is per instance by design) |
| Background work | Vercel Cron or in-process scheduler. Durable email outbox. Webhook lease lifecycle. |
| Caches | 30 s integration-credential snapshot only. Every other request read MongoDB. |
| Media | Local disk (dev) or S3-compatible bucket. Responsive image variants. |
| Redis / queues / CDN config for the API | None |

The code base was already strong on correctness: idempotent checkout, transactions, gateway timeouts, reconciliation, shared rate limits. The bottlenecks were all **performance under concurrency**.

## 2. Baseline measurements (before any change)

Storefront k6 scenario (homepage, categories, listing, product, search, cart quote; 1–3 s think time), one instance:

| VUs | req/s | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|
| 10 | 7.3 | 12 ms | 322 ms | 354 ms | 0% |
| 100 | 68 | 18 ms | 459 ms | 1,014 ms | 0% |
| 250 | **100** (saturated) | 567 ms | **3,998 ms** | 4,755 ms | 0% |

Per endpoint at 250 VUs: **homepage p50 3,257 ms / p95 4,821 ms**; product 2,135 ms p95; listing 2,013 ms p95.

Customer scenario (sign-in + account + tracking), two instances:

| VUs | Errors | login p95 | `/auth/me` p95 |
|---|---|---|---|
| 10 | 0% | 636 ms | 7 ms |
| 50 | 0% | 14,683 ms | 1,797 ms |
| 100 | 1.5% | 42,762 ms | 4,480 ms |
| 250 | **91.4%** | 60,001 ms (timeout) | 32,108 ms |

Database outage (mongod killed): `/api/home` failed after **40 s**, `/api/products` after **30 s**, both 500.

## 3. Bottlenecks identified (with evidence)

| # | Bottleneck | Evidence | Severity |
|---|---|---|---|
| B1 | Homepage recomputed per request: ~20 queries incl. a 90-day best-seller `$unwind` over all orders | 300 ms idle, 364 ms aggregation, dominates the 250-VU run | **High** — the most visited page |
| B2 | bcrypt cost 12 on the event loop | 532 ms CPU per check, 1 sign-in/s per instance; everything else stalls | **High** under any sign-in burst |
| B3 | DB outage → 30–40 s hangs then 500 | Fault injection | **High** (Vercel 30 s limit) |
| B4 | Phone suffix regex in COD cap and discount checks | 22,437 and 60,034 index keys examined per checkout | **Medium**, grows with order count |
| B5 | Listing and Featured sorted in memory over the whole active catalogue | 1,217 docs examined for 24 results | Medium, grows with catalogue |
| B6 | Admin overview: COLLSCAN for `payment_review`, `$group` over all orders | 156 ms + 300 ms | Low (admin only) |
| B7 | Railway storefront served hashed bundles `no-cache`, uncompressed | `curl -I` | Medium (repeat visits) |
| B8 | Express `SERVE_CLIENT` cached `index.html` 1 h | Code | Low (stale page after deploy) |
| B9 | Pool size fixed at 10; no wait-queue timeout | Code | Low |
| B10 | No metrics endpoint, no liveness/readiness split, no slow-request logging | Code | Medium (operability) |

Checked and found fine:
- Frontend bundle sizes (storefront ~163 KB gzip incl. CSS; admin split out)
- Responsive images
- Checkout transaction and idempotency
- Webhook processing
- Email outbox
- Pagination limits
- N+1 patterns: homepage per-category queries are bounded (6 categories) and now cached

## 4. Scaling strategy

- **Horizontal first.** The API is stateless, so add instances (Vercel does it automatically; Railway replicas).
  - Measured: two instances turned an overloaded 1,000-VU run (p95 ~1.8–4.0 s) into p95 339 ms.
- **Vertical** helps MongoDB (Atlas tier) and the bcrypt worker threads (more vCPU).
- **No new infrastructure (Redis, queues) is justified by the measured workload.** See PRODUCTION_CAPACITY_REPORT.md §6.

Fixes and results: SCALABILITY_REMEDIATION_REPORT.md and LOAD_TEST_REPORT.md.
