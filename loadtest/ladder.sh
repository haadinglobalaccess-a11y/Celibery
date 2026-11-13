#!/usr/bin/env bash
# Runs one k6 script at progressive VU levels with the resource monitor alongside.
#   K6=/path/to/k6 METRICS_TOKEN=... LOADTEST_MONGODB_URI=... bash loadtest/ladder.sh storefront "10 50 100 250 500"
# Stops climbing as soon as a level's error rate exceeds 5 % (the environment is saturated).
set -uo pipefail
script="$1"; levels="${2:-10 50 100}"; ramp="${RAMP:-20s}"; hold="${HOLD:-60s}"
cd "$(dirname "$0")/.."
for v in $levels; do
  secs=$(( ${ramp%s} + ${hold%s} + 10 ))
  node loadtest/monitor.mjs "${script}-${v}vu" "$secs" > /dev/null 2>&1 &
  mon=$!
  "$K6" run -q --no-color -e VUS="$v" -e RAMP="$ramp" -e HOLD="$hold" ${K6_EXTRA:-} "loadtest/k6/${script}.js" > "loadtest/results/${script}-${v}vu.log" 2>&1
  wait "$mon"
  err=$(node -e "const d=require('./loadtest/results/${script}-${v}vu.json');console.log((d.errorRate*100).toFixed(2))")
  node -e "const d=require('./loadtest/results/${script}-${v}vu.json');const r=require('./loadtest/results/${script}-${v}vu-resources.json');console.log('${script} ${v}VU', 'rps='+d.rps, 'p50='+d.p50.toFixed(0), 'p95='+d.p95.toFixed(0), 'p99='+d.p99.toFixed(0), 'err='+(d.errorRate*100).toFixed(2)+'%', 'apiCPU='+r.apiCpuPctOfOneCore.avg+'%', 'mongodCPU='+r.mongodCpuPctOfOneCore+'%', 'rss='+r.apiRssMB.max+'MB', 'loopP99='+r.eventLoopDelayP99Ms.max+'ms', 'pool='+JSON.stringify(r.mongoPool))"
  if node -e "process.exit(${err} > 5 ? 0 : 1)"; then echo "stopping: error rate ${err}% at ${v} VUs"; break; fi
done
