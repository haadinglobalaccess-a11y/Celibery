# CELIBERY — 20-Control Security Checklist (verified 13 November 2026)

**Status key:** ✅ verified (code + automated test or probe) · ⚠️ verified in code, depends on production configuration · ⛔ open (owner action). Probe IDs refer to `SECURITY_TEST_REPORT.md`; test files are under `server/tests` and `e2e`.

| # | Control | Status | How it is implemented | Evidence |
|---|---|---|---|---|
| 1 | Row-level security / resource ownership | ✅ | MongoDB has no SQL RLS; the equivalent is enforced in the API. Orders and returns: `loadAccessibleOrder` (owner, staff `orders:read`, or constant-time guest-token check; otherwise 404). Addresses and wishlist scoped to `req.user.id`. Checkout drafts: 256-bit token or owning customer | IDOR-01…06; `security.test.ts` (customer-to-customer IDOR suite) |
| 2 | Authentication on every API route | ✅ | Route table generated from the router: all 124 `/api/admin/*` routes behind `requireStaff` + explicit permission; `/api/me/*` behind `requireCustomer`; public routes are read-only catalogue, auth, checkout and signed webhooks/cron | AUTH-01 (8 endpoints → 401); `security.test.ts` |
| 3 | Never trust the frontend | ✅ | Prices, totals, discounts, delivery and VAT computed on the server from the database; the browser sends product ids and quantities. Roles/permissions never accepted from requests | PRICE-01, MASS-01/02 |
| 4 | Rate limiting | ⚠️ | Shared MongoDB store; per IP (auth 20/15 min), per account (10 failed/15 min), per address (reset 5/h), checkout, tracking, search, reviews, newsletter, uploads, step-up. Correct only with the right `TRUST_PROXY_HOPS` | RATE-01…04; `security.test.ts` (shared store) |
| 5 | Sanitize user input | ✅ | zod validation on every body, query and params (unknown keys stripped); global `$`/`__proto__` key guard; regex input escaped and length-capped | NOSQL-01…03, PROTO-01, REDOS-01 |
| 6 | Safe (parameterised) queries | ✅ | Mongoose with `strictQuery`; values validated to primitive types before reaching queries; no string-built queries, no `$where` | NOSQL-01…03 |
| 7 | Locked-down CORS | ✅ | Explicit `CORS_ORIGINS` allow-list (HTTPS enforced at start-up in production), credentials only for listed origins, never `*` | CORS-01/02 |
| 8 | HTTPS everywhere | ⚠️ | HSTS and `Secure` cookies in production; start-up requires `https://` site URL and origins. HTTP→HTTPS redirect is a hosting setting | SESS-01; configuration guide §2 |
| 9 | Verified webhook signatures | ✅ | Constant-time secret check before any write; event claimed with a lease (replays answered as duplicates); outcome fetched from the provider API, never taken from the body | HOOK-01…03; `payments.test.ts` |
| 10 | No commands from chat text | ✅ | No AI or chat feature; no `child_process`, `eval` or dynamic `require` reachable from requests | Code review (`SECURITY_AUDIT_REPORT.md §1`) |
| 11 | Debug mode off in production | ✅ | Central error handler returns generic messages; no stack traces; development fallbacks disabled on hosted platforms; sandbox gateway blocked unless explicitly allowed. Client errors no longer reported as 500 | ERR-01…03; CEL-SEC-03 tests |
| 12 | Independent security review | ✅ | 11 Nov audit + this audit (route inventory, black-box probes, code review, mutation-checked regression tests). Not a guarantee; repeat before major releases | This folder |
| 13 | Private storage | ⚠️ | Product media is public by design. Uploads use server-generated random keys; local files served with `nosniff` and a sandboxed CSP. No private customer files are stored. Bucket policy is a provider setting | UPLOAD-04/05 |
| 14 | Lock dangerous tools | ✅ | Payment/integration credentials and staff/role changes need `payments:manage` / `staff:manage` **and** recent re-authentication (password + 2FA) — new 13 Nov. Privilege boundary blocks granting rights the caller lacks | CEL-SEC-01 tests; `reauth.spec.ts`; `security.test.ts` (privilege escalation) |
| 15 | Admin pages hidden properly | ✅ | Server-side `requireStaff` + per-route permission on every admin API; the admin UI hiding a menu item is only cosmetic. `/admin` served with `noindex`/`no-store` on Vercel | PRIV-01; route table |
| 16 | Vulnerable packages updated | ✅ | `npm audit`: 0 vulnerabilities; CI fails on high/critical; install scripts reviewed | CI `security` job |
| 17 | Security headers | ⚠️ | API and Vercel: strict CSP (no `unsafe-eval`, no inline scripts), `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, COOP, `Permissions-Policy`. Railway client service needs a redeploy for its headers (SEC-06, 11 Nov) | HDR-01…06 |
| 18 | File upload type checks | ✅ | Allow-list (JPEG, PNG, WebP, AVIF, GIF, MP4, WebM); SVG, HTML, PDF and executables refused; magic bytes must match the declared type; declared size must match; server-generated names | UPLOAD-01…05; `closure.test.ts` |
| 19 | No IDOR bugs | ✅ | See #1. Unknown and forbidden objects both answer 404 (no existence oracle); ObjectIds validated | IDOR-01…06 |
| 20 | Admin actions logged | ✅ | `audit()` records actor, action, resource, detail and time for admin writes (secret values never logged); `security:*` events for authentication, authorization, step-up, webhooks, cron and rate limits | AUDIT-01; `audit-admin-crud.test.ts` |

## Open owner actions (blocking a "fully secured" claim)

| Priority | Action | Control |
|---|---|---|
| ⛔ Critical | Replace the sandbox gateway in production with live Moyasar/Tabby keys; remove `ALLOW_SANDBOX_PAYMENTS` (SEC-01, 11 Nov). Until then consider disabling online payment methods | 3, 9 |
| High | Both staff enrol 2FA, then set `STAFF_MFA_REQUIRED=true` | 14, 15 |
| High | Redeploy the Railway client service (security headers) | 17 |
| Medium | Confirm `TRUST_PROXY_HOPS` matches the real proxy count | 4 |
| Medium | Atlas network allow-list, least-privilege DB user, tested restore | 1, 13 |
| Medium | Log forwarding + alerts listed in the configuration guide | 20 |
| Medium | Make CI a required check on `main` | 16 |
