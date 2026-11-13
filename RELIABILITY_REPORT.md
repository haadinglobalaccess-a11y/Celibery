# CELIBERY — Reliability Report

**Date:** 13 November 2026 · **Method:** code review plus fault injection against a local replica set with two API instances (production build, `NODE_ENV=production`).

## 1. What already existed and was verified (no change needed)

| Control | Where | Verified by |
|---|---|---|
| Idempotent checkout (unique `idempotencyKey`, replay returns the original order) | `order.service.ts` | Load test: **12,703 orders, 0 duplicates**; every replay returned the same order number |
| Transactional stock reservation and discount use | `withTx` | 0 transaction errors at 500 VUs; exactly 1 `order_reserve` movement per order |
| Payment webhooks: claim/lease lifecycle, max 12 attempts, never lost | `webhook-lifecycle.ts` | Existing unit tests |
| Gateway calls with timeouts; "uncertain" outcomes reconciled, never assumed failed | `payments/http.ts`, `refund.service.ts` | Existing tests |
| Durable email outbox: unique per order, backoff retries, bounded `maxAttempts` (5), lock lease | `order-confirmation.ts` | Existing tests |
| Scheduled jobs: overlap-safe, conditional updates | `jobs.ts` | Code review |
| Graceful shutdown on SIGTERM (finish in-flight requests, close DB, 10 s cap) | `server.ts` | Code review. Not exercised on Windows, where signals differ. Verify on Railway with a redeploy. |
| `unhandledRejection` logged, process keeps serving | `server.ts` | Code review |
| Outbound timeouts on SMTP (15/10/20 s), WhatsApp (15 s), S3 (20–60 s) | integrations | Code review |
| Shared rate limits across instances (MongoDB store, memory fallback) | `rate-limit-store.ts` | §3 below |

## 2. Problems found and fixed

### 2.1 Database outage: requests hung 30–40 s, then returned 500

- **Measured before:** with MongoDB killed, `/api/home` took 40.0 s and `/api/products` 30.0 s, each ending in `500 INTERNAL_ERROR`.
  - Cause: every DB call waited ~10 s in Mongoose buffering or driver server selection, and one request makes several calls.
  - On Vercel that exceeds the 30 s function limit. On Railway it piles up open connections.
- **Fix (`middleware/db-gate.ts`):**
  - While the DB is unreachable, a request waits at most 2 s for a reconnect.
  - Public, read-only payloads (homepage, categories, public settings) are then served from the last cached copy, at most 15 min old.
  - Everything else (checkout, accounts, orders, admin, webhooks) gets `503 DATABASE_UNAVAILABLE` with `Retry-After: 5`. Nothing reaches order code while the DB is down.
  - The credentials refresher and `loadUser` skip their queries during the outage.
  - `api/index.ts` lets a warm Vercel instance serve the cached copy too.
- **Measured after** (process killed, two instances):

| Request | Result |
|---|---|
| `/api/health` | 503 (readiness) |
| `/api/health/live` | 200 |
| `/api/home`, `/api/categories` | 200 from cache in ~2 s |
| `/api/products`, `/api/cart/quote` | 503 + `Retry-After` in ~2.1 s |

- **Recovery:** automatic, with no app restart. Products answered 200 again 11 s after `mongod` started (includes mongod start-up and election). The logs record `MongoDB disconnected` and `MongoDB reconnected`, which is new connection-state logging.
- **Test:** `tests/scalability.test.ts` → "database outage".

### 2.2 Sign-in burst stalled the whole instance

- **Cause:** bcryptjs (cost 12, ~530 ms CPU per check) ran on the event loop.
- **Measured before:** at 50 concurrent customers, `/api/auth/me` p95 was 1.8 s and login p95 14.7 s. At 250 customers there were 91% errors.
- **Fix (`lib/password-hash.ts`):** the same library and the same hashes run on a 2-thread worker pool (`PASSWORD_HASH_THREADS`, default 2, 0 on Vercel).
  - Above 64 waiting operations, a new sign-in gets a fast `503 SIGN_IN_BUSY` with `Retry-After: 5`, so it is shed instead of hanging.
  - If workers cannot start, hashing falls back to the main thread.
- **Defect caught during testing and fixed:** at first, "busy" 503s counted as failed passwords in the per-account limiter and locked accounts for 15 minutes. `loginAccountLimiter` now treats 503 as not-a-failure. A regression test covers it and fails without the fix.
- **After:** see LOAD_TEST_REPORT.md §4. Other endpoints stay at p95 ≤ 14 ms during a sign-in burst.

### 2.3 Pool exhaustion could hang requests

`waitQueueTimeoutMS: 10 s` was added, so a request waiting for a pooled connection fails cleanly.

## 3. Horizontal-scaling correctness (two instances, round-robin per request)

| Check | Result |
|---|---|
| Per-IP auth limit (20 / 15 min), attempts alternating A/B | 21st attempt → 429. Counters are shared; per-instance counting would have allowed 40. |
| Session created on A, used on B | 200, same user |
| Logout on B, then reuse the cookie on A | Anonymous: server-side revocation works across instances |
| Admin price change on A, homepage on B | New price on B's next request (version bump in MongoDB) |
| 1,000 VUs across A+B | 0 errors |

The Express app keeps no request state in memory. Sessions, rate limits and cache invalidation all live in MongoDB.

## 4. Monitoring added

- **`GET /api/health/live`:** liveness. Restart the process only if this fails.
- **`GET /api/health`:** readiness (unchanged). 503 while the DB is down. Use this for load balancers and deploy checks.
- **`GET /api/health/metrics`** with `Authorization: Bearer $METRICS_TOKEN` (endpoint disabled and returns 404 when unset). Returns:
  - Process: memory, CPU, event-loop delay
  - Requests: total, in flight, 2xx/4xx/5xx counts, latency histogram, slow-request count
  - MongoDB pool: checked out, waiting, created/closed, checkout failures
  - Public cache: hits, misses, stale serves
  - Records route patterns only. Never URLs with tokens, bodies, cookies or user data (tested).
- **`slow_request` warning log:** written above `SLOW_REQUEST_MS` (default 1500), with route pattern and pool state.

**Suggested alerts** (hosting provider or an uptime service):

| Condition | Severity |
|---|---|
| `/api/health` non-200 for 2 minutes | Page |
| 5xx > 1% over 5 min, or `slow` growing fast | Warning |
| `mongo.waiting` > 20 sustained | Scale out |
| `eventLoopDelayMs.p99` > 200 ms sustained | CPU saturated |
| Atlas: connections > 80% of tier limit; replication lag; election events | Warning |

No external APM was added. None was configured in the repository, and adding one is a vendor choice for the owner.

## 5. Circuit breakers and retries: decision

No generic circuit-breaker library was added:
- **Payments:** gateway calls are user-initiated with 15–20 s timeouts. "Uncertain" outcomes go to reconciliation rather than retries, so there are no retry storms.
- **Email:** retries use a backoff schedule with a bounded attempt count from the scheduled job.
- **WhatsApp:** only a prepared click-to-chat message; no automated sending loop.
- **Login:** the new bounded queue acts as a load shedder.

A breaker would add state without removing a measured failure. Revisit if a provider shows sustained outages in production logs.

## 6. Not verified (needs production access)

- Atlas replica-set failover (primary step-down) under traffic.
- SIGTERM drain during a real Railway or Vercel deploy.
- Third-party provider outage behaviour against real Moyasar/Tabby sandboxes.
