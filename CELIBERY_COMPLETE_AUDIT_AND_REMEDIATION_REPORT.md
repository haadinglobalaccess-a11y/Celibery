# CELIBERY International — Complete Audit & Remediation Report

**Date:** 10 November 2026
**Scope:** whole repository (storefront, Admin Dashboard, API, database models, integrations, jobs, tests, deployment config), plus a read-only check of the live Railway deployment.
**Method:** every claim below is backed by an automated test that was run in this pass, or by a read-only request to the live site. Nothing is marked PASS on code reading alone.
**Change control:** nothing was committed, pushed or deployed. No database was reset, and no live data was written. Uncommitted work already in the tree (the order-notification system from the previous task) was kept.

---

## A. Executive summary

**Overall condition:** the software is functionally complete for the client's requirements and works end to end in the browser, from storefront through API and database to the Admin Dashboard.

- A crawl of every internal storefront link (85 pages, Arabic and English, desktop and mobile) and every Admin page found **no** broken links, console errors, failed API calls or broken images.
- All seven required journeys (A–G) pass through the real UI.
- This pass found 4 real defects (Admin pages that spun forever when the server failed, and an address that was deleted without confirmation). All are fixed and covered by tests.

What stands between the site and a public launch is **not code**. It is **client input, provider credentials and legal approval**, plus one dangerous live setting:

> ⚠️ **P0 launch blocker (configuration):** the live server runs the **sandbox payment gateway** (`gateway: "sandbox"`, `sandbox: true` in `/api/settings/public`). On the sandbox payment page anyone can mark an order as paid without paying. Do not open the site to the public until a real gateway (Moyasar/Tabby) is configured, or until card/Apple Pay/STC Pay/Tabby are switched off in Admin → Settings → Payments (leaving cash on delivery).

**Source of truth.** The original client document, *CELIBERY International — Website Questions and KSA Recommendations* (Q1–Q39 and the accepted recommendations), is **not in the repository**. Its contents are transcribed in `docs/REQUIREMENTS-CHECKLIST.md` and `docs/PENDING-CLIENT-INFO.md`, and this audit uses that transcription. The later client briefs given during development are added as R1–R8.

| Status | Q1–Q39 | R1–R8 (later briefs) | Total |
|---|---|---|---|
| PASS | 15 | 7 | **22** |
| PARTIAL | 6 | 1 | **7** |
| FAIL | 0 | 0 | **0** |
| MISSING | 0 | 0 | **0** |
| BLOCKED (input, credentials or provider needed) | 12 | 0 | **12** |
| CLIENT CLARIFICATION (approval or decision) | 6 | 0 | **6** |
| **Total requirements** | 39 | 8 | **47** |

**Final assessment: READY WITH LIMITATIONS** for a controlled or private launch, once the sandbox gateway is replaced or switched off. It is **NOT READY for a public launch** until the client items in §I are supplied: payment credentials, CR/VAT numbers, approved policies, logo and Arabic product content. See §K.

---

## B. Client requirements matrix

Evidence key:
- **[S]** server test (`server/tests/…`)
- **[E]** browser test (`e2e/…`)
- **[L]** read-only check of the live site on 2026-11-10

All tests listed were executed in this pass.

### Q1–Q39 (client questionnaire)

