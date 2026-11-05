# Premium production-readiness upgrade — implementation report

Date: 3 November 2026 · Base: `celibery-premium-upgrade-2026-11-02.zip` · Requirements: client Q1–Q39 document, independent audit of 3 Nov 2026, and the "Master implementation & premium production-readiness" brief.

This was an enhancement of the existing React/Vite + Express + MongoDB project. No framework, page, API, model, payment integration or design was removed or replaced. Read `docs/PROGRESS-REPORT-2026-11-03.md` for how this session resumed an interrupted one.

## 1. Where things stand (read first)

| Layer | Status |
|---|---|
| **Code complete** | All development items of the brief are implemented (§3). |
| **Configuration complete** | No. Production needs `CREDENTIALS_ENCRYPTION_KEY`, S3-compatible media storage, `CRON_SECRET`, MongoDB Atlas, domain (§9). |
| **Client input pending** | Yes — 21 items (§8). Empty settings fields are not counted as done. |
| **External integration verified** | No. Moyasar, Tabby, I Mile, SMTP and WhatsApp were never called with real or sandbox merchant credentials (none supplied). |
| **Production deployment verified** | No. |
| **Tests** | 47/47 pure unit tests executed and passing. The integration and e2e suites (existing + new) could **not** run: the npm registry is blocked in this sandbox (§7). |

**Verdict: not production-ready until the real test suites pass on a normal machine and the §8–§9 items are done.**

## 2. Findings that were fixed

| Audit finding | Fix |
|---|---|
| HIGH — refund ledger race and rollback after gateway success | New refund ledger (`Refund` model + `refund.service.ts`): atomic reservation (`refunded + reserved + amount ≤ total`), idempotency key per refund, lifecycle requested → reserved → processing → succeeded / failed / reconciliation_required. Totals grow only after gateway confirmation, with atomic `$inc` exactly once (guard arrays). Timeouts, network errors and 5xx keep the reservation and mark `reconciliation_required`; a DB failure after a gateway success is never rolled back. Reconciliation compares our ledger with the gateway's refunded total (cron every 30 min + "Check with gateway" button) and leaves ambiguous cases for a person ("Gateway shows it refunded / shows no refund", audited). |
| Webhook retry weakness | Event lifecycle (`webhook-lifecycle.ts` + `ProcessedEvent.status/attempts/lockedUntil`): claimed with a lease, marked processed only after success, failures answered non-2xx so the provider retries, concurrent duplicates get 409, invalid signatures rejected before any record is written, webhook secrets read from the encrypted store. |
| HIGH — no CSP | One policy source (`server/src/lib/csp.ts`) used by the Express server (header), the Vite build (meta tag in `index.html`) and `vercel.json` (frame-ancestors etc.). Strict separate policy for JSON API responses and for uploaded files. |
| MEDIUM — no lockfile | **Still open** — cannot be generated without registry access (§7). |
| MEDIUM — I Mile manual only | Kept manual and labelled honestly; API mode shown as unavailable; API credentials can be stored encrypted for a future, tested integration. |
| LOW — no lint | Still open (would add dependencies). |

## 3. What was implemented, by brief section

