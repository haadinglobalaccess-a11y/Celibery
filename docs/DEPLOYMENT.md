# Deployment (GitHub → Vercel + MongoDB Atlas)

The repository deploys as **one Vercel project**: the React storefront/admin is served as static files and every `/api/*` request runs the same Express app as a Vercel serverless function (`api/index.ts`).

## 1. Database — MongoDB Atlas

1. Create an Atlas project and cluster. A **replica set is required** (all Atlas tiers are) — order creation, stock and discount updates run in transactions.
2. Region: choose per Q33 (data-residency approval pending). Atlas offers Middle East regions (e.g. Bahrain / Dammam on AWS/GCP) — confirm with CELIBERY's legal advisor.
3. Create a database user with readWrite on the `celibery` database only.
4. Network access: allow Vercel (Atlas "Allow access from anywhere" with a strong password, or Vercel's static IPs on paid plans).
5. Copy the connection string → `MONGODB_URI`.

## 2. Vercel project

1. Push this repository to GitHub (Q: CELIBERY's organisation).
2. Vercel → **Add New Project** → import the repo. Framework preset: **Other**. Root directory: repository root. `vercel.json` sets:
   - install `npm install`, build `npm run build:vercel`, output `client/dist`
   - `/api/*` and `/sitemap.xml` → `api/index.ts`; everything else → SPA `index.html`
   - Cron `*/15 * * * *` → `/api/cron/release-reservations`
3. Environment variables (Production **and** Preview), see `.env.example`:

| Variable | Required | Value |
|---|---|---|
| `NODE_ENV` | ✔ | `production` |
| `PUBLIC_SITE_URL` | ✔ | `https://celibery.international` (no trailing slash) |
| `CORS_ORIGINS` | ✔ | `https://celibery.international,https://www.celibery.international` |
| `MONGODB_URI`, `MONGODB_DB_NAME` | ✔ | from Atlas / `celibery` |
| `JWT_SECRET` | ✔ | 48+ random bytes, e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `COOKIE_SECURE` | ✔ | `true` |
| `CRON_SECRET` | ✔ | random string (Vercel sends it automatically to cron routes) |
| `PAYMENT_GATEWAY` | ✔ | `moyasar` (production refuses `sandbox` unless `ALLOW_SANDBOX_PAYMENTS=true` for a private staging site) |
| `MOYASAR_SECRET_KEY`, `MOYASAR_PUBLISHABLE_KEY`, `MOYASAR_WEBHOOK_SECRET` | for cards/Apple Pay/mada/STC Pay | from Moyasar dashboard |
| `TABBY_SECRET_KEY`, `TABBY_PUBLIC_KEY`, `TABBY_MERCHANT_CODE`, `TABBY_WEBHOOK_SECRET` | for Tabby | from Tabby |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | optional (legacy) | Prefer **Admin → Settings → Notifications & reviews → Email (SMTP)**: encrypted, testable, can be enabled/disabled. These variables are used only while nothing is saved there. |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ORDER_TEMPLATE` | optional (legacy) | Prefer **Admin → Settings → Notifications & reviews → WhatsApp Business**. Same fallback rule as SMTP. |

The server **refuses to start** in production if `MONGODB_URI` is missing, `JWT_SECRET` is shorter than 32 characters, or the sandbox gateway is selected.

4. Deploy. Then add the domain `celibery.international` in Vercel → Domains and update DNS at the registrar (Q35).

## 3. First-time data setup

Run once from your computer with production env vars loaded (e.g. `vercel env pull .env`):

```bash
npm install
npm run seed:base                       # categories, roles, collections, campaign templates, draft policies
npm run create-staff -- --name "Usama M. Usman" --email <work email> --role admin --title "BDM"
npm run create-staff -- --name "Shuja Mubeen" --email <work email> --role sales_executive --title "Online Sales Executive"
npm run import:products -- --file ./celibery-products.csv --dry-run   # validate
npm run import:products -- --file ./celibery-products.csv             # import
```

Each `create-staff` prints a single-use set-password link (72 h). No passwords are generated or stored by the scripts. **Never run `seed:demo` against production.**

## 4. Payment gateway configuration

Since the 3 Nov 2026 upgrade, gateway keys are entered by a Super Administrator in **Admin → Settings → Payments** (encrypted with `CREDENTIALS_ENCRYPTION_KEY`, masked, test/live sets, connection test, typed LIVE confirmation). Full steps: `docs/PAYMENTS-GUIDE.md`. The environment variables below remain a working fallback until credentials are saved in the dashboard.

### Moyasar (cards, mada, Apple Pay, STC Pay)
1. In Moyasar, enable the methods on the account (Apple Pay requires domain verification; STC Pay requires activation).
2. Webhooks: URL `https://<domain>/api/webhooks/moyasar`, events *payment paid / failed*, shared secret → `MOYASAR_WEBHOOK_SECRET`.
3. Test in **test mode** with test keys on a Preview deployment before switching to live keys. The adapter is implemented from Moyasar's public API but has **not** been verified against a real account yet.

### Tabby
1. Register the webhook `https://<domain>/api/webhooks/tabby` with header `X-Celibery-Webhook-Secret: <TABBY_WEBHOOK_SECRET>`.
2. Test with Tabby's test credentials. Authorised payments are captured automatically when verified.

### Other gateways (Tap, HyperPay, PayTabs)
Implement `PaymentProvider` (`server/src/integrations/payments/types.ts`) and register it in `integrations/payments/index.ts`. Checkout, orders, refunds and webhooks do not need changes.

## 4b. Media storage (direct uploads)

Vercel's file system is not persistent, so uploads need an S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces…). Image/video **URLs** work without it.

1. Create a bucket; allow public read of objects (or put a CDN in front) → `MEDIA_PUBLIC_BASE_URL`.
2. Bucket CORS: allow `PUT` with header `Content-Type` from your store origin(s).
3. Create an access key limited to that bucket → `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; set `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` (`S3_FORCE_PATH_STYLE=true` for providers that need it), `MEDIA_STORAGE=s3`.
4. Redeploy: the build adds the bucket origin to the Content-Security-Policy `connect-src`.
Browsers upload straight to the bucket with 15-minute pre-signed URLs; the server then checks each file's real content before it can be used. On a single server with a persistent disk you may instead use `MEDIA_STORAGE=local` with `ALLOW_LOCAL_MEDIA_STORAGE=true` (files under `./uploads`, served at `/media`).

## 4c. Security headers, scheduled jobs, migration

- CSP comes from `server/src/lib/csp.ts`: the API sends it as a header, the Vite build writes it into `index.html`, and `vercel.json` adds `frame-ancestors`, HSTS, nosniff, Referrer-Policy and Permissions-Policy. After deploying, open every page with the browser console open and look for CSP violations; `CSP_CONNECT_SRC` / `CSP_REPORT_URI` extend it.
- Vercel Cron (needs `CRON_SECRET`): `/api/cron/release-reservations` (15 min) and `/api/cron/maintenance` (30 min: reconciles refunds whose gateway outcome was uncertain, removes abandoned uploads).
- After each deploy of this upgrade: `npm run migrate` (safe, idempotent — see `docs/UPGRADE-REPORT-2026-11-03.md` §5).

## 4d. Data residency (Q33)

Record the real regions in `APP_REGION`, `DATABASE_REGION` and `MEDIA_REGION`; they are shown read-only to staff in Admin → Settings → Hosting & data. Changing a region is a planned migration (new Atlas cluster / bucket in the approved region, data copy, cut-over, legal sign-off), never a dashboard switch.

## 5. After deploying — checklist

- `GET https://<domain>/api/health` returns `ok`.
- Admin → Settings → Payments shows each gateway enabled in the intended mode with "connection verified".
- Place a test order in gateway test mode → it reaches *Confirmed* only after the gateway confirms.
- Check emails/WhatsApp in Admin → Order → Customer notifications (`sent`, not `skipped`).
- Fill Settings → Store & contact and Legal & business (CR, VAT, address, WhatsApp) and approve the six policy pages.
- Upload logo, accent colour, hero video/banners, product photos.
- Remove demo data if a staging database was copied: `npm run seed:demo -- --remove`.

## Alternative: single Node server

`npm run build && SERVE_CLIENT=1 npm start` serves the API and the built storefront from one process on `PORT` (useful for a VPS or container).
