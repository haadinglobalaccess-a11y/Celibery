# CELIBERY — Residual Security Risks (13 November 2026)

Risks that remain after this round of hardening, with the reason they remain and who can close them. Severity is the risk **today**, before the owner actions are done.

| # | Risk | Severity | Why it remains | Mitigation in place | Who closes it |
|---|---|---|---|---|---|
| R1 | Sandbox payment gateway active in production (SEC-01, 11 Nov): a buyer can mark an order paid without paying | **Critical** | Needs live payment keys and a production environment change; not re-checked live in this audit (no authorization to touch production) | Orders confirmed by the sandbox in production carry a staff-only "TEST payment — do not ship" note and an error log line | Owner: live keys, `PAYMENT_GATEWAY=moyasar`, remove `ALLOW_SANDBOX_PAYMENTS` |
| R2 | 2FA optional for staff | High | Making it mandatory before enrolment would lock out administrators | Step-up re-authentication on payment/staff changes; lock-out on password guessing; 12-hour staff sessions | Staff enrol, then `STAFF_MFA_REQUIRED=true` |
| R3 | Storefront on Railway served without security headers until redeployed (SEC-06) | High | Requires a redeploy of the client service | Headers are in `client/vite.config.ts`; API and Vercel already send them | Developer: redeploy or `SERVE_CLIENT=1` |
| R4 | No WAF / DDoS protection | Medium | Hosting-provider service | Shared application rate limits; request size and time limits | Owner: Cloudflare or equivalent |
| R5 | No log alerting | Medium | Needs a log service and contacts | Structured `security:*` events ready to forward | Owner/developer: configuration guide §6 |
| R6 | Backups unverified | Medium | Needs Atlas access | — | Owner: enable backups, test a restore quarterly |
| R7 | Wrong `TRUST_PROXY_HOPS` would let clients spoof IPs (CEL-SEC-04) | Medium if misconfigured | Depends on the hosting topology, which the code cannot detect | Values above 2 refused at start-up; default 1 matches Railway and Vercel | Developer: set it whenever a CDN/proxy is added |
| R8 | A stolen staff session can lock the account owner out for 15 minutes (by failing re-checks or sign-ins) | Low | Inherent trade-off of lock-outs; preferred over unlimited guessing | The guessing session is ended when the lock triggers; locks expire | Accepted |
| R9 | Registration reveals whether an email is already registered (409) | Low | Standard e-commerce UX trade-off (SEC-18) | Rate limited per IP | Accepted |
| R10 | Guest order links carry an access token in the URL (emails, WhatsApp) | Low | Needed for guest checkout without accounts (SEC-21) | 24-byte random token, stored hashed; strict Referrer-Policy | Accepted |
| R11 | An administrator with `payments:manage` can point SMTP at any host (CEL-SEC-06) | Low | Required to configure the mail provider | Restricted to the highest permission; now behind step-up; host names only, no URLs | Accepted |
| R12 | Moyasar/Tabby adapters not verified against real test accounts | Medium | No provider test credentials available | Amount and currency reconciled with the provider before marking paid | Developer, once test keys exist |
| R13 | No automated DAST (OWASP ZAP/Burp) or load test | Low | Out of scope for this round | Black-box probe suite (75 probes) covers the main attack classes | Before launch, against staging only |
| R16 | A guest with a new email **and** a new phone number can still reuse a per-customer coupon | Low | Guest checkout without accounts cannot identify a person with certainty | Account, email and phone all count; per-IP checkout limit | Accepted (or make such coupons sign-in only) |
| R17 | Two shoppers sharing one phone number share per-customer coupon limits and the open-COD cap | Low | Phone is used as an identity on purpose | Cap is configurable | Accepted |
| R14 | Third-party trust: Google Fonts, YouTube/Vimeo embeds, Cloudinary images, payment pages | Low | Business features | CSP restricts each to its domain; no third-party scripts beyond the video players | Accepted |
| R15 | SAST (CodeQL) not in CI | Low | Free only on public repositories | Typecheck, tests and audit in CI | Owner: enable if GitHub Advanced Security is available |

## Limits of this assessment

- Production systems, payment providers and third-party services were **not** tested. Every probe ran against a local server with an in-memory database.
- Dependency results reflect the advisory database on 13 November 2026; new advisories will appear, which is why CI runs `npm audit` on every change.
- Code review covered the security-relevant paths listed in the audit report, not every line of the 372 tracked files.