**§3 Centralised admin settings (Admin → Settings, 10 sections).**
- *Payments* — per gateway (Moyasar, Tabby): publishable/public key, secret key, webhook secret, merchant code; separate test and live sets; masked secrets with Replace/Remove; "Test connection" (read-only API call, no money moved); enabling requires credentials that passed the test (tied to the key's fingerprint); going live requires typing `LIVE`; changing the credentials of a gateway in use is re-verified first; audit log records which fields changed, never values. Legacy `MOYASAR_*`/`TABBY_*` env variables keep working until an admin saves credentials.
- *Shipping & I Mile* — free delivery, fee, free-from threshold, delivery pause with custom message, courier name, tracking-URL template, fulfilment mode (manual), I Mile API credentials (stored only).
- *Cash on delivery* — on/off, fee, min/max order, allowed cities. Enforced by the server quote and checkout.
- *Store & contact* — name, description, email, phone, WhatsApp, hours, address, social links, announcement bar (text, link, on/off).
- *Legal & business* — legal name, CR, VAT (format-checked), SBC verification + badge; requires `business:write`.
- *Brand* — accent colour, light/dark logos (upload or URL).
- *Warranty, VAT & stock*, *Notifications & reviews*, *SEO*.
- *Hosting & data* — read-only regions from server configuration; no fake "move data" switch.

**§4 Media: upload AND URL everywhere.** One `MediaField`/`MediaPicker` (Library · Upload from computer · Use a URL) on: product gallery (multiple, main photo, drag/arrow reorder, replace, remove, alt text, preview), homepage hero (desktop + mobile video and poster, headline, CTA label/destination, on/off, preview links), banners (desktop/mobile image per language, video, mobile video, poster), campaigns (image, mobile image, video), categories, brand logos, SBC badge, brand-story image. Media library page with search, filters, preview, file info, usage list and safe delete (refused while used; warns about past orders). Uploads: type/size limits, magic-byte content check, random storage keys, browser-generated WebP variants (480/960/1600) served through `srcset`, video posters; S3-compatible storage with pre-signed direct uploads or local disk; never MongoDB; abandoned uploads cleaned by cron. External URLs: https only; videos must be .mp4/.webm, YouTube (privacy-enhanced embed) or Vimeo. Existing URL-only images unchanged.

**§5 Dashboard & RBAC.** Roles: Super Administrator (key `admin`, unchanged so existing logins keep access), Administrator (everything except payment credentials and staff), Content Manager, Product Manager, Order Manager, Online Sales Executive. New permissions `payments:manage`, `business:write`, `media:write`, all enforced on the API. Navigation and pages appear by permission; role editor shows plain-language labels.

**§6–7 Refunds and webhooks** — see §2. Admin order page shows the refund ledger with status, gateway reference, errors, re-check and manual resolution; the refund dialog sends one idempotency key per dialog so double clicks cannot refund twice.

**§8 Security** — CSP; HSTS, Referrer-Policy, Permissions-Policy, nosniff, frame denial; uploaded files served sandboxed with `nosniff`; secret redaction on every log line (keys, tokens, JWTs, cookies, signed URLs, ciphertexts); secrets encrypted with AES-256-GCM bound to provider/mode/field, key outside DB/repo, rotation supported; secrets never returned by any API (tests assert it); no server-side fetching of admin-entered URLs (no SSRF surface); rate limits on credential tests and uploads.

**§10 Storefront** — hero/banner/campaign video and mobile media, configurable CTA, announcement bar, responsive product images, refund policy link, checkout shows delivery pause, COD unavailability reason and free-from threshold. Existing premium design and motion untouched.

**§11 Data** — additive, defaulted fields only; `npm run migrate` (§5).

## 4. Files changed and why

New (server): `lib/secrets.ts` (encryption), `lib/redact.ts` (log redaction), `lib/csp.ts`, `lib/media-{sniff,rules,url}.ts`, `integrations/credentials/*` (encrypted store), `integrations/payments/http.ts` (timeouts, definitive vs uncertain errors), `integrations/storage/*` (local/S3, SigV4), `models/{IntegrationCredential,MediaAsset,PageRevision,Refund}.ts`, `modules/admin/{integrations.routes,media.routes,media.service}.ts`, `modules/payments/{refund-state,refund.service,webhook-lifecycle}.ts`, `modules/orders/delivery-rules.ts`, `scripts/migrate.ts`; tests `tests/unit/*` (7 files) and `tests/upgrade.test.ts`.
New (client): `admin/media.tsx`, `admin/pages/Settings.tsx` (replaces the old settings page in `System.tsx`), `lib/media.tsx`.

Modified (server): `app.ts` (CSP, security headers, credentials middleware, `/media`, maintenance cron), `config/env.ts` (new variables), `integrations/payments/*` (credentials from the store, verification, refund idempotency + refunded totals), `lib/{logger,permissions}.ts`, `middleware/{auth,security}.ts`, `models/{Order,Payment,Settings,Content,common,index}.ts` (additive fields), `modules/admin/{index,orders.routes,system.routes,content.routes,admin.schemas}.ts`, `modules/orders/{order.service,order.controller,order.schemas}.ts` (delivery/COD rules), `modules/payments/{payment.routes,payment.service}.ts`, `modules/catalog/catalog.service.ts` (public hero/announcement fields), `seed/base-data.ts` (refund policy draft), `scripts/create-staff.ts`.
Modified (client): `admin/{AdminApp,kit,admin.css}`, `admin/pages/{Products,Content,Catalog,Orders,System}.tsx`, `components/{Header,Footer,ProductCard}.tsx`, `pages/{Home,ProductPage,Checkout}.tsx`, `lib/{api,types}.ts`, `state/useQuote.ts`, `i18n/strings.ts`, `styles/premium.css`, `vite.config.ts`.
Modified (root): `.env.example`, `.gitignore`, `package.json`, `server/package.json`, `vercel.json`, docs.

## 5. Database migration

All schema changes are additive with defaults; old documents keep working without migration. Run once after deploying (safe to repeat):

```bash
npm run migrate -- --dry-run   # report only
npm run migrate                # apply
```

It adds the new roles/permissions (never removes any), creates the draft Refund Policy page if missing, sets `refundReservedAmount: 0` on old orders, records refunds made before the ledger as legacy ledger entries, and marks old webhook records processed. After rotating `CREDENTIALS_ENCRYPTION_KEY`: `npm run migrate -- --reencrypt`. Take an Atlas backup first. No data is deleted or reset.

## 6. New environment variables

See `.env.example`: `CREDENTIALS_ENCRYPTION_KEY` (+ `_PREVIOUS`), `MEDIA_STORAGE`, `MEDIA_LOCAL_DIR`, `ALLOW_LOCAL_MEDIA_STORAGE`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `MEDIA_PUBLIC_BASE_URL`, `MEDIA_MAX_IMAGE_MB`, `MEDIA_MAX_VIDEO_MB`, `APP_REGION`, `DATABASE_REGION`, `MEDIA_REGION`, `CSP_CONNECT_SRC`, `CSP_REPORT_URI`. New cron: `/api/cron/maintenance` (in `vercel.json`).

## 7. Tests — exact commands and actual results

Environment: Node 22, no project dependencies (npm registry refused by the network proxy: `403 Forbidden - GET https://registry.npmjs.org/@playwright%2ftest`).

| Command | Result |
|---|---|
| `npm install` | **Failed** — registry blocked. No lockfile generated. |
| Unit tests: `NODE_PATH=<vitest shim>:<tool cache> node --import tsx/loader --test server/tests/unit/*.test.ts` | **PASS — 13 suites, 47 tests, 0 failures** |
| Server type-check against loose stubs (`tsc`, TS 6) | No errors except pre-existing ones caused by the stubs themselves |
| Client type-check against loose React/router stubs | **0 errors** |
| esbuild bundle: `client/src/main.tsx`, `server/src/server.ts`, `api/index.ts`, `client/vite.config.ts` | **Succeed** |
| Chromium render of admin Settings (payments, shipping, COD, legal, hosting), Media library, media picker at 1440 px and 390 px against a mock API | **0 console errors, 0 horizontal overflow** (found and fixed: tab row clipped on desktop; dropzone copy) |
| `npm test` (Vitest: auth, catalog, checkout, admin, payments, **upgrade**) | **Not executed** — needs Vitest + MongoDB binary |
| `npm run test:e2e` (Playwright) | **Not executed** |
| `npm run typecheck`, `npm run build`, `npm audit` | **Not executed** |
| Live/sandbox Moyasar, Tabby, I Mile, SMTP, WhatsApp | **Not executed** — no credentials |

First thing on a machine with npm access:

```bash
npm install && git add package-lock.json
npm run typecheck && npm test && npm run build && npx playwright install chromium && npm run test:e2e && npm audit
```

`tests/upgrade.test.ts` was written without being run; expect to fix small test-side issues on first execution.

## 8. Client input still required

Accent colour (Q2) · logo (Q9) · font approval (Q8) · hero video or approval to produce one (Q7) · native Arabic review (Q12) · category names & filters (Q13, Q18) · ~90 products, prices, specs, stock (Q14) · 2 photos per product + lifestyle photos (Q15) · series names (Q16) · Moyasar merchant access and test/live keys, Apple Pay domain verification, STC Pay activation (Q20–21) · Tabby keys + merchant code (Q22) · COD go-ahead, fee, limits, cities (Q23) · I Mile tracking URL, and API docs if automation is wanted (Q24) · staff work emails (Q27) · SMTP + WhatsApp Business credentials and template (Q28) · CR, VAT, legal name, address (Q29) · SBC verification proof (Q30) · legal approval of all six policies (Q31) · data-residency decision (Q33) · contact details and social links (Q34) · Shopify export + DNS (Q35) · analytics accounts if any (Q36) · launch date (Q38).

## 9. Production deployment checklist

1. `npm install`, commit `package-lock.json`, run every check in §7 and fix failures.
2. MongoDB Atlas replica set in the approved region (Q33); enable backups; set `DATABASE_REGION`.
3. Vercel env: `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET` (≥32 chars), `CREDENTIALS_ENCRYPTION_KEY`, `CRON_SECRET`, `PUBLIC_SITE_URL`, `CORS_ORIGINS`, `PAYMENT_GATEWAY=moyasar` (or keep sandbox only on private staging with `ALLOW_SANDBOX_PAYMENTS=true`).
4. Media: create an S3-compatible bucket with public read for objects, CORS allowing `PUT` from the store origin, and a CDN/public URL; set `MEDIA_STORAGE=s3` + `S3_*` + `MEDIA_PUBLIC_BASE_URL` before building (the build writes the bucket origin into the CSP).
5. `npm run migrate`; `npm run create-staff -- --role admin …` for Usama M. Usman.
6. Admin → Settings → Payments: enter Moyasar/Tabby test keys → Test connection → enable in test → register webhooks (`/api/webhooks/moyasar`, `/api/webhooks/tabby`) → full test purchase + refund + webhook replay → live keys → Test connection → type LIVE.
7. Domain + HTTPS; check response headers (CSP, HSTS) and browse every page with the console open for CSP violations.
8. Error monitoring/log drain on Vercel; check `/api/health`.
9. Client sign-off on content, legal text and design.
