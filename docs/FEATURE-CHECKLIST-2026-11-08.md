# CELIBERY — feature checklist (2026-11-08)

Status after the backend / Admin closure work. **Verified** means an automated test exercises the
feature end to end in this repository (server tests: `server/tests`, browser tests: `e2e/*.spec.ts`).

Legend: ✅ done and verified · 🟡 done; real third-party test blocked by missing credentials · ⛔ blocked (external information needed)

Test runs on 2026-11-08: **server 175/175 passed (18 files)** · **browser 47 passed, 1 skipped (desktop, mobile, tablet)** · typecheck clean (server, client, API) · production build passes.

## Storefront

| Feature | Status | Evidence |
|---|---|---|
| Arabic (RTL, default) / English (LTR), language switch keeps the page | ✅ | `shop-flow.spec` 1–2, `responsive.spec` |
| Homepage sections, categories (6), category filters, product pages | ✅ | `catalog.test`, `shop-flow.spec` 3–7 |
| Search — desktop and mobile | ✅ | `shop-flow.spec` 4 (desktop search had been unreachable since the navbar redesign; restored via the header search icon) |
| Cart, quantity limits, stock issues, cart survives language switch | ✅ | `checkout.test`, `shop-flow.spec` 5–7 |
| Discount codes in cart and checkout (incl. Enter key, no accidental order) | ✅ | `discounts.test`, `coupon.spec` |
| Checkout: server-authoritative pricing, idempotent, no overselling | ✅ | `checkout.test` |
| Delivery zones priced by city at checkout (Arabic/English city names) | ✅ | `closure.test`, `closure.spec` |
| Cash on delivery: switch, fee, min/max, cities, per-zone availability | ✅ | `checkout.test`, `unit/delivery-rules.test`, `closure.test` |
| Delivery promise text follows shipping settings | ✅ | `admin-controls.spec` |
| Guest order tracking (token full view / phone limited view), customer orders | ✅ | `checkout.test`, `shop-flow.spec` 11–13 |
| Customer return requests from the order page, status visible to the customer | ✅ | `returns.test`, `closure.spec` |
| Accounts: register, login lockout, password reset, addresses, wishlist | ✅ | `auth.test`, `checkout.test` |
| No horizontal overflow on mobile/tablet; images not broken | ✅ | `responsive.spec` |
| `robots.txt` from SEO settings; `llms.txt` and `sitemap.xml` generated from live data | ✅ | `admin-controls.test`, `closure.test`, `catalog.test` |

## Payments

| Feature | Status | Evidence |
|---|---|---|
| Sandbox gateway end to end (pay, verify, retry, expiry release) | ✅ | `checkout.test`, `shop-flow.spec` 8–10 |
| Moyasar (mada/Visa/Mastercard/Apple Pay/STC Pay) and Tabby adapters | 🟡 | `payments.test` against mocked HTTP; no merchant sandbox/live keys supplied |
| Webhooks: signature, replay protection, amount mismatch → manual review | ✅ | `payments.test`, `upgrade.test` (webhook lifecycle) |
| Refund ledger: idempotent, concurrent-safe, uncertain outcomes reconciled | ✅ | `upgrade.test` (refund ledger), `admin.test` |
| Gateway credentials in Admin: encrypted, masked, mode checks, verify before enable, typed LIVE | ✅ (logic) / 🟡 (real gateway) | `upgrade.test` (gateway credentials) |

## Admin Dashboard

| Feature | Status | Evidence |
|---|---|---|
| Role-based permissions enforced on the server; staff invites; roles | ✅ | `auth.test`, `admin.test` |
| Products (SAR → halalas), categories, CSV import, archive instead of delete | ✅ | `admin.test` |
| Inventory ledger, adjustments, low-stock alerts | ✅ | `admin.test` |
| Orders: fulfilment workflow, tracking, notes, refunds, CSV export | ✅ | `admin.test`, `shop-flow.spec` 11–13 |
| **Returns**: requested → approved → received (restock) → refunded; reject with reason; customer cancel; audit; notifications | ✅ | `returns.test`, `closure.spec` |
| Discounts: create/edit/delete (used codes protected), all rules | ✅ | `discounts.test`, `admin-controls.test/spec` |
| Customers: view, suspend / reactivate (sessions revoked) | ✅ | `admin-controls.test/spec` |
| Content: banners, campaigns, collections, policy pages with revisions and approval | ✅ | `admin.test`, `upgrade.test` (policy pages) |
| Media library: direct uploads (content-verified), URLs, usage protection | ✅ | `upgrade.test` (media library), `unit/media.test` |
| Settings: store/legal/brand/shipping/COD/VAT/stock/returns/SEO, permission-split | ✅ | `admin.test`, `upgrade.test` (settings & permissions), `returns.test` |
| **Delivery zones** editor (fee, free threshold, COD, COD fee, ETA, unlisted cities) | ✅ | `closure.test`, `closure.spec` |
| **Message templates** (AR/EN email subject + text, WhatsApp status text): placeholders validated, preview, reset | ✅ | `closure.test`, `closure.spec` |
| Email (SMTP) / WhatsApp credentials: encrypted, test connection, test email, enable/disable | ✅ (local SMTP server, mocked Meta API) / 🟡 (real providers) | `admin-controls.test/spec` |
| Notification delivery log | ✅ | `admin-controls.test/spec` |
| Media storage (S3) access key: encrypted, tested by real write + delete, rotation | ✅ (stand-in S3 endpoint; SigV4 matches AWS vectors) / 🟡 (real bucket) | `closure.test`, `unit/csp-redact-sigv4.test` |
| Reports in Riyadh calendar days; overview KPIs; activity (audit) log | ✅ | `admin-controls.test`, `admin.test` |

## Integrations and infrastructure

| Item | Status | Notes |
|---|---|---|
| I Mile Logistics — manual fulfilment with tracking numbers and tracking links | ✅ | `admin.test` |
| I Mile Logistics — API booking / tracking | ⛔ | No I Mile API documentation exists in the project; requirements listed in `docs/IMILE-INTEGRATION.md`. Credentials can already be stored (encrypted). |
| S3 endpoint / bucket / public URL | Server environment by design | Saved media URLs, deletions and the upload CSP depend on them; the access key is manageable in Admin. See `docs/DEPLOYMENT.md`. |
| Credentials encryption key (`CREDENTIALS_ENCRYPTION_KEY`), JWT, cron secret, database URI | Server environment by design | Bootstrap secrets: they protect or unlock everything stored in the database, so they cannot live in it. |

## Business decisions still needed from the client

- Final **return window** (setting defaults to 7 days, the Saudi E-Commerce Law withdrawal period) and the approved returns policy text (policy pages are still drafts).
- Merchant credentials: Moyasar, Tabby, SMTP provider, WhatsApp Business (approved order-update template with 3 body parameters), S3 bucket, I Mile API documentation.
- Delivery zones and fees if free delivery everywhere (Q25) changes.
