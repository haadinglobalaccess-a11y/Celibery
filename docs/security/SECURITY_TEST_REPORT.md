# CELIBERY — Security Test Report (13 November 2026)

Every test below ran on a developer workstation against an **isolated local server with an in-memory MongoDB** (demo data, throwaway administrator). No request reached production, a payment provider or any other third party.

## 1. Summary

| Check | Command | Baseline (`main`, before changes) | Final (this branch) |
|---|---|---|---|
| Server API + security suites | `npm test` | 30 files, **288 passed** | 32 files, **304 passed** (288 + 16 new), 0 failed, no unhandled errors |
| Coupon race (final review) | temporary parallel-checkout test | 5 of 5 parallel checkouts used a "1 per customer" code | `security-orders.test.ts`: exactly 1 of 5 succeeds; checkout/coupon browser specs 26 passed |
| Typecheck (server, client, api) | `npm run typecheck` | pass | pass |
| Production build | `npm run build` | pass | pass |
| Browser end-to-end (desktop, mobile, tablet) | `npm run test:e2e` | not re-run (11 Nov: 91 passed) | **100 passed, 6 skipped, 0 failed** (11.1 min), including 2 new step-up tests |
| Dependency audit | `npm audit` | 0 vulnerabilities | 0 vulnerabilities |
| Secret scan | `node scripts/secret-scan.mjs` | — | 372 tracked files, 0 findings (and verified to catch a planted live key) |
| Black-box probes | `scripts/security-probes/probe.mjs` | 68 / 69 | 68 / 69 (the one "failure" is a test-mode artifact, see §3) |
| Rate-limit probes (limits on) | `scripts/security-probes/rate-probe.mjs` | — | 3 / 3 |

**Skipped e2e tests (6):** intentional, conditional skips. Five FAQ admin-workflow tests run on desktop only (`faq.spec.ts`), and one mobile-only test is skipped on desktop (`responsive.spec.ts`).

**Pre-existing failure not caused by this work:** `e2e/hero-duration.check.cjs` (a standalone hero timing check, not part of `npm run test:e2e`) fails identically on the previous commit, before any of today's changes. It asserts how far a 1-second slide's progress bar has filled at 0.8 s.

## 2. New regression tests and mutation check

`server/tests/security-hardening.test.ts`:

| Test | Guards |
|---|---|
| fresh sign-in can manage staff; an old session must re-enter the password first | CEL-SEC-01 |
| payment and integration credentials need step-up too | CEL-SEC-01 |
| the step-up window expires | CEL-SEC-01 |
| with 2FA on, step-up needs a valid one-time code (no replay) | CEL-SEC-01 |
| only staff sessions can step up | CEL-SEC-01 |
| change-password cannot be used to guess the password (lock + session ended) | CEL-SEC-02 |
| 2FA set-up password re-check counts failures the same way | CEL-SEC-02 |
| a correct re-check resets the failure counter | CEL-SEC-02 |
| `../` in a media path answers 4xx and logs no error-level stack trace | CEL-SEC-03 |

`e2e/reauth.spec.ts`: the admin prompts for the password, rejects a wrong one through the real server, then completes the original action; cancelling changes nothing.

**Mutation check:** with the three fixes temporarily reverted (step-up guards removed, lock-out counting removed from re-checks, client-error branch disabled), **6 of the 9 tests failed**. The 3 that still passed test behaviour the reverted code did not touch (2FA code requirement inside `/reauth`, staff-only access to `/reauth`, counter reset). The fixes were then restored and all 9 pass.

## 3. Black-box probes (final run)

Run: start `npx tsx e2e/server.ts` with `E2E_PORT=4319`, then `node scripts/security-probes/probe.mjs`. For the rate-limit probes, start the server with `RATE_LIMIT_IN_TESTS=1` and run `rate-probe.mjs`. Both scripts refuse non-local targets.

