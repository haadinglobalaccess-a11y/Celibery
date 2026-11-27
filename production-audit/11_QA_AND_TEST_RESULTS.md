# 11 — QA and Test Results

All commands ran on 27 Nov 2026 on the audit workstation (Windows 11, Node 24.19). Server and E2E tests use an **in-memory MongoDB replica set** (`server/tests/global-setup.ts`, `e2e/server.ts`). No production or shared database was touched.

## 1. Results

| # | Check | Command | Result |
|---|---|---|---|
| 1 | Type check | `npm run typecheck` | **PASS**: server, client and api, exit 0 |
| 2 | Lint | `npx eslint .` | **PASS**: 0 errors, 5 warnings (L-08) |
| 3 | Dependency audit | `npm audit` | **PASS**: 0 vulnerabilities |
| 4 | Secret scan | `node scripts/secret-scan.mjs` + git-history pattern scan | **PASS**: none found |
| 5 | Server unit + integration | `cd server && npx vitest run` | **PASS**: 51 files, **481/481 tests**, 285.6 s. A Vitest worker needed SIGKILL at exit (harmless; noted) |
| 6 | Production build | `npm run build` | **PASS**: server `tsc`, client Vite build in 4.1 s |
| 7 | E2E (Playwright, Edge channel; desktop, mobile Pixel 7, tablet) | `npx playwright test -c e2e/playwright.config.ts` | **137 passed, 2 failed, 6 skipped, 1 did not run** (146 total, 15.8 min) |
| 7a | Re-run of the failures in isolation | `… --project=desktop e2e/flagship.spec.ts` / `e2e/bulk-actions.spec.ts` | **PASS**: 3/3 and 1/1 |
| 8 | Load / performance tests (k6) | — | **NOT RUN**: no staging environment, and production must not be load tested |
| 9 | Payment sandbox with real gateway test keys | — | **NOT RUN**: no Moyasar/Tabby test credentials (H-08) |
| 10 | Lighthouse / Web Vitals | — | **NOT RUN** |
| 11 | Manual device and browser testing (Safari / iOS) | — | **NOT RUN** (needed for H-03) |
| 12 | Backup restore drill | — | **NOT RUN**: no Atlas access (H-06) |

## 2. E2E failures (full run)
1. `bulk-actions.spec.ts:18` "select products, then Set active, Archive and Delete in one click each" (desktop). The 90 s test timeout expired in the `finally` cleanup loop (`page.request.delete`, line 82), **after** all assertions had passed.
2. `flagship.spec.ts:75` "the product list dropdown filters by Featured and Flagship and shows both badges" (desktop). Expected 2 rows, received 3.

Both pass in isolation. The most likely cause is shared state: the E2E server keeps one in-memory database for the whole run, and the first test's cleanup did not finish, so its leftover product appeared in the second test. Add timing pressure late in a 15-minute run and you get the first timeout. **Classification: test-suite flakiness (L-09), not a product defect.** Remedy: give each spec unique product fixtures and filters, or reset the data between specs, and give the cleanup its own timeout.

The 6 skips are intentional project filters (`test.skip` for desktop-only or mobile-only behaviour in `faq.spec.ts` and `responsive.spec.ts`). The 1 "did not run" is a serial-group dependent of failure 1.

## 3. Coverage of critical workflows

| Workflow | Server tests | E2E |
|---|---|---|
| Registration / login / lockout / reset / 2FA / step-up | ✅ `auth`, `security*` | ✅ `reauth` |
| Authorization / IDOR / escalation | ✅ `security`, `security-orders`, `admin-controls`, `export-permissions` | ✅ `admin-controls` |
| Browsing / search / filters | ✅ `catalog` | ✅ `shop-flow`, `product-journey`, `full-audit` |
| Cart / quote / discounts | ✅ `checkout`, `discounts` | ✅ `coupon`, `commerce` |
| Checkout / idempotency / stock race | ✅ `checkout`, `q28`, `scalability` | ✅ `journeys`, `abandoned-checkout` |
| Payment (sandbox, mocked Moyasar/Tabby) | ✅ `payments`, `phase6`, `upgrade` | ✅ sandbox flow |
| Webhooks **without** the CSRF header | ❌ **missing (M-04 → hid H-01)** | ❌ |
| Refunds / returns | ✅ `phase6`, `returns` | ✅ `order-documents` |
| Order history / tracking | ✅ | ✅ `order-tracking` |
| Admin operations | ✅ `admin`, `audit-admin-crud`, `product-bulk` | ✅ `bulk-actions`, `bulk-photos`, `flagship` |
| Accessibility (axe) | — | ✅ `accessibility` |
| Cross-site cookie topology (production setup) | ❌ (M-05) | ❌ |

## 5. After remediation (27 Nov 2026, see [17](17_REMEDIATION_LOG.md))

| Check | Command | Result |
|---|---|---|
| New regression suite | `npx vitest run tests/audit-remediation.test.ts` | **PASS**: 7/7 |
| Same suite against the old `security.ts` | file temporarily restored from `HEAD` | **2 FAIL** (both webhook tests), proving the tests catch H-01; fix restored |
| Full server suite | `cd server && npx vitest run` | **PASS**: **488/488** (481 + 7 new) |
| Typecheck | `npm run typecheck` | **PASS** |
| Lint | `npx eslint .` | **PASS**: 0 errors, **0 warnings** (was 5) |
| Production build | `npm run build` | **PASS** |
| E2E: changed and affected specs | `--project=desktop bulk-actions flagship reauth order-documents` | **PASS**: 7/7 (36.9 s) |
| Full E2E re-run | — | NOT RUN (only the specs touched by the changes were re-run) |

## 4. Limitations
Every functional result is from an isolated environment that matches the documented single-origin deployment, **not** the live two-service Railway topology. No test was run against production apart from the read-only probes listed in [01](01_EXECUTIVE_SUMMARY.md).
