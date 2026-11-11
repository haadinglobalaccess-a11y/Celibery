# CELIBERY — Production Security Checklist

**Date:** 11 November 2026. Each item has one status:

| Status | Meaning |
|---|---|
| ✅ CODE | Implemented in source code (working tree; not yet deployed) |
| ✅ TESTED | Implemented and covered by an automated test |
| ☑ VERIFIED LIVE | Observed on the production deployment (read-only check, 11 Nov 2026) |
| ⏳ CREDENTIALS | Waiting for credentials from the owner or provider |
| ⏳ APPROVAL | Waiting for owner approval (commit, deploy, business decision) |
| ⚙ PROVIDER | Must be configured in a provider dashboard; this cannot be done or verified from the code |
| ✖ NOT DONE | Not implemented |

A settings form in the Admin Dashboard does **not** count as "configured". Only a verified check does.

---

## 0. Do first (in this order)

| # | Action | Who | Status |
|---|---|---|---|
| 1 | Review the working-tree changes and approve a commit + redeploy of **both** Railway services | Owner | ⏳ APPROVAL |
| 2 | Stop accepting sandbox "payments": enter Moyasar (and Tabby) **live** keys in Admin → Settings → Payments, set `PAYMENT_GATEWAY=moyasar`, delete `ALLOW_SANDBOX_PAYMENTS`. Until then, consider switching card / Apple Pay / STC Pay / Tabby off (COD only) | Owner | ⏳ CREDENTIALS — **P0** (☑ live: `gateway: sandbox`) |
| 3 | Check for paid orders with the history note "TEST payment (sandbox gateway)" before shipping anything (after deploy) | Operations | ⏳ APPROVAL |
| 4 | Each administrator turns on two-factor authentication (Admin → Profile), then set `STAFF_MFA_REQUIRED=true` | Staff, then owner | ✅ TESTED / ⏳ APPROVAL |
| 5 | After redeploy: `curl -I https://<storefront>/admin` shows `X-Frame-Options: DENY` and `Strict-Transport-Security` | Developer | ✅ CODE / ⏳ APPROVAL (☑ live today: headers missing) |

---

## 1. Railway (current production)

| Item | Status |
|---|---|
| API service `NODE_ENV=production` | ☑ VERIFIED LIVE (HSTS header present, which only production sends) |
| `JWT_SECRET` ≥ 32 random characters, unique, not shared with any other environment | ⚙ PROVIDER (start-up refuses weak values — ✅ CODE) |
| `CRON_SECRET` ≥ 32 characters (required at start-up even though Railway uses the in-process scheduler) | ⚙ PROVIDER |
| `CREDENTIALS_ENCRYPTION_KEY` set (32 random bytes); stored **only** in Railway variables and an offline password manager | ⚙ PROVIDER |
| `CORS_ORIGINS` = exactly the storefront origin(s), HTTPS only | ⚙ PROVIDER (☑ live: a foreign origin gets no CORS headers) |
| `COOKIE_SAMESITE`: leave empty (= `none`) while the store and API are on different `*.up.railway.app` sites. Set `lax` only after moving to one origin (custom domain with `/api` on the same site, or `SERVE_CLIENT=1`), and test sign-in after the change | ⚙ PROVIDER |
| `TRUST_PROXY_HOPS=1` (Railway edge only); `2` if Cloudflare is put in front | ⚙ PROVIDER (✅ CODE) |
| `RATE_LIMIT_STORE=mongo` (default) | ✅ TESTED |
| `STAFF_MFA_REQUIRED=true` after enrolment | ⏳ APPROVAL |
| Storefront service: redeploy so `vite preview` sends the security headers. Better: serve `client/dist` from the API service with `SERVE_CLIENT=1` (one origin, so `COOKIE_SAMESITE=lax` becomes possible) or from a static host | ✅ CODE / ⏳ APPROVAL |
| Railway project members: least privilege, 2FA on every Railway account | ⚙ PROVIDER |
| Only the HTTP port is exposed (no extra TCP proxies); no public MongoDB on Railway | ⚙ PROVIDER |
| Health check path `/api/health`; restart policy "on failure" | ⚙ PROVIDER |
| Graceful shutdown: SIGTERM drains requests for ≤ 10 s; the scheduler stops first; jobs use conditional updates, so an overlapping replica or restart cannot double-process | ✅ CODE |
| Request timeouts 20 s headers / 120 s request | ✅ CODE |
| Media: Railway disk is not persistent — use `MEDIA_STORAGE=s3` or attach a volume with `ALLOW_LOCAL_MEDIA_STORAGE=true` | ⚙ PROVIDER |

## 2. Vercel (alternative deployment)

