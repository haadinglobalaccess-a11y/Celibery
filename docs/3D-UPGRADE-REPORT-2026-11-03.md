# 3D immersive storefront upgrade — report

Date: 3 November 2026 · Base: `celibery-production-upgrade-2026-11-03.zip` · Brief: "Master 3D immersive e-commerce transformation".

This changes the presentation of the existing project only. No server file, API, model, route,
payment flow, admin page, translation key or URL was removed or changed. See
`docs/3D-EXPERIENCE.md` for the design system and developer guide.

## 1. Files changed

**New (client)**
- `client/src/three-d/` — `ThreeDScene.tsx`, `studio.ts`, `Product3DStage.tsx`, `FloatingProduct.tsx`, `CinematicHero.tsx`, `TiltCard.tsx`, `SpatialCarousel.tsx`, `ScrollScene.tsx`, `PremiumButton.tsx`, `DimensionalIcon.tsx`, `InteractiveProductGallery.tsx`, `flyToCart.ts`, `env.ts`, `index.ts`
- `client/src/styles/immersive.css` — the 3D design system (loaded last)

**Modified (client)**

| File | Change |
|---|---|
| `main.tsx` | imports `immersive.css` |
| `pages/Home.tsx` | hero moved to `CinematicHero` (logic unchanged); spatial category panels; product rails → `SpatialCarousel`; campaign/lifestyle panels with tilt and layers; bundles fan; dimensional "Why" panels; brand-story scroll scene; newsletter panel; same data, links and `data-testid`s |
| `pages/ProductPage.tsx` | gallery → `InteractiveProductGallery` (zoom kept, now click-to-zoom); fly-to-cart; dimensional info icons; related → `SpatialCarousel`. Price, stock, quantity, cart, wishlist and sticky-buy logic untouched |
| `pages/Shop.tsx` | category rail (uses the cached `/api/home` categories, no new request); 3D title; card entrance; drawer class. Filters, search, sort and pagination untouched |
| `components/ProductCard.tsx` | tilt (listener on the card, so the stretched link keeps working); fly-to-cart on add |
| `components/ui.tsx` | quantity number rolls in (re-keyed output); dimensional empty-state icon; 3D "404" numerals |
| `lib/motion.tsx` | `MotionReveal` export + `depth`/`rise` variants |
| `i18n/strings.ts` | `premium.zoomHint` now says "Click to zoom" / "انقر للتكبير" (zoom moved from hover to click so hover can tilt) |

**New docs:** this report, `docs/3D-EXPERIENCE.md`, `docs/screenshots/3d-*.jpg` (8 screenshots, sample data).

## 2. 3D components created

`ThreeDScene` (WebGL host), `Product3DStage` + studio shader, `FloatingProduct`, `CinematicHero`,
`TiltCard`/`useTilt`, `SpatialCarousel`, `ScrollScene`/`useScrollProgress`, `MotionReveal`,
`PremiumButton`/`useMagnetic`, `InteractiveProductGallery`, `DimensionalIcon`, `flyToCart`.
Details in `docs/3D-EXPERIENCE.md` §3.

## 3. Pages upgraded

- **Home:** WebGL studio hero, service strip, categories, featured, campaigns, explore tabs, best sellers, lifestyle banners, bundles, why, use cases, brand story, newsletter
- **Shop / category / collection / search:** title, category rail, cards, skeletons, empty state, filter drawer
- **Product:** gallery stage, buy box, quantity, add-to-cart flight, info rows, related rail
- **Cart & checkout:** line entrances, summary panel, step coins, payment tiles (selected state), input focus/invalid states, cart peek. Checkout logic, APIs and payment code untouched
- **Login / register / forgot / reset, account, orders, wishlist, track, campaign, policy, 404:** shared depth language (panels, titles, order cards, status steps, campaign hero, 3D 404)
- **Footer:** perspective light-grid transition. **Route changes:** pages arrive in depth
- **Admin dashboard:** not touched

## 4. Regression testing — what was run and how

The npm registry is blocked in this environment (`403` from the egress policy), as it was for the
previous session. Vite, Vitest and the project's Playwright suite can't be installed. So the
storefront was tested like this:

- **Build:** the real `client/src` bundled with esbuild (same entry and CSS order as Vite). React 19
  (preinstalled) was used instead of React 18, and a small test-only stand-in for
  `react-router-dom`. Neither is part of the project.
- **API:** a mock server built from the project's own demo seed (`server/src/seed`) for the storefront endpoints.
- **Browser:** Chromium (Playwright) with software WebGL (SwiftShader).

