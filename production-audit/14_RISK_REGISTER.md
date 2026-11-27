# 14 — Risk Register

Every finding has an ID that the other documents use. **Evidence** says how each one was established:
- **LIVE**: a non-destructive request to production on 27 Nov 2026
- **REPRO**: reproduced in an isolated script
- **CODE**: read in source
- **ABSENT**: no evidence could be obtained

No secret values or personal data appear here.

Severity scale: CRITICAL (direct financial loss or compromise) · HIGH · MEDIUM · LOW · INFORMATIONAL.

> **Remediation status (27 Nov 2026, not yet deployed):** fixed in code: H-01, H-02 (needs `PUBLIC_API_URL` set on the API), M-01, M-04, L-04, L-06, L-08, L-09. Open by owner decision: C-01 (sandbox kept for testing), L-03, M-06. All others need owner or infrastructure action. Details: [17_REMEDIATION_LOG.md](17_REMEDIATION_LOG.md).

---

## CRITICAL

### C-01 — Sandbox payment simulator is live in production
| | |
|---|---|
| Category | Payment safety / configuration |
| Location | `server/src/integrations/payments/index.ts:10` (`sandboxAllowed`), `:19` (`effectiveCardGateway`); `server/src/modules/payments/payment.routes.ts:153` (`POST /api/payments/sandbox/:ref/complete`); `server/src/modules/payments/payment.service.ts:159` |
| Evidence (LIVE) | `GET https://celiberyserver-production.up.railway.app/api/checkout/options` returns `paymentMethods: { card: true, applepay: true, stcpay: true, tabby: true, cod: true, gateway: "sandbox", sandbox: true }`. That combination is only possible when `PAYMENT_GATEWAY=sandbox` and `ALLOW_SANDBOX_PAYMENTS=true` are set on the production API. The catalogue is real (22 client-sourced products on the homepage, no demo data). |
| How it is exploited | A shopper places an online order and is redirected to `/{lang}/sandbox-pay/sbx_…`, which offers "success / failure / cancel". Choosing *success* calls the public `complete` endpoint, which sets the simulated payment to `paid`. The server then "verifies" with the simulator and marks the order `paymentStatus: paid`, `status: confirmed`, and sends the confirmation email. No money moves. |
| Impact | Free goods if staff ship. False revenue in reports. Stock reserved by fake orders. Customer confusion. The code's only guard is an **internal** order-history note ("TEST payment (sandbox gateway) — no money was collected. Do not ship.") plus an error log line. The admin order list shows the order as paid and confirmed. |
| Safe reproduction | Not performed: it would create a production order. The live configuration alone is conclusive. |
| Remediation | Immediately: in Admin → Settings → Payments, switch off card / Apple Pay / STC Pay / Tabby, or set `ALLOW_SANDBOX_PAYMENTS=false` (online methods then disappear because no real gateway is configured) and keep only cash on delivery. Then configure Moyasar/Tabby in test mode on a **staging** deployment (H-08). Audit existing orders: search order history for "TEST payment (sandbox gateway)". |
| Verification | `GET /api/checkout/options` shows `sandbox: false` and `gateway` ≠ `sandbox`. `GET /api/payments/sandbox/sbx_AAAAAAAA` returns 404. |

---

## HIGH

### H-01 — CSRF guard rejects every payment webhook
| | |
|---|---|
| Category | Payment reliability / backend bug |
| Location | `server/src/middleware/security.ts:16`; mounted at `server/src/app.ts:145` |
| Root cause | `csrfGuard` is mounted with `app.use('/api', …)`. Inside a mounted middleware Express strips the mount path, so `req.path` is `/webhooks/moyasar`, not `/api/webhooks/moyasar`. The exemption `req.path.startsWith('/api/webhooks/')` therefore **never matches**, and every webhook without the custom `X-Requested-With: celibery` header is refused with 403. Gateways never send that header. |
| Evidence (REPRO) | A standalone Express script with the same mount reports `pathSeenByApiMiddleware: "/webhooks/moyasar"`, `exemptionMatches: false`. |
| Evidence (LIVE) | `POST /api/webhooks/moyasar` with an empty JSON body returns `{"code":"FORBIDDEN","message":"Missing or invalid request header"}`. That is the CSRF guard's message, not the handler's "Invalid webhook signature". The request was rejected before any handler ran and nothing was written. |
| Why tests pass | `server/tests/helpers.ts:32` adds `X-Requested-With: celibery` to **every** test request, including the webhook tests in `payments.test.ts`, `phase6.test.ts` and `upgrade.test.ts`. |
| Impact | With a real gateway: (a) orders confirm only when the customer returns to `/checkout/return` or when the reservation-expiry job re-verifies (`order.service.ts:640`), up to ~35 minutes later. (b) A payment that succeeds *after* that job has cancelled the order is never re-checked, so the "paid after cancellation → refund or restore" alert in `payment.service.ts` is unreachable. (c) The gateway dashboard will show failing webhooks and may disable them. Tabby authorisations are captured only on return or expiry. |
| Remediation | Test the full path (`req.baseUrl + req.path` or `req.originalUrl`), or register the webhook routes before `csrfGuard`. Add a regression test that posts to both webhooks **without** the header. Smallest change: one line plus one test. |
| Verification | Live `POST /api/webhooks/moyasar` with `{}` returns `Invalid webhook signature` (403 from the handler). Then run a Moyasar test-mode webhook delivery end to end. |

