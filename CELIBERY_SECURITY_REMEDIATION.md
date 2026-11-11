# CELIBERY — Security Remediation Log

**Date:** 11 November 2026 · Companion to `CELIBERY_COMPLETE_SECURITY_AUDIT.md` (finding ids match).
**State:** all changes are in the working tree. **Not committed, pushed or deployed** — that needs the owner's approval.

---

## Files changed

| File | Change |
|---|---|
| `server/src/config/env.ts` | `TRUST_PROXY_HOPS`, `RATE_LIMIT_STORE`, `STAFF_MFA_REQUIRED`; `isHostedPlatform()`, `devFallbacksAllowed()`; hosted-platform start-up guard |
| `server/src/app.ts` | Configurable trust proxy; `rejectOperatorKeys` on `/api`; cron bad-secret events |
| `server/src/server.ts` | Header/request/keep-alive timeouts; `unhandledRejection` logger |
| `server/src/middleware/auth.ts` | Server-side sessions (`issueSession` async, `revokeSession`, `revokeAllSessions`), MFA-aware `loadUser`, `MFA_ENROLLMENT_REQUIRED`, `authz.denied` events |
| `server/src/middleware/security.ts` | Named, shared limiters with `Retry-After`; per-account and per-email limits; operator/prototype key guard |
| `server/src/models/Security.ts` (new) | `Session` and `RateLimitCounter` models (TTL indexes) |
| `server/src/models/User.ts`, `models/index.ts` | MFA fields (encrypted secret, hashed recovery codes, last step), `lastLoginIp` |
| `server/src/lib/rate-limit-store.ts` (new) | MongoDB store for express-rate-limit with in-memory fallback |
| `server/src/lib/totp.ts` (new) | RFC 6238 TOTP, base32, recovery codes |
| `server/src/lib/security-log.ts` (new) | Structured security events, email masking |
| `server/src/modules/auth/*` | MFA challenge/verify/setup/enable/disable, login events, session revocation |
| `server/src/modules/admin/people.routes.ts` | `assertCanGrant` / `assertCanManage`, `POST /staff/:id/reset-mfa`, sessions revoked on deactivation |
| `server/src/modules/admin/admin.schemas.ts`, `system.routes.ts` | `isSafeLink` for every admin URL field |
| `server/src/modules/orders/order.controller.ts`, `order.routes.ts` | Token type check; generic payment error; quote limiter |
| `server/src/modules/catalog/catalog.routes.ts` | Search, review and newsletter limiters |
| `server/src/modules/payments/payment.routes.ts` | `webhook.bad_signature` events |
| `server/src/modules/payments/payment.service.ts` | Duplicate-payment flag; sandbox-in-production flag |
| `server/src/integrations/credentials/index.ts` | Development key only where `devFallbacksAllowed()` |
| `server/src/integrations/notifications/order-confirmation.ts` | `.catch` on the background email attempt |
| `client/src/state/auth.tsx`, `lib/types.ts` | MFA challenge step (`verifyMfa`) |
| `client/src/admin/security.tsx` (new) | 2FA set-up / recovery codes / turn off; enrolment gate |
| `client/src/admin/AdminApp.tsx` | Code step at admin sign-in; 2FA in Profile; gate when 2FA is mandatory |
| `client/src/admin/pages/System.tsx` | 2FA badge, *Reset 2FA*, error handling on *Send reset link* |
| `client/src/pages/AuthPages.tsx` | Staff-with-2FA message on the storefront sign-in |
| `client/vite.config.ts` | Security headers for `vite preview` (Railway storefront) |
| `vercel.json` | `Cross-Origin-Opener-Policy`; `/admin` `no-store` + `noindex` |
| `.env.example` | New variables documented |
| `server/tests/security.test.ts` (new) | 29 security regression tests |
| `server/tests/unit/totp.test.ts` (new) | 5 TOTP tests (RFC vectors) |

No dependency was added, removed or upgraded.

---

## Fixes

### SEC-01 — Sandbox gateway in production (P0) — mitigated, owner action open
- **Before:** an order "paid" through the simulator looks exactly like a real paid order.
- **After:** in production every sandbox-confirmed order carries a staff-only history line *"TEST payment (sandbox gateway) — no money was collected. Do not ship."* and an error log line. The real fix is configuration (checklist §Payments).
- **Test:** existing sandbox checkout tests still pass. The production-only branch is not exercised by tests, because the test environment is not production.

