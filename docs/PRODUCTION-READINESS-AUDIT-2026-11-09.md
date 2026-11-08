# Production readiness audit — 2026-11-09

Scope: the whole repository (storefront, admin dashboard, API, models, integrations, jobs, SEO,
deployment config, tests). Each area was traced from UI → API → database. This report records
what was **changed** in this pass and what is **still open**. Earlier work is listed in
`FEATURE-CHECKLIST-2026-11-08.md` and was re-verified by running the full test suites below.

Status legend: **Fixed ✔** (fixed and verified by a test or build) · **Awaiting credentials** ·
**Business info needed** · **Provider setup needed** · **Not implemented** · **Blocked**

## 1. Area checklist

| Area | Result |
|---|---|
| Catalogue, categories (6 approved), search, filters, sort | Verified (existing tests pass) |
| Product page | Fixed ✔ — reviews section, social tags, schema.org Product |
| Cart, coupons, checkout (server prices, atomic stock, idempotency) | Verified — no change needed |
| Accounts, profile, addresses, wishlist, order history, tracking | Verified — owner / staff (`orders:read`) / hashed guest token only; unknown orders return 404 |
| Returns / refunds ledger | Verified |
| Reviews & ratings | Fixed ✔ — the API existed but the storefront never used it |
| Homepage, header, footer, mobile nav | Fixed ✔ — Admin SEO title/description now applied; footer SBC dead link |
| Admin: products | Fixed ✔ — CSV **export** added (import existed); list error state |
| Admin: orders / overview / reports | Fixed ✔ — CSV export links broke when the API is on another origin |
| Admin: settings (store, legal, brand, shipping zones, COD, returns, SEO, payments) | Verified |
| Admin: SMTP / WhatsApp / Moyasar / Tabby / I Mile / S3 credentials | Verified — encrypted at rest, masked, test-connection; no hardcoded business credentials found |
| Security (auth, roles, CSRF header, CORS, validation, uploads, webhooks) | Verified; CSV import race fixed |
| Scheduled jobs | Fixed ✔ — ran only on Vercel Cron; now also run in-process on long-running servers |
| Deployment (Vercel + Railway) | Fixed ✔ — graceful shutdown, `COOKIE_SAMESITE`, Railway guide |
| Dummy / placeholder content | Fixed ✔ — 52 backup files removed; mojibake in admin labels repaired |

## 2. Changes in this pass

### Nonfunctional features fixed
1. **Customer reviews** (`client/src/components/ProductReviews.tsx`): turning on "Show reviews" in Admin did nothing on the store. The product page now lists approved reviews and the rating summary. Signed-in customers get a review form. The server still allows reviews only for a delivered order and holds each one for moderation. A `status` sent by the client is ignored.
2. **Admin → SEO title/description**: these were saved and sent to the browser, but the homepage still used fixed text. The homepage now uses them.
3. **CSV export links** in Admin → Orders and Overview used a bare `/api/...` URL. Under the current Railway setup (API on its own service via `VITE_API_BASE_URL`) the download opened the storefront instead of the file.
4. **Footer "SBC verified" badge** linked nowhere when no verification URL was saved. It now shows as plain text in that case.
5. **Admin → Products**: an API error left the list spinning forever. It now shows an error with a retry button.
6. **Settings changes were not visible after a save and refresh** for up to about 2.5 minutes. `/api/settings/public` was sent with `max-age=30, stale-while-revalidate=120`, so browsers kept the old copy. This affected the announcement bar, SEO text, contact details and the reviews switch. It is now `no-cache`: the browser checks every load and gets a 304 when nothing changed. Found by the new browser test.

### New
- **Product CSV export** (`GET /api/admin/products/export.csv`, "Export CSV" button): uses the import template columns. The exported file re-imports without changes (tested). It filters by status/category, includes a `data_source` column so sample products stay labelled, and is written to the activity log.
- **SEO**: Open Graph / Twitter tags on every page. schema.org `Product` on real products only: sample products get none, and `aggregateRating` appears only when approved reviews exist. schema.org `Organization` uses only the business fields saved in Admin. `noindex` is set on cart, checkout, account, auth, tracking and search-result pages.
- **In-process scheduler** (`server/src/jobs.ts`): `npm start` releases expired stock reservations every 5 minutes, and reconciles refunds and cleans up abandoned uploads every 30 minutes. Before this, on Railway these jobs only ran when someone opened the admin. Set `DISABLE_INTERNAL_SCHEDULER=true` to turn it off. The cron endpoints share the same code.
- **Graceful shutdown** on SIGTERM: in-flight requests finish before the database connection closes.
- **`COOKIE_SAMESITE`**: the default keeps today's behaviour (`none` in production). Set `lax` for single-origin deployments, which is the stronger setting.