### H-02 — Gateway callback URL points at the storefront host, which returns 500
| | |
|---|---|
| Category | Payment reliability / deployment |
| Location | `server/src/integrations/payments/moyasar.ts:76` (`callback_url: ${PUBLIC_SITE_URL}/api/webhooks/moyasar`); return URLs `payment.service.ts:69` |
| Evidence (LIVE) | The live sitemap's `<loc>` values use `https://celiberyclient-production.up.railway.app`, so `PUBLIC_SITE_URL` is the **storefront** service. `POST https://celiberyclient-production.up.railway.app/api/webhooks/moyasar` returns **HTTP 500**: `vite preview` does not forward `/api/*` (only the SEO files, `client/vite.config.ts` `seoForwardPlugin`). |
| Impact | Even after H-01 is fixed, Moyasar would deliver webhooks to a host that cannot handle them. The Tabby webhook URL is registered manually, so it depends on what was configured. |
| Remediation | Fix the topology (H-03): one origin. Failing that, build the webhook URL from a dedicated `PUBLIC_API_URL`. |
| Verification | `POST <PUBLIC_SITE_URL>/api/webhooks/moyasar` with `{}` returns the API's 403 "Invalid webhook signature". |

### H-03 — Cross-site two-service topology, and `vite preview` as the production web server
| | |
|---|---|
| Category | Infrastructure / authentication availability |
| Location | `client/vite.config.ts:147` (`preview.allowedHosts`), `server/src/config/env.ts:250` (`cookieSameSite()` → `none` in production) |
| Evidence (LIVE) | The storefront page CSP has `connect-src 'self' https://celiberyserver-production.up.railway.app`, so the browser calls the API cross-origin with credentials. `up.railway.app` is on the Public Suffix List, so the two hosts are **different sites** and the session cookie is a third-party cookie (`SameSite=None; Secure`). |
| Evidence (CODE/DOC) | `docs/DEPLOYMENT.md` ("Two separate services … browsers that block third-party cookies (Safari, and Chrome with tracking protection) can refuse — customer and admin sign-in then fails"; "`vite preview` … is a local preview tool, not a production web server"). |
| Not verified | I did not sign in from a real Safari or iOS device. The failure mode is documented browser behaviour, so treat it as highly likely. |
| Impact | Customer sign-in, account pages, order history and admin access may break for Safari/iOS users, and for Chrome users who enable third-party cookie blocking. Guest checkout keeps working (it uses an access token, not a cookie). `vite preview` adds: a single unhardened Node process, 200 for unknown URLs for people (soft 404s), 500 on unsupported methods, and no request logging. |
| Remediation | Preferred: one Railway service with `SERVE_CLIENT=1`, `COOKIE_SAMESITE=lax`, `VITE_API_BASE_URL` empty (documented in `docs/DEPLOYMENT.md`). Alternatively, a custom domain with `www.`/`api.` subdomains of one registrable domain, or the existing `vercel.json` deployment. |
| Verification | Sign in on Safari (macOS and iOS) and Chrome with third-party cookies blocked. The response cookie carries `SameSite=Lax`, and `/api/auth/me` returns the user after a reload. |

### H-04 — Staff two-factor authentication not enforced (production value unknown)
| | |
|---|---|
| Category | Admin security |
| Location | `server/src/config/env.ts:70`, `:169` (off unless `STAFF_MFA_REQUIRED=true`); `assertProductionConfig` only warns |
| Evidence | CODE. The production setting cannot be read without staff access or the Railway dashboard. A code comment states it is intentionally off during owner/client testing. |
| Impact | A phished or reused staff password gives full admin access, which includes refunds (M-01), customer personal data and content. Payment credentials and staff changes still require step-up re-authentication. |
| Remediation | Set `STAFF_MFA_REQUIRED=true` and confirm `CREDENTIALS_ENCRYPTION_KEY` is set. Every staff member enrols before handover. |
| Verification | A staff account without 2FA receives `403 MFA_ENROLLMENT_REQUIRED` on `/api/admin/*`. |

