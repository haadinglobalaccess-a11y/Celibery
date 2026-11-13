import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { saudiPhone } from '../src/modules/auth/auth.schemas';
import { phoneKey, phoneVariants } from '../src/modules/orders/order.service';
import { Product } from '../src/models';
import { client, createStaff, useDatabase } from './helpers';

useDatabase();

describe('phone matching for the COD cap and per-customer discounts', () => {
  it('exact variants find exactly what the former suffix regex found, for every accepted spelling', () => {
    const forms = (n: string) => [n, `0${n}`, `966${n}`, `+966${n}`];
    for (const n of ['551234567', '500000000', '599999999']) {
      for (const typed of forms(n)) {
        expect(saudiPhone.safeParse(typed).success).toBe(true);
        const key = phoneKey(typed);
        for (const stored of [...forms(n), ...forms('561234567')]) {
          expect(phoneVariants(key).includes(stored)).toBe(new RegExp(`${key}$`).test(stored));
        }
      }
    }
    expect(phoneVariants('')).toEqual([]);
  });
});

describe('public cache (homepage, categories, public settings)', () => {
  const saved = env.PUBLIC_CACHE_TTL_SECONDS;
  beforeAll(() => {
    env.PUBLIC_CACHE_TTL_SECONDS = 30;
  });
  afterAll(() => {
    env.PUBLIC_CACHE_TTL_SECONDS = saved;
  });

  const priceOnHome = async (slug: string) => {
    const r = await client().get('/api/home');
    expect(r.status).toBe(200);
    const all = [...r.body.data.featured, ...r.body.data.categoryProducts.flatMap((c: { items: unknown[] }) => c.items)] as { slug: string; price: number }[];
    return all.find((p) => p.slug === slug)?.price;
  };

  it('reuses the homepage, but an admin save is visible on the very next request', async () => {
    const p = (await Product.findOne({ status: 'active', featured: true }).sort({ sortOrder: 1, _id: 1 }).lean())!;
    const before = await priceOnHome(p.slug);
    expect(before).toBe(p.price);

    // A change that bypasses the admin (e.g. a script) is served from cache until the TTL ends…
    await Product.updateOne({ _id: p._id }, { $set: { price: p.price + 100 } });
    expect(await priceOnHome(p.slug)).toBe(before);

    // …while the server-authoritative cart quote always reads the database.
    const quote = await client().post('/api/cart/quote').send({ items: [{ productId: String(p._id), quantity: 1 }] });
    expect(quote.body.data.lines[0].unitPrice).toBe(p.price + 100);

    // An admin save invalidates before the admin receives "saved".
    const admin = await createStaff('admin');
    const saved = await admin.put(`/api/admin/products/${p._id}`).send({ price: (p.price + 500) / 100 });
    expect(saved.status).toBe(200);
    expect(await priceOnHome(p.slug)).toBe(p.price + 500);
  });

  it('a change made on another instance (version bump) is picked up within about a second', async () => {
    const p = (await Product.findOne({ status: 'active', featured: true }).sort({ sortOrder: 1, _id: 1 }).lean())!;
    expect(await priceOnHome(p.slug)).toBe(p.price);
    await Product.updateOne({ _id: p._id }, { $set: { price: p.price + 7 } });
    await mongoose.connection.db!.collection<{ _id: string; seq: number }>('counters').updateOne({ _id: 'public-cache' }, { $inc: { seq: 1 } }, { upsert: true });
    await new Promise((r) => setTimeout(r, 1_100));
    expect(await priceOnHome(p.slug)).toBe(p.price + 7);
  });

  it('caches nothing tied to a visitor: signed-in and anonymous visitors get the same public payload', async () => {
    const anon = await client().get('/api/settings/public');
    const admin = await createStaff('admin');
    const signedIn = await admin.get('/api/settings/public');
    expect(signedIn.body).toEqual(anon.body);
    // HTTP caching headers are unchanged: never cacheable by shared intermediaries.
    expect(anon.headers['cache-control']).toMatch(/no-(store|cache)/);
    expect(anon.headers['cache-control']).not.toMatch(/public|s-maxage/);
  });
});

