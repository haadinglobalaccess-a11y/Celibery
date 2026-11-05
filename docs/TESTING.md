# Testing

## Backend integration tests (Vitest + Supertest + in-memory MongoDB replica set)

```bash
npm install
npm test            # = npm run test -w server
```

- `mongodb-memory-server` downloads a MongoDB binary on first run (needs internet access to `fastdl.mongodb.org`).
- Every test file gets a fresh database with the base seed and sample products; transactions are real (replica set).
- Suites: `auth`, `catalog`, `checkout`, `admin`, `payments` (see `server/tests`).

What they cover: registration/login/lockout/reset, password hashing, CSRF header, role permissions enforced on the backend, deactivated staff sessions, category-specific facets and filters, search (Arabic + English, regex-safe), sorting/pagination, public product data hiding exact stock, server-side cart quotes ignoring browser prices, checkout with stock reservation, idempotent replay, concurrent last-unit checkouts (no overselling), failed payment + retry, reservation expiry releasing stock exactly once, Tabby authorise-then-capture, discount eligibility and usage limits, COD disabled/enabled rules, guest tracking (full vs limited view), customers isolated from each other's orders, admin product CRUD with SAR→halalas, ledgered stock adjustments, archive-instead-of-delete, CSV import, fulfilment workflow and invalid transitions, cancellation restock, partial/full refunds with permission checks, CSV export, settings merge and validation, staff invitation without passwords, protected admin role, banners/campaigns, Moyasar/Tabby adapters against mocked HTTP, webhook secret checks, webhook replay protection and amount-mismatch review.

## End-to-end tests (Playwright)

```bash
npm run build -w client
npx playwright install chromium     # once, if Chromium is not installed
npm run test:e2e
```

`e2e/server.ts` starts an in-memory database, seeds sample data, creates a throwaway admin (random password written to `e2e/.artifacts/admin.json`) and serves the API + built storefront on `http://localhost:4173`.

- `shop-flow.spec.ts` — the required flow: Arabic homepage (RTL) → switch to English (LTR) on the same page → browse all six categories → search and filter → product → add to cart → update quantity → cart survives language switch → checkout → order created by the backend → sandbox gateway → server-verified payment → order visible in admin → status updated (processing, shipped with tracking) → customer sees the new status.
- `responsive.spec.ts` — desktop (1366px), tablet (820px) and phone (Pixel 7): no horizontal overflow on key pages in both directions, correct `dir`, no broken images, mobile menu, sticky add-to-cart, Western digits in Arabic.

Screenshots are saved to `e2e/.artifacts/screens/`.

## Type checks and builds

```bash
npm run typecheck   # server, client and the Vercel function
npm run build       # server (tsc) + client (tsc + vite)
```

## What is not covered by automated tests

- Live Moyasar / Tabby / SMTP / WhatsApp calls — require the client's test credentials (adapters are tested against mocked HTTP only).
- Real-device testing on iOS Safari and Android Chrome, screen-reader testing, and native Arabic copy review — to be done during client review.

## Verification log — 2 November 2026 (premium upgrade pass)

Dependencies could not be installed in that environment (npm registry blocked), so the suites above were **not run**. See `docs/COMPLETION-REPORT.md` §1 for exactly what was executed (esbuild bundles of client and server, Chromium rendering of the storefront against a mock of the public API, overflow and reduced-motion checks).

New test added: `server/tests/admin.test.ts` → *concurrent refunds can never exceed the order total*.

Animation checks to include when running Playwright locally: run once with `reducedMotion: 'reduce'` in the browser context — all `.reveal`, `.split__word` and `.fade-up` elements must have `opacity: 1` and `transform: none`.

## Verification log — 3 November 2026 (production-readiness upgrade)

npm registry still blocked (403 from the network policy), so the project toolchain was not installed. Executed:

```bash
# pure unit tests, via Node's test runner and a Vitest-compatible shim kept outside the project
NODE_PATH=<shim>:<tool cache> NODE_ENV=test node --import tsx/loader --test server/tests/unit/*.test.ts
# → 13 suites, 47 tests, 47 pass, 0 fail
```

Also: stub-based `tsc` for server and client (clean), esbuild bundles of client/server/api/vite config (succeed), Chromium render of the new admin screens against a mock API (0 errors, 0 overflow).

New tests:
- `server/tests/unit/` — CSP, log redaction, SigV4, credential rules, AES-GCM secrets, media sniffing/rules/URLs, refund lifecycle, webhook lifecycle, delivery/COD rules (`npm run test:unit`).
- `server/tests/upgrade.test.ts` — refund idempotency and 6-way concurrency (order/payment/ledger agree), definitive refusal, timeout → reconciliation, gateway success + DB failure → completed by reconciliation, manual resolution permissions; webhook invalid signature writes nothing, failed attempt retried then deduplicated; settings permission split; COD city/min, free-delivery threshold, delivery pause; credentials masked/never returned/encrypted at rest; live key in test slot refused; live mode needs verification + typed LIVE; media upload with content check, fake file refused, URL rules, in-use delete refused, media permission; plain-URL product images unchanged; policy approval permission and revisions. **Written but not executed** — run `npm test`.
