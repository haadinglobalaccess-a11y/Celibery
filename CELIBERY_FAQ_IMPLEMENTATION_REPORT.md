# CELIBERY — Dynamic FAQ System: Implementation Report

**Date:** 12 November 2026 · **State:** in the working tree; **not committed, pushed or deployed**.

The FAQ is fully database-driven. Staff manage every question, answer, category, heading and display option in the Admin Dashboard. The homepage preview and the `/faq` page read the same records. The React components contain no question, answer or category.

---

## 1. Audit findings that shaped the implementation

| Finding | Decision |
|---|---|
| No FAQ code, model or content existed | New `Faq` and `FaqCategory` models |
| The existing `Page` model holds a fixed set of legal pages with approval workflow (one body per page) | Not reused: it cannot store ordered, categorised, individually published Q&A without changing legal-page behaviour |
| Rich text elsewhere uses a safe Markdown → React renderer (`client/src/lib/markdown.tsx`, no HTML strings) | Reused and extended **opt-in** (`rich` mode: numbered lists and links). Policy pages render exactly as before |
| Website content is guarded by the `content:write` permission (Content Manager, Administrator, Super Administrator) | FAQ routes use `content:write`; no new permission was needed |
| The homepage has **no** Customer Reviews / Testimonials section; product reviews exist only on product pages. The newsletter is in section 08 (`ClosingCampaign`) | The FAQ preview is placed after section 07 (`BrandStory`) and directly **before the newsletter / closing section**, which matches the brief's intent. No other section moved |
| `/api/home` is `no-store` and already feeds the whole homepage | The FAQ preview is embedded in `/api/home`: **no extra homepage request** |
| Storefront URLs are language-prefixed (`/ar/…`, `/en/…`) | Page at `/:lang/faq`; `/faq` redirects to the visitor's preferred language |

---

## 2. Architecture and data flow

```
Admin → Website → FAQ management (client/src/admin/pages/Faq.tsx)
  → /api/admin/faq/*  (staff session + content:write + CSRF header + zod validation)
  → modules/faq/faq.service.ts  (single source of truth)
  → MongoDB: faqs, faqcategories, settings.faq
  → public:  GET /api/faq            → /ar/faq, /en/faq        (client/src/pages/FaqPage.tsx)
             GET /api/home (.faq)     → homepage FAQ preview     (client/src/storefront/Faq.tsx → HomeFaq)
```

**Freshness:**
- `/api/home` is `no-store`.
- `/api/faq` is `no-cache` (revalidated with an ETag on every load), and the `/faq` page fetches on every visit.
- A change made in the admin is therefore visible on the next page load. No stale cache is involved.

---

## 3. Admin Dashboard

**Location:** sidebar → **Website** group → **FAQ management** (`/admin/faqs`). Arabic label: *إدارة الأسئلة الشائعة*.

*Why `/admin/faqs` and not `/admin/faq`:* the storefront route `/:lang/faq` outranks `/admin/*` in React Router for the URL `/admin/faq` (found by the E2E test).

| Tab | Features |
|---|---|
| **Questions** | 5 counters: total, published, drafts, on the homepage, categories. Debounced search (Arabic + English, questions + answers). Filters by category, status and homepage. Sorts by display order, last updated, or A–Z. Each row shows: order with ↑ ↓, English question, Arabic question, category, status, homepage, last updated, and actions (Edit, Publish/Unpublish, Duplicate, Delete with confirmation). Loading, empty, error and paging states |
| **Editor** (modal) | Question and answer in Arabic (RTL) and English (LTR) side by side, with a formatting hint. Category, display order, status, *Show on homepage*, *Featured*, optional SEO title/description. Per-language completeness. **Save as draft** / **Publish**. **Preview** tab renders both languages with the storefront styles |
| **Categories** | Add, edit (bilingual name, web address, visible), reorder ↑ ↓, delete. A category that still holds FAQs can only be deleted after choosing where they go (another category or "No category"). There is a one-click *Add the 7 suggested categories*, offered only when no category exists; the suggestions are editable and deletable, and are **never seeded automatically** |
| **Display settings** | Homepage section on/off and number of questions (1–12); homepage category filters; one-open vs several-open accordion; heading and subtitle (both languages, optional); missing-translation policy |

---

## 4. Database