describe('database outage (fail fast, cached storefront)', () => {
  const saved = env.PUBLIC_CACHE_TTL_SECONDS;
  const simulateOutage = () => Object.defineProperty(mongoose.connection, 'readyState', { get: () => 0, configurable: true });
  const endOutage = () => delete (mongoose.connection as unknown as { readyState?: number }).readyState;
  beforeAll(() => {
    env.PUBLIC_CACHE_TTL_SECONDS = 30;
  });
  afterAll(() => {
    endOutage();
    env.PUBLIC_CACHE_TTL_SECONDS = saved;
  });

  it('serves the last homepage, answers other requests 503 with Retry-After within seconds, and recovers', async () => {
    const warm = await client().get('/api/home');
    expect(warm.status).toBe(200);
    simulateOutage();
    try {
      const t0 = Date.now();
      const home = await client().get('/api/home');
      expect(home.status).toBe(200);
      expect(home.body.data.featured).toEqual(warm.body.data.featured);

      const products = await client().get('/api/products?limit=2');
      expect(products.status).toBe(503);
      expect(products.body.error.code).toBe('DATABASE_UNAVAILABLE');
      expect(products.headers['retry-after']).toBe('5');
      const checkout = await client().post('/api/checkout').send({});
      expect(checkout.status).toBe(503); // nothing reaches order code while the database is down
      expect(Date.now() - t0).toBeLessThan(8_000);

      expect((await client().get('/api/health')).status).toBe(503);
      expect((await client().get('/api/health/live')).status).toBe(200);
    } finally {
      endOutage();
    }
    expect((await client().get('/api/products?limit=2')).status).toBe(200);
  });
});

describe('sign-in under overload', () => {
  it('answers 503 SIGN_IN_BUSY with Retry-After, and busy answers never lock the account', async () => {
    const { createCustomer } = await import('./helpers');
    const { email } = await createCustomer();
    const savedQueue = env.PASSWORD_HASH_MAX_QUEUE;
    process.env.RATE_LIMIT_IN_TESTS = '1';
    try {
      env.PASSWORD_HASH_MAX_QUEUE = 0; // every password check is refused as "busy"
      for (let i = 0; i < 12; i++) {
        const r = await client().post('/api/auth/login').set('X-Forwarded-For', `10.77.0.${i + 1}`).send({ email, password: 'Passw0rd!x' });
        expect(r.status).toBe(503);
        expect(r.body.error.code).toBe('SIGN_IN_BUSY');
        expect(r.headers['retry-after']).toBe('5');
      }
      env.PASSWORD_HASH_MAX_QUEUE = savedQueue;
      // More than the 10-failures-per-account limit were refused as busy; the customer can still sign in.
      const ok = await client().post('/api/auth/login').set('X-Forwarded-For', '10.77.1.1').send({ email, password: 'Passw0rd!x' });
      expect(ok.status).toBe(200);
    } finally {
      env.PASSWORD_HASH_MAX_QUEUE = savedQueue;
      delete process.env.RATE_LIMIT_IN_TESTS;
    }
  });
});

describe('single-server storefront static files (SERVE_CLIENT)', () => {
  it('caches hashed bundles for a year and always revalidates index.html', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const request = (await import('supertest')).default;
    const { createApp } = await import('../src/app');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-dist-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>x</title>');
    fs.writeFileSync(path.join(dir, 'favicon.svg'), '<svg/>');
    const site = createApp({ serveClient: dir });
    expect((await request(site).get('/assets/index-abc123.js')).headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await request(site).get('/favicon.svg')).headers['cache-control']).toBe('no-cache');
    const page = await request(site).get('/en/products');
    expect(page.status).toBe(200);
    expect(page.headers['cache-control'] ?? 'no-cache').not.toMatch(/max-age=[1-9]/);
  });
});

describe('health and metrics endpoints', () => {
  it('liveness is always up; readiness reflects the database', async () => {
    expect((await client().get('/api/health/live')).status).toBe(200);
    expect((await client().get('/api/health')).body.data.status).toBe('ok');
  });

  it('metrics are disabled without METRICS_TOKEN and need the exact bearer token', async () => {
    const saved = env.METRICS_TOKEN;
    try {
      env.METRICS_TOKEN = '';
      expect((await client().get('/api/health/metrics')).status).toBe(404);
      env.METRICS_TOKEN = 'm'.repeat(40);
      expect((await client().get('/api/health/metrics')).status).toBe(403);
      expect((await client().get('/api/health/metrics').set('Authorization', 'Bearer wrong')).status).toBe(403);
      const ok = await client().get('/api/health/metrics').set('Authorization', `Bearer ${'m'.repeat(40)}`);
      expect(ok.status).toBe(200);
      expect(ok.body.data.http.total).toBeGreaterThan(0);
      expect(ok.body.data.mongo.maxPoolSize).toBe(env.MONGODB_MAX_POOL_SIZE);
      expect(JSON.stringify(ok.body)).not.toMatch(/token=|cel_session|@test\.local/);
    } finally {
      env.METRICS_TOKEN = saved;
    }
  });
});
