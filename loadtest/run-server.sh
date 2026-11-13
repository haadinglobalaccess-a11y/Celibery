#!/usr/bin/env bash
# Starts the BUILT API (server/dist) in production mode against the isolated synthetic database,
# exactly as Railway runs it (node dist/server.js), on 127.0.0.1:4100. Secrets are random per run.
#   LOADTEST_MONGODB_URI=mongodb://127.0.0.1:27099/?replicaSet=rs0 LOADTEST_DB_NAME=celibery_loadtest bash loadtest/run-server.sh
set -euo pipefail
: "${LOADTEST_MONGODB_URI:?set LOADTEST_MONGODB_URI}"
: "${LOADTEST_DB_NAME:?set LOADTEST_DB_NAME}"
case "$LOADTEST_DB_NAME" in *loadtest*) ;; *) echo "LOADTEST_DB_NAME must contain 'loadtest'" >&2; exit 1 ;; esac
cd "$(dirname "$0")/../server"
rnd() { node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"; }
export NODE_ENV=production
export PORT="${PORT:-4100}"
export MONGODB_URI="$LOADTEST_MONGODB_URI"
export MONGODB_DB_NAME="$LOADTEST_DB_NAME"
export JWT_SECRET="${JWT_SECRET:-$(rnd)}"   # replicas must share it
export CRON_SECRET="${CRON_SECRET:-$(rnd)}"
export PUBLIC_SITE_URL="https://loadtest.invalid"
export CORS_ORIGINS="https://loadtest.invalid"
export ALLOW_LOCAL_MEDIA_STORAGE=true
export ALLOW_SANDBOX_PAYMENTS=true
export TRUST_PROXY_HOPS=1
export DISABLE_INTERNAL_SCHEDULER=true
export MAX_OPEN_COD_ORDERS_PER_PHONE="${MAX_OPEN_COD_ORDERS_PER_PHONE:-3}"
exec node dist/server.js
