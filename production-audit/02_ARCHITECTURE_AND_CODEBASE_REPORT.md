# 02 — Architecture and Codebase Report

## 1. Actual stack (discovered, not assumed)

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 18.3, TypeScript, Vite 7, React Router 7 | No state library. React context in `client/src/state/`. Only 3 runtime dependencies |
| Backend | Node.js ≥ 22.12, Express 4.21, TypeScript, Zod 4 | Feature modules: routes → controllers → services |
| Database | MongoDB via Mongoose 8. **A replica set is required in production** (startup refuses without transactions, `server/src/db/connect.ts`) | 27 model files |
| Payments | Pluggable gateway: `sandbox`, `moyasar` (card / mada / Apple Pay / STC Pay), `tabby` (BNPL), plus cash on delivery | `server/src/integrations/payments/` |
| Notifications | SMTP (nodemailer) or Resend (HTTPS), WhatsApp Cloud API | `server/src/integrations/notifications/` |
| Media | Local disk (dev) or S3-compatible storage with an in-house SigV4 signer. Cloudinary URLs referenced on the storefront | `server/src/integrations/storage/` |
| Tests | Vitest + Supertest + mongodb-memory-server (51 files, 481 tests); Playwright E2E (30 specs) | |
| CI | GitHub Actions: secret scan, `npm audit --audit-level=high`, typecheck, lint, tests, build, E2E | `.github/workflows/ci.yml` |

Monorepo: npm workspaces `server` and `client`, a Vercel serverless entry in `api/index.ts`, and `scripts/`, `loadtest/` (k6), `e2e/`. 559 tracked files; ~28 k lines of server TypeScript, ~40 k lines of client TS/CSS.

## 2. Deployment topology

**Documented options** (`docs/DEPLOYMENT.md`): (a) Vercel, with a static site plus the `api/index.ts` function and Vercel Cron; (b) one Railway/Node service with `SERVE_CLIENT=1`.

**Actual production** (established from live headers, CSP, sitemap and `client/vite.config.ts`):

```
Browser ──HTTPS──► celiberyclient-production.up.railway.app   (vite preview: static client/dist,
   │                                                          SEO forwarder for crawlers)
   │  fetch(credentials:'include')  ← cross-SITE (public suffix up.railway.app)
   └──HTTPS──► celiberyserver-production.up.railway.app       (Express API, npm start,
                                                             in-process scheduler)
                        │
                        ├──► MongoDB Atlas (replica set; tier/region NOT VERIFIED)
                        ├──► Payment gateway: SANDBOX simulator (C-01)
                        ├──► Email (SMTP/Resend) / WhatsApp — configuration NOT VERIFIED
                        └──► Media: Cloudinary / S3 — NOT VERIFIED
```

## 3. Request pipeline (`server/src/app.ts`)

1. `requestContext` (request id) → `requestMetrics`
2. `trust proxy = TRUST_PROXY_HOPS` (default 1)
3. Helmet (HSTS in production, CORP same-site), a strict API CSP (`default-src 'none'`), a site CSP, `Permissions-Policy`
4. CORS: allow-list from `CORS_ORIGINS`, credentials on (**LIVE**: a foreign origin receives no `Access-Control-Allow-Origin`)
5. `express.json({ limit: '1mb' })`, `Cache-Control: no-store` on `/api`
6. Health: `/api/health` (readiness, 503 when the DB is down), `/api/health/live`, `/api/health/metrics` (token-gated, 404 when no token; **LIVE** 404)
7. `/api` chain: `databaseGate` → `apiLimiter` (300/min/instance) → `csrfGuard` → `rejectOperatorKeys` → `integrationsMiddleware` → `loadUser`
8. Routers: auth, payments/webhooks, reviews, catalogue, blog, currency, home videos, restock, checkout drafts, orders, `/me`, `/admin` (`requireStaff` plus a per-route permission)
9. Crawler prerender for `/`, `/ar…`, `/en…`; optional static client; central `errorHandler` (no stack traces returned)

## 4. Module inventory

| Module | Responsibility |
|---|---|
| `auth` | Register, login, logout, forgot/reset, change password, staff TOTP 2FA, step-up re-auth |
| `catalog` | Home, categories, products, collections, campaigns, policy pages, sitemap, robots, `llms.txt`, bundles |
| `orders` | Server-side quote, checkout (transactional stock reservation), tracking, guest access token, returns, payment retry/verify |
| `payments` | Gateway initiation, authoritative status application, webhooks with an event lease lifecycle, refunds ledger and reconciliation |
| `checkout-drafts` | Abandoned-checkout capture (never used for pricing) |
| `account` | Profile, addresses (max 10), wishlist |
| `admin/*` | Orders, products, categories, inventory, discounts, content, media, customers, staff & roles, integrations (encrypted credentials), templates, notifications, returns, reports, analytics, audit log, FAQ, home videos, reviews |
| `reviews`, `restock`, `faq`, `blog`, `currency`, `seo` | Storefront features |
| `jobs.ts` | Every 5 min: release expired reservations (re-verifying the gateway first), abandoned drafts, notification retries, bundle stock, restock emails. Every 30 min: refund reconciliation, abandoned uploads, FX rates |

## 5. Customer purchase flow (as implemented)

1. The cart lives in `localStorage`. `POST /api/cart/quote` re-prices everything from the DB.
2. `POST /api/checkout` with a client-generated `idempotencyKey`: re-quote → reject if anything changed → validate city / COD / method → **one transaction**: conditional stock decrement per product (`stock: {$gte: qty}`), discount usage claim, per-customer redemption claim, order insert, inventory ledger rows.
3. Online methods: `Payment` record → gateway `initiate` → redirect. COD: confirmed immediately (max 3 open COD orders per phone).
4. Return to `/checkout/return` → `POST /orders/:n/verify-payment` → the server fetches the status **from the gateway** → `applyGatewayStatus` (amount/currency reconciliation, idempotent transitions).
5. Webhooks would do the same step 4 asynchronously; **currently blocked** (H-01/H-02).
6. If unpaid after `reservationMinutes` (default 30), the job verifies once more, then cancels and releases stock exactly once (`stockReleased` guard).

## 6. Admin operational flow
Staff are invited (single-use 72 h link; no passwords are set by others) → sign in (+ TOTP if enrolled) → each admin route checks a named permission. Payment credentials and staff/role changes need a re-authentication within 15 min. Every write is audited (`AuditLog`) and invalidates the public cache.

## 7. External dependencies

| Service | Used for | Failure handling |
|---|---|---|
| Moyasar / Tabby | Payments | 20 s timeout; errors classified as definitive or uncertain; uncertain refunds reconciled by cron |
| SMTP / Resend / WhatsApp | Notifications | Queued with retry (`OrderNotification`), never blocks checkout |
| Exchange-rate APIs | Display currency only | Cached; falls back to SAR |
| `api.country.is` | Visitor country | Optional; off in tests (L-07) |
| YouTube / Vimeo oEmbed | Admin video validation | 6 s timeout |
| Sentry | Errors | Optional; **not configured in the browser build** (M-02) |

## 8. Code-quality observations
- Consistent layering, strict schemas on every route, and a single error envelope `{ ok, data | error }`.
- Business rules carry explanatory comments with rationale. Pure decision modules (webhook lifecycle, refund state, delivery rules, media rules) are unit-tested without a DB.
- Very little dead weight: 3 client runtime dependencies, 11 server runtime dependencies.
- Documentation is extensive but partly stale relative to production (I-06).
