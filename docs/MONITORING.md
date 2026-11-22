# Monitoring and alerts

Two free services cover the essentials. The first tells you **when something breaks** (errors).
The second tells you **when the site is down**. The code is already in place: you only create
the accounts and paste one value into the hosting settings.

## 1. Error tracking — Sentry

What gets reported:

- every unhandled server error (500), with the request id the customer sees;
- every `logger.error(...)` line, including payment amount mismatches, duplicate payments,
  refund problems, failed scheduled jobs and email/webhook failures;
- browser errors on the storefront and admin, including pages that crashed (the "Something went
  wrong" screen).

What is never sent: passwords, tokens, cookies, card data, request bodies, or URL query strings
(order access tokens live there). Up to 30 events per minute per server and 10 per browser page,
with duplicates dropped, so an outage cannot use up the free quota in minutes.

### Set-up (about 10 minutes)

1. Create a free account at sentry.io. Choose the data region you prefer (EU is closest to Saudi Arabia).
2. Create a project. Platform: **Node.js** (one project is enough for server and browser).
3. Copy the **DSN** (Settings → Client Keys). It looks like
   `https://<key>@o123456.ingest.de.sentry.io/4507000000000000`.
4. In Vercel (or Railway) → Environment variables, add:
   - `SENTRY_DSN` = the DSN (server errors)
   - `VITE_SENTRY_DSN` = the same DSN (browser errors — read at build time)
5. Redeploy. The browser policy (CSP) automatically allows the Sentry address.
6. In Sentry → Alerts, create:
   - **New issue** → email (and the Sentry mobile app) — every new kind of error;
   - **Issue frequency > 10 in 5 minutes** → email — something is failing repeatedly (e.g. checkout).

To check it works: open `https://<your-domain>/en/p/does-not-exist` (no event; 404 is normal), then
in Sentry use "Send test event", or ask the developer to trigger a test error on staging.

## 2. Uptime — UptimeRobot (or Better Stack)

1. Create a free account at uptimerobot.com.
2. Add monitor → **HTTP(s)** → `https://<your-domain>/api/health`, every 5 minutes.
   It answers `200` only when the app **and** the database work, and `503` during a database outage.
3. Add a second monitor for the storefront: `https://<your-domain>/ar`.
4. Alert contacts: your email and the UptimeRobot mobile app (push notifications).

## 3. Optional: metrics endpoint

`GET /api/health/metrics` (process memory, database pool, latency) is available when
`METRICS_TOKEN` is set. Call it with `Authorization: Bearer <METRICS_TOKEN>`. It is off by default.

## When an alert arrives

1. Sentry shows the error, the page, and the `request_id`. Search the hosting logs for that id to see
   every log line of that request.
2. Payment alerts (`AMOUNT_MISMATCH`, duplicate payment): open the order in Admin → Orders. The
   history shows "payment review" with what happened. Do not ship until it is resolved.
3. Site down: check the hosting status page and MongoDB Atlas first. The site serves the cached
   homepage and returns "try again" for everything else until the database is back.
