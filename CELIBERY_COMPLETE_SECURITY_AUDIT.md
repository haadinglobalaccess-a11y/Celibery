# CELIBERY International — Complete Security Audit

**Date:** 11 November 2026
**Scope:** whole repository at commit `0dae560` plus the working-tree changes described in `CELIBERY_SECURITY_REMEDIATION.md`: storefront (React/Vite), Admin Dashboard, Express API, MongoDB models, payment / notification / storage integrations, scheduled jobs, Vercel and Railway configuration, dependencies and Git history.
**Live system:** six read-only HTTP requests to the production Railway services (storefront HTML and response headers, API response headers, the public `/api/checkout/options` endpoint, and one request carrying a foreign `Origin` header). No other live testing was done: no attacks, no scanners and no writes against production.
**Method:** source review that traces every sensitive operation from the browser through route → authentication → authorization → service → database, plus automated security tests against an isolated in-memory MongoDB replica set.

> This audit reduces risk; it does not make the platform "unhackable". No certification or compliance claim is made. Findings marked *owner action* stay open until someone with provider access completes them.

---

## 1. Standards used

| Standard | Version | Use |
|---|---|---|
| OWASP Application Security Verification Standard | 5.0.0 (May 2025) | Requirement checklist for authentication (V6), session management (V7), authorization (V8), validation, logging |
| OWASP Top 10 | 2021 | Risk categories |
| OWASP API Security Top 10 | 2023 | API1 BOLA … API10 unsafe consumption |
| OWASP Cheat Sheet Series | current | Session, CSRF, password storage, MFA, logging |
| CWE Top 25 | 2024 | Weakness classification |
| NIST Cybersecurity Framework | 2.0 | Identify / Protect / Detect / Respond / Recover structure for the checklist and incident guide |
| PCI DSS | v4.0.1 | Only the requirements that apply to a merchant using hosted payment pages (SAQ A scope): no card data touches CELIBERY systems |

---

## 2. Architecture and attack surface

```
Browser (storefront + /admin, React SPA)
   │  HTTPS, session cookie cel_session (HttpOnly, Secure, SameSite)
   │  every write carries X-Requested-With: celibery (CSRF)
   ▼
Railway "client" service — `vite preview` serving client/dist        (or Vercel static hosting)
Railway "server" service — Express API (server/src/server.ts)        (or Vercel function api/index.ts)
   │  Mongoose, TLS (Atlas URI)
   ▼
MongoDB Atlas (replica set; transactions)
   ├─ outbound HTTPS → Moyasar, Tabby (hosted payment pages; no card data stored)
   ├─ outbound SMTP → admin-configured mail server
   ├─ outbound HTTPS → WhatsApp Cloud API (graph.facebook.com)
   └─ outbound HTTPS → S3-compatible bucket (optional); product images currently external links (Cloudinary)
Inbound machine-to-machine: /api/webhooks/moyasar, /api/webhooks/tabby, /api/cron/* (Vercel Cron) — in-process scheduler on Railway
```

**Current production topology (verified 11 Nov 2026):** two Railway services on different `*.up.railway.app` sites. The storefront is `celiberyclient-production` and the API is `celiberyserver-production`. The session cookie is cross-site (`SameSite=None; Secure`), and CSRF protection rests on the custom-header + CORS allow-list design. The API runs with `NODE_ENV=production`, which the presence of the production-only HSTS header confirms.

### Entry points reviewed (≈120 routes)

