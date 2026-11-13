# CELIBERY — Security Remediation Report (13 November 2026)

Fixes for the findings in `SECURITY_AUDIT_REPORT.md`. All changes are backward compatible: no API was removed, no schema change needs a migration, and no customer or staff record is modified. Customers see no difference; staff see a password prompt only when they change payment settings, staff or roles more than 15 minutes after signing in.

## Files changed

| File | Change |
|---|---|
| `server/src/middleware/auth.ts` | `req.user.authAt` (last proof of identity in the session); `requireRecentAuth`, `requireRecentAuthForWrites`, `REAUTH_WINDOW_MINUTES = 15` |
| `server/src/models/Security.ts` | Optional `Session.reauthAt` (no migration; older sessions lack it and fall back to their sign-in time) |
| `server/src/modules/auth/auth.service.ts` | `verifyCurrentPassword` (lock-out aware, ends the guessing session on lock), `consumeSecondFactor` (extracted unchanged from MFA sign-in), `stepUp`, `RecheckError`; `changePassword` / 2FA set-up / 2FA disable now use the shared check |
| `server/src/modules/auth/auth.controller.ts` | `reauth` handler; re-check failures logged as security events |
| `server/src/modules/auth/auth.routes.ts`, `auth.schemas.ts` | `POST /api/auth/reauth` (staff session, auth rate limit, validated body) |
| `server/src/modules/admin/integrations.routes.ts` | Step-up required for every write (credentials, activation, verification, test messages) |
| `server/src/modules/admin/people.routes.ts` | Step-up required for every staff and role write |
| `server/src/middleware/error.ts` | Library client errors (`expose: true`, 4xx) keep their status; one warning line, no stack |
| `server/src/lib/security-log.ts` | New events: `auth.reauth_required`, `auth.reauth_success`, `auth.reauth_failed`, `auth.password_check_failed` |
| `client/src/lib/api.ts` | Pluggable step-up handler: on `REAUTH_REQUIRED` it prompts once (shared by parallel requests) and retries the request once. No handler outside the admin, so storefront behaviour is unchanged |
| `client/src/admin/security.tsx`, `AdminApp.tsx` | `ReauthHost` password (+ 2FA code) prompt, mounted only for signed-in staff |
| `scripts/secret-scan.mjs` | Dependency-free, high-confidence secret scan of tracked files (masked output) |
| `.github/workflows/ci.yml` | CI gates: secret scan, `npm audit --audit-level=high`, typecheck, server tests, build |
| `server/tests/security-hardening.test.ts` | 9 regression tests (CEL-SEC-01/02/03) |
| `server/src/models/Discount.ts` | `DiscountRedemption` counter (unique per coupon + identity), no migration |
| `server/src/modules/orders/order.service.ts` | Per-customer coupon limit enforced atomically inside the order transaction (CEL-SEC-07); phone as identity (CEL-SEC-08); open-COD cap per phone (CEL-SEC-09); uses returned on cancellation/expiry and on rollback |
| `server/src/config/env.ts` | Optional `MAX_OPEN_COD_ORDERS_PER_PHONE` (default 3; 0 = off) |
| `server/tests/security-orders.test.ts` | 7 regression tests (CEL-SEC-07/08/09) |
| `e2e/reauth.spec.ts` | 2 browser tests for the admin step-up flow |

## Design notes

**Step-up (CEL-SEC-01).** The proof of identity lives on the server-side session record, so it cannot be forged by the browser, ends with the session, and is not shared between devices. Sign-in time counts as a proof: an administrator who has just signed in (with 2FA, if enabled) is never asked twice. The TOTP check reuses the sign-in code path, including single use of each time step and of recovery codes, so a code seen once cannot be replayed. Wrong passwords and codes count toward the normal lock-out. Scope is deliberately narrow (payment and integration credentials, staff and roles), so day-to-day work such as orders, products and content is never interrupted.

**Lock-out for re-checks (CEL-SEC-02).** The same 5 failures / 15 minutes rule as sign-in. When a re-check failure locks the account, the session that produced the failures is revoked, because that pattern indicates a hijacked session. Trade-off (accepted, same as sign-in): someone holding a stolen session can lock the real user out for 15 minutes.

**Error handling (CEL-SEC-03).** Only `http-errors` objects marked `expose: true` qualify. Errors from payment or messaging APIs that happen to have a `status` field still return a generic 500, so a provider's 401 can never be mistaken for the user's session ending.

## Not changed (and why)

| Item | Reason |
|---|---|
| Sandbox gateway in production (SEC-01 of 11 Nov) | Requires live payment keys and production environment changes: owner action, needs approval |
| Making 2FA mandatory (`STAFF_MFA_REQUIRED=true`) | Would lock out administrators who have not enrolled yet; enable after both staff members enrol |
| Railway/Vercel headers, WAF, monitoring, backups | Hosting-provider settings, not application code (see configuration guide) |
| SAST (CodeQL) in CI | Free only for public repositories; on a private repository it needs GitHub Advanced Security. Enable it in repository settings if available |
