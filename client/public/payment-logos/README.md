# Payment brand badges

Shown by `PayLogos` (`client/src/components/ui.tsx`) only for the methods enabled in Admin → Settings → Payments: card → Visa, Mastercard and mada; then Apple Pay, STC Pay and tabby.

All six share one 96×64 card-badge format: white, rounded, with a 0.5px grey edge.

| File | Source |
|---|---|
| `visa.svg`, `mastercard.svg`, `mada.svg` | Moyasar payment form (`moyasar-payment-form@2.3.1`, MIT, © Moyasar Ltd.). Moyasar is CELIBERY's card gateway; these are the badges its checkout form shows. Copied unchanged except the XML prolog. |
| `stcpay.svg` | STC Pay wordmark from the same Moyasar package, placed on the shared badge. |
| `tabby.svg` | tabby wordmark from tabby.ai's own site header, placed on the shared badge. |
| `applepay.svg` | Apple Pay mark (Simple Icons, CC0), placed on the shared badge. |

Only add a brand here when its method is actually enabled for the store. Do not redraw brand marks.