| Area | Routes | Authentication |
|---|---|---|
| Public catalogue | `/api/home`, `/products`, `/categories`, `/collections`, `/campaigns`, `/pages`, `/settings/public`, sitemap/robots/llms | none (read-only) |
| Cart / checkout | `/api/cart/quote`, `/api/checkout`, `/api/checkout/options`, `/api/checkout/draft` | optional customer session; draft token |
| Orders (customer) | `/api/orders/:n`, `/track`, `/verify-payment`, `/retry-payment`, `/returns` | owner session **or** guest access token **or** staff `orders:read` |
| Account | `/api/me/*` | customer session |
| Auth | `/api/auth/*` (register, login, MFA, logout, reset, change password) | varies |
| Admin | `/api/admin/*` (orders, refunds, products, inventory, discounts, content, media, customers, staff, roles, settings, integrations, reports, audit, templates, notifications, returns, abandoned checkouts) | staff session + per-route permission |
| Webhooks | `/api/webhooks/moyasar`, `/api/webhooks/tabby` | shared secret (body / header) |
| Cron | `/api/cron/release-reservations`, `/api/cron/maintenance` | `Authorization: Bearer CRON_SECRET` |
| Sandbox gateway | `/api/payments/sandbox/:ref[/complete]` | none — only mounted while the sandbox gateway is allowed |
| Media (local disk) | `/media/*`, `PUT /api/admin/media/:id/content` | public read / `media:write` |

---

## 3. Findings

Severity follows the brief: **P0** critical, **P1** high, **P2** medium, **P3** low/hardening, **P4** informational. "Fixed" means fixed in source and covered by an automated test. It does **not** mean deployed. Nothing in this audit has been committed, pushed or deployed.

### Summary

| ID | Severity | Finding | Status |
|---|---|---|---|
| SEC-01 | **P0** | Sandbox payment gateway is live in production: anyone can mark their own order "paid" | **Open — owner action** (code mitigation added) |
| SEC-02 | P1 | No multi-factor authentication for administrators | Fixed (TOTP 2FA, opt-in; enforcement switch = owner action) |
| SEC-03 | P1 | Privilege escalation through `staff:manage` (custom roles could grant any permission or take over the Super Administrator) | Fixed |
| SEC-04 | P2 | Logout did not end the session; a copied cookie stayed valid up to 7 days (customers) / 12 h (staff) | Fixed (server-side sessions) |
| SEC-05 | P2 | Rate limiting was in memory per instance, so it was ineffective on Vercel serverless or several replicas | Fixed (shared MongoDB store) |
| SEC-06 | P2 | Live storefront and `/admin` send no security headers (clickjacking, no HSTS) | Fixed in config — **needs redeploy** |
| SEC-07 | P2 | Unhandled promise rejection in the confirmation-email path can crash the production process | Fixed |
| SEC-08 | P2 | Built-in development secrets would sign sessions on a host where `NODE_ENV` is not `production` | Fixed (not exploitable live today) |
| SEC-09 | P3 | Gateway error text returned to customers at checkout | Fixed |
| SEC-10 | P3 | No per-account / per-email limits (reset-email bombing, distributed guessing on one account) | Fixed |
| SEC-11 | P3 | Newsletter, reviews, coupon checks and search only had the global limit | Fixed |
| SEC-12 | P3 | Protocol-relative links (`//evil.example`) accepted in admin link fields → open redirect | Fixed |
| SEC-13 | P3 | A second successful payment on an already-paid order was not flagged for refund | Fixed |
| SEC-14 | P3 | No security event logging (failed logins, denials, rate limits, bad webhook signatures) | Fixed (structured logs); alerting = owner action |
| SEC-15 | P3 | `trust proxy` hard-coded; long-running server had no header/request timeouts | Fixed |
| SEC-16 | P3 | Malformed `token` query (array) or legacy orders → HTTP 500 instead of 404 | Fixed |
| SEC-17 | P4 | Defense in depth: `$`-operator / `__proto__` keys in request bodies | Added a global guard |
| SEC-18 | P4 | Account enumeration via registration (409) and the lock-out message | Accepted (rate limited) |
| SEC-19 | P4 | Attacker can lock a known account for 15 min | Accepted (per-IP + per-account limits) |
| SEC-20 | P4 | Payment method on/off switches need `settings:write`, not `payments:manage` | Informational |
| SEC-21 | P4 | Guest order access token travels in email links / URL query | Accepted (strict Referrer-Policy, 24-byte random token) |
| SEC-22 | P4 | Developer workstation `.env` holds a credentialed remote MongoDB URI | Owner action (separate dev database user) |
| SEC-23 | P4 | No error monitoring, alerting, verified backup restore or WAF | Owner action (checklist) |

