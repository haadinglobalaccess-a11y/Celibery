# CELIBERY — Scalability Remediation Report & Final Assessment

**Date:** 13 November 2026 · **Base:** `ca76f9a` · Changes are uncommitted in the working tree for review.

## 1. Changes made

| # | Change | Files | Fixes | Measured effect |
|---|---|---|---|---|
| 1 | **Public cache** for homepage, categories, category facets, public settings: per instance, 30 s TTL, stampede-safe. Cross-instance invalidation via a MongoDB version stamp bumped **before** any successful admin write responds. | `lib/public-cache.ts`, `catalog.service.ts`, `app.ts` | B1 | Homepage 300 ms → 4 ms; storefront p95 at 250 VUs 3,998 → 37 ms |
| 2 | Two product indexes for the default/category sort and Featured | `models/Product.ts` | B5 | 1,217 → 24 docs examined |
| 3 | Exact phone-variant matching instead of suffix regex (COD cap, per-customer discount) | `order.service.ts` | B4 | 60,034 → 35 keys; 340 → 1 ms |
| 4 | Partial index for `payment_review`; per-status index counts in the admin overview | `models/Order.ts`, `reports.service.ts` | B6 | COLLSCAN 60k → 0 docs |
| 5 | **bcrypt on worker threads** (same library, hashes, cost) + bounded queue → `503 SIGN_IN_BUSY` + `Retry-After`. Busy answers never count as failed passwords. | `lib/password-hash.ts`, `auth.service.ts`, `middleware/security.ts`, `middleware/error.ts` | B2 | 1 → 3 sign-ins/s per instance; site stays fast during bursts |
| 6 | **DB-outage fail-fast**: ≤ 2 s grace, then 503 + `Retry-After`. Public pages served from the last cache (≤ 15 min). | `middleware/db-gate.ts`, `app.ts`, `api/index.ts`, `middleware/auth.ts`, `credentials/index.ts`, `public-cache.ts` | B3 | 30–40 s + 500 → 2 s + 503; storefront browsable; auto-recovery |
| 7 | Pool settings: configurable size, idle timeout, wait-queue timeout; connection-state logging | `db/connect.ts`, `config/env.ts` | B9 | Clean failures, no idle Atlas connections |
| 8 | Liveness `/api/health/live`, token-protected `/api/health/metrics`, `slow_request` log | `lib/metrics.ts`, `app.ts` | B10 | Used to collect every resource number in LOAD_TEST_REPORT.md |
| 9 | Hashed `/assets/*` immutable for 1 year on the Railway `vite preview` and Express `SERVE_CLIENT`; `index.html` always revalidated | `client/vite.config.ts`, `app.ts` | B7, B8 | Verified headers; security headers unchanged |
| 10 | k6 suite, synthetic seeder, explain-plan harness, resource monitor, restore verifier | `loadtest/`, `scripts/verify-restore.mjs` | Evidence | Repeatable |

**No new runtime dependencies.** No data was migrated, deleted or reset. No security control was removed or weakened:
- The one limiter change makes a server overload stop counting against a customer.
- bcrypt cost factor, CSP and HTTP cache headers on API responses are unchanged.

## 2. Preservation and tests

- `npm run typecheck` (server, client, api): pass.
- `npm test` (final run, 13 Nov 2026): **34 files, 316 tests passed**. `npm run build -w client` passes. New tests:
  - `tests/scalability.test.ts`: phone equivalence, cache reuse plus instant admin invalidation, cross-instance invalidation, no per-visitor data in cache, DB outage, sign-in overload, static headers, health/metrics.
  - `tests/unit/password-hash.test.ts`
- The sign-in overload regression test was confirmed to **fail without its fix**.
- Unchanged behaviour verified by the existing suites:
  - storefront, admin CRUD, auth/MFA
  - checkout, discounts, payments/webhooks/refunds, returns
  - FAQ, homepage hero/flagship, Arabic/English text

**Behaviour you may notice:**
- The stock "available" label on homepage/category cards can lag a sale by up to 30 s. Checkout always re-checks stock and price in the database. `PUBLIC_CACHE_TTL_SECONDS=0` restores the old behaviour.
- During extreme sign-in bursts some customers see "busy, try again in a few seconds" instead of a long wait.

## 3. Final independent assessment

| Measure | Score | Basis |
|---|---|---|
| **Scalability** | **7 / 10** | Stateless API; shared sessions, limits and cache invalidation verified across two instances; hot paths cached and indexed. Minus: admin aggregations scan all orders; per-instance CPU ceiling; nothing measured on production hardware. |
| **Performance** | **8 / 10** | Storefront p95 ≤ 37 ms up to 250 VUs per instance; homepage 4 ms; checkout p95 ≤ 116 ms at 250 VUs. Minus: sign-in is inherently CPU-heavy (3/s per instance); admin search/overview 0.5–0.9 s. |
| **Database reliability** | **7 / 10** | Transactions and idempotency verified under load (0 duplicates in 12,703 orders); fail-fast and auto-recovery verified locally. Minus: production backups, PITR and restore **not verified**; Atlas tier unknown. |
| **High availability** | **5 / 10** | The app side is ready: multi-instance safe, readiness/liveness split, graceful degradation. **Not verified:** Atlas failover under traffic, multi-replica Railway, backup restore. HA is not claimed. |

- **Overall infrastructure readiness: ~65%.** Code-side items are done. The remaining 35% is owner/provider work (PRODUCTION_CAPACITY_REPORT.md §7) and is all unverified.
- **Actual tested concurrent-user capacity:** 250 concurrent simulated shoppers per instance within all thresholds, on a shared laptop, in both runs. 500 per instance and 1,000 on two instances passed in one of two runs. **Not a production figure.**
- **Verified requests per second:** ~180 req/s per instance within thresholds (both runs); up to 368 per instance and 645 on two instances at peak, with 0 errors in every after-fix storefront run.
- **Latency at the verified level (250 VUs, final run):** p95 **37 ms**, p99 **52 ms**.
- **Remaining bottlenecks:**
  1. Single-instance CPU ceiling (~320–460 req/s here).
  2. Sign-in cost (3/s per instance).
  3. Admin overview/search aggregations over all orders.
  4. Best sellers recomputed every 30 s per instance (grows with orders).
- **Infrastructure upgrades required:**
  - Atlas ≥ M10 with Cloud Backup + PITR and alerts.
  - Two or more API instances (Vercel automatic / Railway replicas).
  - Railway health check `/api/health`.
  - `METRICS_TOKEN` plus an uptime monitor.
  - Media bucket versioning and a CDN.
  - A restore drill and a test failover on staging.

**Production readiness (scalability & high availability): NO.** The application changes are complete and tested. "Yes" needs the owner's evidence that:
- Atlas backups/PITR are on and a restore drill passed (BACKUP_RECOVERY_REPORT.md §5);
- a failover test passed on staging;
- the k6 storefront and checkout scenarios pass on a staging environment that mirrors production.

None of these can be done from this repository.
