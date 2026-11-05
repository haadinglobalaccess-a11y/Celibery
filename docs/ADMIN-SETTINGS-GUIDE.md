# Admin guide — settings and media

For CELIBERY staff. Sign in at `/admin`. What you see depends on your role; the server refuses anything your role does not allow, even if a link is shared with you.

| Role | Can do |
|---|---|
| Super Administrator | Everything, including payment credentials, live mode and staff accounts |
| Administrator | Everything except payment credentials and staff management |
| Content Manager | Website content, media, categories, policy drafts, reviews |
| Product Manager | Products, categories, stock, media, discounts (view), reports |
| Order Manager | Orders, fulfilment, customers (view), stock (view) |
| Online Sales Executive | Orders, products, stock, customers, discounts, reports |

Refunds need the "Issue refunds" permission (Super Administrator / Administrator by default). Legal identity and approving policies need "Legal identity & policy approval".

## Settings (Admin → Settings)

- **Store & contact** — store name and description, support email, phone, WhatsApp number (international format 9665…; the WhatsApp button stays hidden until set), support hours, address, social links, and the **announcement bar** (empty text = the default "free delivery · 2-year warranty" message; link can be `/c/power-banks` or `https://…`).
- **Legal & business** — registered name, CR number, VAT number (15 digits, starts and ends with 3), Saudi Business Center verification (tick only with official proof) and badge. Enter official values only; empty fields are hidden on the store. Every change is in the Activity log.
- **Brand** — accent colour (placeholder until approved, Q2) and logos.
- **Shipping & I Mile** — free delivery (on by default, Q25); if switched off: delivery fee and optional "free from" amount; "Accept orders for delivery" pauses checkout with your message; courier name and tracking-link template (`{tracking}` is replaced by the tracking number). Fulfilment is **manual**: book each shipment in the I Mile portal, then Orders → Mark as shipped with the tracking number. I Mile API keys can be stored (encrypted) but are not used until an integration is built and tested.
- **Cash on delivery** — off until CELIBERY confirms the rules (Q23). Fee (keep 0 if included in prices), minimum/maximum order, and cities (one per line; add Arabic and English spellings, e.g. `Riyadh` and `الرياض`; empty = all of Saudi Arabia). Customers see why COD is unavailable.
- **Warranty, VAT & stock**, **Notifications & reviews**, **SEO** — as labelled.
- **Payments** — see `docs/PAYMENTS-GUIDE.md`.
- **Hosting & data** — read-only. Moving customer data to another country or provider is an infrastructure migration with legal approval (Q33), not a switch.

## Media — upload or link, everywhere

Every image or video field offers **Upload** (from your computer), **Library** (reuse a file) and a URL box.

- Images: JPEG, PNG, WebP, AVIF, GIF up to 10 MB (server setting). Smaller WebP copies are made automatically so phones download less. SVG logos: use a URL.
- Videos: MP4 or WebM up to 100 MB, or a YouTube / Vimeo link. Ordinary web pages are not accepted as videos. Keep hero videos muted, 10–15 s (`docs/HERO-VIDEO-BRIEF.md`) and add a poster image — it shows while loading and to visitors who prefer reduced motion.
- Links must start with `https://`.
- Files are checked by their real content; a renamed file is refused.
- **Product photos** (Products → edit → Images): add several at once, drag or use the arrows to reorder, "Make main" sets the first photo, Replace / Alt text / Remove per photo. Two photos per product on a plain background are recommended (Q15).
- **Homepage hero** (Website content → Homepage): desktop video + poster, optional vertical mobile video + poster, headline, sub-headline, button label and destination, show/hide. Priority: hero video → hero banners → animated product slider. Use the preview links after saving.
- **Banners** (Website content → Banners): image per language for desktop and mobile, optional video (plays instead of the image) and poster, schedule and order.
- **Media library** (left menu): search, filter by uploads/links, see where a file is used. A file used on the website cannot be deleted — replace it there first.

## Policy pages (Website content → Policy pages)

Privacy, Terms, Returns, Refunds, Shipping and Warranty start as drafts with [bracketed] placeholders. Every save keeps the previous version (History → Restore brings an old version back as a draft). Only staff with legal approval permission can mark a policy "approved"; editing an approved policy without that permission returns it to draft.

## Refunds (Orders → order → Refund…)

Enter the amount and reason. Outcomes: **refunded**; **failed** (the gateway refused — nothing was refunded); **awaiting confirmation** (the gateway did not answer in time — the amount stays reserved so it cannot be refunded twice). For "awaiting confirmation" use **Check with gateway**, or after checking the gateway dashboard choose "Gateway shows it refunded" / "Gateway shows no refund". Never repeat the refund directly in the gateway dashboard.