### Details

#### SEC-01 — P0 — Sandbox payment gateway live in production
- **Evidence (read-only, live):** `GET https://celiberyserver-production.up.railway.app/api/checkout/options` returns `"gateway":"sandbox","sandbox":true` with card, Apple Pay, STC Pay and Tabby all enabled.
- **Affected:** `server/src/modules/payments/payment.routes.ts` (`/api/payments/sandbox/:ref/complete`), `integrations/payments/sandbox.ts`; configuration `PAYMENT_GATEWAY=sandbox`, `ALLOW_SANDBOX_PAYMENTS=true`.
- **Impact:** a buyer chooses "card", lands on the simulator and clicks *success*. The order becomes `paid` / `confirmed` and staff may ship it without any money being collected. The checkout and order pages behave exactly like a real payment.
- **Reproduction:** not repeated against production (that would create a fake paid order). The flow is exercised locally in `server/tests/checkout.test.ts`.
- **Mitigation in code:** in production, every order confirmed through the sandbox now gets a staff-only history entry: *"TEST payment (sandbox gateway) — no money was collected. Do not ship."* An error is logged too.
- **Required (owner):** enter the Moyasar/Tabby live keys in Admin → Settings → Payments, set `PAYMENT_GATEWAY=moyasar`, remove `ALLOW_SANDBOX_PAYMENTS`. Until then, consider switching card / Apple Pay / STC Pay / Tabby **off** in Admin → Settings → Payments (COD stays available). That is a business decision for the owner.

#### SEC-02 — P1 — No MFA for administrators
- **Before:** staff accounts, including the Super Administrator who manages payment credentials, were protected by a password only.
- **Fix:** RFC 6238 TOTP built on `node:crypto` (no new dependency). Enrolment needs password re-entry. Secrets are AES-256-GCM encrypted with `CREDENTIALS_ENCRYPTION_KEY`, bound to the user id. Each code can be used only once (the last accepted time step is stored and checked atomically). There are 10 recovery codes, SHA-256 hashed and single use. Wrong codes count toward the account lock-out. The 5-minute challenge token is audience-bound, so it cannot be used as a session. Enabling 2FA ends every other session. Administrator reset requires `staff:manage` and the privilege boundary in SEC-03. With `STAFF_MFA_REQUIRED=true`, staff without 2FA can reach only the enrolment endpoints.
- **Tests:** `security.test.ts › two-factor authentication…` (3 tests), `unit/totp.test.ts` (RFC 4226/6238 vectors).
- **Open:** turning on `STAFF_MFA_REQUIRED` after the administrators have enrolled (owner).

#### SEC-03 — P1 — Privilege escalation through staff management
- **Before:** any role holding `staff:manage` could create a role with *any* permission (including `payments:manage`), invite someone as Super Administrator, change anyone's role, or deactivate the Super Administrator. It could also request a password-reset link for the Super Administrator. When email is not configured, that link is returned in the API response, so this is a direct account takeover.
- **Precondition:** a non-default role holding `staff:manage` (by default only the Super Administrator has it).
- **Fix (`people.routes.ts`):** `assertCanGrant` blocks creating, editing, deleting or assigning a role with permissions the caller lacks. `assertCanManage` blocks editing, deactivating, reset links or 2FA resets for a colleague whose role has permissions the caller lacks. Blocked attempts are logged as `staff.privilege_blocked`.
- **Test:** `security.test.ts › privilege escalation through staff management`.