| Item | Status |
|---|---|
| Same variables as Railway, set for **Production** only (separate secrets for Preview) | ⚙ PROVIDER |
| Preview deployments protected (Vercel Authentication / password) so staging data and the sandbox gateway are not public | ⚙ PROVIDER |
| `COOKIE_SAMESITE=lax` (store and API share one origin on Vercel) | ⚙ PROVIDER |
| Vercel Firewall: enable Attack Challenge Mode during an attack; add rate-limit rules for `/api/auth/*` and `/api/checkout` | ⚙ PROVIDER |
| Security headers in `vercel.json` (CSP frame-ancestors, XFO, HSTS, nosniff, Referrer-Policy, Permissions-Policy, COOP; `/admin` no-store) | ✅ CODE |
| Vercel Cron calls `/api/cron/*` with `CRON_SECRET` | ✅ CODE |
| Team members with 2FA; no long-lived personal tokens | ⚙ PROVIDER |

## 3. MongoDB Atlas

| Item | Status |
|---|---|
| Network access: **no `0.0.0.0/0`**. Railway has no static egress IPs on all plans: use Railway static outbound IPs where available, Atlas Private Endpoint / VPC peering, or document the accepted risk. Verify in Atlas → Network Access | ⚙ PROVIDER — **unverified** |
| Application database user has `readWrite` on the `celibery` database only (not `atlasAdmin`, not "any database") | ⚙ PROVIDER — **unverified** |
| Separate users for production, staging and each developer. The local `.env` on the developer workstation currently holds a credentialed remote URI: confirm it is **not** the production user, or rotate it | ⚙ PROVIDER |
| TLS required (Atlas default) | ⚙ PROVIDER |
| Atlas project members with MFA; database access audit enabled where the tier allows | ⚙ PROVIDER |
| Cloud backups enabled; retention ≥ 7 days daily + 4 weekly; continuous backup (point-in-time) if the tier allows | ⚙ PROVIDER — **unverified** |
| Backup encryption at rest (Atlas default); backup download / restore restricted to the owner | ⚙ PROVIDER |
| New collections created automatically on deploy: `sessions` (TTL), `rate_limits` (TTL) | ✅ CODE |
| Database alerts: connections > 80 %, query targeting, disk, replication lag | ⚙ PROVIDER |

## 4. Payments (Moyasar, Tabby, COD)

| Item | Status |
|---|---|
| Live keys entered in Admin → Settings → Payments (encrypted at rest, masked in the admin, never returned by the API) | ⏳ CREDENTIALS (✅ TESTED: never returned) |
| Moyasar webhook URL `https://<api>/api/webhooks/moyasar` with a long random secret token; Tabby webhook with the `X-Celibery-Webhook-Secret` header | ⏳ CREDENTIALS |
| Webhooks verified (constant-time), replay-safe, outcome fetched from the gateway, amount/currency reconciled | ✅ TESTED |
| Test the complete flow in Moyasar **test mode** and Tabby sandbox before switching to live (adapters not yet verified against real accounts) | ⏳ CREDENTIALS |
| Refund permission `orders:refund` only for trusted roles; refunds idempotent and capped at the paid amount | ✅ TESTED |
| Duplicate payments flagged for refund | ✅ TESTED |
| No card data stored (hosted payment pages, PCI DSS SAQ A); complete the SAQ A annually with the acquirer | ⚙ PROVIDER / owner |
| Gateway dashboards: owner accounts with 2FA; API keys restricted to the server | ⚙ PROVIDER |

## 5. Email (SMTP) and WhatsApp

| Item | Status |
|---|---|
| SMTP password and WhatsApp token stored encrypted (Admin → Settings → Notifications); never logged (redaction) | ✅ CODE |
| Use a dedicated SMTP account / app password with sending rights only | ⚙ PROVIDER |
| SPF, DKIM and DMARC (`p=quarantine` or stricter) for the sending domain | ⚙ PROVIDER |
| WhatsApp: a system-user token with only `whatsapp_business_messaging`; rotate when staff leave | ⚙ PROVIDER |
| Message content HTML-escaped; recipients only from the order itself; resend requires `orders:write` | ✅ CODE |

## 6. WAF / CDN / DDoS / bots

| Item | Status |
|---|---|
| Put the custom domain behind Cloudflare (or similar): proxied DNS, "Full (strict)" TLS, WAF managed rules, Bot Fight Mode, rate-limit rules for `/api/auth/*`, `/api/checkout`, `/api/cart/quote`. Then set `TRUST_PROXY_HOPS=2`, and only allow Cloudflare IPs to reach Railway if the plan supports it | ⚙ PROVIDER — ✖ NOT DONE |
| Application rate limits (shared) and per-account lock-out | ✅ TESTED |
| CAPTCHA: not added (the brief asks for no blanket CAPTCHA). Recommended only as a provider-side challenge (Cloudflare Turnstile / managed challenge) on `/api/auth/register` and `/api/auth/login` during an attack | ✖ NOT DONE (by design) |
| Inventory-reservation abuse: unpaid online orders release stock after `reservationMinutes`; checkout limited to 20/min per IP | ✅ CODE |