**Regression flow (30 checks, mirroring `e2e/shop-flow.spec.ts` and `e2e/responsive.spec.ts` where the mock allows): 30/30 PASS.**
Root → `/ar` with RTL/lang · 6 category tiles · language switch → `/en`, LTR · category tile → category page (3 products) · capacity filter → 1 product + URL · sort updates URL · category rail navigation · header search · card "+" adds to cart + cart peek · card wishlist button clickable · card title (stretched link) opens product · product page h1 + sample note + add to cart · gallery next / thumbnails / arrow keys / click-zoom on & off · quantity + / − · cart lines, + quantity, total · cart survives language switch · checkout form fill + card payment selectable + "Place order" enabled · remove line · legacy `/products/:handle` redirect · policy page · 404 · login form · newsletter submit · hero "Shop now" · hero product card link · carousel next button scrolls · mobile menu → category · mobile sticky add-to-cart · mobile filter drawer open/close · no horizontal overflow on 6 key pages at 390 px.

**Other checks**
- Server unit tests (`server/tests/unit/*`, through a vitest→node:test shim): **47/47 PASS** (server code unchanged)
- Client type-check against loose React/router stubs: **0 errors in project code** (the only errors are stub artifacts, which appear identically in the untouched baseline)
- Production CSP injected into the build: **0 violations** on home, product page and add-to-cart
- WebGL disabled: CSS stage fallback, 0 page errors · hero off screen: **0 frames rendered** · leaving the page: canvas removed
- React StrictMode (development build): 3D stage starts correctly (double-mount safe)
- Screenshots reviewed at 1440 px and 390 px, Arabic and English, reduced motion: 0 console errors, 0 horizontal overflow

**Regressions found and fixed during testing**
1. Wishlist on product cards became unclickable: the 3D transform put the photo panel in its own stacking context under the stretched title link. Fixed and covered by the flow.
2. Tilt didn't respond on cards because the stretched link sits on top. The listener moved to the card.
3. Hero product card disappeared for about 1 s during the CSS → WebGL handover, and could have left an invisible focusable duplicate. Fixed.
4. On phones the hero product card overlapped the eyebrow text. Fixed.
5. Pre-existing: with reduced motion, the route progress bar stayed on screen. Fixed (hidden under reduced motion).

## 5. Tests passed / failed / not run

| Suite | Result |
|---|---|
| Storefront regression flow (harness) | **30/30 pass** |
| Server unit tests (47) | **47/47 pass** |
| `npm run typecheck` (real React types) | **Not run** (registry blocked) |
| `npm test` (Vitest integration: auth, catalog, checkout, admin, payments, upgrade) | **Not run** (needs Vitest + MongoDB binary). Server code unchanged by this upgrade |
| `npm run test:e2e` (project Playwright suite against real API + MongoDB) | **Not run** |
| `npm run build` (Vite) | **Not run** (esbuild bundle of the same sources succeeds) |
| Real GPU / real phone performance | **Not measured.** SwiftShader is CPU rendering (~15 fps here); budgets and adaptive quality are in place but need checking on a mid-range Android and an iPhone |
| Safari / Firefox | **Not tested** (Chromium only) |

First thing on a machine with npm access:

```bash
npm install && git add package-lock.json
npm run typecheck && npm test && npm run build && npx playwright install && npm run test:e2e
```

## 6. Missing client assets / 3D models

- **No real product photos yet.** The catalogue is still demo products with placeholder icons
  (Q14/Q15). The 3D stage, cards and gallery are built for real photos: square, light or
  transparent background (see `docs/3D-EXPERIENCE.md` §7).
- **No 3D product models (GLB).** None exist, so none are shown. Products appear as photo slabs. The upgrade path is in `docs/3D-EXPERIENCE.md` §6.
- **Brand accent and logo** (Q2, Q9) are still placeholders. The studio rings and highlights follow Admin → Brand accent automatically.
- **Lifestyle / brand-story photography** (Q15) is not supplied yet, so placeholders are used.
- **Hero video** (Q7): if supplied, it takes precedence over the 3D stage (unchanged order), and gets pointer depth parallax.
- **Product variants:** the data model has no variants (colour is a single attribute per product), so no variant selector was added. Inventing one would have been fake functionality.

## 7. Remaining production blockers

All blockers from `docs/UPGRADE-REPORT-2026-11-03.md` §8–§9 still apply (credentials, storage,
domain, client content, legal approval, real test-suite runs). Added by this upgrade:

1. Run `npm run typecheck`, `npm run build` and `npm run test:e2e` on a normal machine. This client code has only been checked with stubs and esbuild.
2. Check performance on real devices (mid-range Android, iPhone, low-end laptop) and in Safari/Firefox. Tune `ThreeDScene` quality bounds if needed.
3. Client design sign-off on the 3D direction, once real photos are loaded (placeholders understate it).