| ID | Requirement | Expected behaviour | FE | BE | DB | Admin | Evidence | Result |
|---|---|---|---|---|---|---|---|---|
| Q1 | Hybrid theme: light shopping pages, dark premium sections | Light catalogue/cart/checkout, dark hero/editorial/footer | ✔ | — | — | Brand settings | [E] full-audit crawl (85 pages, 0 errors), responsive.spec | PASS |
| Q2 | Near-black + white with ONE brand accent | Accent set by client | ✔ token | ✔ | ✔ | Settings → Brand | [L] accent is still placeholder `#2563EB` | BLOCKED — accent colour |
| Q3 | Keep list (dark hero, service strip, use-case tabs, wishlist, SAR prices with discounts, mega menu, series, lifestyle banners) | All present | ✔ | ✔ | ✔ | Content → Banners | [E] shop-flow, journeys (wishlist), full-audit; [L] 0 lifestyle banners uploaded (content) | PASS |
| Q4 | Feel: premium, Saudi, trustworthy | Subjective | ✔ | — | — | — | Design unchanged; needs sign-off | CLIENT CLARIFICATION |
| Q5 | Mega menu | Categories + products in the menu | ✔ | ✔ | — | Categories | [E] shop-flow 3, full-audit (all 6 categories reached from links) | PASS |
| Q6 | Balanced animation, site stays fast | Smooth motion, reduced-motion respected, fast | ✔ | — | — | — | [E] scroll-replay, why-standard, header-icons, responsive. Bundle: storefront JS ≈380 kB (≈120 kB gzip), Admin lazy-loaded. **No Lighthouse/real-device run** | PARTIAL — performance not measured on real devices |
| Q7 | One hero video | Uploadable/linked video with fallbacks | ✔ | ✔ | ✔ | Content → Homepage | [E] journeys E (Admin → storefront), hero specs; [L] hero video is set | PASS |
| Q8 | Proposed font pair | IBM Plex Sans Arabic + Plus Jakarta Sans | ✔ | — | — | — | Loaded on the storefront | CLIENT CLARIFICATION — approval of the pair |
| Q9 | Logo recreated as vector | Client logo in header/footer | ✔ `<Logo>` | ✔ | ✔ | Settings → Brand | [L] no logo uploaded | BLOCKED — logo file |
| Q10 | Arabic default, English one tap away | `/` → `/ar`; switch keeps page/cart | ✔ | — | — | — | [E] shop-flow 1–2, 5–7 | PASS |
| Q11 | Western digits on the Arabic site | `ar-SA-u-nu-latn` | ✔ | ✔ | — | — | [E] responsive "Arabic numbers use Western digits" | PASS |
| Q12 | Native Saudi Arabic copy | Approved Arabic text | ✔ drafts | ✔ | ✔ | All content fields | [L] **all 90 live products have no Arabic short or full description** (the Arabic site falls back to English text); interface Arabic still a draft | BLOCKED — native review + Arabic product text |
| Q13 | Category names (research, keep if matching) | 6 categories | ✔ | ✔ | ✔ | Categories | [S] audit-admin-crud (create/rename/hide/delete); [E] shop-flow 3 | CLIENT CLARIFICATION — written approval |
| Q14 | ~90 products from the client | All products live | ✔ | ✔ | ✔ | Products, CSV import/export | [L] **90 real products live, 0 sample products**; [E] journeys C, product-journey; [S] admin (CSV import). Arabic text and specs missing (see Q12) | PARTIAL — content incomplete |
| Q15 | 2 photos per product + lifestyle, shot in KSA | 2+ images per product | ✔ gallery | ✔ | ✔ | Product → Images | [E] journeys C (upload → storefront); [L] **all 90 products have only 1 photo**, 0 lifestyle banners | PARTIAL — photos missing |
| Q16 | Series: "use ours for now" | Series shown and searchable | ✔ | ✔ | ✔ | Product → Series | [L] live products carry series "CELIBERY" | PASS |
| Q17 | Bundles as their own menu item | `/bundles` | ✔ | ✔ | ✔ | Collections | [E] full-audit (`/ar/bundles`, `/en/bundles`); [S] audit-admin-crud (collections) | PASS |
| Q18 | Per-category filters, created then approved | Category-specific facets | ✔ | ✔ | ✔ | Category → filters | [E] shop-flow 4; [S] catalog | CLIENT CLARIFICATION — approval (`docs/CATEGORY-FILTERS-FOR-APPROVAL.md`) |
| Q19 | Real, verified reviews only | Reviews only from delivered orders, moderated | ✔ | ✔ | ✔ | Content → Reviews | [E] production-readiness; [S] closure | PASS |
| Q20 | Apple Pay, mada, Visa/Mastercard, STC Pay | Live card payments | ✔ | ✔ adapter | ✔ | Settings → Payments | [S] payments (mocked gateway HTTP); [L] **live uses the sandbox gateway** | BLOCKED — gateway account + keys, Apple Pay domain |
| Q21 | Use the existing gateway | Adapter for the client's gateway | — | ✔ Moyasar | — | Settings → Payments | — | BLOCKED — which gateway + credentials |
| Q22 | Tabby | Tabby checkout | ✔ | ✔ adapter | ✔ | Settings → Payments | [S] payments, upgrade (webhook lifecycle) | BLOCKED — merchant code + keys |
| Q23 | Cash on delivery, delivery cost in price | COD with rules | ✔ | ✔ | ✔ | Settings → COD | [S] checkout, unit/delivery-rules; [L] COD enabled | PASS |
| Q24 | Courier: I Mile Logistics | Tracking numbers and links | ✔ | ✔ manual | ✔ | Settings → Shipping, Orders | [S] admin (fulfilment); [L] courier name set, **tracking-URL template empty**; no I Mile API documentation | PARTIAL — tracking URL format / API docs |
| Q25 | Free delivery | Free shipping, server-priced | ✔ | ✔ | ✔ | Settings → Shipping, zones | [S] checkout, closure (zones); [L] free delivery on | PASS |
| Q26 | Approved Admin modules | Every module works with server-side permissions | ✔ | ✔ | ✔ | All | [E] full-audit (every Admin page and Settings tab, desktop + mobile, 0 errors), journeys C/E, admin-controls, flagship, abandoned-checkout, order-notifications; [S] admin, audit-admin-crud, upgrade, admin-controls | PASS |
| Q27 | Staff: Shuja Mubeen, Usama M. Usman | Staff accounts | ✔ | ✔ | ✔ | Staff | [S] admin (invite) | BLOCKED — work email addresses (live accounts not checked) |
| Q28 | Email + WhatsApp order updates | Confirmation and status updates | ✔ | ✔ | ✔ | Settings → Notifications, order page | [S] order-notifications (14), q28, admin-controls; [E] order-notifications. Email works through any SMTP account set in Admin. WhatsApp without the API is **prepared click-to-chat, sent by staff**, never reported as delivered | BLOCKED — SMTP account; WhatsApp Business API for automatic sending |
| Q29 | CR + VAT numbers | Shown in the footer | ✔ | ✔ | ✔ | Settings → Legal | [L] both empty ("Coming soon") | BLOCKED — numbers |
| Q30 | Saudi Business Center verification | Badge when verified | ✔ | ✔ | ✔ | Settings → Legal | [L] not verified | BLOCKED — answer + badge URL |
| Q31 | Policies drafted, approved by the client's advisor | Approved policy pages | ✔ | ✔ revisions | ✔ | Content → Policy pages | [L] **all 6 policy pages are still `draft`** (with [bracketed] info needed) | BLOCKED — legal approval |
| Q32 | 2-year warranty claim | 24 months shown | ✔ | ✔ | ✔ | Settings → Warranty | [L] warranty 24 months | PASS |
| Q33 | Customer data outside KSA | Legal decision | — | — | — | Hosting (read-only) | — | CLIENT CLARIFICATION |
| Q34 | WhatsApp, hours, address, email, phone, socials | All shown | ✔ | ✔ | ✔ | Settings → Store | [L] WhatsApp, hours, Instagram, Snapchat set; **email, phone, address missing** | PARTIAL — remaining details |
| Q35 | Shopify + domain | Old URLs redirect; own domain | ✔ redirects | — | — | — | [E] full-audit; legacy redirect route; [L] still on `*.up.railway.app` | PARTIAL — domain/DNS |
| Q36 | Analytics/ad accounts: none yet | Connect later | — | — | — | — | — | BLOCKED — accounts |
| Q37 | Allow AI assistants | robots.txt + llms.txt | ✔ | ✔ | ✔ | Settings → SEO | [S] admin-controls; [E] admin-controls, closure; [L] allowed | PASS |
| Q38 | Launch date: recommend when ready | — | — | — | — | — | This report | CLIENT CLARIFICATION |
| Q39 | One approver (Usama M. Usman) | — | — | — | — | — | Recorded | PASS |

