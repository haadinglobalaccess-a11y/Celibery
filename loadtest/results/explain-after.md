| Query | Plan | Keys examined | Docs examined | Returned | ms |
|---|---|---|---|---|---|
| catalog: list default sort | IXSCAN(status_1_featured_-1_sortOrder_1_createdAt_-1__id_1) → FETCH → LIMIT | 24 | 24 | 24 | 2 |
| catalog: list by category | IXSCAN(status_1_category_1_featured_-1_sortOrder_1_createdAt_-1__id_1) → FETCH → LIMIT | 24 | 24 | 24 | 2 |
| catalog: search regex | IXSCAN(status_1_featured_-1_sortOrder_1_createdAt_-1__id_1) → FETCH → LIMIT | 92 | 92 | 24 | 7 |
| home: featured | IXSCAN(status_1_featured_-1_sortOrder_1_createdAt_-1__id_1) → FETCH → LIMIT | 8 | 8 | 8 | 1 |
| product: by slug | IXSCAN(slug_1) → FETCH → LIMIT | 1 | 1 | 1 | 0 |
| product: review stats | IXSCAN(product_1) → FETCH | 0 | 0 | 0 | 0 |
| account: my orders | IXSCAN(customer_1) → FETCH → SORT → PROJECTION_SIMPLE | 17 | 17 | 17 | 1 |
| checkout: open COD per phone (old: suffix regex) | IXSCAN(paymentMethod_1_status_1_contact.phone_1) → FETCH → PROJECTION_SIMPLE | 15003 | 0 | 0 | 231 |
| checkout: open COD per phone (new: exact variants) | IXSCAN(contact.phone_1) → FETCH → PROJECTION_SIMPLE | 1 | 0 | 0 | 0 |
| checkout: discount per customer (old: phone regex) | IXSCAN(contact.phone_1) → IXSCAN(contact.email_1) → IXSCAN(customer_1) → OR → FETCH → PROJECTION_SIMPLE | 60034 | 17 | 0 | 340 |
| checkout: discount per customer (new: exact variants) | IXSCAN(contact.phone_1) → IXSCAN(contact.email_1) → IXSCAN(customer_1) → OR → FETCH → PROJECTION_SIMPLE | 35 | 17 | 0 | 1 |
| admin: payment_review count | IXSCAN(history_payment_review) → FETCH → PROJECTION_SIMPLE | 0 | 0 | 0 | 0 |
| admin: orders list page 1 | IXSCAN(createdAt_-1) → FETCH → PROJECTION_SIMPLE → LIMIT | 25 | 25 | 25 | 0 |
| jobs: expired reservations | IXSCAN(reservationExpiresAt_1) → FETCH → PROJECTION_SIMPLE → LIMIT | 0 | 0 | 0 | 1 |
| home: best sellers (90 days) | aggregate | – | – | – | 248.0 (median of 5) |
| categories: product counts | aggregate | – | – | – | 4.8 (median of 5) |
| admin overview: revenue totals | aggregate | – | – | – | 286.6 (median of 5) |
| admin overview: orders by status | aggregate | – | – | – | 203.4 (median of 5) |
