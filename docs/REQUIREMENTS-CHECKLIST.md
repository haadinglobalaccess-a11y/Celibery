# Requirements checklist — CELIBERY International

Source of truth: *CELIBERY International — Website Questions and KSA Recommendations* (Q1–Q39 with the client's answers; Sections 1–3 recommendations the client accepted with "Agree").
Approver for every item: **Usama M. Usman (BDM)** (Q39).

Last updated: 3 November 2026 (premium production-readiness upgrade — see `docs/UPGRADE-REPORT-2026-11-03.md`).

## Status rules

| Status | Meaning |
|---|---|
| PASS | Implemented **and** observed working (see "Evidence") |
| PARTIAL | Part implemented and verified; part still open |
| FAIL | Implemented but broken |
| MISSING | Not implemented |
| BLOCKED | Needs client input, credentials or external access |
| NOT VERIFIED | Code exists and was reviewed, but could not be executed in this session |

**How verification was done in this session (important).** The build sandbox could not reach the npm registry or the MongoDB download server, so the project's own dependencies (Express, Mongoose, Vite, React Router, Vitest…) could not be installed. Therefore:

- The **storefront** was verified by bundling the real `client/src` code with esbuild and rendering it in real Chromium (desktop 1440 px and Pixel 7) against a read-only mock of the public catalogue API built from the project's own labelled demo seed data. Anything shown only in that preview is marked PASS **for the storefront behaviour**; anything that needs the real API/database is NOT VERIFIED.
- The **API, database, payments, admin and the Vitest/Playwright suites** were not executed. They are NOT VERIFIED here, even where the draft's tests claim coverage. Run `npm test` and `npm run test:e2e` (see `docs/TESTING.md`) as the first step after installing dependencies.

## Client questions Q1–Q39

| ID | Client requirement (answer) | Implementation | Status | Evidence / test | Still needed |
|---|---|---|---|---|---|
| Q1 | Hybrid theme: light shopping pages, dark premium sections (Agree) | Light category/product/cart/checkout; dark hero, bundles editorial, "Why CELIBERY", brand story, footer | PASS | Preview screenshots AR/EN, desktop + mobile | Client sign-off on design |
| Q2 | Near-black + white base with ONE brand accent (Agree) | Accent = CELIBERY turquoise **#00B1C0**, measured from the client's logo file (median of opaque pixels #02B1C0). Tokens in `client/src/styles/tokens.css`; `--accent-ink` (#111) for text on the accent and `--accent-text` (darkened) for accent-coloured text on light surfaces, for WCAG contrast. Admin → Settings → Brand still overrides; the old placeholder #2563EB is treated as unset (13 Nov 2026) | PASS | Rendered AR/EN at 375/390/1440 px against the e2e stack | Client sign-off on the applied colour |
| Q3 | Keep list from cellebry/UGREEN (Agree) | Dark hero, service strip, use-case tabs, wishlist, SAR prices with discounts, mega menu, series, lifestyle banners | PASS | All rendered in preview (series/lifestyle need client data — see Q15/Q16) | — |
| Q4 | Feel: premium, Saudi, trustworthy (Agree) | Cinematic hero, editorial sections, Arabic-first, trust/service strip, no invented claims | PASS | Preview screenshots | Client sign-off (subjective) |
| Q5 | Mega menu (Agree) | Animated mega menu with categories, sample products per category, bundles panel | PASS | Hover screenshot (`docs/screenshots/mega-menu-en.jpg`) | — |
| Q6 | Balanced animation, site stays fast (Agree) | Motion system (`styles/motion.css`): scroll reveals, staggered lists, masked headline reveal, page transitions, route progress bar, card hover/zoom/second-image swap, add-to-cart feedback + animated cart panel, gallery zoom/crossfade, marquee, ambient background. Transform/opacity only, IntersectionObserver (no scroll loops), CSS-only parallax as progressive enhancement, full `prefers-reduced-motion` support | PASS | Preview: zero console errors; reduced-motion run shows 0 elements left hidden/transformed | Real-device performance check (Lighthouse) after deploy |
| Q7 | One hero video (client: "AI would be better, or explain what kind of video") | Hero video/poster can now be **uploaded or linked** (direct .mp4/.webm, YouTube, Vimeo), with separate mobile video/poster, headline, button label/destination and on/off — Admin → Website content → Homepage. Banners also accept video. Else hero banners; else animated product stage. Brief in `docs/HERO-VIDEO-BRIEF.md` | BLOCKED | Fallback stage verified in preview; admin media fields rendered in Chromium (3 Nov) | Video (or approval to produce one) |
| Q8 | We propose a font pair (Agree) | Manrope (Latin, variable 400–800) + IBM Plex Sans Arabic via Google Fonts, both SIL OFL (13 Nov 2026; was Plus Jakarta Sans) | PARTIAL | Rendered in Edge against the e2e stack | Client approval of the pair; optionally self-host |
| Q9 | Logo: client sends logo, we recreate as vector | Client PNG (`docs/brand/celibery-logo-original.png`) cropped and served as WebP from `client/public/brand/`; `<Logo>` uses it unless Admin → Brand has an upload; favicon is a turquoise bolt (13 Nov 2026) | PARTIAL | Header, drawer and footer rendered AR/EN | True vector (SVG) recreation of the wordmark still to do |
| Q10 | Arabic default, English one tap away (Agree) | `/` → `/ar`; header switch keeps page, query and cart | PASS | Preview: `/` → `/ar`, `dir=rtl`; switch to `/en` same path | — |
| Q11 | Western digits on Arabic site (Agree) | `ar-SA-u-nu-latn` number/date formats | PASS | Arabic screenshots show `149.00 ر.س` | — |
| Q12 | Native Saudi Arabic copy, we draft for approval (Agree) | All Arabic strings are drafts in `client/src/i18n/strings.ts` (incl. new strings added this session) | BLOCKED | — | Native review |
| Q13 | Category names: research competitors; keep if they match | Six categories seeded; proposal in `docs/CATEGORY-FILTERS-FOR-APPROVAL.md` | BLOCKED | Names render in preview | Written approval |
| Q14 | Client will share ~90 products | CSV import (Admin → Products, `npm run import:products`), template in `docs/` | BLOCKED | — | Product list |
| Q15 | Photos: 2 per product + lifestyle, shot in KSA (Agree) | Product gallery (zoom, crossfade, prev/next), card hover shows 2nd photo, lifestyle banners | BLOCKED | Mechanics verified with placeholders | Photos |
| Q16 | Series: "use ours for now", open to suggestions | Series field in admin, searchable; **now shown on cards and product page (links to series search)** — added this session | PARTIAL | Code reviewed; renders when set | Series names from client |
| Q17 | Bundles as own menu item (Agree) | "Bundles & Gifts" in header, mega menu, mobile menu; `/bundles` page; bundles editorial on home | PASS | Preview `/en/bundles` | — |
| Q18 | Per-category filters, we create and get approval | Category-specific facets (capacity, watts, connector, colour, price, availability) | NOT VERIFIED | Filter UI verified in preview with mock facets; server facet aggregation not executed | Approval + run tests |
| Q19 | No real reviews to import → real, verified reviews only | No reviews or ratings displayed (`reviewsEnabled: false`) | PASS | Preview shows no review UI | Decide whether to collect reviews post-launch |
| Q20 | Apple Pay, mada, Visa/Mastercard, STC Pay at launch (Agree) | Moyasar adapter; credentials now entered by a Super Administrator in Admin → Settings → Payments (AES-256-GCM encrypted, masked, separate test/live sets, “Test connection”, typed LIVE confirmation) | BLOCKED | Admin UI rendered in Chromium; credential rules unit-tested; API tests written (`tests/upgrade.test.ts`), not executed here | Gateway account + keys, Apple Pay domain verification |
| Q21 | Use existing gateway (Agree) | Moyasar adapter; others need an adapter | BLOCKED | — | Which gateway + credentials |
| Q22 | Tabby (Agree) | Tabby adapter (authorise → capture exactly once, refunds with reference id), webhook with retry-safe lifecycle; credentials managed in Admin → Settings → Payments | BLOCKED | Lifecycle rules unit-tested; API tests written, not executed | Merchant code + keys |
| Q23 | COD: in use, delivery cost included in price | COD on/off, fee, minimum and maximum order, allowed cities (Arabic/English spellings) — Admin → Settings → Cash on delivery; enforced in the server quote and at checkout; customers see why COD is unavailable; **disabled by default** | BLOCKED | Rules unit-tested (`delivery-rules.test.ts`, 5 tests pass) | Confirm: enable COD, fee 0, limits/cities | Confirm: enable COD, fee 0, any max order value |
| Q24 | Courier: I Mile Logistics | Courier name, tracking-URL template, delivery pause switch, fulfilment mode shown as **manual** (API mode deliberately unavailable), I Mile API credentials can be stored encrypted for a future integration | PARTIAL | Admin screen rendered in Chromium | I Mile tracking URL format (API optional) |
| Q25 | Free delivery, cost covered in price | `freeDelivery: true` default; optional fee + free-from threshold when switched off; server quote is authoritative | NOT VERIFIED (rules unit-tested) | Server quote logic reviewed; "Free" rendered in preview | Run checkout tests |
| Q26 | Admin modules approved (Agree) | Overview, Orders, Products, Categories, Inventory, Customers, Discounts, Website content, **Media library**, Reports, Staff & roles, Settings (10 sections), Activity log; roles Super Administrator, Administrator, Content Manager, Product Manager, Order Manager, Online Sales Executive; permissions enforced server-side (`payments:manage`, `business:write`, `media:write` added) | NOT VERIFIED | Settings and Media screens rendered in Chromium with no errors; API permission tests written, not executed | Run admin tests with database |
| Q27 | Staff: Shuja Mubeen (Online Sales Executive), Usama M. Usman (BDM) | `create-staff` CLI and Admin → Staff | BLOCKED | — | Work email addresses |
| Q28 | Email + WhatsApp order updates (Agree) | SMTP + WhatsApp Cloud API, credentials managed (encrypted) in Admin → Settings → Notifications with connection test, test email and delivery log; skipped (logged) when not configured | BLOCKED | — | SMTP + WhatsApp credentials, approved template |
| Q29 | CR + VAT numbers (client will provide) | Footer shows "coming soon" until set; editable only with the `business:write` permission (audited) | BLOCKED | Footer verified in preview | Numbers |
| Q30 | Saudi Business Center verification (unanswered) | Badge appears only when marked verified | BLOCKED | — | Answer + badge/URL |
| Q31 | We draft policies, client's advisor approves (Agree) | Draft shipping/returns/**refunds**/warranty/privacy/terms pages; every save keeps a version (history + restore); approving needs `business:write`; editing an approved policy returns it to draft | BLOCKED | Draft notice renders (`/en/page/returns`) | Legal approval |
| Q32 | Publishable claim: 2-year warranty | 24-month warranty default; shown in announcement bar, service strip, product page | PASS | Preview screenshots | — |
| Q33 | Customer data outside KSA (unanswered) | Hosting/database/media regions documented through server settings and shown **read-only** in Admin → Settings → Hosting & data (no fake “move data” switch) | BLOCKED | — | Legal answer |
| Q34 | WhatsApp, hours, address, email, phone, socials (unanswered) | All configurable; WhatsApp button hidden until a real number exists | BLOCKED | Verified hidden in preview | Details |
| Q35 | Shopify + domain access (Agree) | `/products/:handle` and `/collections/:handle` redirect to the new URLs | PARTIAL | Preview: `/products/demo-usb-c-hub` → `/ar/p/demo-usb-c-hub` | Shopify export/handles, DNS access |
| Q36 | Analytics/ad accounts: none yet | Nothing connected | BLOCKED | — | Accounts when created |
| Q37 | Allow AI assistants (Agree) | `robots.txt` allows GPTBot, OAI-SearchBot, Google-Extended, PerplexityBot, ClaudeBot; `llms.txt` | PASS | `/robots.txt` is generated by the server from Admin → Settings → SEO (“Allow AI assistants”); `/llms.txt` is generated from the live categories, campaigns, policy pages, delivery/payment settings and contact details | — |
| Q38 | Launch date: recommend when ready | — | BLOCKED | — | Decide after QA on real stack |
| Q39 | One approver: Usama M. Usman (BDM) | Recorded in `PENDING-CLIENT-INFO.md` and here | PASS | — | — |

## Summary

| Status | Count |
|---|---|
| PASS | 13 |
| PARTIAL | 5 |
| FAIL | 0 |
| MISSING | 0 |
| BLOCKED | 18 |
| NOT VERIFIED | 3 |
| **Total** | **39** |

**A. Technical completion** — requirements that do not depend on client input (39 − 18 BLOCKED = 21):
- strict (PASS only): 13 / 21 = **61.9 %**
- weighted (PARTIAL = 0.5): (13 + 2.5) / 21 = **73.8 %**

**B. Overall client-requirement completion** — all 39:
- strict: 13 / 39 = **33.3 %**
- weighted: 15.5 / 39 = **39.7 %**

The low overall figure reflects missing client inputs and the fact that no server-side behaviour could be executed in this session, not missing code. Running the existing test suites on a machine with npm access would move Q18, Q25 and Q26 out of NOT VERIFIED (or reveal defects).

## Engineering checks (from the delivery briefs, not client questions)

Updated 3 November 2026. The npm registry is still blocked in the build sandbox, so the project's real toolchain could not be installed. Substitute checks are listed with their limits.

| Check | Status | Notes |
|---|---|---|
| Dependency install / lockfile | BLOCKED | `npm install` refused by the network policy (403 for registry.npmjs.org). No `package-lock.json` could be generated — run `npm install` on a normal machine and commit the lockfile |
| TypeScript — server | NOT VERIFIED (substitute PASS) | `tsc` against loose stubs for express/mongoose: no errors outside known stub limitations |
| TypeScript — client | NOT VERIFIED (substitute PASS) | `tsc` against loose React/router stubs: 0 errors |
| Unit tests (pure modules) | PASS | 13 suites / 47 tests via Node's test runner + a Vitest-compatible shim: CSP, log redaction, SigV4, credential rules, AES-GCM secrets, media sniffing/rules/URLs, refund lifecycle, webhook lifecycle, delivery/COD rules |
| Integration tests (`npm test`) | NOT VERIFIED | Existing suites + new `tests/upgrade.test.ts` (refund idempotency, concurrency, gateway refusal/timeout/DB-failure, reconciliation, webhook retry, settings permissions, encrypted credentials, live-mode gate, media upload/URL, policy approval, COD/threshold/pause) need Vitest + MongoDB |
| End-to-end (`npm run test:e2e`) | NOT VERIFIED | Needs API + database |
| Build | NOT VERIFIED (substitute PASS) | esbuild bundles of client, server, `api/index.ts` and `vite.config.ts` succeed |
| Admin UI render | PASS (preview) | Settings (payments, shipping, COD, legal, hosting), Media library and media picker rendered in Chromium at 1440 px and 390 px against a mock API: 0 console errors, 0 horizontal overflow |
| Refund concurrency | NOT VERIFIED (logic unit-tested) | Ledger with atomic reservation, idempotency key, `reconciliation_required` for uncertain outcomes, never rolls back a gateway-confirmed refund, reconciliation cron + manual resolution |
| Webhook retry | NOT VERIFIED (rules unit-tested) | Event lease/lifecycle: processed only after success; failures retried; invalid signatures write nothing |
| CSP | NOT VERIFIED in a browser against the real build | Policy built from one source (`server/src/lib/csp.ts`): Express header, build-time meta tag, Vercel header directives; unit-tested |
| Lint | MISSING | No lint config in the project (adding one needs new dependencies) |
| `npm audit` | NOT VERIFIED | Needs registry |