### R1–R8 (requirements from later client briefs)

| ID | Requirement | Evidence | Result |
|---|---|---|---|
| R1 | Independent Featured and Flagship controls in the status dropdown; Flagship shows only selected products, in Admin order | [E] flagship (3); [S] flagship; [L] 4 featured, 3 flagship live | PASS |
| R2 | Abandoned / incomplete checkout tracking (autosave, offline, resume, Admin page, privacy) | [S] checkout-drafts (10); [E] abandoned-checkout (4); [L] deployed (menu + `/api/checkout/draft` live) | PASS |
| R3 | Automated order confirmation email + WhatsApp (no API) | [S] order-notifications (14); [E] order-notifications (2) | PARTIAL — implemented and verified locally, **not committed or deployed** (needs your authorisation) |
| R4 | Repository-wide mojibake repair; no damage to Arabic | [S] encoding-guard, unit/text; [E] encoding | PASS |
| R5 | Scroll animations replay on every re-entry | [E] scroll-replay | PASS |
| R6 | Premium "The CELIBERY standard" animation, text unchanged | [E] why-standard | PASS |
| R7 | Premium header icons, sizes unchanged | [E] header-icons | PASS |
| R8 | Product descriptions, Add to Cart, zero dummy content | [E] product-journey; [S] production-readiness; [L] 0 sample products live | PASS |

