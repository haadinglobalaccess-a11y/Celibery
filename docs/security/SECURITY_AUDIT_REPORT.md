# CELIBERY International — Security Audit Report

**Date:** 13 November 2026 · **Branch:** `security/hardening-2026-11-13` (from `main` at `a92c07d`)
**Builds on:** the 11 November audit (`CELIBERY_COMPLETE_SECURITY_AUDIT.md`, findings SEC-01 … SEC-23). This audit re-verifies those controls against the current code, reviews everything added since, and black-box tests the running application.

> No website can be guaranteed unhackable. This report states what was tested and with what result. "Fixed" means fixed in source **and** covered by a test that fails without the fix. Nothing here is deployed until the branch is merged and released.

## 1. Scope and method

| Item | Detail |
|---|---|
| Stack (from source) | React 18 + Vite SPA (storefront + `/admin`), Express 4.22 API (TypeScript), MongoDB via Mongoose (replica set, transactions), Vercel function entry `api/index.ts`, Railway/Node entry `server/src/server.ts` |
| Integrations | Moyasar, Tabby (hosted payment pages), SMTP, WhatsApp Cloud API, S3-compatible storage or local disk, iMile shipping |
| AI features | None. `/llms.txt` is a static description for AI crawlers (client answer Q37); there is no model call, tool execution or prompt input anywhere |
| Route inventory | 181 routes, generated from the live Express router (not from documentation) |
| Black-box tests | 69 HTTP probes + 6 rate-limit probes against an isolated local server (in-memory MongoDB, demo data). **No request was sent to production or to any third party.** |
| Code review | Authentication, sessions, MFA, authorization (function and object level), checkout/pricing, webhooks, uploads, error handling, CORS/CSRF, headers, outbound requests (SSRF), client rendering (XSS) |
| Baseline | `npm test`: 30 files / 288 tests passed · `npm run typecheck`: pass · `npm audit`: 0 vulnerabilities |

## 2. Findings

| ID | Severity | Type | Finding | Status |
|---|---|---|---|---|
| CEL-SEC-01 | **Medium** | Confirmed | No step-up re-authentication before changing payment credentials or managing staff and roles | Fixed |
| CEL-SEC-02 | **Medium** | Confirmed | In-session password re-checks (change password, 2FA set-up/disable) did not count toward the account lock-out | Fixed |
| CEL-SEC-03 | Low | Confirmed | Library client errors (e.g. `../` refused by the static file server) returned 500 and logged an error-level stack trace | Fixed |
| CEL-SEC-04 | Medium *if misconfigured* | Configuration risk | `TRUST_PROXY_HOPS` must equal the real number of proxies; with no proxy in front, clients can spoof their IP and bypass per-IP rate limits | Documented (configuration guide) |
| CEL-SEC-05 | Informational | Process gap | No CI pipeline: tests, typecheck, dependency audit and secret scanning only ran when someone remembered | Fixed (`.github/workflows/ci.yml`) |
| CEL-SEC-06 | Informational | Accepted | An administrator with `payments:manage` can point SMTP at any host (the server connects to it) | Accepted: privileged, now behind step-up |
| CEL-SEC-07 | **Medium** | Confirmed (final review) | A "1 per customer" coupon was used 5 times by sending 5 checkouts at the same moment (limit checked before the order transaction, never inside it) | Fixed |
| CEL-SEC-08 | Low | Confirmed | A guest could reuse a per-customer coupon by typing a new email | Fixed (phone number, in any format, now also identifies the shopper) |
| CEL-SEC-09 | Medium | Confirmed by code review | Unlimited fake cash-on-delivery orders could reserve (lock up) all stock until staff cancel them | Fixed (max 3 open COD orders per phone, `MAX_OPEN_COD_ORDERS_PER_PHONE`) |
| SEC-01 (11 Nov) | **Critical** | Carried forward | Sandbox payment gateway enabled in production | **Open — owner action.** Not re-checked live (no authorization to touch production) |

