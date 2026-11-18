# CELIBERY storefront transformation — 18 November 2026

## Reference research

Read the live UAE UGREEN homepage, its category navigation and search content, Chargers collection, Uno 65W product page, About page, Support page, and footer structure:

- https://www.ugreen.com/en-ae
- https://www.ugreen.com/en-ae/collections/ae-chargers
- https://www.ugreen.com/en-ae/products/ae-25686
- https://www.ugreen.com/en-ae/pages/about-ugreen
- https://www.ugreen.com/en-ae/pages/support

Patterns applied: campaign-led home, direct category discovery, early product browsing, concise collection introductions, consistent image frames, structured product information, clear service/contact destinations, and grouped footer navigation. No reference assets or product claims were copied. Reference research used extracted live page content; a comprehensive interactive, viewport-by-viewport UGREEN audit was not performed. Its regional collection is a product-discovery catalog; filter or purchase behavior absent from its accessible content was not assumed.

## Workspace audit and implementation

Reviewed the route tree, home sections, shared header/footer, product cards, shop/category/collection/search, product detail and gallery, cart summary, checkout, account, authentication, policy/campaign pages, FAQ, hero playback, responsive styles, image delivery, cached requests, public catalog/home API, content models, and admin content mapping. Payment and shipping code paths remain under existing ownership; no backend or schema changes were made.

| Area | Changes |
| --- | --- |
| Home | Products follow compact category discovery. Existing flagship, campaign, category spotlight, bundle, trust, story, FAQ and newsletter sections remain. Category descriptions remain accessible on category pages. Promo banners returned by the API now render alongside lifestyle banners. |
| Collections | Only existing populated homepage collections create use-case tabs. Removed speculative requests for four hardcoded collection slugs and the associated dynamic-import warning. |
| Navigation | Search includes actual category shortcuts. Mobile menu locks background scrolling, focuses its close button, traps keyboard focus, and restores focus on dismissal. Help link added. Mobile drawer uses the correct light-background logo. Mega menu can scroll on short displays. |
| Listings/search | Smaller banners/headings, balanced grid spacing, 44px card controls, narrow-screen sorting and price wrapping. Search results include an editable search form. Price bounds update in a single URL transaction, fixing one bound overwriting the other. |
| Product | Smaller purchase headings and section spacing. Full rich descriptions are accessible in native expandable details; structured specifications start open and can collapse. Existing interactive gallery, facts, stock, services, pricing, bundles, reviews and related products remain. |
| About/contact/support | New lazy-loaded bilingual routes use existing admin brand story and business contact settings. Support links reuse FAQ, tracking, account and policy destinations. Footer links expose these routes. No invented contact details, reviews, specifications or statistics. |
| Policies/FAQ/account/cart/checkout | Shared storefront typography, readable policy measure, consistent form/summary surfaces, and mobile spacing. Policy text and transactional behavior retained. |

## Files

- `client/src/App.tsx`: customer information routes and lazy chunk.
- `client/src/main.tsx`: storefront presentation stylesheet import.
- `client/src/components/StoreLayout.tsx`: storefront-only styling scope.
- `client/src/components/Header.tsx`: menu accessibility, support and search shortcuts.
- `client/src/components/Footer.tsx`: customer information links.
- `client/src/pages/Home.tsx`: early product discovery.
- `client/src/storefront/HomeSections.tsx`: category summaries, collection data integrity, promo banners.
- `client/src/pages/Shop.tsx`: atomic price range and results search form.
- `client/src/pages/ProductPage.tsx`: description/specification disclosures.
- `client/src/pages/ContentPages.tsx`: readable policy article layout.
- `client/src/pages/CustomerInfo.tsx`: real-data customer information pages.
- `client/src/styles/commerce.css`: scoped responsive presentation.
- `e2e/commerce.spec.ts`: width matrix, real interactions and customer pages.
- `e2e/product-journey.spec.ts`: open the description disclosure before validating its content.

## Preservation and performance

CELIBERY logo, existing typography, brand tokens and admin brand overrides remain. Hero source configuration, timings, transitions, progress, YouTube/Vimeo/uploaded-video support, and active-player lifecycle are unchanged. Existing motion classes and libraries remain in use. Admin/dashboard, authentication, inventory, prices, cart, API contracts, Moyasar, Tabby and shipping integrations were not rewritten. No dependencies were installed.

Existing responsive image utilities, lazy image loading, route splitting, font delivery and hero media strategy remain. Customer information adds a separate approximately 1.2KB gzip JS chunk. No before/after Core Web Vitals benchmark was conducted; build size alone is not a loading-speed measurement.

## Verification

- Root production build passed, including server compilation and client TypeScript check. Final build completed without the earlier dynamic-import warning.
- Root TypeScript checks passed (server, client and API).
- Existing server suite: 34 files, 319 tests passed. The runner reported a worker shutdown warning after completion.
- Existing browser selection (`responsive`, `product-journey`, `header-icons`): 35 passed, one intentional desktop-only skip. Covers desktop, Pixel 7 and tablet; mobile menu, sticky purchase, cart/order journey, eager images and direction checks.
- Final-build browser selection (`commerce`, `full-audit`, updated `product-journey`, desktop project): all 28 passed. The commerce tests explicitly set 320, 360, 375, 390, 414, 430, 820, 1366 and 1920px viewports in both languages for home, category and product pages. No horizontal overflow or uncaught page exceptions found.
- Final crawl visited 93 storefront URLs across both languages with zero recorded problems. Admin dashboard crawl and failed-load retry also passed.
- New About, Contact, Support, FAQ and search pages checked in both languages at 320 and 1366px. Atomic price bounds, description/specification disclosures, mobile focus trap/restoration and single active hero slide passed.
- Updated product journey verified admin-created rich product content in both languages, cart quantity, checkout and stored sandbox order data. This uses only the isolated test server, never real payment processing.
- `git diff --check` passed. Browser screenshots are available under ignored `e2e/.artifacts/screens/`, including `commerce-en-320.png`, `commerce-ar-390.png` and `commerce-en-1366.png`. Narrow English product and Arabic collection/desktop images were visually reviewed.

## Limits

Browser QA uses the repository's isolated in-memory database and existing demo fixtures; production data was not seeded, changed or replaced. The fixture catalog uses existing placeholder artwork, so screenshots cannot establish production photography quality. No real payment is submitted. Live third-party payment/provider credentials and real YouTube/Vimeo service availability are outside this local verification.