---

## C. Frontend audit

| Area | Checked | Result | Fixes |
|---|---|---|---|
| Every internal link | Crawler followed every same-origin `<a>` from 18 entry pages: 85 unique pages (home, shop, 6 categories, 20 products, bundles, search, cart, checkout, track, wishlist, account, login/register/forgot, 6 policy pages), AR + EN, desktop (1366 px) and mobile (Pixel 7) | 0 pages landing on 404, 0 console errors, 0 uncaught errors, 0 API errors, 0 broken images | — |
| Header, mega menu, mobile menu, footer | shop-flow, responsive, header-icons, full-audit | Pass | — |
| Homepage sections, hero, Flagship/Featured | flagship, hero specs, why-standard, scroll-replay, journeys E | Pass | — |
| Product listing, filters, sorting, search | shop-flow 3–4 | Pass | — |
| Product page, gallery, reviews, SEO | product-journey, production-readiness | Pass | — |
| Cart, quantity, coupon, checkout, payment, confirmation | shop-flow 5–10, coupon, product-journey, abandoned-checkout | Pass | — |
| Registration, sign in (wrong password refused), sign out, profile, order history/detail | **journeys B (new)** | Pass | — |
| Saved addresses add/edit/delete, password change, newsletter | **journeys "customer forms" (new)** | Pass after fix | **Fixed:** deleting a saved address had no confirmation and failed silently |
| Wishlist, guest order tracking, returns | shop-flow, closure, crawl | Pass | — |
| Arabic RTL / English LTR, Western digits | shop-flow, responsive, encoding | Pass | — |
| Responsive (mobile, tablet), no horizontal overflow | responsive (desktop, mobile, tablet) | Pass | — |
| Loading / error / empty states | Code search for API calls without error handling | Storefront: all handled | Admin: 3 fixed (see §E) |
| Dead buttons / `href="#"` / empty handlers / TODOs / console logging | Repository search | None found | — |
| Contact form | No contact page or form exists. The questionnaire (Q34) asks only for contact *details*, which are configurable and shown | — | CLIENT CLARIFICATION if a contact form is wanted |

## D. Backend audit