**`faqs`**
- **Fields:** `question{ar,en}`, `answer{ar,en}`, `category` (ref, nullable), `status` (`draft`|`published`), `showOnHomepage`, `featured`, `sortOrder`, `seoTitle{ar,en}`, `seoDescription{ar,en}`, `publishedAt`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt`.
- **Indexes:**
  - `{status, sortOrder, _id}` — public page
  - `{status, category, sortOrder}` — category views
  - `{status, showOnHomepage, sortOrder}` — homepage
  - `{updatedAt: -1}` — admin "last updated" sort

**`faqcategories`**
- **Fields:** `slug` (unique), `name{ar,en}`, `visible`, `sortOrder`, timestamps.
- **Index:** `{visible, sortOrder}`.

**`settings.faq`** (store settings document):
- **Fields:** `homepageEnabled`, `homepageLimit`, `showCategoryFilters`, `title{ar,en}`, `subtitle{ar,en}`, `missingTranslation` (`hide`|`fallback`), `allowMultipleOpen`.

No migration is needed. Collections and indexes are created by Mongoose, and missing settings fall back to defaults in code.

---

## 5. API

### Admin — `/api/admin/faq` (staff session · `content:write` · CSRF header · zod)

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | List: `q` (≤ 100 chars, escaped), `category` (id or `none`), `status`, `homepage`, `sort`, `page` (≤ 1000), `limit` (≤ 100). `meta.stats` holds the dashboard counters |
| POST | `/` | Create |
| GET | `/:id` | Read one |
| PUT | `/:id` | Update |
| PATCH | `/:id/status` | Publish / unpublish |
| POST | `/:id/duplicate` | Copy as a draft, placed right after the original, not on the homepage |
| POST | `/:id/move` | Move up / down one place |
| POST | `/reorder` | Set the order of up to 500 FAQs |
| DELETE | `/:id` | Delete |
| GET / POST | `/categories` | List (with FAQ counts) / create |
| PUT / DELETE | `/categories/:id` | Update / delete (`?reassignTo=<id>|none` is required when the category holds FAQs, otherwise 409 `CATEGORY_IN_USE`) |
| POST | `/categories/reorder` | Category order |
| GET / PUT | `/settings` | Display settings |

Every write is recorded in the admin Activity log (`faq`, `faq_category`, `faq_settings`).

### Public

| Method | Path | Returns |
|---|---|---|
| GET | `/api/faq` | Display settings, the categories that are visible **and** used, and published FAQs (≤ 500). Per FAQ: `id`, `question`, `answer`, `categoryId`, `featured` only |
| GET | `/api/home` → `faq` | Same allow-listed fields, homepage-selected questions only, limited to the configured count |

Questions in a hidden category are not public. There is no public write route.

---

## 6. Storefront

| Component | File | Notes |
|---|---|---|
| `HomeFaq` | `storefront/Faq.tsx` | Two-column editorial layout (sticky heading and *View all FAQs* link; questions on the right), stacked on mobile. Optional category chips. Renders **nothing** until a published, homepage-selected question exists |
| `FaqPage` | `pages/FaqPage.tsx` | Heading and subtitle, search, category chips, results count (`aria-live`), empty / no-results states, skeleton while loading, error with retry, *contact us* link (WhatsApp or email from Settings; omitted when neither is set). Featured questions lead the unfiltered list. `#faq-<id>` deep links open that question |
| `FaqAccordion` | `storefront/Faq.tsx` | WAI-ARIA accordion: `<button aria-expanded aria-controls>` inside a heading, labelled `region`. Enter/Space toggle; ↑ ↓ Home End move focus. Closed answers are `inert`. Visible focus ring. CSS-only unfold animation, disabled under `prefers-reduced-motion`. One-open by default; several-open is an admin setting |
| Styles | `styles/faq.css` | Uses the existing `cx-*` tokens. Hairline dividers, plus → minus icon, no shadows or gradients, restrained hover, full RTL mirroring |

### Bilingual behaviour
- Arabic renders RTL and English LTR (the document direction comes from the language prefix).
- Each language is separate content written by staff; nothing is machine-translated.
- **Missing translation** is set by the admin:
  - **hide** (default): the question is not shown in that language.
  - **fallback**: the other language is shown with its own `dir`, `lang` and font.
- Arabic search ignores diacritics and alef / yaa / taa-marbuta variants.

---

## 7. SEO

- **Metadata:** unique title, meta description (admin subtitle or default), canonical URL, `hreflang` ar-SA / en-SA, Open Graph and locale, all through the existing `useSeo` hook.
- **Sitemap:** `/ar/faq` and `/en/faq` are listed **only once something is published**, with `lastmod` = the last published change.
- **Structured data:** `FAQPage` JSON-LD with only the published questions shown in that language (plain-text answers, ≤ 100). The element is omitted when there are none.
  - Google currently shows FAQ rich results only for well-known, authoritative government and health sites, so **rich-result display is not expected**. The markup is still valid and describes real content. No fake or keyword-stuffed questions were added.
- **Note:** the site is a client-rendered SPA. Search engines that render JavaScript see this metadata. Non-rendering crawlers see the static `index.html` (an existing, site-wide limitation).

---

## 8. Security controls

