# 07 — Payment and Order Audit

## 1. Integrated providers (discovered)

| Provider | Methods | Code status | Production status (LIVE) |
|---|---|---|---|
| Sandbox simulator | All | Complete | **ACTIVE in production (C-01)** |
| Moyasar | mada, Visa, Mastercard, Apple Pay, STC Pay (hosted invoice) | Implemented; never run against a real account (H-08) | Not active |
| Tabby | BNPL (authorise → capture) | Implemented; never run against a real account (H-08) | Not active (Tabby is routed to the sandbox) |
| Cash on delivery | — | Complete: min 40 SAR, max 60 SAR as configured, 1 SAR fee, limited cities, max 3 open per phone | Active |

Live `GET /api/checkout/options` (27 Nov 2026): `card, applepay, stcpay, tabby, cod: true`, `gateway: "sandbox"`, `sandbox: true`.

## 2. Requirement checklist

| Requirement | Implementation | Status |
|---|---|---|
| Never trust frontend success | Return page calls `verify-payment`; the server fetches the status from the gateway (`verifyPayment` → `provider.fetchStatus`) | PASS |
| Server-side confirmation | The webhook body is ignored; the status is always re-fetched | PASS (logic) |
| Webhook authenticity | Moyasar: `secret_token`, constant-time compare. Tabby: secret header. Rejected before any write | PASS (logic) |
| Webhook delivery actually works | CSRF guard blocks it (H-01); callback URL on the storefront → 500 (H-02) | **FAIL** |
| No duplicate orders | Idempotency key, unique index | PASS |
| No duplicate payment processing | Conditional status transitions, `ProcessedEvent` lease, single capture claim | PASS |
| Amount and currency verified | Mismatch → `payment_review`, no capture, no confirmation | PASS |
| Consistent order/payment states | Explicit transitions; late payment after cancellation flagged for staff; duplicate payment flagged | PASS (logic). The late-payment path is only reachable via webhooks (H-01) |
| Delayed / repeated webhooks | Lease + retry lifecycle; max 12 attempts | PASS (logic) |
| Refunds | Ledger with an atomic cap, idempotency keys, uncertain outcomes reconciled every 30 min, manual resolution | PASS |
| Logging without secrets | `sanitizeError` redacts keys and bearer tokens | PASS |
| Real money cannot be simulated | **FAIL: C-01** | **FAIL** |

## 3. Order lifecycle
`pending → confirmed → processing → shipped → delivered → returned`, with cancellation allowed from pending, confirmed and processing (`ORDER_TRANSITIONS`). Confirm, process and ship require `paid`, `cod_pending` or `cod_collected`. Delivery of a COD order sets `cod_collected`. Cancellation before shipping releases stock exactly once. Return restocks unless the staff member opts out.

## 4. Reservation expiry (the current safety net)
`releaseExpiredReservations` (every 5 min, in-process on Railway) asks the gateway once more before cancelling an unpaid online order. Because of this, **H-01 delays confirmations rather than losing paid orders**, provided payment completes before the reservation expires (default 30 min). A payment that completes later is not detected (H-01 impact b).

## 5. Inventory and checkout manipulation
- A customer **cannot** change the price, discount, delivery fee or total. Only product ids and quantities are accepted, and everything else is recomputed.
- A customer **cannot** buy unavailable stock. The conditional decrement fails and the order is rejected with `OUT_OF_STOCK` / `CART_CHANGED`.
- Fake COD orders that hold stock are capped at 3 open orders per phone.
- With C-01, a customer **can** obtain a "paid" order without paying.

## 6. Sandbox test matrix required before go-live (NOT RUN: no gateway test credentials)
Run on staging with Moyasar and Tabby **test keys**:

1. Card success → confirmed exactly once, one email.
2. Card failure / cancel → `failed`, order still payable via retry.
3. Return page closed before redirect → webhook confirms (needs the H-01/H-02 fixes).
4. Same webhook delivered twice → second answered `duplicate`.
5. Payment completed after reservation expiry → order flagged "payment received after cancellation".
6. Amount tampered at the gateway (if test mode allows) → `payment_review`, not confirmed.
7. Tabby authorise → captured once, then `CLOSED`.
8. Partial refund, then full refund; an over-refund attempt is refused.
9. Gateway timeout during a refund → `uncertain`, reconciled by cron.
10. Apple Pay and STC Pay on real devices.

## 7. Status
**Payment safety: FAIL** (C-01, H-01, H-02). **Order management logic: PASS**. **Real gateway integration: NOT VERIFIED** (H-08).