### CEL-SEC-07 / 08 / 09 — Coupon and order abuse (found in the final review)
- **CEL-SEC-07 evidence:** a temporary race test (5 parallel checkouts, one customer, `perCustomerLimit: 1`) produced **5 discounted orders**; a sixth sequential request was refused. Cause: `evaluateDiscount` counted past orders at quote time; the order transaction re-checked only the global limit, and transaction retries never recounted.
- **Fix:** `DiscountRedemption` (one counter per coupon and identity — account, email, phone — with a unique index). Inside the order transaction each identity's counter is incremented only while below the limit; at the limit the upsert collides with the unique index and the order is refused. Cancelled or expired orders give the use back (`releaseStock`). The quote-time order count stays, so uses made before this change still count.
- **CEL-SEC-08 fix:** the phone number (normalised to its last 9 digits, so `05…`, `+9665…` and `9665…` match) is an identity in both checks. A guest now needs a new email **and** a new phone number.
- **CEL-SEC-09 fix:** before a COD order is created, open COD orders (pending/confirmed/processing) for the same phone are counted; the fourth is refused with a clear message. Card payment and other phones are unaffected. Configurable with `MAX_OPEN_COD_ORDERS_PER_PHONE` (0 disables).
- **Evidence:** `server/tests/security-orders.test.ts` (7 tests). With the fixes switched off, 5 of them fail; the other 2 confirm legitimate behaviour (a cancelled order frees the coupon; different shoppers are independent).

### CEL-SEC-01 — No step-up re-authentication for high-impact admin operations
- **Affected:** `server/src/modules/admin/integrations.routes.ts` (all write routes), `server/src/modules/admin/people.routes.ts` (staff and role writes).
- **Root cause:** these routes checked only that the session was valid and held `payments:manage` / `staff:manage`. Two-factor authentication protects sign-in, not a session that already exists.
- **Exploitation:** someone with a stolen staff cookie (malware, a shared or unlocked computer during the 12-hour session) opens Settings → Payments and replaces the Moyasar keys with keys of their own merchant account. Customer card payments then go to the attacker. The same session can also create a new staff login for persistence.
- **Impact:** direct financial loss and loss of control of the store.
- **Fix:** `requireRecentAuth` / `requireRecentAuthForWrites` in `middleware/auth.ts`. A session counts as recently authenticated for 15 minutes after sign-in or after `POST /api/auth/reauth` (password, plus a TOTP or recovery code when 2FA is on, single use). Otherwise the server answers `403 REAUTH_REQUIRED`; the admin shows a password prompt and retries. Reading stays available. The time is stored on the server-side session (`Session.reauthAt`, optional field, no migration).
- **Evidence:** `server/tests/security-hardening.test.ts` (5 tests), `e2e/reauth.spec.ts` (2 browser tests). With the guard removed, the 3 server tests that depend on it fail (mutation check, see test report).

### CEL-SEC-02 — Password re-checks inside a session were an unlimited password oracle
- **Affected:** `auth.service.ts` `changePassword`, `checkPassword` (2FA set-up and disable).
- **Root cause:** sign-in counts failures (5 per 15 minutes lock the account); these in-session re-checks did not. Only the per-IP limit (20 per 15 minutes) applied, and rotating IPs defeats that.
- **Exploitation:** with a stolen session, call `POST /api/auth/change-password` or `/api/auth/mfa/setup` with password guesses until one succeeds. Learning the real password turns a temporary session theft into permanent access.
- **Fix:** one shared `verifyCurrentPassword`. Failures count toward the same lock-out; the failure that locks the account also ends the session that made it; a correct password resets the counter; failures are logged as `security:auth.password_check_failed`.
- **Evidence:** 3 tests in `security-hardening.test.ts`; both lock-out tests fail without the fix.

### CEL-SEC-03 — Client errors from Express libraries reported as server errors
- **Affected:** `server/src/middleware/error.ts`.
- **Root cause:** standard `http-errors` objects (used by `serve-static`/`send`, `body-parser`) were not recognised and fell through to the generic 500 branch, which logs the full stack at error level.
- **Exploitation:** `GET /media/..%2f..%2f.env` — the traversal itself is correctly refused (no file is read), but each request produced a 500 and an error-level stack trace. A loop of such requests floods error logs and any alerting built on them, hiding real incidents, and can raise log-storage costs.
- **Fix:** errors with `expose: true` and a 4xx status keep that status, return a generic message and log one warning line. Upstream errors that merely carry a `status` field still return 500.
- **Evidence:** `security-hardening.test.ts` › CEL-SEC-03 (fails without the fix).