| Risk | Control | Test |
|---|---|---|
| Broken access control / IDOR | All admin routes: staff session + `content:write`; ids validated as ObjectIds | Anonymous 401, customer 403, Order Manager 403 on list / create / update / status / delete / categories / settings; record unchanged |
| CSRF | Existing `X-Requested-With` guard | Staff session without the header → 403 |
| Stored XSS / HTML injection | Server refuses HTML tags and comments in questions and answers. Rendering produces React elements only (no `dangerouslySetInnerHTML`) | `<script>`, `<img onerror>`, HTML in questions → 400 |
| Unsafe links | Links only `https?://host…` or `/path` (not `//` or `/\`), checked on save **and** on render. External links get `rel="noopener noreferrer"` | `javascript:`, `data:`, `//evil` → 400 |
| NoSQL injection / prototype pollution | zod schemas; existing global `$`/`__proto__` key guard; search escaped and capped at 100 characters | `q[$ne]` → 400, `$where` → 400 |
| Mass assignment | Allow-listed fields; `_id`, `createdBy`, `publishedAt`, `createdAt` from the client are ignored | Test |
| Excessive data exposure | Public views map to 5 allow-listed fields; drafts, status, SEO notes, authors and order are never public | Field-list test |
| Unbounded queries | Admin `limit` ≤ 100, `page` ≤ 1000; public ≤ 500; categories ≤ 200; reorder ≤ 500 unique ids; indexed filters | `limit=100000` → 400 |
| Rate limiting | Existing global API limiter (300/min per IP). Writes are staff-only | — |
| Data loss | A category holding FAQs needs an explicit reassignment; deletes ask for confirmation; Activity log | Test |

---

## 9. Files changed

**New**
- `server/src/models/Faq.ts`, `server/src/lib/faq-content.ts`
- `server/src/modules/faq/faq.schemas.ts`, `faq.service.ts`, `faq.routes.ts`
- `client/src/storefront/Faq.tsx`, `client/src/pages/FaqPage.tsx`, `client/src/styles/faq.css`, `client/src/admin/pages/Faq.tsx`
- `server/tests/faq.test.ts`, `server/tests/unit/faq-content.test.ts`, `e2e/faq.spec.ts`

**Modified (integration only)**

| File | Change |
|---|---|
| `server/src/models/Settings.ts` | `faq` block |
| `server/src/models/index.ts` | Export |
| `server/src/modules/admin/index.ts` | Mount `/faq` |
| `server/src/modules/catalog/catalog.routes.ts` | `GET /api/faq` |
| `server/src/modules/catalog/catalog.service.ts` | `faq` in the home payload |
| `server/src/modules/catalog/catalog.controller.ts` | Sitemap entry |
| `client/src/App.tsx` | `/faq` redirect, `/:lang/faq` |
| `client/src/pages/Home.tsx` | One `<HomeFaq>` line before section 08 |
| `client/src/lib/markdown.tsx` | Opt-in `rich` mode + `markdownToText` |
| `client/src/lib/types.ts` | FAQ types |
| `client/src/i18n/strings.ts` | Interface wording only |
| `client/src/admin/AdminApp.tsx`, `admin/i18n.tsx`, `admin/icons.tsx` | Nav item, route, label, icon |
| `e2e/playwright.config.ts` | Run `faq.spec.ts` on mobile too |

No dependency was added. Hero, navbar, other homepage sections, product pages, cart, checkout, reviews and the footer are untouched.

---

## 10. Tests

| Suite | Result |
|---|---|
| `npm run typecheck` (server, client, api) | Passed |
| `npm run build` | Passed |
| `npm test` (server unit + integration) | **30 files, 288 tests passed**, exit 0 (before this feature: 28 files, 274 tests). New: 9 integration + 5 unit tests |
| `e2e/faq.spec.ts` (Playwright, real admin UI + storefront) | 7 passed: 5 desktop workflow tests and the layout test on desktop and mobile (the admin workflow is skipped on the mobile project by design) |
| Full E2E `npm run test:e2e` | **98 passed, 6 skipped, 0 failed** (11.7 min). Before: 91 passed, 1 skipped. The 7 new passes are the FAQ tests; the 5 new skips are the FAQ admin-workflow tests on the mobile project, skipped by design |

Brief scenarios 1–20 map to:
- **Server tests:** lifecycle (1–14), access control (15), search, filters and categories (18).
- **E2E:** create draft in the UI and verify not public (1–3); publish and check `/faq` in English LTR and Arabic RTL, plus keyboard (4–5, 16–17, 20); homepage visibility, edited answer and order (6–11); search, Arabic search and category filters (18); unpublish, delete with confirmation and anonymous write refused (12–15); no horizontal scroll on mobile and desktop in both languages (19).

Design was reviewed from screenshots (desktop and mobile, Arabic and English) during development.

---

## 11. Remaining limitations

1. **Owner action:** no FAQs exist in production until staff write them (by design: no dummy content). The homepage section stays hidden until then.
2. Reordering is ↑ ↓ (one step) plus an exact *Display order* number; there is no drag-and-drop.
3. The per-FAQ SEO title and description are stored and editable but not rendered (there is no page per question). The FAQ page's title and description come from Display settings.
4. Structured data and metadata depend on JavaScript rendering (SPA; see §7).
5. The Admin FAQ page is English-only inside the Arabic admin shell, like the other untranslated admin pages. FAQ content fields are bilingual.
6. Google rich results for FAQs are not expected for a commercial site (§7).