| Area | Result | Evidence |
|---|---|---|
| API validation (Zod on every body/query/param), consistent `{ok, data, error}` responses | Pass | Every server test file; 400 on invalid input verified in audit-admin-crud, order-notifications, discounts |
| Authentication: bcrypt hashes, HttpOnly session cookie, lockout, single-use reset tokens, sessions revoked on password change/reset/suspension | Pass | [S] auth (incl. **new change-password test**), admin-controls |
| Authorisation: role permissions enforced on the server, customers blocked from Admin APIs | Pass | [S] auth, admin, audit-admin-crud (403/401 checks), order-notifications |
| CSRF (`X-Requested-With`), CORS allow-list, Helmet + CSP, 1 MB JSON limit, `trust proxy` for Railway | Pass | [S] auth (CSRF), unit/csp |
| Rate limits: API, auth, checkout, tracking, uploads, drafts | Present, **in-memory per instance** | See §H |
| Prices, discounts and stock never trusted from the browser; atomic stock reservation; idempotent checkout | Pass | [S] checkout, discounts |
| Orders, payments, webhooks (signature, replay, amount mismatch), refund ledger (idempotent, concurrent-safe) | Pass (gateway HTTP mocked) | [S] payments, upgrade, admin |
| Categories, collections, banners, campaigns, policy pages: CRUD, duplicate slug → 409, hidden → public 404 | Pass | **[S] audit-admin-crud (new)**, admin, upgrade |
| Uploads: content-sniffed type, size limits, permission | Pass | [S] upgrade (media); [E] journeys C (real upload → storefront) |
| Notifications: idempotent, retried, never block orders | Pass | [S] order-notifications |
| Scheduled jobs (reservations, abandoned checkouts, confirmation retries, refunds, uploads) | Pass | Production build booted (`server/dist`), scheduler ran all jobs |
| Dependency vulnerabilities | **0** (`npm audit`, production and dev) | — |
| Secrets | Not in code or bundle; credentials AES-256-GCM encrypted and masked | Previous audit + tests |

## E. Admin Dashboard audit

Every module was opened in the browser with no errors (desktop + mobile), and every Settings tab was clicked through. CRUD and persistence evidence:

| Module | Create | Edit | Delete / archive | Persists | Storefront follows | Permissions | Evidence |
|---|---|---|---|---|---|---|---|
| Dashboard / reports | — | — | — | ✔ | — | ✔ | [S] admin, admin-controls |
| Products (+ images, price, stock) | ✔ | ✔ | ✔ archive + delete | ✔ | ✔ | ✔ | **[E] journeys C**, product-journey; [S] admin |
| Featured / Flagship | — | ✔ | — | ✔ | ✔ | ✔ | [E] flagship |
| Categories | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | **[S] audit-admin-crud** |
| Inventory | — | ✔ adjust | — | ✔ | ✔ | ✔ | [S] admin; **fixed endless spinner** |
| Orders (status, tracking, notes, refunds, CSV, confirmation panel) | — | ✔ | — | ✔ | ✔ | ✔ | [E] shop-flow 11–13, order-notifications; [S] admin |
| Abandoned checkouts | — | — | ✔ | ✔ | — | ✔ | [E] abandoned-checkout; [S] checkout-drafts |
| Customers (suspend/reactivate, newsletter) | — | ✔ | — | ✔ | ✔ | ✔ | [E] admin-controls, journeys (newsletter); **fixed endless spinner** |
| Returns | — | ✔ | — | ✔ | ✔ | ✔ | [E] closure; [S] returns |
| Discounts | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | [E] admin-controls, coupon; [S] discounts |
| Website content: homepage hero, brand story | — | ✔ | — | ✔ | ✔ | ✔ | **[E] journeys E**; **fixed endless spinner** |
| Banners, collections, campaigns, policy pages (revisions, approval) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | [S] admin, upgrade, audit-admin-crud |
| Media library | ✔ upload/URL | ✔ | ✔ protected when in use | ✔ | ✔ | ✔ | [S] upgrade; [E] journeys C |
| Staff & roles | ✔ invite | ✔ | — | ✔ | — | ✔ | [S] admin, auth |
| Settings (store, legal, brand, shipping/zones, COD, VAT/stock/returns, payments, notifications, SEO, hosting) | — | ✔ | — | ✔ | ✔ | ✔ split permissions | [S] admin, upgrade, closure, admin-controls, order-notifications; [E] admin-controls, closure, order-notifications |
| Message templates, notification log | — | ✔ | ✔ reset | ✔ | — | ✔ | [S] closure, order-notifications; [E] closure, order-notifications |
| Activity log | — | — | — | ✔ | — | ✔ | [S] audit entries asserted in several tests |

