// Production-shaped rate-limit probes. TRUST_PROXY_HOPS=1 (default): the platform proxy APPENDS the
// SAFETY: these probes send attack-shaped requests. They refuse to run against anything but a local server.
const __base = process.env.BASE || 'http://localhost:4319';
{ const u = new URL(__base); if (u.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(u.hostname)) { console.error('Refusing to probe a non-local server: ' + __base); process.exit(2); } }
// real client IP, so the right-most X-Forwarded-For value is authoritative. We simulate that proxy by
// always putting a fixed "real" IP last, and let the attacker vary everything to its left.
const B = __base;
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'celibery' };
const post = (p, body, xff) => fetch(B + p, { method: 'POST', headers: { ...H, 'X-Forwarded-For': xff }, body: JSON.stringify(body) });
const out = [];
const rec = (id, name, pass, detail) => { out.push({ id, name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${name}  — ${detail}`); };

// RATE-02: attacker rotates the left part of X-Forwarded-For on every attempt; real IP stays last.
{
  const real = '198.51.100.7';
  let first = -1;
  for (let i = 0; i < 25; i++) {
    const r = await post('/api/auth/login', { email: `rot${i}@example.com`, password: 'Wrong-Passw0rd!' }, `10.${i}.${i}.${i}, ${real}`);
    if (r.status === 429) { first = i + 1; break; }
  }
  rec('RATE-02', 'rotating spoofed X-Forwarded-For (behind 1 proxy) does not bypass per-IP limit', first > 0 && first <= 21, first > 0 ? `429 on attempt ${first}` : 'never limited in 25 attempts');
}

// RATE-03: per-address reset-email limit (5/h), from a fresh client IP so the per-IP budget is unused.
{
  let blocked = -1;
  for (let i = 0; i < 8; i++) {
    const r = await post('/api/auth/forgot-password', { email: 'victim2@example.com' }, `198.51.100.${30 + i}`);
    if (r.status === 429) { blocked = i + 1; break; }
  }
  rec('RATE-03', 'reset emails to one address limited across many IPs', blocked === 6, blocked > 0 ? `429 on request ${blocked} (limit 5/h per address)` : 'never limited');
}

// RATE-04: distributed guessing on ONE account from many IPs (per-account limit 10 failed / 15 min).
{
  let blocked = -1;
  for (let i = 0; i < 14; i++) {
    const r = await post('/api/auth/login', { email: 'target@example.com', password: 'Wrong-Passw0rd!' + i }, `198.51.100.${100 + i}`);
    if (r.status === 429) { blocked = i + 1; break; }
  }
  rec('RATE-04', 'distributed login guessing on one account limited', blocked > 0 && blocked <= 11, blocked > 0 ? `429 on attempt ${blocked}` : 'never limited');
}
console.log(`\n${out.length} probes, ${out.filter((r) => !r.pass).length} failed`);
