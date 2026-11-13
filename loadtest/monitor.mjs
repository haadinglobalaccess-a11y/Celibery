// Samples the API's /api/health/metrics and MongoDB serverStatus every 2 s while a k6 run is in
// progress, then writes peak/average resource usage to loadtest/results/<label>-resources.json.
//   METRICS_TOKEN=... LOADTEST_MONGODB_URI=... node loadtest/monitor.mjs <label> <seconds>
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const mongoose = require('mongoose');
const [label = 'run', seconds = '90'] = process.argv.slice(2);
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4100';
const token = process.env.METRICS_TOKEN;
const mongodCpu = () => {
  try { return Number(execSync('powershell -NoProfile -Command "(Get-Process mongod | Measure-Object CPU -Sum).Sum"').toString().trim()); } catch { return NaN; }
};

await mongoose.connect(process.env.LOADTEST_MONGODB_URI);
const admin = mongoose.connection.db.admin();
const samples = [];
const cpu0 = mongodCpu();
const t0 = Date.now();
let prev = null;
while (Date.now() - t0 < Number(seconds) * 1000) {
  try {
    const r = await fetch(`${BASE}/api/health/metrics`, { headers: { Authorization: `Bearer ${token}` } });
    const m = (await r.json()).data;
    const ss = await admin.command({ serverStatus: 1 });
    const now = Date.now();
    const cpuMs = (m.cpuMicros.user + m.cpuMicros.system) / 1000;
    if (prev) {
      samples.push({
        apiCpuPct: (100 * (cpuMs - prev.cpuMs)) / (now - prev.now),
        rssMB: m.memoryMB.rss,
        heapMB: m.memoryMB.heapUsed,
        loopP99: m.eventLoopDelayMs.p99,
        inFlight: m.http.inFlight,
        poolCreated: m.mongo.created,
        poolOut: m.mongo.checkedOut,
        poolWaiting: m.mongo.waiting,
        dbConnections: ss.connections.current,
      });
    }
    prev = { cpuMs, now };
  } catch { /* server busy or restarting */ }
  await new Promise((r) => setTimeout(r, 2000));
}
const cpu1 = mongodCpu();
const max = (k) => Math.max(...samples.map((s) => s[k]));
const avg = (k) => samples.reduce((a, s) => a + s[k], 0) / Math.max(1, samples.length);
const out = {
  label,
  samples: samples.length,
  apiCpuPctOfOneCore: { avg: +avg('apiCpuPct').toFixed(1), max: +max('apiCpuPct').toFixed(1) },
  mongodCpuPctOfOneCore: +((100 * (cpu1 - cpu0)) / ((Date.now() - t0) / 1000)).toFixed(1),
  apiRssMB: { avg: Math.round(avg('rssMB')), max: max('rssMB') },
  apiHeapMB: { max: max('heapMB') },
  eventLoopDelayP99Ms: { max: +max('loopP99').toFixed(1) },
  inFlightMax: max('inFlight'),
  mongoPool: { createdTotal: max('poolCreated'), checkedOutMax: max('poolOut'), waitingMax: max('poolWaiting') },
  dbConnectionsMax: max('dbConnections'),
};
fs.mkdirSync('loadtest/results', { recursive: true });
fs.writeFileSync(`loadtest/results/${label}-resources.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
await mongoose.disconnect();