### CEL-SEC-04 — Proxy-hop configuration decides whether per-IP limits can be bypassed
- **Observation:** against a server with no proxy in front, sending `X-Forwarded-For: <random>` gave each request a fresh rate-limit budget. With the production topology simulated (one proxy appending the real client IP), rotating the spoofed part did **not** help: blocked at attempt 21 (probe RATE-02).
- **Conclusion:** correct as long as `TRUST_PROXY_HOPS` equals the actual number of proxies (1 on Railway and Vercel). Start-up already refuses values above 2. See `SECURITY_CONFIGURATION_GUIDE.md`.

### CEL-SEC-05 — No automated security gates
- **Fix:** `.github/workflows/ci.yml` runs on every push and pull request to `main`: secret scan (`scripts/secret-scan.mjs`, high-confidence patterns, verified to catch a planted live key), `npm audit --audit-level=high`, typecheck, the full server suite (including the security regression suites) and the production build.

## 3. Potential issues investigated and ruled out (false positives)

| Probe | Initial result | Conclusion |
|---|---|---|
| RATE-01 (no 429 after 30 bad logins) | Fail | Test-mode artifact: the e2e server disables rate limits unless `RATE_LIMIT_IN_TESTS=1`. With limits on: blocked at attempt 21 |
| RATE-02 (spoofed `X-Forwarded-For`) | Fail | Topology artifact (no proxy). See CEL-SEC-04 |
| PATH-01 (`/.env`, `/.git/config`, `/package.json` → 200) | Looked alarming | The single-page-app fallback returns `index.html`; no file content leaked (checked for `JWT_SECRET`, `MONGODB_URI`, workspace and Git markers) |
| IDOR-06 (return request on another customer's order → 400) | Inconclusive | Validation ran first. Code review: every customer order action goes through `loadAccessibleOrder` (owner, staff `orders:read`, or constant-time guest-token check) and answers 404 otherwise |
| Secret scan hits in `server/tests` | 6 matches | Fake fixtures (`AKIAGOODKEY…`, `AKIABADKEY…`, `*.example` URI); allow-listed by exact value |

## 4. Controls verified effective (evidence)

| Area | Evidence |
|---|---|
| Authentication on every protected route | Route table: all 124 `/api/admin/*` routes behind `requireStaff` and an explicit permission; `/api/me/*` behind `requireCustomer`. Probes AUTH-01 (8 endpoints → 401), PRIV-01 (customer → admin 403) |
| Object-level authorization (IDOR) | IDOR-01…06; checkout drafts require a 256-bit token or the owning customer |
| Mass assignment | MASS-01/02: `type`, `role`, `permissions`, `email` in register/profile ignored |
| NoSQL / prototype injection | NOSQL-01…03, PROTO-01 → 400 |
| Regex DoS | REDOS-01: metacharacters rejected in 6 ms |
| CSRF / CORS | CSRF-01/02 → 403; CORS-01/02: no `Access-Control-Allow-Origin` for foreign origins |
| Sessions | SESS-01 (`HttpOnly`, `SameSite`, `Secure` in production), SESS-02 (cookie dead after logout), SESS-03 (`alg:none` rejected) |
| Account enumeration | ENUM-01/02: identical responses for known/unknown emails |
| Brute force | RATE-01…04: per IP (21st blocked), per account across IPs (11th), reset email per address (6th) |
| Pricing | PRICE-01: client-sent `price`, `total`, `discountTotal` ignored; order total = catalogue price |
| Webhooks / cron | HOOK-01…03, CRON-01 → 403; outcome always fetched from the gateway; replays answered as duplicates |
| Uploads | UPLOAD-01…05: SVG, HTML-as-PNG and executables refused; magic bytes must match; server-generated keys; served with `nosniff` and a sandboxed CSP |
| Errors | ERR-01…03: no stack traces; 1 MB body limit; PAGE-01 pagination capped |
| Headers | HDR-01…06: strict CSP (no `unsafe-eval`, no inline scripts), `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, no `X-Powered-By` |
| Client XSS | No `dangerouslySetInnerHTML`, `innerHTML` or `eval`; Markdown renderer builds React elements and allow-lists link schemes; JSON-LD escapes `<` |
| SSRF | S3 endpoint is environment-only; external media URLs are never fetched by the server |
| Dependencies | `npm audit`: 0 vulnerabilities; install scripts only in `esbuild` and `mongodb-memory-server` (both expected) |
| Secrets in Git | 372 tracked files scanned; no secrets; only `.env.example` tracked |
| Audit trail | AUDIT-01: admin actions recorded with actor, action, resource and time |
