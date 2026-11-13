# CELIBERY — Production Capacity Report

**Date:** 13 November 2026 · Based on the repository's deployment files and on local measurements. **I could not see the hosting dashboards**, so plan limits marked "check" must be confirmed by the owner. No capability is assumed.

## 1. Deployment as configured in the repository

| Component | Vercel path (`vercel.json`, `api/index.ts`) | Railway path (`docs/DEPLOYMENT.md`, `vite.config.ts`) |
|---|---|---|
| Storefront | Static `client/dist` on Vercel's CDN; `/assets/*` immutable for 1 year | `vite preview` service (`celiberyclient-production.up.railway.app`). Hashed assets were `no-cache`, **now immutable for 1 year** (this audit). |
| API | One serverless function, `maxDuration: 30 s`, Express app per instance | `node dist/server.js` long-running service |
| Scheduled jobs | Vercel Cron: every 15 min (reservations), every 30 min (maintenance) | In-process scheduler (5 / 30 min). Overlap-safe across replicas. |
| Database | MongoDB Atlas replica set (tier not in repo, **check**) | Same |
| Media | S3-compatible bucket recommended (`MEDIA_PUBLIC_BASE_URL` → CDN-able) | Same. Local disk is not persistent without a Railway volume. |
| Redis | None | None |

## 2. Measured capacity of ONE API instance

Local laptop, 12 logical cores shared by k6, MongoDB and the API. Production hardware differs, so read these as relative numbers.

| Workload | Sustained, within thresholds | Saturation point | Limit |
|---|---|---|---|
| Storefront browsing (mixed pages, 1–3 s think time) | ~320–370 req/s at 500 VUs, 0 errors | ~460 req/s at 1,000 VUs (p95 ~1.8–1.9 s) | Node main thread ~100% of one core |
| Sign-ins (bcrypt cost 12) | **3 / s** (p95 0.6 s) | 4 / s queue grows | 2 worker threads. Was **1 / s** before this audit. |
| COD order placement | ~42 orders/s at 500 VUs (2 instances), p95 1.2 s | not reached | MongoDB CPU |

Memory: RSS 130–450 MB under load (`*-resources.json`). Plan **≥ 512 MB per instance**; 1 GB gives headroom for exports.

## 3. What scales and how

- **The API is stateless.** Sessions, rate limits and cache invalidation are in MongoDB, verified across two instances (RELIABILITY_REPORT.md §3). Add instances to add capacity.
  - Two local instances raised the 1,000-VU storefront run from p95 ~1.8 s to **339 ms** with 0 errors.
- **Vercel:** scales function instances automatically. Each warm instance keeps its own connection pool (≤ `MONGODB_MAX_POOL_SIZE`, idle connections closed after 60 s). `PASSWORD_HASH_THREADS` defaults to 0 there.
  - **Check** the plan's concurrency limit and whether Fluid Compute is enabled.
  - The 30 s `maxDuration` is above every measured request. Outage requests now end in ~2 s instead of 30–40 s.
- **Railway:** set the replica count (Settings → Deploy → Replicas) or vertical size.
  - **Check** the plan's vCPU/memory per replica and whether horizontal replicas are available on it.
  - Set the health check path to **`/api/health`**.
- **Database is the shared limit.** Under 25 concurrent admin users, local `mongod` used up to 4.2 cores because of full-collection admin aggregations (DATABASE_PERFORMANCE_REPORT.md §3).

## 4. Connection budget (check the Atlas tier)

`total connections ≈ (API instances × MONGODB_MAX_POOL_SIZE) + monitoring + scripts`

| Atlas tier | Max connections (Atlas published limits — confirm in Atlas UI) | Safe API instances at pool 10 |
|---|---|---|
| M0 / M2 / M5 (shared) | 500 | ~40 — but shared tiers have no PITR and throttled ops: **not for production** |
| M10 | 1,500 | ~120 |
| M20 | 3,000 | ~250 |

On Vercel, many cold instances can open pools quickly. Watch the Atlas "Connections" chart during the first sale event. If it approaches 80%, lower `MONGODB_MAX_POOL_SIZE` to 5. Throughput is CPU-bound anyway (pool 10 → 40 gave +1%).

