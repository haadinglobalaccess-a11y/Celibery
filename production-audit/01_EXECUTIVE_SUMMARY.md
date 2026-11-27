# 01 — Executive Summary

**Platform:** CELIBERY International: bilingual (Arabic/English) e-commerce for Saudi Arabia
**Audit date:** 27 November 2026 · **Branch audited:** `feature/premium-polish` @ `86a0f53` (clean tree)
**Method:** read-only code review of all 559 tracked files, the full automated test suites, a production build, a dependency audit, a secret scan, and **non-destructive** probes of the live Railway deployment (GET requests plus one rejected empty POST). No source code, data, settings or deployments were changed.

---

## Overall verdict

> **NOT READY for real customer traffic. NOT VERIFIED for production acceptance.**

The engineering itself is unusually strong. Pricing, stock, discounts and payment status are all decided on the server. Stock is reserved in transactions, checkout and webhooks are idempotent, refunds use a ledger, admin permissions are enforced on the API, sessions can be revoked, and 481 of 481 server tests pass. The blockers are **live configuration and deployment topology**, plus one real code defect in the payment path:

1. **The live site accepts fake payments.** Production runs the *sandbox* payment simulator, and it is enabled for card, Apple Pay, STC Pay and Tabby. Any visitor can click "success" and get a **confirmed, "paid" order with no money collected** (finding **C-01**).
2. **Payment webhooks can never be processed.** The CSRF guard rejects every gateway webhook, and the gateway's callback URL also points at the storefront host, which returns HTTP 500. I confirmed both on the live API (**H-01**, **H-02**).
3. **Sign-in is likely to fail in Safari / iOS and other browsers that block third-party cookies.** The storefront and API run on two different `*.up.railway.app` sites, and the storefront is served by `vite preview`, a development tool (**H-03**).
4. **Legal identity is still a draft.** The CR number, VAT number, email and phone are blank, and all five policy pages are marked "Draft — awaiting legal review". The site is nevertheless fully indexable (**H-05**).
5. **Not verified:** database backups and restore, staff two-factor enforcement in production, monitoring and alerting, and the real Moyasar/Tabby integrations (**H-04**, **H-06**, **H-08**, **M-02**).

## Findings by severity

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 1 | C-01 |
| HIGH | 8 | H-01 … H-08 |
| MEDIUM | 6 | M-01 … M-06 |
| LOW | 9 | L-01 … L-09 |
| INFORMATIONAL | 6 | I-01 … I-06 |

Full detail is in [14_RISK_REGISTER.md](14_RISK_REGISTER.md).

## Critical and high-risk findings

| ID | Finding | Evidence type |
|---|---|---|
| **C-01** | Sandbox payment gateway is live in production. Online orders can be "paid" without money. | Live API response + code |
| **H-01** | CSRF guard blocks all payment webhooks (mount-relative `req.path`). Tests hide it. | Live API response + standalone reproduction + code |
| **H-02** | Moyasar `callback_url` = storefront host, which returns 500 to `POST /api/webhooks/*` | Live response + live sitemap + code |
| **H-03** | Cross-site cookie topology (two public-suffix hosts, `SameSite=None`) plus `vite preview` as the production web server | Live headers/CSP + config + the project's own deployment doc |
| **H-04** | Staff 2FA is not enforced by default; the production value is not verifiable | Code (`env.ts`) |
| **H-05** | CR/VAT/contact blank; all policies are drafts; site indexable with checkout open | Live API |
| **H-06** | Backups and restore not verified (no Atlas access) | Absence of evidence |
| **H-07** | The developer `.env` connects to a **remote Atlas cluster** with credentials (possibly production) | Local file inspection (value not printed) |
| **H-08** | Moyasar and Tabby adapters have never run against a real (test-mode) account | Code comments + live config |

## Business-impacting issues

- **Revenue loss / free goods (C-01):** sandbox-"paid" orders reach *Confirmed* and send confirmation emails. The only safeguard is an internal note ("TEST payment … Do not ship") in the order history. If staff miss it, goods ship unpaid.
- **Lost payment visibility (H-01/H-02):** once a real gateway is enabled, orders confirm only when the customer returns to the site or when the reservation-expiry job re-checks the gateway. A payment that arrives *after* that job has cancelled the order is never flagged.
- **Customers and staff unable to sign in on Safari/iOS (H-03).** This is the dominant mobile browser segment in KSA.
- **Regulatory exposure (H-05):** the store trades without displaying its commercial registration or VAT identity and with unapproved policies.

## Deployment concerns
Production runs on Railway as **two services**: storefront `celiberyclient-production.up.railway.app` (served by `vite preview`) and API `celiberyserver-production.up.railway.app`. `vercel.json` exists and is well configured, but it is **not** what serves production. The project's own `docs/DEPLOYMENT.md` already recommends the single-service setup (`SERVE_CLIENT=1`, `COOKIE_SAMESITE=lax`) or a custom domain with `shop.`/`api.` subdomains.

## Security concerns
At the code level the security posture is good: strict Zod validation, operator-key rejection, CSRF header, Helmet, strict CSP, bcrypt in worker threads, server-side revocable sessions, account lockout, TOTP 2FA with replay protection, step-up re-authentication for credentials and staff changes, least-privilege role management, and magic-byte upload sniffing. `npm audit` reports 0 vulnerabilities, and the secret scan is clean on tracked files and on git history. The open security items are configuration (C-01, H-04), the webhook guard bug (H-01), refunds without step-up (M-01) and the developer database connection (H-07).

## Performance concerns
Small sequential sample of live public endpoints, taken from the audit workstation (region unknown, not a load test): `/api/home` median ≈ 2.3 s with an 8.0 s cold first call; `/api/categories` median ≈ 0.9 s; `/api/products` median ≈ 1.5 s with a 6.4 s outlier. This is slow for a storefront. See [10_PERFORMANCE_AND_SCALABILITY.md](10_PERFORMANCE_AND_SCALABILITY.md). Earlier load tests (13 Nov) ran on a laptop against a local database, so they say nothing about production capacity.

## Recommended next steps (in order)
1. **Today:** stop free orders. Turn off online payment methods in Admin → Settings → Payments, or set `ALLOW_SANDBOX_PAYMENTS=false` with no real gateway, so that only cash on delivery remains. Review every order whose history contains "TEST payment (sandbox gateway)".
2. Fix the webhook CSRF exemption and add a regression test that sends **no** `X-Requested-With` header (H-01).
3. Move to one origin: single Railway service with `SERVE_CLIENT=1`, or a custom domain with same-site subdomains. This fixes H-02, H-03 and the `vite preview` issue together.
4. Configure Moyasar (and Tabby) in **test mode** and run the full sandbox payment matrix ([07](07_PAYMENT_AND_ORDER_AUDIT.md) §6) before switching to live keys.
5. Enable Atlas backups and point-in-time recovery, then perform and record a restore drill into a separate cluster.
6. Set `STAFF_MFA_REQUIRED=true`. Fill in CR/VAT/contact details. Get the policies approved. Configure Sentry and uptime monitoring.
7. Point the developer `.env` at a local or dedicated development database.

Approval is requested before any remediation begins. See [16_RECOMMENDED_REMEDIATION_PLAN.md](16_RECOMMENDED_REMEDIATION_PLAN.md).
