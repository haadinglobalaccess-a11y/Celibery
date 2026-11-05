# Pending client information, credentials and approvals

Everything below is **configurable** in the finished system. Nothing has been invented to fill these gaps; the storefront hides or clearly marks missing values ("coming soon", draft banners, sample-product labels).

Approver for all items: **Usama M. Usman (BDM)** — Q39.

## Content & brand

| # | Item | Source question | Where to enter it |
|---|---|---|---|
| 1 | Logo files (light + dark). Client will send a logo for us to recreate as vector | Q9 | Admin → Settings → Brand (logo URLs) |
| 2 | Brand accent colour (current `#2563EB` is a placeholder) | Q2 | Admin → Settings → Brand |
| 3 | Full product list (~90 products: names AR/EN, models, SAR prices, specs, colours, stock) | Q14 | Admin → Products → Import CSV (template: `docs/product-import-template.csv`) or `npm run import:products` |
| 4 | Product photos (2 per product) and lifestyle photos, shot in Saudi Arabia | Q15 | Product form → Images; Website content → Banners |
| 5 | Hero video (see `docs/HERO-VIDEO-BRIEF.md`) | Q7 | Website content → Homepage → Hero video URL |
| 6 | Native Saudi Arabic review of all interface and marketing copy (current Arabic is a draft) | Q12 | `client/src/i18n/strings.ts`, Admin content fields |
| 7 | Approval of category Arabic names and per-category filters | Q13, Q18 | `docs/CATEGORY-FILTERS-FOR-APPROVAL.md`; Admin → Categories |
| 8 | Series names (client: "use ours for now") | Q16 | Product form → Series |
| 9 | Brand story text (only confirmed claims) | Q32 | Website content → Homepage → Brand story |
| 10 | Font pair approval (IBM Plex Sans Arabic + Plus Jakarta Sans proposed) | Q8 | `client/index.html`, `client/src/styles/tokens.css` |

## Legal & trust (required by Saudi e-commerce rules)

| # | Item | Source | Where |
|---|---|---|---|
| 11 | Commercial Registration (CR) number | Q29 | Settings → Business & legal |
| 12 | VAT number (15 digits) | Q29 | Settings → Business & legal |
| 13 | Registered business name and address | Trust table | Settings → Business & legal |
| 14 | Saudi Business Center verification status, verification URL and official badge | Q30 (unanswered) | Settings → Business & legal |
| 15 | Legal advisor approval of policy drafts: privacy, returns (return window), shipping (delivery days), warranty (coverage/exclusions), terms | Q31 | Website content → Policy pages |
| 16 | Approval for storing customer data with providers outside Saudi Arabia (MongoDB Atlas region, Vercel, email/WhatsApp providers) | Q33 (unanswered) | Hosting decision — Atlas offers a Middle East region; see DEPLOYMENT.md |

## Contact

| # | Item | Source | Where |
|---|---|---|---|
| 17 | WhatsApp number, support hours, email, phone, social links | Q34 (unanswered) | Settings → Business & legal. The WhatsApp button only appears once a real number is saved |

## Payments & operations (credentials — never commit them; set as environment variables)

| # | Item | Source | Notes |
|---|---|---|---|
| 18 | Payment gateway account + **test** and live keys (Moyasar adapter included; Tap / HyperPay / PayTabs need an adapter) | Q21 | `PAYMENT_GATEWAY`, `MOYASAR_*` |
| 19 | Apple Pay domain verification and STC Pay activation on the gateway account | Q20 | Done in the gateway dashboard |
| 20 | Tabby merchant code + keys, webhook registration | Q22 | `TABBY_*` |
| 21 | Cash-on-delivery rules: enable? fee (client says 0 — cost in price)? maximum order? | Q23 | Settings → Delivery, warranty & COD (currently **disabled**) |
| 22 | I Mile Logistics: tracking URL format and (optionally) API credentials | Q24 | Settings → Courier tracking URL template |
| 23 | Estimated delivery time text | Q25 | Settings → Delivery |
| 24 | SMTP credentials for order emails | Q28 | `SMTP_*` |
| 25 | WhatsApp Business Cloud API token, phone number id, approved `order_update` template | Q28 | `WHATSAPP_*` |
| 26 | Staff work emails for Usama M. Usman and Shuja Mubeen | Q27 | `npm run create-staff …` or Admin → Staff |

## Access & launch

| # | Item | Source |
|---|---|---|
| 27 | Shopify store access (export products, keep old product URLs — `/products/<handle>` redirects are built in) | Q35 |
| 28 | Domain & DNS for celibery.international | Q35 |
| 29 | GitHub organisation/repository and Vercel team | Build decisions |
| 30 | Analytics / ad accounts (none yet) — can be connected later | Q36 |
| 31 | Launch date (client: recommend once the site is ready) | Q38 |
| 32 | Whether to collect real reviews after launch (none to import) | Q19 |