## F. End-to-end workflow results

| Journey | Steps verified | Result | Evidence |
|---|---|---|---|
| A — Purchase | Homepage → category → search/filters → product → add to cart → quantity → checkout → details → payment (sandbox) → confirmation → order in Admin | PASS | e2e/shop-flow.spec 1–13, product-journey |
| B — Customer account | Register → sign out (account locked) → wrong password refused → sign in → profile change persists after reload → order history → order detail | PASS | **e2e/journeys.spec B (new)** |
| C — Admin product | Create (name AR/EN, SKU, slug, category, price, stock, uploaded photo) → storefront shows price/photo/Add to Cart → edit price → storefront updated → archive → hidden from store and search → delete | PASS | **e2e/journeys.spec C (new)** |
| D — Order management | Customer orders → Admin sees it → status change → customer sees the status | PASS | e2e/shop-flow 11–13; [S] admin fulfilment |
| E — Homepage management | Hero headline + brand story edited in Admin → persists after refresh → shown on refreshed `/en` and `/ar` | PASS | **e2e/journeys.spec E (new)** |
| F — Checkout persistence | Progressive server-side save before Place Order → refresh restores → offline + shutdown → sync on next visit → conversion → opt-out | PASS | e2e/abandoned-checkout (4); [S] checkout-drafts (10) |
| G — Notifications | One confirmation email per successful order (AR/EN, full details), retry after failure, no duplicates; WhatsApp **prepared** → opened (not delivered) → staff-confirmed | PASS (local SMTP server; no real provider) | [S] order-notifications; [E] order-notifications. Real delivery needs an SMTP account (BLOCKED); automatic WhatsApp needs the official API (BLOCKED) |

## G. Issues fixed in this pass

| # | Problem | Root cause | Files | Fix | Verification |
|---|---|---|---|---|---|
| 1 (P2) | Admin → Inventory showed a spinner forever when the server or network failed | The list request had no error branch | `client/src/admin/pages/Catalog.tsx` | Error message with a Retry button | `e2e/full-audit.spec` "failed load…" (simulated 500, then retry loads the table) |
| 2 (P2) | Admin → Customers: same | Same | `client/src/admin/pages/Catalog.tsx` | Same | Same test |
| 3 (P2) | Admin → Website content → Homepage editor: same, so staff could not tell the page had failed | Same | `client/src/admin/pages/Content.tsx` | Error box with a Retry button | Same test |
| 4 (P3) | Account → Addresses: Delete removed an address with no confirmation, and a failed delete was silently ignored | No confirm, no error handling | `client/src/pages/Account.tsx`, `client/src/i18n/strings.ts` (new AR/EN string) | Confirmation dialog; error shown | `e2e/journeys.spec` "customer forms" (cancel keeps the address, confirm deletes it) |

**Tests added** (they cover areas that had no browser or server evidence):
- `e2e/full-audit.spec.ts`: whole-site crawl, every Admin page and Settings tab, failure states. It runs on desktop and mobile; `e2e/playwright.config.ts` now includes it in the mobile project.
- `e2e/journeys.spec.ts`: journeys B, C and E, plus newsletter, addresses and password change.
- `server/tests/audit-admin-crud.test.ts`: category and collection CRUD with the storefront following each change, plus permissions.
- `server/tests/auth.test.ts`: a new change-password test (wrong current password, weak password, other devices signed out).

