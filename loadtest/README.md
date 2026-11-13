# CELIBERY load testing

Isolated environments only. **Never run this against production.** Results and method: `../LOAD_TEST_REPORT.md`.

| File | Purpose |
|---|---|
| `seed-synthetic.ts` | Synthetic products, customers, orders and an admin. Refuses non-`loadtest` DB names, non-local hosts (unless `--allow-remote-staging`), `NODE_ENV=production`, and databases holding real orders. Writes `.fixtures.json` (git-ignored). |
| `explain-queries.ts` | Read-only query-plan report for the hot queries |
| `run-server.sh` | Starts the built API in production mode against the synthetic DB (random secrets; set `JWT_SECRET` to share one across instances) |
| `monitor.mjs` | Samples `/api/health/metrics` + MongoDB `serverStatus` during a run |
| `ladder.sh` | Runs a k6 script at increasing VU levels with the monitor; stops when errors exceed 5% |
| `k6/storefront.js` | Anonymous shopper journey (home, categories, listing, product, search, cart quote, checkout options) |
| `k6/customer.js` | Sign-in, account, orders, tracking |
| `k6/checkout.js` | COD order placement + idempotent replay. **Writes orders**: needs `ALLOW_ORDER_WRITES=1`. |
| `k6/admin.js` | Admin overview, orders, search, products |
| `k6/login-rate.js` | Constant sign-in arrival rate |

```bash
# 1. a local replica set on 27099 (any MongoDB ≥ 6 started with --replSet rs0, then rs.initiate())
export LOADTEST_MONGODB_URI="mongodb://127.0.0.1:27099/?replicaSet=rs0" LOADTEST_DB_NAME=celibery_loadtest
npx tsx loadtest/seed-synthetic.ts
npm run build -w server
METRICS_TOKEN=local-token bash loadtest/run-server.sh &          # API on :4100
K6=$(which k6) METRICS_TOKEN=local-token bash loadtest/ladder.sh storefront "10 50 100 250"
```

Several instances: start more servers with `PORT=4101` and the same `JWT_SECRET`, then pass
`K6_EXTRA="-e BASE_URLS=http://127.0.0.1:4100,http://127.0.0.1:4101"`.