### Data / security
- CSV import sets stock only if stock has not changed since the row was read. Before, an order placed during an import could have its stock reservation overwritten. A conflict is now reported for that row.
- CSV writer moved to `lib/csv.ts` and shared by the orders and products exports. It guards against spreadsheet formula injection, and the import removes that guard again.

### Hygiene
- Removed 52 tracked backup files (`*.backup-*`, `backups/`, `fix-admin-mojibake.ps1`, `index.html.backup…`). Nothing imported them, and git history keeps them. Added ignore rules so new ones are not committed.
- Repaired garbled characters (a closing quote shown as two Latin characters) in Admin content/settings labels. Stripped UTF-8 BOMs from 14 source files.

## 2b. Product descriptions, Add to Cart and content quality (second pass)

Traced: Admin product form → API schema → database → public product API → product page → Add to Cart panel → cart → checkout summary → order snapshot → customer order page and emails.

**What the cart path does (verified, correct):** the Add to Cart panel and the cart show name, model, quantity and price only — never the long description. Prices, names and images come from the server quote, never from the browser. The order stores its own snapshot: product id, SKU, model, name, unit price, quantity.

**Root causes found and fixed**

| Problem | Cause | Fix |
|---|---|---|
| Raw HTML, `&amp;`/`&nbsp;` and garbled characters could appear in product text | Text was stored and shown exactly as typed or imported. Shopify exports and copy-paste from web pages contain HTML, and text saved with the wrong encoding shows Latin-character sequences in place of apostrophes and Arabic letters. | `server/src/lib/text.ts` normalises product name, short description, description and specs **when saved** (Admin form and CSV import) **and when served**, so text saved earlier is fixed without a database migration. HTML becomes paragraphs/bullets, entities are decoded, encoding damage is repaired, bullet styles are unified. |
| Bullets and paragraphs showed as literal text | The product page printed the description as one pre-formatted block | `client/src/components/RichText.tsx` renders paragraphs, `- ` bullets, `### ` sub-headings and `**bold**` as React elements (no HTML injection possible), in Arabic and English. Admin form explains the format. |
| Cart showed an out-of-date product link and model | Cart lines used the browser's saved snapshot for slug and model | Cart uses the current server quote; the snapshot is only a placeholder until the quote loads. |
| Homepage "Why CELIBERY" promised a warranty, six payment methods and WhatsApp support regardless of setup | Fixed text | Each promise now appears only when Admin settings make it true. Payment logos (homepage, footer, checkout) show only methods with a configured gateway. |
| Arabic warranty text was ungrammatical ("1 سنوات", "3 شهر"); "ضمان معتمد" ("certified warranty") claimed more than the English | Simple string template | Correct Arabic number agreement; neutral title "الضمان". |

**Sample products (dummy content):** the seeded demo products carry text such as "Over-ear wireless sample" and "Sample product used only to preview the store design". The storefront labels them, but they are still dummy content. If the live database contains them, a customer sees this text next to Add to Cart. They must be replaced by the real product list (Admin → Products → Import CSV), then removed with `npm run seed:demo -- --remove`. That command deletes data on the live database, so it needs the owner's go-ahead. I could not check the live database: the read-only check was blocked by the session's permission rules.

## 2c. Text encoding (mojibake) — repository-wide repair

**Audit.** I scanned all 298 text files in the repository (source, styles, HTML, JSON, translations, seed data, templates, docs, tests) and every file of the production build. The detector reverses UTF-8 shown as Windows-1252/Latin-1 byte by byte, so it finds every damaged character. A fixed pattern list misses damaged arrows, for example. It also checks for invalid UTF-8, BOMs, U+FFFD, and raw control or invisible characters.

**Found and repaired (8 files):**

| File | Damage | Visible to |
|---|---|---|
| `client/src/admin/pages/Products.tsx` | "← Products" back link, "View ↗", "Settings → Warranty" arrows shown as Latin-character sequences | Staff |
| `client/src/admin/pages/Content.tsx` | "Arabic/English homepage ↗", banner and campaign date ranges "→"; invisible U+009D control characters left after quotes | Staff |
| `client/src/admin/pages/Settings.tsx` | The Arabic example city in the delivery-zones hint (الرياض) shown as Latin letters | Staff |
| `client/src/admin/admin.css`, `client/src/three-d/campaignHero.css` | 8 raw Windows-1252 bytes (0x97, em dash): invalid UTF-8 | Comments only |
| `client/src/styles/immersive.css` (and 1 in `campaignHero.css`) | 7 characters already lost (U+FFFD) | Comments only |
| `e2e/hero-duration.check.cjs`, `e2e/hero-provider-state.check.cjs` | UTF-8 BOM | — |
| `Orders.tsx`, `csv.ts`, `catalog.routes.ts`, `system.routes.ts` | Raw invisible BOM characters in code (Excel CSV prefix); now written as escapes | — |