#### SEC-04 — P2 — Logout did not invalidate sessions
- **Before:** the session was a stateless JWT. Logout only deleted the cookie, so a stolen or copied cookie kept working until expiry (customers 168 h, staff 12 h). Password change and reset did revoke tokens (`tokenVersion`).
- **Fix:** server-side `sessions` collection (TTL-indexed). The JWT carries a random session id, and `loadUser` requires a live, unrevoked record. Logout revokes that one session. Password change or reset revokes all others, staff deactivation revokes all, and enabling 2FA revokes all. Every sign-in creates a new session id (no fixation). Staff JWTs without a session id (issued before this change) are refused, so staff sign in once after deploy. Customer legacy tokens keep working until they expire (≤ 7 days) so shoppers are not logged out.
- **Tests:** four tests under *server-side sessions*.

#### SEC-05 — P2 — In-memory rate limiting
- **Before:** `express-rate-limit` with its default memory store. On Vercel every function instance had its own counters. On Railway each replica did too, and a restart reset them.
- **Fix:** `lib/rate-limit-store.ts`, a MongoDB store (atomic fixed window, TTL cleanup) shared by every instance, with a per-instance fallback if MongoDB is slow or unreachable (`rate_limit.store_unavailable`). The global 300/min burst limit is deliberately per instance, so a flood is not turned into database writes; volumetric DDoS belongs to the WAF/CDN (SEC-23). 429 responses carry `Retry-After` and `RateLimit` headers, and windows always expire, so nobody is blocked permanently.
- **Limits now:** see `CELIBERY_SECURITY_REMEDIATION.md §SEC-05/10/11`.
- **Tests:** four tests under *shared rate limiting*, covering two store instances sharing one counter, atomic parallel increments, window expiry, fallback, and the 429 + `Retry-After` response.

#### SEC-06 — P2 — No security headers on the live storefront
- **Evidence (read-only, live):** `HEAD https://celiberyclient-production.up.railway.app/admin` → `200 OK`, only `Server: railway-hikari`. There is no `X-Frame-Options`, no `frame-ancestors`, no HSTS and no `nosniff`. The CSP in `index.html` is a `<meta>` tag, which cannot express `frame-ancestors`.
- **Impact:** `/admin` can be framed by another site (clickjacking on staff actions), and there is no HSTS on the shop domain.
- **Fix:** `client/vite.config.ts → preview.headers` (the same set as `vercel.json`), plus `Cross-Origin-Opener-Policy` and `no-store` / `noindex` for `/admin` on Vercel. **Takes effect after the client service is redeployed.** Long term: serve `client/dist` from a static host or with `SERVE_CLIENT=1` (already supported).

#### SEC-07 — P2 — Process crash on a background failure
- **Evidence:** the baseline test run (before any change) ended with `Unhandled Rejection: MongoServerError … notifications` and exit code 1. `queueOrderConfirmation` started `processConfirmationEmail` with `void` and no `.catch`. On Node ≥ 15 an unhandled rejection terminates the process, so a transient database error during an email attempt would restart the production API.
- **Fix:** `.catch` + log at the call site, and a process-level `unhandledRejection` logger in `server.ts`. After the fix the full suite exits 0 with no unhandled errors.

#### SEC-08 — P2 — Development secrets on a mis-configured host
- **Before:** if `NODE_ENV` was missing on a host, `jwtSecret()` fell back to a constant from the public repository, and so did the credential key ring. Anyone could then forge an administrator session.
- **Live status:** not exploitable today (production mode confirmed by the HSTS header).
- **Fix:** `isHostedPlatform()` detects Vercel, Railway, Render, Fly, Cloud Run and Heroku. Development fallbacks are disabled there whatever `NODE_ENV` says, and start-up refuses to run without a real `JWT_SECRET`.

