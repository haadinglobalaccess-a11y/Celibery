# CELIBERY — Production Security Configuration Guide

Settings that live **outside the code**: hosting provider, database, DNS and environment variables. The application enforces some of them at start-up (it refuses to run in production without them); the rest need someone with provider access. Never paste secret values into chat, tickets, commits or CI logs.

## 1. Environment variables (API service)

The API refuses to start in production unless the items marked **enforced** are correct.

| Variable | Required value | Enforced |
|---|---|---|
| `NODE_ENV` | `production` | On hosted platforms (Railway, Vercel, Render, Fly, Cloud Run, Heroku) the built-in development secrets are disabled even if this is missing, so a mis-set host cannot sign sessions with a public key |
| `JWT_SECRET` | Unique random string, ≥ 32 characters (`openssl rand -base64 48`) | Yes |
| `CRON_SECRET` | Unique random string, ≥ 32 characters | Yes |
| `CREDENTIALS_ENCRYPTION_KEY` | 32 random bytes as base64 or 64 hex characters (`openssl rand -base64 32`). Encrypts payment/SMTP/WhatsApp credentials and 2FA secrets. Rotation: move the old key to `CREDENTIALS_ENCRYPTION_KEY_PREVIOUS`, then run `npm run migrate -- --reencrypt` | Storing credentials fails without it |
| `PUBLIC_SITE_URL` | `https://` production domain | Yes |
| `CORS_ORIGINS` | Comma-separated **exact** `https://` origins of the storefront and admin. Never `*` | Yes |
| `MONGODB_URI` | Atlas URI with TLS, for a database user limited to `readWrite` on the CELIBERY database only | Presence only |
| `PAYMENT_GATEWAY` | `moyasar` (or `tabby` for BNPL). **Not** `sandbox` | Yes, unless `ALLOW_SANDBOX_PAYMENTS=true` |
| `ALLOW_SANDBOX_PAYMENTS` | **Unset** in production. Only for a private staging site | — |
| `TRUST_PROXY_HOPS` | Exactly the number of proxies in front of the API: `1` on Railway or Vercel, `2` if a CDN/WAF (e.g. Cloudflare) sits in front of Railway. A value larger than reality lets clients spoof their IP and bypass every per-IP rate limit | Values above 2 refused |
| `STAFF_MFA_REQUIRED` | `true` **after** both staff members have enrolled 2FA (Admin → My account) | — |
| `SESSION_TTL_HOURS` | Default 168 (customers). Staff sessions are capped at 12 hours regardless | — |
| `COOKIE_SAMESITE` | `lax` when storefront and API share a site; `none` only for the current two-domain Railway set-up (forces `Secure`) | — |
| `MEDIA_STORAGE` | `s3` in production (`local` needs `ALLOW_LOCAL_MEDIA_STORAGE=true` and a persistent volume) | Yes |
| `MAX_OPEN_COD_ORDERS_PER_PHONE` | Default `3`. Raise it only if genuine customers regularly have more open cash-on-delivery orders; `0` turns the protection off | — |
| `RATE_LIMIT_STORE` | `mongo` (default) so limits are shared by every instance | — |
| `CSP_REPORT_URI` | Optional endpoint for Content-Security-Policy violation reports | — |

## 2. Hosting

| Setting | Where | Why |
|---|---|---|
| HTTPS only; HTTP → HTTPS redirect | Railway / Vercel domain settings (default on both) | The API sends HSTS in production; the redirect covers the first visit |
| Serve the storefront with security headers | Vercel uses `vercel.json`. On Railway, redeploy the client service so `client/vite.config.ts → preview.headers` apply, or serve `client/dist` from the API with `SERVE_CLIENT=1` | Clickjacking protection for `/admin` (finding SEC-06 of 11 Nov) |
| One proxy hop known | If you add Cloudflare or another CDN, update `TRUST_PROXY_HOPS` the same day | CEL-SEC-04 |
| WAF / bot protection | Cloudflare (free plan is enough to start) in front of both services | Volumetric and Layer-7 attacks are outside what application rate limits can absorb |
| Never expose source or `.env` | Deploy only built output; keep `.env` out of the image. Verified: the API serves only `client/dist` and `/media`, and refuses `../` | — |

## 3. Database (MongoDB Atlas)

1. **Network access:** allow only the outbound IPs of the API host (Railway static egress IPs, or Vercel's documented ranges), not `0.0.0.0/0`.
2. **Users:** one application user with `readWrite` on the CELIBERY database only. Separate users for developers (a separate development database), never the production URI on laptops (SEC-22 of 11 Nov).
3. **TLS:** on by default with `mongodb+srv://`.
4. **Backups:** enable continuous backup / snapshots and **test a restore** to a scratch cluster at least once per quarter. A backup is not proven until a restore succeeds.
5. **Auditing:** enable Atlas database auditing if the plan allows it; at minimum keep Atlas access logs.

## 4. Payment providers

| Provider | Setting |
|---|---|
| Moyasar | Webhook URL `https://<api-domain>/api/webhooks/moyasar` with a random shared secret (≥ 32 characters) entered in Admin → Settings → Payments |
| Tabby | Webhook with the secret header `X-Celibery-Webhook-Secret`; same secret in the admin |
| Both | Live keys entered only in Admin → Settings → Payments (stored encrypted; changing them now requires step-up re-authentication). Use test keys on staging only |

The application never trusts a webhook's body for the payment outcome; it always asks the provider's API. A wrong secret is rejected before anything is written.

## 5. Accounts and access

1. Two staff accounts only (Q27): Usama M. Usman (BDM) and Shuja Mubeen (Online Sales Executive). Give each the smallest role that fits; keep `payments:manage` and `staff:manage` with the approver only.
2. Both enrol 2FA, store their recovery codes offline, then set `STAFF_MFA_REQUIRED=true`.
3. Developer/agency access to Railway, Vercel, Atlas, GitHub and the domain registrar: individual accounts with 2FA, removed when the engagement ends.

## 6. Monitoring and alerting

The API writes structured JSON lines prefixed `security:`. Forward logs to a service that can alert (Better Stack, Datadog, Grafana Cloud, Railway log drains) and alert on:

| Event | Alert when |
|---|---|
| `security:auth.account_locked` | Any staff account |
| `security:auth.password_check_failed` | Any `lockedNow: true`, or > 3 in an hour for one staff user |
| `security:auth.reauth_failed` | > 3 in 15 minutes for one user |
| `security:webhook.bad_signature` | Any |
| `security:cron.bad_secret` | Any |
| `security:staff.privilege_blocked` | Any |
| `security:mfa.disabled`, `security:mfa.reset_by_admin` | Any |
| `security:rate_limit.exceeded` | Sustained bursts from one IP |
| `level: error` | Any (after CEL-SEC-03, error lines are real server faults) |

## 7. Repository

1. Make the `CI` workflow a required status check on `main` (GitHub → Settings → Branches → branch protection).
2. Turn on GitHub secret scanning and push protection (free for public repositories; included in Advanced Security for private ones).
3. Dependabot alerts on; review `npm audit` output when CI flags a high/critical advisory instead of using `npm audit fix --force`.
