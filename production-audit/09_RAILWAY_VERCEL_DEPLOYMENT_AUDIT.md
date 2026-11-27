# 09 — Railway and Vercel Deployment Audit

**Access:** no Railway or Vercel dashboard, logs, metrics or environment-variable access was available. Everything below comes from the repository plus non-destructive public requests. Nothing was redeployed or changed.

## 1. What serves production

| Item | Finding | Evidence |
|---|---|---|
| Storefront | Railway service `celiberyclient-production.up.railway.app`, served by **`vite preview`** | `client/vite.config.ts:147` `allowedHosts`; `Server: railway-hikari`; soft-404 behaviour |
| API | Railway service `celiberyserver-production.up.railway.app` (`npm start` → `node dist/server.js`) | LIVE `/api/health` |
| Vercel | `vercel.json` is complete (SPA rewrites, crawler rewrites, crons, headers) but is **not** the live deployment | The live hosts are Railway |
| Custom domain | None in use (`celibery.international` appears in docs and examples only) | Sitemap `<loc>` uses the Railway host |

## 2. Railway: API service

| Check | Status | Notes |
|---|---|---|
| Start command | PASS (code) | `npm start`; `assertProductionConfig()` refuses unsafe configuration |
| Port binding | PASS | `env.PORT` |
| Health endpoint | PASS (LIVE) | `/api/health` 200 (503 when the DB is down), `/api/health/live` 200 |
| Database connection | PASS (LIVE) | Health reports `ok`; production requires a replica set |
| HTTPS / HSTS | PASS (LIVE) | |
| CORS | PASS (LIVE) | Foreign origin refused |
| Graceful shutdown | PASS (code) | SIGTERM → drain ≤ 10 s → close the DB |
| Scheduled jobs | PASS (code) | In-process scheduler (no Vercel Cron on Railway) |
| Restart behaviour, resource usage, deploy and runtime logs | **NOT VERIFIED** | No dashboard access |
| Health check configured in Railway | **NOT VERIFIED** | |
| Environment variables | **PARTIAL** | Inferred from live behaviour: `PAYMENT_GATEWAY=sandbox`, `ALLOW_SANDBOX_PAYMENTS=true` (**C-01**); `PUBLIC_SITE_URL` = storefront host; `COOKIE_SAMESITE` empty or `none`; `METRICS_TOKEN` unset; `STAFF_MFA_REQUIRED` unknown |

## 3. Railway: storefront service

| Check | Status | Notes |
|---|---|---|
| Server | **FAIL (H-03)** | `vite preview` is a preview tool. The project's own docs say not to use it in production |
| Security headers | PASS (LIVE) | Configured in `preview.headers` |
| Asset caching and compression | PASS (LIVE) | gzip; `immutable` for `/assets/*` |
| SEO files and crawler pages | PASS (LIVE) | Forwarded to the API by `seoForwardPlugin` |
| `/api/*` on the storefront host | **FAIL (H-02)** | `POST /api/webhooks/moyasar` → 500 |
| 404 status for people | FAIL (L-01) | 200 |

## 4. Environment configuration comparison

| Concern | Dev | Production (inferred) | Status |
|---|---|---|---|
| Database | Remote Atlas URI in `.env` | Atlas | **H-07**: possible overlap |
| Payment gateway | sandbox | sandbox | **C-01** |
| Debug mode | n/a | `NODE_ENV=production` implied: HSTS present and production guards active | PASS |
| Secrets in git | none | none | PASS |
| API URL | proxy `/api` → `localhost:4000` | `VITE_API_BASE_URL` = API host | PASS (functional) |
| CORS | localhost | storefront origin only | PASS |
| Staging environment | — | **none identified** | **M-05** |

`.env.example` documents every variable (without values), with a production column.

## 5. CI/CD
GitHub Actions runs on every push: secret scan, `npm audit --audit-level=high`, typecheck, lint, tests, build and E2E. **Whether Railway deploys only after CI passes is NOT VERIFIED.** Railway auto-deploys from the branch by default, independently of CI. The current branch is `feature/premium-polish`. Which branch Railway deploys is unknown.

## 6. Rollback readiness
Railway keeps previous deployments, and you can redeploy one from the dashboard. **Not tested.** Database migrations (`npm run migrate`) are described as additive and safe to repeat, but that is not proven by a rollback test. **Rollback procedure: NOT DOCUMENTED as a runbook.**

## 7. Recommendation
Consolidate into **one** Railway service (`npm ci && npm run build`, `npm start`, `SERVE_CLIENT=1`, `COOKIE_SAMESITE=lax`, `VITE_API_BASE_URL` empty). Give it the custom domain and set `PUBLIC_SITE_URL` / `CORS_ORIGINS` to it. Create a staging service with the same settings and test-mode gateway keys. Then retire the `vite preview` service. This removes H-02, H-03, L-01 and M-05 together.