### H-05 — Legal identity blank and policies in draft on an indexable, transacting store
| | |
|---|---|
| Category | Customer trust / compliance |
| Evidence (LIVE) | `/api/settings/public` → `business.crNumber: ""`, `vatNumber: ""`, `email: ""`, `phone: ""`, `sbcVerified: false`. `/api/pages/{privacy,terms,shipping,returns,warranty}`: every body begins "مسودة — بانتظار مراجعة واعتماد المستشار" (Draft — awaiting counsel review and approval). `robots.txt` allows indexing, and the sitemap is live with real products. |
| Impact | Customers cannot identify the legal seller. Policies are not approved. Saudi e-commerce rules generally expect seller identity and policies to be disclosed; **confirm the exact obligations with the client's counsel** (this audit does not give legal advice). The project's own `docs/PENDING-CLIENT-INFO.md` lists these as outstanding. |
| Remediation | Client supplies the CR, VAT, address and contact details, approves the policies in Admin, and completes the SBC verification. Until then, consider `noindex` or a pre-launch gate. |
| Verification | `/api/settings/public` returns non-empty values, and the policy pages have no draft banner. |

### H-06 — Database backups and restore not verified
| | |
|---|---|
| Category | Backup and recovery |
| Evidence | ABSENT. Backup policy is Atlas project configuration, and there was no Atlas access. The earlier `BACKUP_RECOVERY_REPORT.md` (13 Nov) states production backups were not verified and that only a local synthetic restore drill with `scripts/verify-restore.mjs` was done. |
| Impact | Unknown recovery point and recovery time for orders, payments and customers. The Atlas tier is unknown (shared tiers have limited backup). |
| Remediation | See [12_BACKUP_AND_RECOVERY_ASSESSMENT.md](12_BACKUP_AND_RECOVERY_ASSESSMENT.md): enable Cloud Backup and PITR, restore into a separate cluster, run `scripts/verify-restore.mjs verify`, and record the RPO/RTO. |
| Verification | A dated restore-drill record showing `RESTORE VERIFIED`. |

### H-07 — Developer `.env` connects to a remote Atlas cluster with credentials
| | |
|---|---|
| Category | Environment separation / data safety |
| Evidence (CODE) | The repository-root `.env` (git-ignored, not committed) contains a single variable: a `mongodb+srv://` URI with embedded credentials pointing at `*.mongodb.net`, and no database path, so `MONGODB_DB_NAME` defaults to `celibery`. The audit did **not** connect to it and cannot tell whether it is production. |
| Impact if it is production | `npm run dev` connects as `NODE_ENV=development` and starts the in-process scheduler (`server/src/jobs.ts`). That expires orders, retries order emails and sends back-in-stock emails against live data. `npm run seed:demo` would insert sample products into the live catalogue, and `repair:text` / `migrate` would run against production. The developer machine also holds production credentials. |
| Note | The automated test suites are **not** affected: server tests and E2E both start an in-memory replica set (`server/tests/global-setup.ts`, `e2e/server.ts`). |
| Remediation | Confirm which cluster it is. Use a local Docker replica set (README) or a separate development cluster. Rotate the database user's password if it is production. Restrict Atlas network access. |
| Verification | The developer `.env` URI points at localhost or a non-production cluster. Atlas shows separate users per environment. |

### H-08 — Real payment gateways never exercised
| | |
|---|---|
| Category | Payment safety |
| Evidence | CODE. `moyasar.ts` and `tabby.ts` state "NOT verified against a live or test account because no credentials were supplied". LIVE: production uses the sandbox (C-01). |
| Impact | Field mapping (status names, amount units, invoice vs payment ids, Tabby capture/close) is unproven. The amount/currency reconciliation logic is sound, but depends on correct mapping. |
| Remediation | Run the matrix in [07](07_PAYMENT_AND_ORDER_AUDIT.md) §6 with Moyasar and Tabby **test keys** on staging. |
| Verification | A recorded test-mode run of success, failure, cancel, duplicate webhook, late payment, partial and full refund. |

---

## MEDIUM

