# CELIBERY API reference

Base path: `/api`. JSON in, JSON out.

- **Success:** `{ "ok": true, "data": …, "meta"?: { total, page, pages } }`
- **Error:** `{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details"?: … } }` with a matching HTTP status (400, 401, 403, 404, 409, 413, 422, 429, 500, 503). Internal errors never include stack traces.
- **Money:** every amount is an **integer in halalas** (1 SAR = 100). Admin *inputs* for prices are in SAR and converted on the server.
- **Auth:** HTTP-only cookie `cel_session` (JWT, HS256). Customers 7 days, staff 12 hours. Session is invalidated on password change, reset or deactivation.
- **CSRF:** every non-GET request must send `X-Requested-With: celibery` (webhooks and cron are exempt).
- **Rate limits:** 300 req/min per IP overall; 20 / 15 min on auth endpoints; 20 / min on checkout.

## Public catalogue

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/home` | Homepage payload: hero (video/banners), categories, per-category products, featured, best sellers (`source: orders` from real sales, `curated` fallback), collections, active campaigns, brand story |
| GET | `/settings/public` | Business details, brand, delivery/warranty, available payment methods. No secrets |
| GET | `/categories` | Six categories with product counts |
| GET | `/categories/:slug` | Category + **facets limited to that category's configured filters** |
| GET | `/products` | Query: `category, collection, q, sort(featured|newest|price_asc|price_desc|name), page, limit≤60, minPrice, maxPrice (SAR), capacity, power, connector, color (comma lists), inStock=1, ids, lang` |
| GET | `/products/:slug` | Detail incl. specs, warranty months, delivery info, related products, bundles containing it, bundle contents. Exact stock is not exposed (only `available`, `lowStock`) |
| GET | `/products/:slug/reviews` | Approved reviews (empty while reviews are disabled) |
| POST | `/products/:slug/reviews` | Customer with a **delivered** order for the product only |
| GET | `/collections/:slug` | Curated collection with products |
| GET | `/campaigns/:slug` | Active campaign landing page data |
| GET | `/pages/:slug` | Policy page (`shipping, returns, warranty, privacy, terms`) incl. `status: draft|approved` |
| POST | `/newsletter` | `{ email, lang }` |
| GET | `/sitemap.xml` | Both languages with hreflang alternates |

## Cart, checkout, orders

| Method | Path | Body / notes |
|---|---|---|
| GET | `/checkout/options` | Available payment methods, delivery info, COD rules |
| POST | `/cart/quote` | `{ items:[{productId, quantity}], discountCode?, paymentMethod?, email? }` → authoritative lines, issues (`OUT_OF_STOCK`, `QUANTITY_LIMITED`, `UNAVAILABLE`), subtotal, discount, delivery, COD fee, total, VAT included |
| POST | `/checkout` | `{ idempotencyKey, items, contact{name,email,phone}, shippingAddress{fullName,phone,city,district,street,buildingNumber,postalCode,shortAddress,notes}, paymentMethod(card|applepay|stcpay|tabby|cod), discountCode?, customerNote?, lang, saveAddress? }` → `{ order, accessToken, redirectUrl, paymentId? }`. Re-quotes on the server, reserves stock atomically in a transaction, consumes the discount, persists the order. Replaying the same `idempotencyKey` returns the original order (200) |
| GET | `/orders/track?orderNumber&token` | Full order view for the guest token holder |
| GET | `/orders/track?orderNumber&phone` | **Limited** status view (no address or contact data) |
| GET | `/orders/:orderNumber?token` | Owner (customer), token holder or staff |
| POST | `/orders/:orderNumber/verify-payment` | `{ token? }` — server asks the gateway for the real status |
| POST | `/orders/:orderNumber/retry-payment` | `{ token? }` — new payment for an unpaid, unexpired order |

Order statuses: `pending → confirmed → processing → shipped → delivered`, `cancelled` (from pending/confirmed/processing), `returned` (from shipped/delivered). Payment statuses: `pending, paid, failed, expired, refunded, partially_refunded, cod_pending, cod_collected`.

## Payments

| Method | Path | Notes |
|---|---|---|
| POST | `/webhooks/moyasar` | Verifies `secret_token` (constant-time), de-duplicates by event id, then **re-fetches** the invoice from Moyasar before changing anything |
| POST | `/webhooks/tabby` | Header `X-Celibery-Webhook-Secret` must equal `TABBY_WEBHOOK_SECRET`; de-duplicated; re-fetches payment, captures authorised payments |
| GET/POST | `/payments/sandbox/:ref[/complete]` | Development gateway only (404 when a real gateway is configured or in production) |
| GET | `/cron/release-reservations` | `Authorization: Bearer $CRON_SECRET`; cancels expired unpaid orders after a final gateway check and returns their stock |

Payment rules: amount and currency reported by the gateway must equal the order total, otherwise the order is flagged `payment_review` and not confirmed. A payment that arrives after an order expired is recorded and flagged for refund/restoration.

## Authentication & account

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | `{ name, email, password, phone?, lang, marketingOptIn? }` |
| POST | `/auth/login` | Customers and staff. Lockout for 15 min after 5 failures. Same message for unknown email and wrong password |
| POST | `/auth/logout` | |
| GET | `/auth/me` | Profile + role permissions (staff) or `null` |
| POST | `/auth/forgot-password` | Always 200 (no account enumeration) |
| POST | `/auth/reset-password` | `{ token, password }` single-use, hashed token, 60 min (staff invites 72 h) |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }` |
| PATCH | `/me/profile` | name, phone, preferredLang, marketingOptIn |
| GET/POST/PUT/DELETE | `/me/addresses[/:id]` | Up to 10 saved addresses |
| GET/POST/DELETE | `/me/wishlist[/:productId]` | POST accepts `{ productIds:[] }` (also used to merge a guest wishlist) |
| GET | `/me/orders` | Own orders only |