### SEC-02 — Staff two-factor authentication (P1)
- **Before:** password only.
- **After:** sign-in returns `{ mfaRequired: true, mfaToken }` (no cookie) for staff with 2FA. `POST /api/auth/mfa/verify` with a 6-digit code or a recovery code creates the session. Set-up lives in Admin → Profile → *Two-factor authentication* (password → key + `otpauth://` link → code → 10 recovery codes shown once). A Super Administrator can *Reset 2FA* for a colleague who lost their phone (Staff page).
- **New endpoints:** `GET /api/auth/mfa`, `POST /api/auth/mfa/setup|enable|disable|verify`, `POST /api/admin/staff/:id/reset-mfa`.
- **Rollout:** each administrator enrols, then the owner sets `STAFF_MFA_REQUIRED=true`. 2FA needs `CREDENTIALS_ENCRYPTION_KEY` in production, which is already required for admin-managed credentials.
- **Tests:** enrolment with a wrong password and a wrong code; the secret is encrypted at rest; password-only sign-in gets no cookie; a wrong code is refused; the enrolment code cannot be replayed; the next code works once and only once; a recovery code works once; a challenge token is not a session; admin reset ends the colleague's sessions; mandatory mode blocks admin APIs but allows enrolment. RFC 4226/6238 vectors.

### SEC-03 — Staff-management privilege escalation (P1)
- **Before:** `staff:manage` ⇒ effectively every permission.
- **After:** a caller can only grant, assign or manage permission sets that are a subset of their own. The Super Administrator (all permissions) is unaffected.
- **Test:** the HR role (`staff:manage` + `customers:read`) is refused 403 for a `payments:manage` role, a Super-Admin invite, a Super-Admin reset link, deactivation and 2FA reset. It can still create a `customers:read` role, and the Super Administrator can create a `payments:manage` role.

### SEC-04 — Server-side sessions (P2)
- **Before:** logout deleted the cookie only.
- **After:** a `sessions` record per sign-in. The cookie names it, logout revokes it, and records expire via TTL.
- **Migration impact:** staff sign in once after deploy. Customers stay signed in until their current cookie expires. Collection `sessions` and its indexes are created automatically by Mongoose; no migration script is needed.
- **Cost:** one indexed read per authenticated API request.
- **Tests:** stolen-cookie replay after logout; the password change keeps the current device and signs out the others; a new session id on each sign-in; legacy, forged-sid and wrong-key tokens are refused; deactivation ends sessions.

### SEC-05, SEC-10, SEC-11 — Shared and endpoint-specific rate limits (P2/P3)

| Limiter | Key | Limit | Store |
|---|---|---|---|
| `api` (every `/api` request) | IP | 300 / min | per instance (deliberate) |
| `auth` (register, login, reset, change password, 2FA set-up/disable) | IP | 20 / 15 min | shared |
| `login-account` | email | 10 **failed** / 15 min | shared |
| `reset-email` | email | 5 / h | shared |
| `mfa` (verify, enable) | IP | 15 / 15 min | shared |
| `checkout`, retry payment, returns | IP | 20 / min | shared |
| `tracking`, order view, verify payment | IP | 30 / 15 min | shared |
| `quote` (cart + coupon checks) | IP | 60 / min | shared |
| `search` (`/api/products`) | IP | 120 / min | shared |
| `review` | IP | 10 / h | shared |
| `newsletter` | IP | 10 / h | shared |
| checkout drafts (existing) | IP | 90 / min | shared |
| media uploads (existing) | IP | 120 / 10 min | shared |

- Plus the existing per-account lock-out (5 failed passwords **or 2FA codes** → 15 min).
- If MongoDB is unavailable, the limiter falls back to per-instance counting (never fail-closed for everyone, never unlimited) and logs `rate_limit.store_unavailable`.
- `RATE_LIMIT_STORE=memory` restores the old behaviour.
- **Tests:** two store instances sharing one counter; 10 parallel increments give exactly 1…10; window expiry; fallback; 6 reset requests for one address → 5 × 200 then 429 with `Retry-After`.

