# 16 — Recommended Remediation Plan

**No remediation has been started.** Approval is requested before any change. Items marked **(owner)** are configuration or dashboard actions that only the client or operator can perform. Items marked **(code)** are repository changes I can make after approval.

## Phase 0 — Immediate containment (today, before any further traffic)
| # | Item | Type | Complexity | Risk of change |
|---|---|---|---|---|
| 0.1 | **C-01**: disable online payment methods in Admin → Settings → Payments, or set `ALLOW_SANDBOX_PAYMENTS=false` on the Railway API (COD only remains) | owner | Trivial | Online checkout unavailable until a real gateway is live (intended) |
| 0.2 | Review orders whose history contains "TEST payment (sandbox gateway)" and do not ship them unpaid | owner | Low | None |
| 0.3 | **H-07**: confirm which cluster the developer `.env` uses. If production, stop running `npm run dev` / seed scripts against it and rotate the DB user's password | owner | Low | Rotation requires updating the Railway variable (brief restart) |

## Phase 1 — Critical and high (code)
| # | Item | Files | Complexity | Depends on | Risk |
|---|---|---|---|---|---|
| 1.1 | **H-01**: match the full path in `csrfGuard` (`req.baseUrl + req.path`) | `server/src/middleware/security.ts` | Very low (1 line) | — | Low. Exempts only `/api/webhooks/*` and `/api/cron/*`, which authenticate separately |
| 1.2 | **M-04**: webhook/cron regression tests without the CSRF header | `server/tests/payments.test.ts` (or new) | Low | 1.1 | None |
| 1.3 | **M-01**: `requireRecentAuth` on `POST /admin/orders/:id/refund` (+ test). Check that the admin refund dialog handles `REAUTH_REQUIRED` as other dialogs do | `server/src/modules/admin/orders.routes.ts`, possibly `client/src/admin/pages/Orders.tsx` | Low | — | Staff re-enter a password before refunding |
| 1.4 | **H-02** (code part, optional): dedicated `PUBLIC_API_URL` for the gateway callback, used only when the API and site differ | `env.ts`, `moyasar.ts` | Low | — | None if defaulted to `PUBLIC_SITE_URL`. Unnecessary if 2.1 is done |

## Phase 2 — Infrastructure and configuration (owner, with my support)
| # | Item | Complexity | Depends on | Risk |
|---|---|---|---|---|
| 2.1 | **H-03 / H-02 / L-01**: single Railway service (`SERVE_CLIENT=1`, `COOKIE_SAMESITE=lax`, empty `VITE_API_BASE_URL`) on the custom domain; retire the `vite preview` service | Medium | Domain DNS | Changing the domain invalidates existing sessions and carts on the old host; plan the cut-over and redirect the old host |
| 2.2 | **M-05**: staging service, identical settings, test-mode gateway keys, separate database | Medium | 2.1 | Cost of a second service and cluster |
| 2.3 | **H-08**: configure Moyasar/Tabby **test** keys on staging; run the 10-case matrix in [07](07_PAYMENT_AND_ORDER_AUDIT.md) §6; then live keys in production | Medium | 1.1, 2.1, 2.2, gateway accounts | Real money once live: switch only after the matrix passes |
| 2.4 | **H-04**: `STAFF_MFA_REQUIRED=true`; every staff member enrols | Low | `CREDENTIALS_ENCRYPTION_KEY` set | Staff without 2FA are locked out until they enrol |
| 2.5 | **H-06**: Atlas Cloud Backup + PITR, restore drill, runbook | Medium | Atlas tier ≥ M10 | Cost |
| 2.6 | **M-02**: Sentry DSN (server + browser build), uptime monitor on `/api/health`, `METRICS_TOKEN` | Low | — | None |
| 2.7 | **H-05**: CR, VAT, contact details; approve policies; SBC verification | Low (technical) | Client and counsel | None |
| 2.8 | CI gating: deploy production only from `main` after CI passes; written rollback runbook | Low | — | None |

## Phase 3 — Medium and low improvements
| # | Item | Complexity |
|---|---|---|
| 3.1 | M-03: confirm regions, measure from KSA, tune caching / CDN | Medium |
| 3.2 | M-06: soften account lockout (IP+account, alert on staff locks) | Low–Medium |
| 3.3 | L-03: ignore third-party email in quote eligibility | Low |
| 3.4 | L-04: atomic failure counter | Low |
| 3.5 | L-06: consume the TOTP step on disable | Low |
| 3.6 | L-07: privacy disclosure or CDN geo header | Low |
| 3.7 | L-08: hook dependency warnings | Low |
| 3.8 | I-06: consolidate stale root-level reports | Low |
| 3.9 | Staging load test (1–50 VUs) and Lighthouse from KSA | Medium |

## Dependencies
`0.1` comes first, independent of everything. `1.1` → `1.2` → `2.3`. `2.1` makes `1.4` unnecessary and is a prerequisite for meaningful Safari testing and for the real-gateway webhook test. `2.2` is a prerequisite for `2.3` and `3.9`.

## Recommended sequence
0.1 → 0.2 → 0.3 → 1.1 + 1.2 → 1.3 → 2.1 → 2.2 → 2.6 → 2.3 → 2.4 → 2.5 → 2.7 → 2.8 → Phase 3.

## Must be fixed before accepting real customer traffic
C-01, H-01, H-02, H-03, H-04, H-05, H-06 (a verified restore), H-08 (the test-mode matrix passed), and M-02 (at least error alerting).

## Change rules (once approved)
Smallest safe changes; no redesign, refactors or dependency upgrades; a regression test for each fix; full `npm test` plus E2E after each batch; every modified file listed; no production configuration changed by me and no deployment without separate explicit approval.
