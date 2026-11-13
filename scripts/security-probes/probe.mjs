// Black-box security probes against the LOCAL e2e server only (in-memory DB, demo data).
// SAFETY: these probes send attack-shaped requests. They refuse to run against anything but a local server.
const __base = process.env.BASE || 'http://localhost:4319';
{ const u = new URL(__base); if (u.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(u.hostname)) { console.error('Refusing to probe a non-local server: ' + __base); process.exit(2); } }
import fs from 'node:fs';
const B = __base;
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'celibery' };
const results = [];
const rec = (id, name, pass, detail) => { results.push({ id, name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${name}  — ${detail}`); };
const j = async (r) => { try { return await r.json(); } catch { return null; } };
const raw = (path, init = {}) => fetch(B + path, { redirect: 'manual', ...init });
const api = (path, { method = 'GET', body, cookie, headers = {} } = {}) =>
  raw(path, { method, headers: { ...H, ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
const cookieOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

// ---------- 1. Authentication boundary ----------
for (const p of ['/api/admin/orders', '/api/admin/settings', '/api/admin/staff', '/api/admin/integrations', '/api/admin/faq', '/api/admin/checkouts', '/api/me/addresses', '/api/me/orders']) {
  const r = await api(p);
  rec('AUTH-01', `anonymous GET ${p}`, r.status === 401, `status ${r.status}`);
}

// ---------- 2. CSRF + CORS ----------
{
  const r = await raw('/api/newsletter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'x@example.com' }) });
  rec('CSRF-01', 'write without X-Requested-With header', r.status === 403, `status ${r.status}`);
  const r2 = await raw('/api/newsletter', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'email=x@example.com' });
  rec('CSRF-02', 'simple (form-style) cross-site POST', r2.status === 403 || r2.status === 415 || r2.status === 400, `status ${r2.status}`);
  const r3 = await raw('/api/auth/me', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-requested-with,content-type' } });
  const acao = r3.headers.get('access-control-allow-origin');
  rec('CORS-01', 'preflight from foreign origin', !acao || acao === 'null', `ACAO=${acao}`);
  const r4 = await raw('/api/settings/public', { headers: { Origin: 'https://evil.example' } });
  rec('CORS-02', 'credentialed read from foreign origin', r4.headers.get('access-control-allow-origin') !== 'https://evil.example', `ACAO=${r4.headers.get('access-control-allow-origin')} ACAC=${r4.headers.get('access-control-allow-credentials')}`);
}

// ---------- 3. Injection ----------
{
  const r = await api('/api/auth/login', { method: 'POST', body: { email: { $ne: null }, password: { $ne: null } } });
  rec('NOSQL-01', 'operator injection in login body', r.status === 400, `status ${r.status}`);
  const r2 = await api('/api/products?category[$ne]=x&sort[$where]=1');
  rec('NOSQL-02', 'operator injection in query string', r2.status === 400 || r2.status === 200, `status ${r2.status} (must not be 500)`);
  const r3 = await api('/api/orders/track?orderNumber[$ne]=x&email[$ne]=x');
  rec('NOSQL-03', 'operator injection in order tracking', r3.status === 400 || r3.status === 404, `status ${r3.status}`);
  const r4 = await api('/api/auth/login', { method: 'POST', body: '{"__proto__":{"isAdmin":true},"email":"a@b.co","password":"x"}' });
  rec('PROTO-01', 'prototype pollution key', r4.status === 400, `status ${r4.status}`);
  const t0 = Date.now();
  const r5 = await api('/api/products?q=' + encodeURIComponent('(a+)+'.repeat(20) + '$'));
  rec('REDOS-01', 'regex metacharacters in search', r5.status < 500 && Date.now() - t0 < 3000, `status ${r5.status} in ${Date.now() - t0}ms`);
}

// ---------- 4. Error handling / debug exposure ----------
{
  const r = await api('/api/auth/login', { method: 'POST', body: '{"email": broken' });
  const t = await r.text();
  rec('ERR-01', 'malformed JSON → no stack trace', r.status === 400 && !/at \w+ \(|node_modules|\.ts:\d+/.test(t), `status ${r.status} body ${t.slice(0, 90)}`);
  const big = 'x'.repeat(1_200_000);
  const r2 = await api('/api/newsletter', { method: 'POST', body: JSON.stringify({ email: big }) });
  rec('ERR-02', 'body over 1 MB rejected', r2.status === 413, `status ${r2.status}`);
  const r3 = await api('/api/products/' + 'a'.repeat(5000));
  rec('ERR-03', 'oversized path parameter', r3.status === 400 || r3.status === 404, `status ${r3.status}`);
  const r4 = await api('/api/products?limit=100000');
  const b4 = await j(r4);
  rec('PAGE-01', 'pagination limit capped', r4.status === 400 || (Array.isArray(b4?.data) && b4.data.length <= 100), `status ${r4.status} items ${b4?.data?.length}`);
}

// ---------- 5. Static file / path traversal ----------
for (const p of ['/.env', '/../.env', '/%2e%2e/.env', '/..%2f..%2fserver%2f.env', '/media/..%2f..%2f.env', '/media/%2e%2e/%2e%2e/package.json', '/server/src/config/env.ts', '/package.json', '/.git/config', '/e2e/.artifacts/admin.json', '/assets/../../package.json']) {
  const r = await raw(p);
  const t = await r.text();
  const leaked = /JWT_SECRET|MONGODB_URI|"workspaces"|\[core\]|"password"/.test(t);
  rec('PATH-01', `GET ${p}`, !leaked, `status ${r.status}${leaked ? ' LEAKED CONTENT' : ''}`);
}

// ---------- 6. Security headers ----------
{
  const r = await raw('/en');
  const h = Object.fromEntries(['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'strict-transport-security', 'cross-origin-opener-policy', 'x-powered-by'].map((k) => [k, r.headers.get(k)]));
  rec('HDR-01', 'storefront CSP present', Boolean(h['content-security-policy']), String(h['content-security-policy']).slice(0, 80));
  rec('HDR-02', 'CSP forbids framing', /frame-ancestors 'none'|frame-ancestors 'self'/.test(h['content-security-policy'] ?? '') || /deny|sameorigin/i.test(h['x-frame-options'] ?? ''), `XFO=${h['x-frame-options']}`);
  rec('HDR-03', 'nosniff', h['x-content-type-options'] === 'nosniff', String(h['x-content-type-options']));
  rec('HDR-04', 'no X-Powered-By', !h['x-powered-by'], String(h['x-powered-by']));
  rec('HDR-05', 'Referrer-Policy', Boolean(h['referrer-policy']), String(h['referrer-policy']));
  const csp = h['content-security-policy'] ?? '';
  rec('HDR-06', "CSP has no 'unsafe-eval' / script 'unsafe-inline'", !/unsafe-eval/.test(csp) && !/script-src[^;]*'unsafe-inline'/.test(csp), csp.match(/script-src[^;]*/)?.[0] ?? 'no script-src');
}

// ---------- 7. Sensitive data exposure (public endpoints) ----------
{
  const s = await (await api('/api/settings/public')).text();
  rec('EXPO-01', 'public settings carry no secrets', !/secret|apiKey|api_key|password|smtp|accessToken|privateKey/i.test(s), `${s.length} bytes`);
  const p = await (await api('/api/products?limit=5')).text();
  rec('EXPO-02', 'product list carries no cost/internal fields', !/costPrice|"cost"|supplier|passwordHash/i.test(p), 'checked costPrice/supplier/passwordHash');
}

// ---------- 8. Accounts: mass assignment, enumeration, brute force ----------
const email = `probe${Date.now()}@example.com`;
let cust = '';
{
  const r = await api('/api/auth/register', { method: 'POST', body: { name: 'Probe', email, password: 'Str0ng!Passw0rd-x', type: 'staff', role: 'admin', permissions: ['settings:write'], tokenVersion: 99, mfa: { enabled: true } } });
  cust = cookieOf(r);
  const me = await j(await api('/api/auth/me', { cookie: cust }));
  rec('MASS-01', 'register ignores type/role/permissions', r.status < 300 && me?.data?.type === 'customer' && !me?.data?.role && !(me?.data?.permissions ?? []).length, `status ${r.status} type=${me?.data?.type} role=${me?.data?.role} perms=${JSON.stringify(me?.data?.permissions ?? [])}`);
  const r2 = await api('/api/admin/orders', { cookie: cust });
  rec('PRIV-01', 'customer session → admin API', r2.status === 403 || r2.status === 401, `status ${r2.status}`);
  const r3 = await api('/api/me/profile', { method: 'PATCH', cookie: cust, body: { name: 'P2', type: 'staff', email: 'admin@celibery.test', role: 'admin', status: 'active' } });
  const me2 = await j(await api('/api/auth/me', { cookie: cust }));
  rec('MASS-02', 'profile update ignores type/email/role', me2?.data?.type === 'customer' && me2?.data?.email === email && !me2?.data?.role, `status ${r3.status} type=${me2?.data?.type} email=${me2?.data?.email}`);
  const weak = await api('/api/auth/register', { method: 'POST', body: { name: 'W', email: 'w' + email, password: '123456' } });
  rec('PASS-01', 'weak password refused', weak.status === 400, `status ${weak.status}`);
}
{
  const a = await api('/api/auth/forgot-password', { method: 'POST', body: { email } });
  const b = await api('/api/auth/forgot-password', { method: 'POST', body: { email: 'nobody' + email } });
  const ta = await a.text(), tb = await b.text();
  rec('ENUM-01', 'forgot-password identical for known/unknown email', a.status === b.status && ta.replace(/"devResetUrl":"[^"]*",?/, '') === tb, `${a.status}/${b.status} same=${ta === tb}`);
  const la = await api('/api/auth/login', { method: 'POST', body: { email, password: 'wrong-Passw0rd!' } });
  const lb = await api('/api/auth/login', { method: 'POST', body: { email: 'nobody' + email, password: 'wrong-Passw0rd!' } });
  const tla = await la.text(), tlb = await lb.text();
  rec('ENUM-02', 'login error identical for known/unknown email', la.status === lb.status && tla === tlb, `${la.status}/${lb.status} same=${tla === tlb}`);
}
{
  let limited = 0, first429 = -1;
  for (let i = 0; i < 30; i++) {
    const r = await api('/api/auth/login', { method: 'POST', body: { email: `bf${i % 3}-${email}`, password: 'wrong-Passw0rd!' + i } });
    if (r.status === 429) { limited++; if (first429 < 0) first429 = i; }
  }
  rec('RATE-01', 'login brute force throttled', limited > 0, `first 429 after ${first429} attempts, ${limited}/30 blocked`);
}

// ---------- 9. Sessions ----------
{
  const r = await api('/api/auth/register', { method: 'POST', body: { name: 'Session Probe', email: 's' + email, password: 'Str0ng!Passw0rd-y' } });
  rec('SESS-00', 'second account registered (precondition)', r.status === 201, `status ${r.status}`);
  const c = cookieOf(r);
  const setc = (r.headers.getSetCookie?.() ?? []).join(' | ');
  rec('SESS-01', 'session cookie HttpOnly + SameSite', /HttpOnly/i.test(setc) && /SameSite/i.test(setc), setc.replace(/=[^;]{8,}/, '=…').slice(0, 120));
  await api('/api/auth/logout', { method: 'POST', cookie: c });
  const after = await api('/api/me/addresses', { cookie: c });
  rec('SESS-02', 'stolen cookie unusable after logout', after.status === 401, `status ${after.status}`);
  const forged = await api('/api/me/addresses', { cookie: 'cel_session=eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIiwidHlwIjoic3RhZmYifQ.' });
  rec('SESS-03', 'alg:none forged token rejected', forged.status === 401, `status ${forged.status}`);
}

// ---------- 10. Orders: IDOR + price manipulation ----------
let orderNumber = '', orderToken = '';
{
  const prods = (await j(await api('/api/products?limit=5')))?.data ?? [];
  const p = prods.find((x) => x.available) ?? prods[0];
  const body = {
    items: [{ productId: p._id, quantity: 1, price: 1, unitPrice: 1 }],
    contact: { name: 'Probe Buyer', email: 'buyer' + email, phone: '0501234567' },
    shippingAddress: { fullName: 'Probe Buyer', phone: '0501234567', city: 'Riyadh', district: 'Olaya', street: 'King Fahd Rd', buildingNumber: '1234', postalCode: '12345', line1: 'King Fahd Rd 1234' },
    paymentMethod: 'card', total: 1, subtotal: 1, discountTotal: 999, idempotencyKey: 'probe-' + Date.now(),
  };
  const r = await api('/api/checkout', { method: 'POST', body });
  const b = await j(r);
  orderNumber = b?.data?.order?.orderNumber ?? b?.data?.orderNumber ?? '';
  orderToken = b?.data?.accessToken ?? b?.data?.order?.accessToken ?? '';
  const total = b?.data?.order?.total ?? b?.data?.total;
  rec('PRICE-01', 'client-sent price/total ignored', r.status < 300 ? total === undefined || total >= p.price : r.status === 400, `status ${r.status} total=${total} catalogue price=${p.price} ${r.status >= 300 ? JSON.stringify(b?.error ?? b).slice(0, 160) : ''}`);
  if (orderNumber) {
    const anon = await api(`/api/orders/${orderNumber}`);
    rec('IDOR-01', 'guest order without token', anon.status === 404 || anon.status === 401, `status ${anon.status}`);
    const other = await api(`/api/orders/${orderNumber}`, { cookie: cust });
    rec('IDOR-02', "another customer's session reads the order", other.status === 404 || other.status === 403, `status ${other.status}`);
    const wrong = await api(`/api/orders/${orderNumber}?token=${'A'.repeat(32)}`);
    rec('IDOR-03', 'guest order with wrong token', wrong.status === 404, `status ${wrong.status}`);
    const arr = await api(`/api/orders/${orderNumber}?token=a&token=b`);
    rec('IDOR-04', 'token as array (type confusion)', arr.status === 404 || arr.status === 400, `status ${arr.status}`);
    const vp = await api(`/api/orders/${orderNumber}/verify-payment`, { method: 'POST', cookie: cust, body: {} });
    rec('IDOR-05', "verify-payment on another's order", vp.status === 404 || vp.status === 403, `status ${vp.status}`);
    const ret = await api(`/api/orders/${orderNumber}/returns`, { method: 'POST', cookie: cust, body: { items: [], reason: 'x' } });
    rec('IDOR-06', "return request on another's order", ret.status === 404 || ret.status === 403 || ret.status === 400, `status ${ret.status}`);
  }
}

// ---------- 11. Webhooks ----------
{
  const r = await api('/api/webhooks/moyasar', { method: 'POST', body: { id: 'evt_1', type: 'payment_paid', secret_token: 'guess', data: { invoice_id: 'inv_1' } } });
  rec('HOOK-01', 'Moyasar webhook with bad secret', r.status === 403 || r.status === 401, `status ${r.status}`);
  const r2 = await api('/api/webhooks/moyasar', { method: 'POST', body: { id: 'evt_2', data: { invoice_id: 'inv_1' } } });
  rec('HOOK-02', 'Moyasar webhook without secret', r2.status === 403 || r2.status === 401, `status ${r2.status}`);
  const r3 = await api('/api/webhooks/tabby', { method: 'POST', body: { id: 'p1', status: 'authorized' } });
  rec('HOOK-03', 'Tabby webhook without secret header', r3.status === 403 || r3.status === 401, `status ${r3.status}`);
  const r4 = await api('/api/cron/maintenance', { headers: { Authorization: 'Bearer x' } });
  rec('CRON-01', 'cron with wrong secret', r4.status === 401 || r4.status === 403, `status ${r4.status}`);
}

// ---------- 12. Admin: uploads ----------
{
  const creds = JSON.parse(fs.readFileSync(process.env.ADMIN_JSON || new URL('../../e2e/.artifacts/admin.json', import.meta.url), 'utf8'));
  const lr = await api('/api/auth/login', { method: 'POST', body: creds });
  const adm = cookieOf(lr);
  rec('ADMIN-00', 'admin login (fixture)', lr.status === 200, `status ${lr.status}`);
  // Real flow: create (declares type/size) → PUT raw bytes to the returned target → complete.
  const upload = async (name, type, bytes) => {
    const buf = Buffer.from(bytes);
    const c = await api('/api/admin/media/uploads', { method: 'POST', cookie: adm, body: { kind: 'image', filename: name, parts: [{ role: 'original', contentType: type, size: buf.length }] } });
    const cb = await j(c);
    if (c.status >= 300) return { status: c.status, stage: 'create', body: JSON.stringify(cb?.error ?? cb).slice(0, 160) };
    const target = cb.data.uploads[0];
    const put = await raw(target.url.replace(/^https?:\/\/[^/]+/, ''), { method: target.method || 'PUT', headers: { 'X-Requested-With': 'celibery', Cookie: adm, 'Content-Type': type, ...(target.headers || {}) }, body: buf });
    const pt = await put.text();
    if (put.status >= 300) return { status: put.status, stage: 'put', body: pt.slice(0, 160) };
    const done = await api(`/api/admin/media/${cb.data.assetId}/complete`, { method: 'POST', cookie: adm, body: {} });
    return { status: done.status, stage: 'complete', body: await done.text() };
  };
  const svg = await upload('x.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
  rec('UPLOAD-01', 'SVG with script refused', svg.status >= 400, `status ${svg.status} at ${svg.stage}: ${svg.body.slice(0, 90)}`);
  const html = await upload('x.png', 'image/png', '<html><script>alert(1)</script></html>');
  rec('UPLOAD-02', 'HTML disguised as .png refused', html.status >= 400, `status ${html.status} at ${html.stage}: ${html.body.slice(0, 90)}`);
  const exe = await upload('x.png', 'application/x-msdownload', Buffer.from('MZ\x90\x00'));
  rec('UPLOAD-03', 'executable content type refused', exe.status >= 400, `status ${exe.status} at ${exe.stage}`);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const trav = await upload('../../../evil.png', 'image/png', png);
  rec('UPLOAD-04', 'path traversal in filename: stored under a server key', trav.status < 300 && !/\.\.\//.test(JSON.stringify(JSON.parse(trav.body)?.data?.url ?? '')), `status ${trav.status} at ${trav.stage} url=${JSON.parse(trav.body)?.data?.url ?? ''}`);
  if (trav.status < 300) {
    const url = JSON.parse(trav.body).data.url.replace(/^https?:\/\/[^/]+/, '');
    const served = await raw(url);
    rec('UPLOAD-05', 'stored media served with nosniff + sandbox CSP', served.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(served.headers.get('content-security-policy') ?? ''), `ct=${served.headers.get('content-type')} csp=${(served.headers.get('content-security-policy') ?? '').slice(0, 60)}`);
  }
  const ar = await api('/api/admin/audit?limit=5', { cookie: adm });
  const audit = await j(ar);
  const n = Array.isArray(audit?.data) ? audit.data.length : audit?.data?.items?.length;
  rec('AUDIT-01', 'admin actions are audit-logged', n > 0, `status ${ar.status} entries ${n} ${n ? '' : JSON.stringify(audit).slice(0, 120)}`);
}

if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(results, null, 2));
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length} probes, ${fails.length} failed`);