#### SEC-09 … SEC-16 — P3
| ID | Evidence | Fix |
|---|---|---|
| SEC-09 | `order.controller.ts` returned `err.message`; `GatewayError` messages contain up to 200 characters of the provider's response body | Generic customer message; details stay in server logs and the payment record |
| SEC-10 | Only a per-IP auth limit (20 / 15 min) existed. Reset emails to one address and failed logins against one account from many IPs were unlimited (the account lock-out still applied) | `resetEmailLimiter` 5/h per address; `loginAccountLimiter` 10 failed / 15 min per account (successful sign-ins not counted) |
| SEC-11 | Newsletter, reviews, `/cart/quote` (coupon enumeration) and product search only had 300/min | Dedicated shared limits (10/h, 10/h, 60/min, 120/min) |
| SEC-12 | Link validation was `v.startsWith('/')`, so `//evil.example` and `/\evil.example` passed. Browsers resolve those to another host (announcement link, hero CTA, social links…) | `isSafeLink`: absolute http(s) with a host, or a same-site path not starting with `//` or `/\` |
| SEC-13 | `applyGatewayStatus` set the second payment to `paid` but the order update matched nothing, so the money was invisible to staff | Staff-only history entry *"A second payment was received … refund the duplicate"*, idempotent |
| SEC-14 | Failed logins, lock-outs, permission denials, rate-limit hits, bad webhook signatures and bad cron secrets were not logged | `lib/security-log.ts`: structured `security:*` JSON lines with masked email, IP, path and user id; never passwords, codes or tokens |
| SEC-15 | `app.set('trust proxy', 1)` was fixed in code (a CDN in front of Railway would mis-attribute IPs). The Node server had no `headersTimeout` / `requestTimeout` (slow-client exhaustion) | `TRUST_PROXY_HOPS` (validated ≤ 2 in production); 20 s headers, 120 s request, 65 s keep-alive |
| SEC-16 | `?token=a&token=b` reached `sha256(array)` → 500. Orders without `accessTokenHash` → 500 | Type-checked token; 404 |

---

## 4. Areas verified secure (no change needed)

| Area | Evidence |
|---|---|
| Password storage | bcrypt cost 12, 72-byte input limit enforced (`auth.schemas.ts`), constant-time dummy compare for unknown emails |
| Reset tokens | 32 random bytes, stored as SHA-256, 60 min (staff invite 72 h), consumed atomically (concurrency test in `auth.test.ts`), revoke all sessions |
| Session cookie | `HttpOnly`, `Secure` in production, `SameSite` configurable; JWT algorithm pinned to HS256 |
| CSRF | Custom header required on every non-GET (`csrfGuard`); CORS allow-list with credentials, no wildcard. Verified live: a foreign `Origin` gets no `Access-Control-Allow-Origin` |
| Input validation | Every route parses `body` / `query` / `params` with zod (unknown keys stripped); `mongoose.strictQuery`; every user-supplied regex is `escapeRegex`d with a length cap |
| Object-level authorization | Orders: owner, guest token (constant-time hash compare) or staff `orders:read`. Missing access answers 404, which does not reveal existence. Addresses and wishlist are scoped to `req.user.id` |
| Function-level authorization | All admin routes sit behind `requireStaff` + `requirePermission` / `requireAnyPermission`; the UI is not relied on |
| Pricing | Server-side quote from database prices; the browser sends only ids and quantities. Totals, currency, discounts and delivery are computed on the server. Gateway amount and currency are reconciled before marking paid |
| Idempotency | Checkout `idempotencyKey` (unique index); refunds use an idempotency key + reservation (`$expr` guard against over-refund); webhooks use `ProcessedEvent` lease/claim lifecycle |
| Webhooks | Shared secret compared in constant time **before** any write; the outcome is always fetched from the gateway API, never taken from the webhook body; replays answered "duplicate" |
| Payment data | Hosted payment pages only; no PAN, CVV or card tokens stored (PCI DSS SAQ A scope) |
| Integration secrets | AES-256-GCM, location-bound AAD, key id per value, rotation via `CREDENTIALS_ENCRYPTION_KEY_PREVIOUS` + `npm run migrate -- --reencrypt`; masked in the admin; never in API responses (test) |
| File uploads | Magic-byte sniffing (JPEG/PNG/WebP/AVIF/GIF/MP4/WebM only; SVG, HTML and PDF refused), server-generated random keys (`safeKey` blocks traversal), size limits, `media:write` + upload limiter. Local files are served with `nosniff` + a sandboxed CSP |
| Output encoding | React escapes by default; no `dangerouslySetInnerHTML` / `eval` in the client; email templates HTML-escape every value; nodemailer rejects header injection |
| CSP | Strict policy (no `unsafe-inline` scripts, no `eval`), YouTube/Vimeo frames only, `frame-ancestors 'none'` on the API and Vercel |
| Secrets in Git | `.env` ignored and never committed; history scan for MongoDB URIs, `sk_live_`, AWS keys, Meta tokens and private keys found only documented test fixtures (fake or AWS-documentation example values) |
| Build artifacts | `client/dist` contains no secret values; no source maps |
| Dependencies | `npm audit`: 0 vulnerabilities (0 critical / high / moderate / low) across 2 workspaces |

---

## 5. Tests performed

All local tests ran against the isolated in-memory MongoDB (`mongodb-memory-server`) or the E2E server with its own in-memory database. Production data was never touched.

| Suite | Command | Result |
|---|---|---|
| Baseline (before changes) | `npm test` | 26 files, 240 tests passed; **1 unhandled error, exit code 1** (SEC-07) |
| Server (after) | `npm test` | **28 files, 274 tests passed, 0 errors, exit code 0** (240 existing + 34 new) |
| New security suite | `vitest run tests/security.test.ts` | 29 tests passed |
| New TOTP unit tests | `vitest run tests/unit/totp.test.ts` | 5 tests passed |
| Typecheck | `npm run typecheck` (server, client, api) | passed |
| Production build | `npm run build` | passed |
| End-to-end (Playwright, desktop/mobile/tablet) | `npm run test:e2e` | **91 passed, 1 skipped, 0 failed** (10.7 min; same as before the changes) |
| Dependencies | `npm audit` | 0 vulnerabilities |

**Safe penetration tests (automated, `server/tests/security.test.ts`):** anonymous access to protected APIs; customer → admin; customer-to-customer order / return / payment-verification / address IDOR; guest token tampering; content manager → orders, refunds, settings, staff, integrations; order manager → refunds; staff-management privilege escalation (role grant, Super-Admin invite, reset-link takeover, deactivation, 2FA reset); mass assignment at registration and profile update; MongoDB operator injection in body and query; prototype pollution; open-redirect links; CSRF without the header; CORS from a foreign origin; stolen-cookie replay after logout; session survival after a password change; session fixation; forged / legacy / foreign-key JWTs; suspension; MFA bypass, replay and recovery-code reuse; MFA challenge token used as a session; rate-limit sharing across instances and atomicity; 429 + `Retry-After`; duplicate payment; secrets in admin and public responses; password, email and secret redaction in security logs. Existing suites already cover webhook signature rejection and replay, amount mismatch, idempotent checkout, refund over-allocation, upload sniffing and CSP.

**Not performed:** automated DAST scanning (OWASP ZAP / Burp), load or DDoS testing, testing of real Moyasar/Tabby/WhatsApp accounts (no credentials; sandbox only), and backup restore tests (no Atlas access). Each of these is listed as an owner action in the checklist.

---

## 6. Remaining risks

1. **SEC-01 — sandbox gateway in production (P0)** until live keys are configured.
2. Security headers on the live storefront (SEC-06) and all code fixes are **not deployed** until the owner approves a commit and redeploy.
3. 2FA is available but **not mandatory** until `STAFF_MFA_REQUIRED=true` is set.
4. No WAF/CDN in front of Railway: no Layer-7 DDoS or bot protection beyond application rate limits.
5. No error monitoring or alerting on the new `security:*` log lines.
6. Backups and restore are unverified (a backup is not verified until a restore succeeds).
7. Moyasar and Tabby adapters are implemented from public documentation and have not been verified against test accounts.
8. Login-lockout DoS and registration enumeration are accepted risks (SEC-18/19).
