# CELIBERY — Database Performance Report

**Date:** 13 November 2026 · **Scope:** MongoDB 7.0 / Mongoose 8 usage in `server/src` · **Production database:** not accessed.

All plans and timings below come from `loadtest/explain-queries.ts` (read-only `explain("executionStats")`) against an **isolated local single-node replica set** seeded with synthetic data by `loadtest/seed-synthetic.ts`: 1,217 products, 2,001 users, 60,000 orders over 180 days (72,703 after the checkout load tests). Absolute milliseconds depend on this laptop; the **keys/documents examined** columns are hardware-independent and are the real evidence.

## 1. Findings and fixes

| Query (where it runs) | Before | After | Change |
|---|---|---|---|
| Storefront default listing, `sort: featured, sortOrder, createdAt` (`/api/products`) | IXSCAN `status_1` → **in-memory SORT**: 1,217 keys / 1,217 docs, 50 ms | IXSCAN new compound index: **24 / 24**, 2–4 ms | New index `{status, featured:-1, sortOrder, createdAt:-1, _id}` |
| Category listing, same sort | 204 / 204 + SORT, 8 ms | **24 / 24**, 2–4 ms | New index `{status, category, featured:-1, sortOrder, createdAt:-1, _id}` |
| Homepage Featured (`featured: true`, sort `sortOrder`) | 1,217 / 1,217 + SORT, 27 ms | **8 / 8**, 1 ms | Same new index (prefix) |
| Checkout: open COD orders for this phone (every COD order) | suffix regex `/<9 digits>$/`: 22,437 keys / 22,435 docs, 285 ms | `$in` of the 4 accepted spellings: **1 key / 0 docs**, 0 ms | Query change (`phoneVariants`), existing `contact.phone_1` index |
| Checkout/quote: per-customer discount use (with phone clause) | regex inside `$or`: **60,034 keys**, 340 ms | **35 keys**, 1 ms | Same query change |
| Admin overview: orders flagged `payment_review` | **COLLSCAN 60,000 docs**, 156 ms | IXSCAN partial index: 0 docs, 0–2 ms | Partial index on `history.status` (only flagged orders are indexed) |
| Admin overview: orders by status | `$group` over every order, 203–302 ms | 7 index `COUNT_SCAN`s (one per status) | Code change in `reports.service.ts`, same output |

**Why the phone change is safe.** Checkout only accepts phones matching `saudiPhone = /^(\+?966|0)?5\d{8}$/` (unchanged since the first commits). Every stored order phone is therefore one of `5XXXXXXXX`, `05XXXXXXXX`, `9665XXXXXXXX` or `+9665XXXXXXXX`. Exact matching of those four finds the same orders as the old suffix regex. `tests/scalability.test.ts` proves this for every spelling, and the existing CEL-SEC-09 test (COD cap across `05…` and `966…`) still passes.

**An index I tried and removed.** `{paymentMethod, status, contact.phone}` was added first, but the planner preferred `contact.phone_1` once the query was exact, so it was removed rather than adding write cost for nothing.

## 2. Queries reviewed and left unchanged (already efficient)

| Query | Plan | Evidence |
|---|---|---|
| Product by slug | IXSCAN `slug_1`, 1/1 | 0 ms |
| Account → My orders | IXSCAN `customer_1` + small SORT | 17 docs, 1 ms |
| Admin orders list, page 1 | IXSCAN `createdAt_-1`, 25/25 | 0 ms |
| Expired reservations job | IXSCAN `reservationExpiresAt_1` | 1 ms |
| Reviews summary | IXSCAN `product_1` | 0 ms |
| Category product counts | aggregate | 5–8 ms |

## 3. Remaining heavy queries (not changed; documented)

| Query | Cost (72k orders) | Why left | When to act |
|---|---|---|---|
| Homepage best sellers (90-day `$unwind` over orders) | 250–375 ms | Now runs at most once per 30 s per instance (public cache) instead of on every homepage request | > ~500k orders: keep a pre-computed best-seller collection updated by the scheduled job |
| Admin overview revenue total (all orders) | 287–399 ms | Admin-only, a few staff | Same threshold: maintain running totals |
| Admin order search (unanchored regex over 5 fields) | ~400–700 ms p95 | Admin-only; anchored/text search would change search behaviour | When staff complain, or > ~200k orders |
| Storefront search (unanchored regex on name/sku/tags) | 92 docs examined, 7–10 ms | Catalogue is small (hundreds of products) | > ~20k products: Atlas Search or a text index |

Under 25 concurrent admin users the admin aggregations pushed local `mongod` to 420% CPU (LOAD_TEST_REPORT.md §6). That load would compete with the storefront on a small Atlas tier. It is the main database-side scaling item.

## 4. Connection pooling and limits

- Before: `maxPoolSize: 10` was hard-coded. No idle timeout and no wait-queue timeout.
- Now (`db/connect.ts`):
  - `MONGODB_MAX_POOL_SIZE` (default 10) and `MONGODB_MIN_POOL_SIZE` (default 0).
  - `maxIdleTimeMS: 60 s`, so frozen or scaled-down serverless instances release Atlas connections.
  - `waitQueueTimeoutMS: 10 s`, so a request waiting for a connection fails cleanly instead of hanging until the platform timeout.
- Measured: at 1,000 VUs on one instance, raising the pool from 10 to 40 changed throughput from 460 to 465 req/s. The instance is **CPU-bound**, not pool-bound, so the default stays 10.
- **Connection budget rule:** instances × `MONGODB_MAX_POOL_SIZE` + scripts must stay under the Atlas tier's connection limit (see PRODUCTION_CAPACITY_REPORT.md).
- No connection leaks were seen. Peak server-side connections stayed flat across all runs (`dbConnectionsMax` in `loadtest/results/*-resources.json`). One process-wide cached connection (`globalThis.__celiberyMongo`) is reused across serverless invocations.

## 5. Pagination and query limits (verified)

| Endpoint | Limit |
|---|---|
| `/api/products` | `limit` ≤ 60 (zod), `page` ≤ 1000 |
| Cart and checkout | ≤ 50 lines |
| `/api/me/orders` | `limit(100)` |
| Admin lists | Paginated |
| Exports | Admin CSV exports load the selected date range in full. Acceptable today; stream them if a range exceeds ~100k orders. |

## 6. Transactions, replication and sharding

- **Transactions:** order creation, stock reservation, discount use and inventory movements run in one transaction (`withTx`). Production refuses to start without replica-set support (`connect.ts`), and that guard is unchanged.
  - Under the checkout load test (500 VUs, ~42 orders/s, 12,703 orders), no transaction errors or duplicates appeared.
  - Each order produced exactly one `order_reserve` inventory movement.
- **Replication:** Atlas clusters are 3-member replica sets on every tier. Failover was **not** tested here (no Atlas access).
- **Sharding: not recommended.** Total data is tens of MB. Sharding adds operational cost with no benefit until the working set exceeds one replica set (≫ 100 GB) or write throughput exceeds a single primary. Neither is close.

## 7. Index rollout to production

- Mongoose `autoIndex` (default on) builds the three new indexes at the next deploy. MongoDB ≥ 4.2 builds indexes without blocking reads or writes.
- At CELIBERY's size the build takes seconds. Nothing is dropped or migrated.
- To build them ahead of a deploy instead, run `db.orders.createIndex(...)` / `db.products.createIndex(...)` in Atlas with the definitions in `models/Order.ts` and `models/Product.ts`.