| ID | Attack | Result |
|---|---|---|
| AUTH-01 ×8 | Anonymous access to admin and account APIs | 401 ✅ |
| CSRF-01/02 | Write without the custom header; form-style cross-site POST | 403 ✅ |
| CORS-01/02 | Preflight and credentialed read from `https://evil.example` | no `Access-Control-Allow-Origin` ✅ |
| NOSQL-01…03 | `{"$ne":null}` in login body, query string and order tracking | 400 ✅ |
| PROTO-01 | `__proto__` key in JSON body | 400 ✅ |
| REDOS-01 | Catastrophic-backtracking pattern in search | 400 in 6 ms ✅ |
| ERR-01…03 | Malformed JSON, 1.2 MB body, 5,000-character path parameter | 400 / 413 / 400, no stack traces ✅ |
| PAGE-01 | `limit=100000` | 400 ✅ |
| PATH-01 ×11 | `/.env`, `/../.env`, encoded traversal, `/.git/config`, `/e2e/.artifacts/admin.json`, `/media/..%2f..%2f.env` | no file content leaked ✅; `/media` traversal now **403** (was 500 before CEL-SEC-03) |
| HDR-01…06 | Security headers on the storefront | CSP without `unsafe-eval`/inline scripts, framing denied, `nosniff`, Referrer-Policy, no `X-Powered-By` ✅ |
| EXPO-01/02 | Secrets or internal fields in public settings and product list | none ✅ |
| MASS-01/02 | `type:"staff"`, `role`, `permissions`, `email` in register and profile update | ignored ✅ |
| PRIV-01 | Customer session → admin API | 403 ✅ |
| PASS-01 | Password `123456` | 400 ✅ |
| ENUM-01/02 | Known vs unknown email on forgot-password and login | identical responses ✅ |
| SESS-01…03 | Cookie flags; cookie after logout; `alg:none` token | `HttpOnly; SameSite=Lax` (+`Secure` in production); 401; 401 ✅ |
| PRICE-01 | Client sends `price: 1`, `total: 1`, `discountTotal: 999` | order total = catalogue price (SAR 149.00) ✅ |
| IDOR-01…06 | Guest order without/with wrong/array token; another customer's order, payment verification, return | 404 / 404 / 404 / 404 / 404 / 400 (validation first; ownership verified in code) ✅ |
| HOOK-01…03, CRON-01 | Webhooks with wrong/missing secret; cron with wrong secret | 403 ✅ |
| UPLOAD-01…05 | SVG with script; HTML renamed `.png`; executable type; `../../../evil.png` filename; serving headers | refused at create / content check (422) / create; stored as `/media/2026/11/image-<random>.png`; served `nosniff` + `default-src 'none'` ✅ |
| AUDIT-01 | Admin upload appears in the audit log | ✅ |
| RATE-01 | 30 bad logins from one IP **with limits disabled (test mode)** | not limited — expected in test mode; see rate-limit probes |
| RATE-01 (limits on) | Bad logins from one IP | blocked at attempt 21, `Retry-After: 900` ✅ |
| RATE-02 | Rotating spoofed `X-Forwarded-For` behind one proxy | blocked at attempt 21 ✅ |
| RATE-03 | Reset emails to one address from 8 IPs | blocked at request 6 ✅ |
| RATE-04 | Distributed guessing on one account from 14 IPs | blocked at attempt 11 ✅ |

## 4. Not executed (and why)

| Test | Reason |
|---|---|
| Anything against production (`*.up.railway.app`) | No authorization to test production in this task; SEC-01 (sandbox gateway) therefore not re-checked live |
| Real Moyasar/Tabby/WhatsApp/S3 calls | No provider test credentials; provider code paths are covered by existing tests with local stand-ins |
| Checkout with a real sandbox payment provider | Same reason; the built-in sandbox gateway flow runs in `payments.test.ts` and the e2e journeys |
| DAST scanner (OWASP ZAP/Burp), load/DDoS testing | Out of scope; recommended against staging before launch |
| Backup restore | Needs MongoDB Atlas access |
| CI workflow on GitHub | Added in this branch; it runs on the first push. Each step was run locally with the same commands |

## 5. Environment note

During testing, the D: drive ran out of space (80 MB free), which stopped the in-memory database from starting. The cause was 94 leftover `mongo-mem-*` test database folders in `D:\Temp` (27 GB, the oldest from 7 November), left behind whenever a test server process is killed instead of shut down. They contained only generated test data and were deleted. If test runs fail with `Mongod internal error (fassert() failure)`, check free disk space first.