The order confirmation & notification system (R3) from the previous task is also in the working tree, uncommitted. Its details are in `docs/PRODUCTION-READINESS-AUDIT-2026-11-09.md` §2e.

## H. Still missing / not fixed

| Item | Why it is incomplete | Type | Action needed | Who |
|---|---|---|---|---|
| **Live payments run on the sandbox gateway** | No merchant credentials; the server was started with `ALLOW_SANDBOX_PAYMENTS=true` | Configuration (P0 for public launch) | Enter Moyasar/Tabby keys in Admin → Settings → Payments and set `PAYMENT_GATEWAY`. Until then, switch the online methods off or keep the site private | Client (credentials) + developer (env) |
| Order confirmation system (R3) not deployed | Not committed, as the brief requires | Process | Your authorisation to commit, push and redeploy both Railway services | You |
| Rate limiting is per server instance (in memory) | A shared store (e.g. Redis) is not part of the stack | Code / infrastructure (P2) | Add a Redis store for `express-rate-limit`, or rely on the host's WAF | Developer + hosting |
| No error monitoring (Sentry or similar) | Needs an account and a new dependency | Infrastructure (P2) | Create an account, add the SDK | Developer + client account |
| Railway storefront served with `vite preview` | It works, but it is not a production static server | Deployment (P2) | Serve `client/dist` from the API service, or use a static host (`docs/DEPLOYMENT.md` → Railway) | Developer |
| Real-device performance (Lighthouse) not measured | Needs the final domain and real content | Verification (P3) | Run Lighthouse on mobile after launch content is in | Developer |
| Email bounces and inbox delivery not tracked | "Sent" means the mail server accepted it | Feature (P3) | Optional provider webhooks after an SMTP provider is chosen | Developer after the client chooses a provider |
| No lint configuration | Would add dependencies | Hygiene (P3) | Add ESLint if wanted | Developer |
| Media storage on the live server not verified | Admin-only setting; the live product images are external Cloudinary links | Configuration | Check Admin → Settings → Hosting & data: uploads must use S3, or set `ALLOW_LOCAL_MEDIA_STORAGE` with a persistent volume. Railway's disk is erased on redeploy | Developer |
| Live database text-encoding dry run | Live data not inspected (no write access used) | Data | `npm run repair:text` (dry run) on production, review, then `--apply` | Owner/developer |
| I Mile API booking/tracking | No API documentation | External | I Mile API docs + credentials | Client / I Mile |

## I. Client-side pending items

**Must provide:**
- Payment gateway account and keys (Moyasar or the existing gateway), Apple Pay domain verification, STC Pay activation, Tabby merchant code and keys (Q20–Q22).
- SMTP account for order emails (Q28). Optionally, WhatsApp Business Platform (Cloud API) access for automatic WhatsApp messages; without it, staff send the prepared messages.
- Official WhatsApp Business number for confirmations (Admin → Settings → Notifications → Order confirmation).
- Logo files (Q9) and the brand accent colour (Q2).
- Arabic short and full descriptions for all 90 products, specifications, and a second photo per product plus lifestyle photos (Q12, Q14, Q15).
- Brand story text (homepage section is empty).
- CR and VAT numbers, legal name, business address, support email and phone (Q29, Q34).
- I Mile tracking-URL format, and API docs if an integration is wanted (Q24).
- Work email addresses for Shuja Mubeen and Usama M. Usman (Q27).
- Domain/DNS access, and Shopify handles if old links must keep working (Q35).
- Analytics/ad accounts when created (Q36).

**Requires approval:**
- Legal approval of the 6 policy pages (all still drafts with bracketed placeholders) and the return window (Q31).
- Native Saudi Arabic review of the interface copy (Q12).
- Category names and per-category filters (Q13, Q18).
- Font pair (Q8), and design sign-off (Q4).

