# 08 — Security Assessment

## 1. Automated checks

| Check | Command | Result |
|---|---|---|
| Dependency vulnerabilities | `npm audit` | **0 vulnerabilities** (all severities) |
| Secret scan (tracked files) | `node scripts/secret-scan.mjs` | "559 tracked files, no secrets found" |
| Secret scan (git history, 114 commits) | `git log --all -p -G<pattern>` for credentialed Mongo URIs, `sk_live_`, AWS keys, private keys, Resend keys, credentialed Cloudinary URLs | **0 matches** (counts only were printed) |
| Lockfile | `package-lock.json` present; CI uses `npm ci` | PASS |
| Static analysis | ESLint (recommended + react-hooks + typescript-eslint) | 0 errors, 5 warnings |

Dependencies are deliberately minimal: 11 server and 3 client runtime packages, all current major versions (Express 4.21, Mongoose 8, Zod 4, React 18.3, Vite 7). No upgrades were made during the audit.

## 2. OWASP-oriented review

| Area | Result | Notes / finding |
|---|---|---|
| A01 Broken access control | PASS | Server-side permissions on every admin route; IDOR-safe order access; escalation guards |
| A02 Cryptographic failures | PASS | bcrypt-12; SHA-256 for tokens; AES encryption of credentials and TOTP secrets with a key ring and rotation; HSTS |
| A03 Injection | PASS | Zod on every route, operator-key rejection, `strictQuery`; prerender HTML escaped |
| A04 Insecure design | **FAIL** | C-01 (sandbox payments reachable in production by configuration) |
| A05 Security misconfiguration | **FAIL** | C-01, H-03, H-04, M-02 |
| A06 Vulnerable components | PASS | `npm audit` clean |
| A07 Identification & auth failures | PARTIAL | Strong implementation; 2FA not enforced (H-04); lockout abuse (M-06) |
| A08 Software & data integrity | PARTIAL | Webhook path broken (H-01) |
| A09 Logging & monitoring | PARTIAL | Structured security events (`security-log.ts`, masked emails); alerting not configured (M-02) |
| A10 SSRF | PASS | No user-controlled server fetches |
| CSRF | PASS (browser) | Custom header + CORS allow-list; webhooks wrongly included (H-01) |
| XSS | PASS | No HTML sinks in the client; strict CSP |
| Uploads | PASS | Magic-byte sniffing, SVG blocked, sandboxed serving |
| Clickjacking | PASS | LIVE: storefront `X-Frame-Options: DENY` + `frame-ancestors 'none'` |
| Information disclosure | PASS | Generic errors; no `X-Powered-By`; metrics endpoint 404 without a token (LIVE) |

## 3. Live header evidence (27 Nov 2026)
- **API** `/api/health`: `content-security-policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, `strict-transport-security: max-age=31536000; includeSubDomains`, `x-content-type-options: nosniff`, `x-frame-options: SAMEORIGIN`, `Cache-Control: no-store`.
- **Storefront** `/`: `frame-ancestors 'none'; object-src 'none'; base-uri 'self'` (header) plus a full CSP in a `<meta>` tag, HSTS, nosniff, `X-Frame-Options: DENY`.
- **CORS:** a preflight from `https://evil.example` received no `Access-Control-Allow-*` headers.

## 4. Findings in this area
| ID | Summary |
|---|---|
| C-01 | Sandbox payments live |
| H-01 | Webhooks blocked by the CSRF guard |
| H-03 | Third-party cookie topology |
| H-04 | 2FA not enforced |
| H-07 | Developer machine holds remote DB credentials |
| M-01 | Refunds without step-up |
| M-02 | No alerting |
| M-06 | Account lockout abuse |
| L-02 … L-07 | See [14_RISK_REGISTER.md](14_RISK_REGISTER.md) |

## 5. Not performed
No active penetration testing (fuzzing, brute force, exploit attempts) against production, per the audit rules. A staging environment with the production configuration does not exist (M-05), so dynamic testing was limited to the isolated test suites.