### SEC-06 — Storefront security headers (P2)
- **Before:** live `/admin` answered with no security headers.
- **After:** `vite preview` sends `CSP frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS and COOP. Vercel additionally gets COOP and `no-store` + `noindex` on `/admin`.
- **Verify after redeploy:** `curl -I https://<storefront>/admin`.

### SEC-07 — Crash on background failure (P2)
- **Before:** baseline run: 1 unhandled rejection, exit code 1.
- **After:** caught and logged; the global handler logs any future unhandled rejection instead of crashing. The full suite runs with 0 unhandled errors and exit code 0.

### SEC-08 — Development secrets on hosting platforms (P2)
- **Before:** `NODE_ENV` ≠ production → constant JWT secret and credential key from the repository.
- **After:** on Vercel, Railway, Render, Fly, Cloud Run or Heroku, fallbacks are disabled, start-up refuses to run without `JWT_SECRET`, and a warning is printed when `NODE_ENV` is not production.

### SEC-09 — Gateway error leakage (P3)
- **Before:** `paymentError` echoed the provider's response text.
- **After:** application errors (`AppError`) keep their safe message; gateway errors become *"Could not start the payment. Please try again from your order page."*

### SEC-12 — Open redirect through admin links (P3)
- **Before:** `//evil.example` was accepted.
- **After:** `isSafeLink` accepts only `https?://host…` or `/path` (not `//` or `/\`).
- **Test:** `//evil.example`, `/\evil.example`, `javascript:alert(1)` and `https://` are refused; normal links are accepted.
- **Note:** values already saved are not re-validated until they are edited. Check Admin → Settings links once.

### SEC-13 — Duplicate payments (P3)
- **After:** staff-only history line identifying the extra payment. It is idempotent on webhook replay.
- **Test:** included.

### SEC-14 — Security logging (P3)
- **Events:** `auth.login_failed`, `auth.login_success`, `auth.account_locked`, `auth.logout`, `auth.password_reset_requested`, `auth.password_reset`, `auth.password_changed`, `auth.session_rejected`, `mfa.*`, `authz.denied`, `rate_limit.exceeded`, `rate_limit.store_unavailable`, `webhook.bad_signature`, `cron.bad_secret`, `staff.privilege_blocked`.
- **Format:** one JSON line, `"security": true`, IP, method, path, user agent (160 characters), user id, masked email (`so***@domain`). Passwords, codes, tokens and cookies are never passed. The logger's redaction (`lib/redact.ts`) is the second safeguard.
- **Audit log:** 2FA enable, disable, reset and recovery-code use are also written to the admin Activity log.
- **Test:** a failed login logs `security:auth.login_failed` with a masked email and without the password.

### SEC-15, SEC-16, SEC-17 — Hardening (P3/P4)
- `TRUST_PROXY_HOPS` (default 1). The Node server timeouts are listed in the audit.
- `?token=` must be a single string; legacy orders without a token hash answer 404.
- Requests whose body or query contains `$…`, `__proto__`, `constructor` or `prototype` keys are refused with 400 `INVALID_INPUT`. Test included.

---

## Verification

Run from the repository root on 11 November 2026, Windows 11, Node 24.19.0. The isolated in-memory MongoDB was used for every suite.

| Check | Command | Result |
|---|---|---|
| Typecheck (server, client, api) | `npm run typecheck` | passed (exit 0) |
| Server unit + integration | `npm test` | 28 files, 274 tests passed, 0 unhandled errors, exit 0 (baseline: 26 files, 240 passed, 1 unhandled error, exit 1) |
| Production build | `npm run build` | server tsc + client Vite build passed; API typecheck passed |
| End-to-end | `npm run test:e2e` | 91 passed, 1 skipped (mobile-only check skipped on desktop by design), 0 failed |
| Dependencies | `npm audit` | 0 vulnerabilities |
| Build artifacts | grep `client/dist`, `server/dist` for MongoDB URIs, `sk_live_`/`sk_test_`, AWS keys, Meta tokens, private keys | 0 matches; no source maps |
| Git history | `git log -p` pattern scan | test fixtures only |
