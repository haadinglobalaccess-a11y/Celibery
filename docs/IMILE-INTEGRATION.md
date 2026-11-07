# I Mile Logistics — integration status and what is needed

_Last reviewed: 2026-11-08_

## Current state (working)

CELIBERY ships with I Mile Logistics using a **manual, fully working** workflow:

1. Staff book the shipment in the I Mile portal.
2. In **Admin → Orders → (order) → Mark as shipped** they enter the I Mile tracking number.
3. The customer gets the "shipped" email/WhatsApp update, and the order page shows the tracking
   number and a tracking link built from **Admin → Settings → Shipping → Tracking URL template**
   (`{tracking}` is replaced by the number).
4. **Delivered** is set by staff in the same screen (COD orders become "cash collected").

The I Mile **credentials** can already be stored securely: **Admin → Settings → Payments → I Mile
Logistics API** (customer/account ID + API key; the key is AES-256-GCM encrypted and only shown masked).
They are marked "stored only — not connected yet" and are not used by any code.

The code has the extension point ready: `CourierProvider.createShipment()` in
`server/src/integrations/shipping/index.ts`, and `fulfilmentMode: 'api'` is reserved (refused by the
settings API until an integration exists).

## Why the API integration is not built

The repository contains **no I Mile API documentation** — no base URL, authentication scheme,
endpoint list, request/response format, error codes, webhook format or sandbox. Public I Mile
developer documentation was not provided. Writing an integration without it would mean inventing
endpoints and payloads, which could create wrong shipments or silently fail in production, so it has
deliberately **not** been implemented.

## What is needed from I Mile (to send to the I Mile account manager)

1. **API documentation** for the Saudi Arabia (KSA) account: base URLs for sandbox and production.
2. **Authentication**: method (API key header, OAuth client credentials, signed requests…), how
   keys are issued and rotated, token lifetime.
3. **Sandbox access**: a test account/customer ID and test credentials, plus test tracking numbers.
4. **Create shipment**: endpoint, required fields (consignee name, phone format, city list/codes,
   district, address lines, postal code, short address), package fields (pieces, weight,
   dimensions), **COD amount** field and currency, reference field for our order number,
   response (tracking/AWB number, label).
5. **City / area codes**: whether I Mile requires its own city codes, and the list for KSA.
6. **Label**: format (PDF/ZPL), size, and how to retrieve it.
7. **Pickup**: whether pickups are requested per shipment or scheduled.
8. **Cancel shipment**: endpoint and the statuses in which cancelling is allowed.
9. **Tracking**: status endpoint and the full list of status codes (to map to Shipped / Delivered /
   Returned to sender), plus the public tracking page URL format.
10. **Webhooks** (optional but preferred): events, payload, and how requests are signed/authenticated.
11. **COD remittance**: how collected cash is reported (report/API) for reconciliation.
12. **Rate limits**, idempotency support (to avoid duplicate shipments on retries) and support contact.

## What will be implemented once the documentation arrives

- `imileCourier` implementing `CourierProvider.createShipment()` (and cancel/track), using the
  credentials already stored in Admin; a "Test connection" check against the sandbox.
- Automatic booking when an order moves to **Processing** (with the tracking number saved on the
  order), behind `fulfilmentMode: 'api'`, which an admin switches on only after a successful test.
- Optional webhook endpoint to move orders to Shipped/Delivered automatically.
- Tests against recorded sandbox responses, plus a real sandbox run before going live.