**Business decisions:**
- Storing customer data with providers outside Saudi Arabia (Q33).
- Saudi Business Center verification (Q30).
- Launch date (Q38).
- Whether a contact form is wanted (not in the questionnaire).
- Whether to keep the online payment methods visible before real credentials exist.

**External accounts / provider activation:** payment gateway, Tabby, SMTP provider, optional WhatsApp Cloud API, S3-compatible storage, error monitoring, analytics.

## J. Technical and production readiness

| Check | Result |
|---|---|
| TypeScript (server, client, api) | Pass — `npm run typecheck`, 0 errors |
| Production build (server `tsc`, client Vite) | Pass — `npm run build` (server tsc + client Vite) |
| Production server boot (`server/dist`, real start-up, in-memory MongoDB) | Pass: health 200, draft API 200, Admin 401 without login, scheduler ran every job |
| Server tests (unit + integration + API + database) | **240 / 240 passed**, 26 files (before this pass: 237 / 25 files) |
| Browser tests (desktop, mobile, tablet) | **91 passed, 1 skipped, 0 failed** (desktop + mobile + tablet; the skipped test is a mobile-only check that is deliberately skipped on desktop). Before this pass: 81 passed |
| `npm audit` | 0 vulnerabilities |
| Bundle | Storefront JS ≈380 kB (≈120 kB gzip) + 190 kB CSS; Admin (279 kB) loaded only for staff |
| Live deployment (read-only) | Commit 7e18fff is live on both services: "Abandoned checkouts" is in the live Admin bundle, `/api/checkout/draft` returns 200 |
| Security findings | No new issues. Remaining hardening is listed in §H (shared rate-limit store, monitoring) |
| Deployment blockers | Sandbox gateway live (P0); policies in draft and CR/VAT missing (legal); `vite preview` serving the storefront; media storage on Railway to confirm |

Tests that could not run against real providers: Moyasar, Tabby, SMTP providers and the WhatsApp Cloud API are exercised against mocked HTTP or a local SMTP server, because no credentials exist.

## K. Final completion status

**READY WITH LIMITATIONS** (software), **NOT READY for a public launch** (business inputs).

- Everything that can be built and verified without the client's inputs is built and verified. There are no FAIL or MISSING requirements, and all seven journeys pass in a real browser.
- A public launch needs, at minimum:
  1. a real payment gateway, or the online methods switched off (P0);
  2. approved policy pages and CR/VAT numbers (Saudi e-commerce requirements);
  3. the logo, accent colour and Arabic product content;
  4. an SMTP account so customers actually receive emails;
  5. your authorisation to deploy the uncommitted order-confirmation work.
- This is **not** 100% complete: 12 requirements are blocked on client input or credentials, 6 await client decisions, and 7 are partial (mostly content).

---

### Files changed in this pass

| File | Change |
|---|---|
| `client/src/admin/pages/Catalog.tsx` | Fix: Inventory and Customers error states with retry |
| `client/src/admin/pages/Content.tsx` | Fix: Homepage editor error state with retry |
| `client/src/pages/Account.tsx` | Fix: address delete confirmation and error |
| `client/src/i18n/strings.ts` | New string `account.deleteAddressConfirm` (AR/EN) |
| `e2e/full-audit.spec.ts` | New: site crawl, Admin pages, failure states |
| `e2e/journeys.spec.ts` | New: journeys B, C, E and customer forms |
| `e2e/playwright.config.ts` | Mobile project also runs `full-audit` |
| `server/tests/audit-admin-crud.test.ts` | New: category and collection CRUD |
| `server/tests/auth.test.ts` | New change-password test |
| `CELIBERY_COMPLETE_AUDIT_AND_REMEDIATION_REPORT.md` | This report |

Already in the working tree from the previous task (order confirmation & notifications, uncommitted): see `docs/PRODUCTION-READINESS-AUDIT-2026-11-09.md` §2e for its file list.
