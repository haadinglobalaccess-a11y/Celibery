# 05 — Database and Data Integrity (MongoDB)

**Scope:** model code and query patterns. **I did not connect to the production database** (no access was granted, and H-07 means the only credentials available locally may be production's). Live data volume, slow-query logs, Atlas tier and region: **NOT VERIFIED**.

## 1. Structure
27 model files in `server/src/models/`. Money is stored as integer halalas. Localised text is stored as `{ ar, en }`. Orders hold **snapshots** of line items (name, SKU, price, image, warranty), so later product edits or deletions never change past orders.

| Model | Key constraints |
|---|---|
| `Order` | unique `orderNumber`, unique `idempotencyKey`; indexes on `customer`, `status`, `paymentStatus`, `reservationExpiresAt`, `createdAt`, `contact.email`, `contact.phone`; partial index on `payment_review` history |
| `Payment` | `order` indexed; unique `(provider, providerRef)` (partial) |
| `ProcessedEvent` | unique `(provider, eventId)`: webhook de-duplication |
| `Refund` | unique `idempotencyKey`; `order` and `status` indexed |
| `Product` | unique `slug` and `sku`; compound listing indexes matching the sort orders |
| `User` | unique `email`; text index (admin search) |
| `Session` | TTL on `expiresAt` |
| `RateLimit` | TTL on `resetAt` |
| `CheckoutDraft` | TTL on `expiresAt`; unique partial `order` |
| `DiscountRedemption` | unique `(discount, key)`: per-customer limit |
| `OrderNotification` | unique `(order, channel, kind)`: one confirmation per channel |
| `RestockSubscription` | unique partial `(product, email)` while open |

**Assessment: PASS.** Constraints that protect money and identity are unique indexes, not application checks.

## 2. Performance (code level)
- Every hot query found (`myOrders` by `customer`, `verifyOrderPayment` by `order`, reservation expiry by `status` + `reservationExpiresAt`, tracking by `orderNumber`, phone lookups as `$in` exact variants rather than regexes) has a supporting index.
- Unbounded reads are capped: admin CRUD lists `.limit(500)`, `myOrders` `.limit(100)`, paged admin lists ≤ 100.
- Pool: `maxPoolSize` 10 per instance (configurable), `maxIdleTimeMS` 60 s, one cached connection per process.
- Minor: automatic discount offers are evaluated in a loop with per-offer queries (`order.service.ts` `quote`). That is fine at a few offers; watch it if campaigns grow.
- The earlier `DATABASE_PERFORMANCE_REPORT.md` (13 Nov, local synthetic data with 72 k orders) documents explain-plan improvements. It is **not production evidence**.

## 3. Data integrity

| Risk | Control | Status |
|---|---|---|
| Duplicate orders | Unique `idempotencyKey`; replay returns the original (409 if the email differs) | PASS |
| Duplicate users | Unique lower-cased `email` | PASS |
| Duplicate payment processing | Conditional status updates (`status ∈ PAYABLE`) + unique webhook events + `captureRequestedAt` claim | PASS |
| Duplicate payment for one order (two tabs) | Detected and flagged "refund the duplicate" | PASS |
| Over-refund | Atomic `$expr` guard: refunded + reserved + new ≤ total (`refund.service.ts:200`) | PASS |
| Stock double-release | `stockReleased` flag claimed atomically before returning stock | PASS |
| Inventory audit trail | `InventoryMovement` ledger row for every reserve, release and restock | PASS |
| Product deletion | Orders keep snapshots; categories cannot be deleted while products use them (`beforeDelete`) | PASS |
| Sandbox-"paid" orders in live data | Flagged internally only | **FAIL: C-01** |

## 4. Concurrency scenarios

| Scenario | Mechanism | Verdict |
|---|---|---|
| Two customers buy the last unit | `findOneAndUpdate({stock:{$gte:qty}}, {$inc:-qty})` in a transaction; the loser gets `OUT_OF_STOCK` | Safe |
| Simultaneous checkouts by one shopper with a limited code | `DiscountRedemption` conditional upsert + unique index | Safe |
| Double-click / refresh at checkout | Same idempotency key (sessionStorage) → replay | Safe |
| Webhook delivered twice / concurrently | `ProcessedEvent` lease (60 s), `processed` only after success | Safe, but **unreachable today (H-01)** |
| Repeated refund click | Refund idempotency key from the dialog | Safe |
| Concurrent admin status change | Optimistic `{ status: from }` filter → 409 `CONCURRENT_UPDATE` | Safe |
| Overlapping scheduled jobs (several instances) | Conditional updates; in-process overlap guard | Safe |

The server test suite covers these paths (`checkout`, `security-orders`, `payments`, `phase6`, `upgrade`, `scalability`), and all of them passed.

## 5. Backup and recovery
See [12_BACKUP_AND_RECOVERY_ASSESSMENT.md](12_BACKUP_AND_RECOVERY_ASSESSMENT.md). **NOT VERIFIED (H-06).**

## 6. Access and connection-string security
- The production connection string is not in the repository or git history (scan of all 114 commits).
- The developer `.env` holds a remote Atlas URI with credentials (**H-07**).
- Atlas network access list, database-user roles and per-environment users: **NOT VERIFIED**.
