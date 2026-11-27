# 17 — Remediation Log (27 Nov 2026)

**Scope approved by the owner:** every code-level fix **except C-01**. The sandbox gateway stays on deliberately for the current testing phase. Nothing has been committed, pushed or deployed. Production configuration is unchanged.

## Fixed in code

| Finding | Change | Files |
|---|---|---|
| **H-01** webhooks blocked by the CSRF guard | The exemption now matches the full path (`req.baseUrl + req.path`). Only `/api/webhooks/*` and `/api/cron/*` are exempt (both authenticate with their own secret); every other POST/PUT/PATCH/DELETE still needs `X-Requested-With` | `server/src/middleware/security.ts` |
| **H-02** webhook callback on the storefront host | New optional `PUBLIC_API_URL`, validated as HTTPS in production. The Moyasar `callback_url` uses it, falling back to `PUBLIC_SITE_URL`, so the single-origin setup is unchanged. Documented | `server/src/config/env.ts`, `server/src/integrations/payments/moyasar.ts`, `.env.example`, `docs/DEPLOYMENT.md` |
| **M-01** refunds without step-up | `requireRecentAuth` on `POST /admin/orders/:id/refund` and `POST /admin/orders/:id/refunds/:refundId/resolve`. The admin client already shows the password prompt on `REAUTH_REQUIRED` and retries | `server/src/modules/admin/orders.routes.ts` |
| **M-04** tests hid header-dependent bugs | New suite that calls the API with bare supertest (no default headers) | `server/tests/audit-remediation.test.ts` |
| **L-04** non-atomic failed-login counter | `$inc`, then one conditional lock; parallel guesses can no longer slip past the limit | `server/src/modules/auth/auth.service.ts` |
| **L-06** `mfa/disable` did not consume the code | Uses the same single-use check as sign-in | `server/src/modules/auth/auth.service.ts` |
| **L-08** React hook warnings | Storefront `HomeVideos` built a new array every render, so its structured-data `<script>` was removed and re-added on every render. Now memoised (also in the admin page). The three intentional mount-once effects carry a documented lint exception | `client/src/storefront/HomeVideos.tsx`, `client/src/admin/pages/HomeVideos.tsx`, `client/src/three-d/CampaignPlayback.tsx`, `client/src/three-d/InteractiveProductGallery.tsx` |
| **L-09** order-dependent E2E failures | Root cause: `bulk-actions` cleanup ran inside the test's 90 s budget. On a slow full run it was cut off, and a leftover Flagship product broke `flagship.spec.ts`, which counted all Flagship rows. Cleanup moved to its own `afterAll`; the flagship assertion now checks its own products | `e2e/bulk-actions.spec.ts`, `e2e/flagship.spec.ts` |

## Deliberately not changed
| Finding | Reason |
|---|---|
| C-01 | The owner's decision (testing phase) |
| L-03 quote email probing | The checkout page sends the typed email on purpose, so a guest sees "code already used" before paying. Removing it degrades checkout for a minor, rate-limited leak. Accepted trade-off |
| M-06 account lockout | Changing lockout semantics alters security behaviour for every account. It needs a product decision (CAPTCHA vs. IP+account lock) |
| L-05, I-05 | L-05 is acceptable under the strict CSP. Renaming the `collection` schema path (I-05) would need a data migration |
| H-03, H-04, H-05, H-06, H-07, H-08, M-02, M-03, M-05, L-01, L-07 | Configuration, infrastructure, legal or content: owner actions (see below) |

## Owner actions still required
1. **H-03 / L-01:** one Railway service (`SERVE_CLIENT=1`, `COOKIE_SAMESITE=lax`) on a custom domain. **Until then, set `PUBLIC_API_URL=https://celiberyserver-production.up.railway.app` on the API service** so gateway webhooks reach the API (H-02).
2. **H-04:** `STAFF_MFA_REQUIRED=true` before handover.
3. **H-05:** CR, VAT and contact details; approve the policies.
4. **H-06:** Atlas backups + PITR and a restore drill.
5. **H-07:** point the developer `.env` at a local or non-production database.
6. **H-08:** Moyasar/Tabby test keys on staging and the payment matrix.
7. **M-02:** Sentry DSN (server + browser build) and an uptime monitor.
8. **L-07:** mention the visitor-IP country lookup in the privacy policy.

## Verification
See the results recorded in [11_QA_AND_TEST_RESULTS.md](11_QA_AND_TEST_RESULTS.md) §5.