## Admin (`/api/admin`, staff session + per-route permission)

| Area | Endpoints | Permission |
|---|---|---|
| Overview | `GET /overview` | overview:read |
| Reports | `GET /reports/sales?from&to`, `GET /reports/orders.csv?from&to` | reports:read |
| Orders | `GET /orders?status&paymentStatus&q&from&to&page`, `GET /orders/:id`, `POST /orders/:id/status {status,note,notifyCustomer,trackingNumber,courier,restock}`, `POST /orders/:id/verify-payment`, `POST /orders/:id/tracking`, `PATCH /orders/:id/notes`, `POST /orders/:id/resend-notification` | orders:read / orders:write |
| Refunds | `POST /orders/:id/refund {amount(halalas), reason}` | orders:refund |
| Products | `GET /products?q&status&category&lowStock&page`, `GET/PUT/DELETE /products/:id`, `POST /products`, `POST /products/import {csv, dryRun}` | products:read / products:write |
| Categories | `GET/POST /categories`, `GET/PUT/DELETE /categories/:id` | products:read / categories:write |
| Inventory | `GET /inventory`, `GET /inventory/movements?product`, `POST /inventory/:id/adjust {mode: delta|set, value, reason, type}` | inventory:read / inventory:write |
| Discounts | CRUD `/discounts` (value: percent or SAR; dates; usage limits; per-customer limit; eligible categories/products) | discounts:read / discounts:write |
| Content | CRUD `/content/banners`, `/content/collections`, `/content/campaigns`; `GET /content/pages`, `PUT /content/pages/:id`; `GET /content/reviews`, `PATCH /content/reviews/:id` | content:write / reviews:moderate |
| Customers | `GET /customers?q&page`, `GET /customers/:id`, `GET /customers/newsletter` | customers:read |
| Staff | `GET/POST /staff`, `PATCH /staff/:id`, `POST /staff/:id/reset-link`, `GET /staff/roles/all`, `POST/PUT/DELETE /staff/roles[/:id]` | staff:manage |
| Settings | `GET /settings` (+ integration status, never secrets), `PUT /settings` (partial; sections merge) | settings:write |
| Activity | `GET /audit`, `GET /notifications` | audit:read / orders:read |

Every admin write is recorded in the audit log.
