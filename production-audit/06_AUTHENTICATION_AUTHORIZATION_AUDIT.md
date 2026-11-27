# 06 — Authentication and Authorization Audit

## 1. Mechanism
- **Session:** a JWT (HS256, algorithm pinned) in an HttpOnly cookie `cel_session`. It names a server-side `Session` document, which allows revocation. Every request re-loads the user and checks `active`, `tokenVersion`, account type, session revocation and expiry (`middleware/auth.ts` `loadUser`).
- **TTL:** customers 168 h (configurable); staff capped at 12 h. A new session id is issued on every sign-in, password change and MFA step (no session fixation).
- **Cookie:** `HttpOnly`; `Secure` in production; `SameSite` = `COOKIE_SAMESITE`, or `none` in production when unset. The live two-site topology forces `none` (**H-03**).
- **Secret:** `JWT_SECRET` must be ≥ 32 characters and not a placeholder in production or on any hosting platform. Otherwise startup fails (`assertProductionConfig`, `jwtSecret`).

## 2. Feature review

| Feature | Implementation | Status |
|---|---|---|
| Registration | Zod-validated; bcrypt cost 12 in worker threads; 409 for an existing email (L-02) | PASS |
| Login | Same message for unknown email and wrong password; dummy hash equalises timing; 5 failures → 15-min lock (M-06); per-IP and per-account limiters | PASS |
| Logout | Revokes the server session and clears the cookie | PASS |
| Password hashing | bcrypt, 72-byte limit enforced by the schema | PASS |
| Password reset | 32-byte random token, stored as SHA-256, 60 min, single use (atomic `findOneAndUpdate`); bumps `tokenVersion` and revokes all sessions; identical response whether or not the account exists; 5 emails/h/address | PASS |
| Change password | Current password re-checked (counts toward lockout); all other sessions revoked | PASS |
| Email verification | Not implemented | INFO: guest checkout makes it optional; consider it before account-based offers |
| Staff 2FA | TOTP, secret encrypted with `CREDENTIALS_ENCRYPTION_KEY`, per-step replay protection, hashed one-time recovery codes, 5-min challenge token with a separate audience | PASS (feature) / **H-04** (not enforced) |
| Step-up re-auth | 15-min window; required for payment credentials, staff and roles | PASS / **M-01** (refunds not covered) |
| Staff invitation | Single-use 72 h link; nobody sets another person's password | PASS |

## 3. Authorisation model
23 named permissions (`lib/permissions.ts`). Six default roles. Only Super Administrator holds `payments:manage` and `staff:manage`. Enforcement:
- `/api/admin/*` → `requireStaff`, then `requirePermission(...)` on every route or sub-router. I checked all admin route definitions: none is reachable without a permission check.
- **Escalation guards** (`people.routes.ts`): nobody can grant a permission they lack (`assertCanGrant`) or manage a colleague who holds permissions they lack (`assertCanManage`). Nobody can change their own role or deactivate themselves. The system role is immutable.
- Customer data: `/api/me/*` → `requireCustomer`, with queries scoped to `req.user.id`. Order access goes through `loadAccessibleOrder` (owner, hashed token, or staff with `orders:read`), and every denial returns **404** so order existence is not revealed.

## 4. Security scenarios

| # | Scenario | Evidence | Result |
|---|---|---|---|
| 1 | Anonymous → protected endpoint | LIVE: `GET /api/admin/orders` → 401 `UNAUTHORIZED`. Tests `security.test.ts` | PASS |
| 2 | Customer → another customer's account | All `/me` routes are scoped to the session user; no id parameter accepted | PASS (code + tests) |
| 3 | Customer → another customer's order | `loadAccessibleOrder` → 404. `security-orders.test.ts` | PASS (tests) |
| 4 | Customer → admin API | `requireStaff` → 403. `security.test.ts`, `export-permissions.test.ts` | PASS (tests) |
| 5 | Limited admin → super-admin operations | `requirePermission('staff:manage' / 'payments:manage')` + escalation guards. `admin-controls.test.ts`, `security-hardening.test.ts` | PASS (tests) |
| 6 | Expired token | `jwt.verify` fails, the session TTL expires → anonymous, cookie cleared | PASS (code) |
| 7 | Invalid / forged token | HS256 pinned; signature failure → anonymous | PASS (code + tests) |
| 8 | Modified role claims | The token carries no role or permissions; they are re-read from the DB on every request | PASS (by design) |
| 9 | IDOR | Ids in admin routes are permission-gated; customer routes take no foreign ids; return requests are owner- or token-checked | PASS |
| 10 | Privilege escalation via role edit | `assertCanGrant` on create, update and delete | PASS (tests) |

Scenarios 2–10 were verified through the automated suite on an isolated in-memory database (481/481 passing) and by code review. **No attack traffic was sent to production.** Scenario 1 was checked live with an anonymous GET.

## 5. Findings
- **H-03**: cross-site cookie (sign-in availability on Safari / iOS).
- **H-04**: 2FA not enforced.
- **M-01**: refunds without step-up.
- **M-06**: lockout abuse.
- **L-02**: registration enumeration.
- **L-04**: non-atomic failure counter.
- **L-06**: TOTP replay on disable.
