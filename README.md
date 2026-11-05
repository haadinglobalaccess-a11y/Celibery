# CELIBERY International — e-commerce platform

Bilingual (Arabic-first, RTL / English, LTR) online store for the Saudi market with a custom admin dashboard, built from the client document *"CELIBERY International — Website Questions and KSA Recommendations"* (Q1–Q39).

| Part | Stack | Folder |
|---|---|---|
| Storefront + admin dashboard | React 18, TypeScript, Vite, React Router | `client/` |
| API | Node.js 20+, Express 4, TypeScript, Zod | `server/` |
| Database | MongoDB (Atlas, replica set) via Mongoose 8 | `server/src/models` |
| Hosting | Vercel (static site + serverless function `api/index.ts`) | `vercel.json` |
| Tests | Vitest + Supertest + mongodb-memory-server, Playwright | `server/tests`, `e2e/` |

## Quick start (local)

Requirements: Node.js 20+, npm 10+, and either a MongoDB replica set (Atlas free tier works) or Docker.

```bash
cp .env.example .env              # set MONGODB_URI (and JWT_SECRET)
npm install
npm run seed:base                 # categories, roles, collections, campaign templates, draft policy pages
npm run seed:demo                 # OPTIONAL: clearly-labelled sample products for review (never in production)
npm run migrate                   # after upgrading an existing database (safe to repeat)
npm run create-staff -- --name "Your Name" --email you@example.com --role admin
npm run dev                       # API http://localhost:4000 + store http://localhost:5173
```

Open the link printed by `create-staff` to set your admin password, then sign in at <http://localhost:5173/admin>.

Local MongoDB with Docker (single-node replica set, needed for transactions):

```bash
docker run -d --name celibery-mongo -p 27017:27017 mongo:7 --replSet rs0
docker exec celibery-mongo mongosh --eval "rs.initiate()"
# MONGODB_URI=mongodb://127.0.0.1:27017/celibery?directConnection=true
```

## Where things are

```
api/index.ts                 Vercel serverless entry (wraps the Express app)
server/src/app.ts            Express app: security middleware, routes, error handling
server/src/config/env.ts     Environment validation (fails fast on unsafe production config)
server/src/models/           Mongoose models (products, orders, payments, inventory ledger, …)
server/src/modules/          Feature modules: routes → controllers → services
  auth/ catalog/ orders/ payments/ account/ admin/
server/src/integrations/     Payment gateways (sandbox, Moyasar, Tabby), email + WhatsApp, courier
server/src/seed/             Base data (6 categories, roles, draft policies) + separate demo data
server/src/scripts/          seed-base, seed-demo, create-staff, import-products CLIs
client/src/pages/            Storefront pages
client/src/admin/            Admin dashboard (lazy-loaded bundle)
client/src/i18n/strings.ts   Arabic + English interface text
client/src/styles/           Design system (tokens, components, store)
docs/                        API, deployment, testing, requirement checklist, pending client info
e2e/                         Playwright end-to-end tests
```

## Key behaviours

- **Arabic default** at `/ar`, English at `/en`; the header switch keeps the same page, query and cart. Western digits in Arabic (Q11).
- **Premium motion** (Q6 balanced): `client/src/styles/motion.css` + `premium.css` and `client/src/lib/motion.tsx` — scroll reveals, headline reveal, page transitions, animated cart panel, gallery zoom; transform/opacity only, full `prefers-reduced-motion` support, no animation libraries.
- **Hybrid theme** (Q1): light shopping pages; dark hero, "Why CELIBERY" and brand story. One configurable accent colour (Q2) from Admin → Settings → Brand.
- **Server-authoritative checkout:** prices, stock, discounts and delivery are recalculated on the server; stock is reserved atomically in a transaction; duplicate submissions are idempotent; orders are marked paid only after the server verifies with the gateway.
- **Payments** (Q20–Q23): mada / Visa / Mastercard / Apple Pay / STC Pay through a pluggable gateway (Moyasar adapter included), Tabby, configurable cash on delivery (disabled until the client confirms rules). Gateway keys are managed in Admin → Settings → Payments, encrypted at rest (`CREDENTIALS_ENCRYPTION_KEY`). Refunds use a ledger that can never exceed the amount paid. A sandbox gateway exists for development only.
- **Media**: every image/video field accepts an upload from the computer or a URL (S3-compatible storage in production; see `docs/DEPLOYMENT.md`).
- **Free delivery across KSA** (Q25), courier I Mile Logistics (Q24) with manual tracking entry; 2-year warranty as a setting (Q32).
- **Admin modules** (Q26): Overview, Orders, Products, Categories, Inventory, Customers, Discounts, Website content, Reports, Staff & roles, Settings (+ Activity log). Permissions enforced on the API.
- **No invented business data:** CR/VAT numbers, address, WhatsApp, logo, product data, reviews and legal text are configurable and shown as pending/draft until supplied. Sample products are labelled on the storefront.

## Documentation

- [docs/HERO-INTRO-REPORT-2026-11-03.md](docs/HERO-INTRO-REPORT-2026-11-03.md) — homepage hero opening sequence "The future is here": acts, rules kept, tests
- [docs/3D-UPGRADE-REPORT-2026-11-03.md](docs/3D-UPGRADE-REPORT-2026-11-03.md) — immersive 3D storefront upgrade: files, components, tests, missing assets
- [docs/3D-EXPERIENCE.md](docs/3D-EXPERIENCE.md) — 3D design system, performance rules, how to add GLB product models
- [docs/UPGRADE-REPORT-2026-11-03.md](docs/UPGRADE-REPORT-2026-11-03.md) — production-readiness upgrade: what changed, test results, migration, checklists
- [docs/ADMIN-SETTINGS-GUIDE.md](docs/ADMIN-SETTINGS-GUIDE.md) — staff guide: settings, media upload/URL, policies, refunds
- [docs/PAYMENTS-GUIDE.md](docs/PAYMENTS-GUIDE.md) — Moyasar / Tabby credentials, test → live
- [docs/REQUIREMENTS-CHECKLIST.md](docs/REQUIREMENTS-CHECKLIST.md) — every requirement (Q1–Q39) with PASS / PARTIAL / BLOCKED / NOT VERIFIED status
- [docs/COMPLETION-REPORT.md](docs/COMPLETION-REPORT.md) — latest changes, what was verified, completion percentages
- [docs/screenshots/](docs/screenshots/) — storefront preview screenshots (sample data)
- [docs/PENDING-CLIENT-INFO.md](docs/PENDING-CLIENT-INFO.md) — information, credentials and approvals still needed
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — GitHub → Vercel + Atlas, environment variables, gateway setup
- [docs/API.md](docs/API.md) — API reference
- [docs/TESTING.md](docs/TESTING.md) — how to run the tests and what they cover
- [docs/HERO-VIDEO-BRIEF.md](docs/HERO-VIDEO-BRIEF.md) — hero video specification (Q7)
- [docs/CATEGORY-FILTERS-FOR-APPROVAL.md](docs/CATEGORY-FILTERS-FOR-APPROVAL.md) — category names and filters for approval (Q13, Q18)
- [docs/product-import-template.csv](docs/product-import-template.csv) — product list template (Q14)