## 7. DNS, domain, TLS

| Item | Status |
|---|---|
| Registrar account with 2FA and registrar lock | ⚙ PROVIDER |
| DNSSEC if the registrar or DNS host supports it | ⚙ PROVIDER |
| CAA record limiting certificate issuers (e.g. `letsencrypt.org`, `pki.goog`) | ⚙ PROVIDER |
| HSTS sent by the API and (after redeploy) the storefront; consider `preload` only after every subdomain is HTTPS | ✅ CODE / ⏳ APPROVAL |
| Update `PUBLIC_SITE_URL`, `CORS_ORIGINS` and the payment webhook URLs when the custom domain goes live | ⚙ PROVIDER |

## 8. Secrets and rotation

| Secret | Where it lives | How to rotate | Effect |
|---|---|---|---|
| `JWT_SECRET` | Railway/Vercel variables | Replace, redeploy | Everyone is signed out |
| `CRON_SECRET` | Variables (+ Vercel Cron) | Replace, redeploy | None |
| `CREDENTIALS_ENCRYPTION_KEY` | Variables + offline password manager | New key in `CREDENTIALS_ENCRYPTION_KEY`, old key in `CREDENTIALS_ENCRYPTION_KEY_PREVIOUS`, deploy, `npm run migrate -- --reencrypt`, remove the previous key | Gateway, SMTP, WhatsApp and S3 credentials and **staff 2FA secrets** remain readable during rotation. Losing the key means re-entering credentials and staff re-enrolling 2FA |
| MongoDB password | Atlas + `MONGODB_URI` | Create a new user/password, update the variable, deploy, delete the old one | None |
| Moyasar / Tabby keys | Admin → Settings → Payments | Generate in the gateway dashboard, paste, *Verify*, *Activate*, revoke the old key | None |
| Webhook secrets | Admin + gateway dashboard | Change both sides together | Deliveries fail in between, and the gateway retries |
| SMTP password, WhatsApp token, S3 key | Admin → Settings | Generate new, save, test, revoke old | None |

- No secret has been found in Git history or in build output (audit §4).
- `.env` is git-ignored.

## 9. Monitoring and alerting

| Item | Status |
|---|---|
| Structured `security:*` log events | ✅ TESTED |
| Ship logs to a searchable store with ≥ 90 days retention (Railway log drains / Better Stack / Datadog / Axiom) | ⚙ PROVIDER — ✖ NOT DONE |
| Alerts: > 20 `auth.login_failed` per IP in 15 min; any `auth.account_locked` with `accountType: staff`; any `mfa.disabled`, `mfa.reset_by_admin`, `staff.privilege_blocked`, `webhook.bad_signature`, `cron.bad_secret`; any `rate_limit.store_unavailable`; any log line "Order confirmed by the sandbox gateway in production" or "Payment amount mismatch" | ⚙ PROVIDER — ✖ NOT DONE |
| Error monitoring (Sentry or equivalent; needs an account and an SDK, with the DSN as an environment variable and PII scrubbing on) | ⚙ PROVIDER — ✖ NOT DONE |
| Uptime monitor on `/api/health` and the storefront | ⚙ PROVIDER — ✖ NOT DONE |
| Admin Activity log (staff actions, 2FA changes) | ✅ CODE |

## 10. Backups and disaster recovery

| Item | Target | Status |
|---|---|---|
| Recovery Point Objective (RPO) | ≤ 1 h with continuous backup; ≤ 24 h with daily snapshots | ⚙ PROVIDER — **unverified** |
| Recovery Time Objective (RTO) | ≤ 4 h | Not tested |
| Restore test: restore the latest snapshot to a **new temporary cluster** (never over production), point a local API at it, check orders, products and sign-in, then delete the cluster. Record date, duration and result | Quarterly | ✖ NOT DONE — a backup is not verified until this succeeds |
| Media: bucket versioning / lifecycle; product images currently on external Cloudinary links | — | ⚙ PROVIDER |
| Configuration backup: an export of all environment variable *names* (values in the password manager) | — | ⚙ PROVIDER |

## 11. Ongoing

- Run `npm audit` and `npm outdated` monthly. Never run `npm audit fix --force` without running the full test + E2E suites.
- Keep `package-lock.json` committed; install with `npm ci` in CI.
- Review staff accounts and roles quarterly. Deactivate leavers the same day (this ends their sessions immediately).
- Re-run `server/tests/security.test.ts` (part of `npm test`) on every change.