| ID | Finding | Location / evidence | Impact | Remediation |
|---|---|---|---|---|
| **M-01** | Refunds do not require step-up re-authentication | `server/src/modules/admin/orders.routes.ts:98` uses only `requirePermission('orders:refund')`; payment credentials and staff changes use `requireRecentAuthForWrites` | A stolen or unattended admin session can move money back out | Add `requireRecentAuth` to `/:id/refund` (the admin UI already handles `REAUTH_REQUIRED`) |
| **M-02** | Monitoring and alerting not configured or not verified | LIVE: storefront CSP `connect-src` has no Sentry origin, so `VITE_SENTRY_DSN` was empty at build and **browser errors are not reported**. Server `SENTRY_DSN`, uptime checks and alert routing: ABSENT | Payment failures, 500s and outages go unnoticed | Follow `docs/MONITORING.md`: Sentry (server + browser), an uptime monitor on `/api/health`, alert email/WhatsApp |
| **M-03** | Slow public API from the audit vantage point | LIVE, 8 sequential requests each: `/api/home` 1.17–7.97 s (median ≈ 2.3 s); `/api/products?limit=24` 1.16–6.40 s; `/api/categories` 0.60–1.18 s; `/api/settings/public` 0.63–3.19 s | Slow first page and checkout feel. Small sample from an unknown region, so **indicative only** | Confirm the Railway and Atlas regions (I-03). Move closer to KSA, add a CDN, measure from KSA with a proper tool |
| **M-04** | Webhook tests cannot detect auth-header regressions | `server/tests/helpers.ts:32` | Hid H-01 | Use a bare `supertest(app)` (no default headers) for all webhook/cron tests |
| **M-05** | Production topology differs from the tested one | E2E and docs describe single-origin / Vercel. Production is two Railway services | Cross-site cookie and `vite preview` behaviour are untested | Make staging identical to production, or move production to the tested topology |
| **M-06** | Account lockout can be triggered by anyone who knows an email | `server/src/modules/auth/auth.service.ts:14-15`, `:49` (5 failures → 15-min lock, for staff too) | Targeted denial of sign-in for admins during operations | Keep the per-IP limits, and lock by IP+account or add a CAPTCHA after N failures instead of a full account lock. Alert on `auth.account_locked` for staff |

## LOW

| ID | Finding | Location | Remediation |
|---|---|---|---|
| **L-01** | Unknown URLs return 200 to people (soft 404) on the `vite preview` storefront. Crawlers get a correct 404 | LIVE `GET /en/nonexistent-page-xyz` → 200; same path with a Googlebot UA → 404 | Resolved by H-03 (Express `SERVE_CLIENT` / Vercel) |
| **L-02** | Registration reveals whether an email is registered | `auth.service.ts:22` (409 `EMAIL_IN_USE`) | Accepted UX trade-off; rate-limited (20/15 min/IP). Optionally a generic message plus an email |
| **L-03** | Cart quote accepts any email, so it can probe "first order" / per-customer code usage for a third party | `order.controller.ts:39` | Ignore `body.email` for eligibility unless it is the signed-in user; re-check at checkout (already done) |
| **L-04** | Failed-login counter is read-modify-write (not atomic) | `auth.service.ts:49` | Use `$inc` with a conditional lock. Capped anyway by the per-account limiter (10/15 min) |
| **L-05** | Guest order access tokens travel in URL query strings and are kept in `localStorage` (`cel_orders`) | `payment.service.ts:69`; `client/src/pages/Checkout.tsx:41` | Acceptable with the strict CSP. Optionally exchange the token for a short-lived cookie on first visit |
| **L-06** | `mfa/disable` accepts a TOTP code without consuming its time step (replay within ~30 s) | `auth.service.ts:289` | Reuse `consumeSecondFactor` |
| **L-07** | Visitor IPs are sent to a third party (`api.country.is`) for currency display when no geo header exists | `server/src/modules/currency/geo.ts:52` | Disclose in the privacy policy, or use a CDN geo header (`GEO_COUNTRY_HEADER`) |
| **L-09** | E2E suite is order-dependent: 2 desktop admin specs failed in the full run and passed in isolation | `e2e/bulk-actions.spec.ts:82` cleanup timeout; `e2e/flagship.spec.ts:84` leftover row | Isolate fixtures per spec, reset data between specs, bound the cleanup time |
| **L-08** | 5 React hook dependency warnings | `client/src/admin/pages/HomeVideos.tsx:98`, `client/src/storefront/HomeVideos.tsx:46`, `client/src/three-d/CampaignPlayback.tsx:55,119`, `client/src/three-d/InteractiveProductGallery.tsx:230` | Memoise or add dependencies; check for stale-closure bugs |

## INFORMATIONAL

| ID | Observation |
|---|---|
| **I-01** | Order numbers are sequential (`CEL-1000xx`) and reveal order volume. Tracking needs the order number plus phone/email (limited view) or the secret token (full view). It is rate-limited. |
| **I-02** | `vercel.json` (crons, headers, rewrites, serverless API) is well built but is not the active production deployment. Keep one deployment path to avoid drift. |
| **I-03** | Hosting and data regions (`APP_REGION`, `DATABASE_REGION`, `MEDIA_REGION`) are not visible publicly. The data-residency decision (Q33) is listed as pending. |
| **I-04** | A local `.env.cloudinary` holds Cloudinary credentials. It is git-ignored, not referenced by the env schema, and was not committed. |
| **I-05** | A Mongoose warning that `collection` is a reserved schema path name appears in every test worker. It is harmless today; rename on the next schema change. |
| **I-06** | Thirteen earlier audit and report files sit at the repository root (Nov 11–13). Several statements in them (e.g. "Vercel" hosting) no longer match production. Consolidate them to avoid misleading future readers. |