Each was repaired by decoding the original bytes back, never retyped or guessed. For U+FFFD in comments, the em dash is the separator every neighbouring comment uses. No customer-facing storefront text was damaged. The Arabic and English strings, seed data, email and WhatsApp templates were already correct. The project contains no Urdu text.

**Root causes, now fixed:**
1. **Product CSV import decoded every file as UTF-8.** Excel's plain "CSV (Comma delimited)" is Windows-1256 on Arabic Windows, and Windows-1252 on English Windows. Decoded as UTF-8, every Arabic letter became U+FFFD and was saved that way: permanent loss. The Admin upload (`client/src/lib/textFile.ts`) and `npm run import:products` now detect the encoding (UTF-8, else Windows-1256 if it gives Arabic, else Windows-1252) and tell staff when a file was converted.
2. **Files saved in a Windows code page** (the earlier mojibake fix script). `.editorconfig` and `.vscode/settings.json` now set UTF-8.
3. **No guard on saved text.** Every Admin text field now repairs reversible damage on save and refuses text containing U+FFFD with a clear message: product, settings, content, media and message templates. Legitimate Unicode is never refused. The repair works per character sequence, so mixed Arabic/English strings and double-encoded text are fixed while correct text around them is untouched.

**Database.** I could not inspect the live database from this session; the read-only query was blocked by the session's permission rules. So it is unknown whether stored records are affected. `npm run repair:text` lists every affected record and field (before → after) and changes nothing by default. `--apply` first writes a JSON backup of the original values to `server/text-repair-backups/`, then updates each field only if it still holds the scanned value. `--restore <backup>` undoes it. Records with lost characters (U+FFFD) are reported for re-entry, never guessed. Orders are only reported unless `--include-orders` is passed. Recommended: run the dry run on production, review the list, then `--apply`. Product text is also repaired automatically when served, so the storefront shows correct text even before the repair runs.

**Charset.** `index.html` declares UTF-8 before any text. JSON, robots, sitemap and llms.txt are served with `charset=utf-8`. CSV exports are `text/csv; charset=utf-8` with a BOM for Excel. Emails use nodemailer's UTF-8 default, WhatsApp is JSON (UTF-8), and MongoDB stores UTF-8. All verified by tests.

## 3. Still open

| Item | Status |
|---|---|
| Moyasar / Tabby live or sandbox merchant keys (adapters tested only against mocked HTTP) | Awaiting credentials |
| SMTP account, WhatsApp Cloud API token + approved `order_update` template | Awaiting credentials (tested against a local SMTP server and a mocked Meta API) |
| S3 bucket (`S3_ENDPOINT`, `S3_BUCKET`, `MEDIA_PUBLIC_BASE_URL`) | Provider setup needed |
| I Mile API booking/tracking | Blocked — no API documentation (manual tracking works) |
| Live database text encoding: run `npm run repair:text` (dry run) on production, review, then `--apply` (backup is automatic) | Needs owner to run — live data not inspected |
| Sample (demo) products in the live database, if present: replace with the real list, then `npm run seed:demo -- --remove` | Needs owner approval — destructive on live data; live data not inspected |
| Real product list, photos, logo, accent colour (`#2563EB` is a placeholder), hero video | Business info needed (`PENDING-CLIENT-INFO.md`) |
| CR / VAT numbers, legal name, address, contact, social links | Business info needed (footer shows "coming soon") |
| Policy pages approval (still drafts), return window | Business info needed — legal review |
| Native Arabic review of interface copy, including the new review strings | Business info needed |
| Rate limiting is in-memory per instance (weak on Vercel serverless / several instances) | Not implemented — needs a shared store (e.g. Redis) or the host's WAF |
| Error monitoring (Sentry or similar) | Not implemented — structured JSON logs only |
| Database backups | Provider setup needed — enable Atlas backups and test a restore |
| Railway: client served with `vite preview`; two `*.up.railway.app` sites need `SameSite=None` cookies | Deployment change recommended — see `DEPLOYMENT.md` → Railway |

## 4. Verification (2026-11-09)

- `npm run typecheck` (server, client, api): clean
- `npm run build`: passes. The built bundle was checked: no secrets, no hard-coded API host.
- `npm test`: 197/197 passed, 21 files (baseline before changes: 186/186). New files: `server/tests/production-readiness.test.ts`, `server/tests/unit/text.test.ts`.
- `npm run test:e2e`: 54 passed, 1 skipped (already skipped before), 0 failed — desktop, mobile and tablet. New files: `e2e/production-readiness.spec.ts`, `e2e/product-journey.spec.ts`. The first run of the reviews test exposed the settings cache bug (§2 item 6).
