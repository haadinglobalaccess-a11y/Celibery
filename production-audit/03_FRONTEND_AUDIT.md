# 03 — Frontend Audit (React)

## 1. Build and stability

| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` (server, client, api) | **PASS**, exit 0 |
| Lint | `npx eslint .` | **PASS**: 0 errors, 5 `react-hooks/exhaustive-deps` warnings (L-08) |
| Production build | `npm run build` | **PASS**: 155 modules, built in 4.1 s |
| E2E (Playwright, in-memory DB) | `npx playwright test -c e2e/playwright.config.ts` | See [11_QA_AND_TEST_RESULTS.md](11_QA_AND_TEST_RESULTS.md) |

**Error handling.** `client/src/components/ErrorBoundary.tsx` wraps the app. It reloads once after a chunk-load failure, guarded by a `sessionStorage` flag, and then shows a fallback. `client/src/lib/errorReporting.ts` reports to Sentry when `VITE_SENTRY_DSN` is set. **It is not set in the live build** (M-02).

**API client** (`client/src/lib/api.ts`): one `fetch` wrapper with `credentials: 'include'`. It sends `X-Requested-With: celibery` on every state-changing call, and gives typed error codes that are localised in `apiErrors.ts`.

**Duplicate submissions.** Checkout keeps its idempotency key in `sessionStorage` (`cel_checkout_key`, `Checkout.tsx:126`), so a refresh or double-click replays the same order rather than creating a second one. The server enforces this through the unique `idempotencyKey` index.

## 2. Routing (`client/src/App.tsx`)
- `/` and `/faq` redirect to the preferred language. Legacy `/products/:handle` and `/collections/:handle` redirect.
- `/:lang/*`: shop, category, collection, bundles, search, product, cart, checkout, checkout/return, sandbox-pay, track, wishlist, login, register, forgot/reset password, policy pages, FAQ, blog, account (lazy-loaded).
- `/admin/*`: a separately lazy-loaded bundle (`AdminApp`, 107 KB gzip). Access control is **server-side**: every `/api/admin/*` route needs a staff session plus a permission (verified in [06](06_AUTHENTICATION_AUTHORIZATION_AUDIT.md)).
- Unknown routes render `NotFound`. On the current `vite preview` host the HTTP status is still 200 (L-01). Crawlers get a real 404 from the prerenderer.
- Deep links and refresh work on Vercel (`vercel.json` SPA rewrite), Express (`app.get('*')`) and `vite preview` (SPA fallback).

## 3. Customer journey
The full journey (browse → product → cart → quantity → remove → coupon → checkout → sandbox payment → confirmation → account → history → detail) is covered by the Playwright specs `shop-flow`, `journeys`, `commerce`, `coupon`, `product-journey`, `order-tracking` and `abandoned-checkout` against an **in-memory** database. It was **not** performed on production, because that would create real orders (and, given C-01, "paid" ones).

## 4. Responsive design
Playwright projects run `desktop` (1366×900), `mobile` (Pixel 7) and `tablet` (820×1180) for the responsive, encoding, header and full-audit specs. I did not do a manual visual review on physical devices. **Status: covered by automation; manual device check NOT VERIFIED.**

## 5. Performance (bundle facts from this build)

| Asset | Raw | Gzip |
|---|---|---|
| `index-*.js` (storefront) | 212.0 KB | 67.2 KB |
| `react-*.js` (vendor chunk) | 180.4 KB | 59.5 KB |
| `index-*.css` | 216.5 KB | **42.5 KB** |
| `AdminApp-*.js` (lazy) | 396.6 KB | 107.2 KB |
| Checkout chunk (lazy) | 17.8 KB | 6.4 KB |

- **Initial load ≈ 127 KB gzip JS + 42.5 KB gzip CSS.** That is reasonable for a React store. The CSS is large (18 style sheets, ~16 k lines) and worth pruning.
- Code splitting: admin, account, auth, checkout, orders, content, FAQ, blog and customer info are all `lazy()`.
- LIVE: hashed assets are served gzip-compressed with `Cache-Control: public, max-age=31536000, immutable`. `index.html` is `no-cache`. Preconnect hints go to the API and Cloudinary.
- **Core Web Vitals (FCP/LCP/INP/CLS/TBT): NOT MEASURED.** No Lighthouse or browser lab run was done in this audit. The API latency observed (M-03: `/api/home` median ≈ 2.3 s) will dominate LCP for first-time visitors.

## 6. Client-side security
- No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` in `client/src`. Markdown is rendered into React elements (`lib/markdown.tsx`).
- Strict CSP is injected at build time from the same source as the server (`server/src/lib/csp.ts`).
- Stored in `localStorage`: cart, discount code, wishlist ids, language, settings snapshot, currency, and **guest order tokens** (`cel_orders`, L-05). Session credentials are **not** stored. The session is an HttpOnly cookie.

## 7. Findings
- **H-03**: the storefront is served by `vite preview`, cross-site to the API.
- **M-02**: browser error reporting is off in production.
- **L-01**: soft 404 for people.
- **L-05**: guest tokens in `localStorage` and URLs.
- **L-08**: hook dependency warnings.