## 5. CDN and media

- **Static bundles:** CDN-cached on Vercel. On Railway, now cacheable by browsers and any CDN in front (`immutable`).
- **API responses:** `Cache-Control: no-store` / `no-cache` everywhere (unchanged). Personal data is never put in shared caches. Public payloads use the in-process cache instead.
- **Images:** uploaded images have responsive variants with `srcset` (`ArtFrame`, `CategoryGallery`), lazy loading on below-the-fold images, WebP brand logo. Local media served `immutable` for 365 days.
- **Video:** the hero supports separate desktop/mobile video and poster URLs, and YouTube/Vimeo embeds.
  - Recommendation: host hero video on the S3 bucket behind a CDN (or YouTube/Vimeo), keep it ≤ 5–8 MB with a poster image.
  - Video processing was not added; there is no measured need.
- **Bundle sizes (gzip):** storefront JS 64 KB + React 59 KB + CSS 40 KB. Admin (82 KB) is lazy-loaded and never downloaded by shoppers.

## 6. Redis and queues: decision

| Candidate | Decision | Evidence |
|---|---|---|
| Redis cache | **Not added** | The hot path was the homepage recomputed per request. An in-process cache with a MongoDB version stamp removed ~99% of that cost (300 ms → 4 ms) and stays correct across instances within ~1 s. |
| Redis rate limits | **Not added** | Limits already shared via MongoDB, verified across instances. The global per-IP burst limit is per instance by design. |
| Redis sessions | **Not needed** | Server-side sessions already in MongoDB |
| Job queue (BullMQ etc.) | **Not added** | Email already uses a durable MongoDB outbox with bounded retries. Webhooks use a lease lifecycle. Reservations and refunds use overlap-safe scheduled jobs. No lost work found. |

Revisit Redis when one of these happens:
- more than ~10 API instances, where the per-instance cache miss rate matters;
- sustained admin/reporting load on Atlas;
- a need for sub-second cross-instance invalidation of private data.

## 7. Application changes vs. infrastructure actions

**Application changes (in this repository, done):**
- Indexes and query fixes
- Public cache
- Pool settings
- Sign-in worker pool and load shedding
- DB outage fail-fast
- Metrics and health endpoints
- Static cache headers
- k6 suite and restore verifier

**Infrastructure actions (owner, in provider dashboards):**
1. Atlas: confirm the tier (≥ M10 for production), enable Cloud Backup + PITR, set alerts (connections > 80%, replication lag, elections), run a restore drill and a test failover.
2. Railway: health check `/api/health`; ≥ 512 MB per replica; 2 replicas for redundancy if the plan allows; set `METRICS_TOKEN`.
3. Vercel: confirm plan concurrency and region (close to the Atlas region; Q33).
4. Set `METRICS_TOKEN` and point an uptime monitor at `/api/health` and `/api/health/metrics`.
5. Media bucket: versioning on, CDN in front of `MEDIA_PUBLIC_BASE_URL`.
6. Optional: a WAF/CDN (e.g. Cloudflare) for volumetric abuse. Then set `TRUST_PROXY_HOPS=2`.

## 8. New environment variables (all optional, safe defaults)

| Variable | Default | Purpose |
|---|---|---|
| `MONGODB_MAX_POOL_SIZE` / `MONGODB_MIN_POOL_SIZE` | 10 / 0 | Connection pool per instance |
| `PUBLIC_CACHE_TTL_SECONDS` | 30 (0 in tests) | Public homepage/category cache. **0 = off (previous behaviour).** |
| `PASSWORD_HASH_THREADS` | 2 (0 on Vercel) | bcrypt worker threads. 0 = main thread (previous behaviour). |
| `PASSWORD_HASH_MAX_QUEUE` | 64 | Above this, sign-in answers 503 `SIGN_IN_BUSY` |
| `METRICS_TOKEN` | empty (endpoint off) | Bearer token for `/api/health/metrics` |
| `SLOW_REQUEST_MS` | 1500 | `slow_request` log threshold (0 = off) |
