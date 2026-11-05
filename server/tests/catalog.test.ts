import { describe, expect, it } from 'vitest';
import { client, useDatabase } from './helpers';

useDatabase();
const c = client();

describe('catalogue', () => {
  it('lists the six confirmed categories in order', async () => {
    const r = await c.get('/api/categories');
    expect(r.status).toBe(200);
    expect(r.body.data.map((x: { slug: string }) => x.slug)).toEqual(['headphones', 'power-banks', 'car-essentials', 'cables', 'charging-adapters', 'tech-essentials']);
    for (const cat of r.body.data) {
      expect(cat.name.ar).toBeTruthy();
      expect(cat.name.en).toBeTruthy();
    }
  });

  it('returns only the filters configured for each category', async () => {
    const pb = await c.get('/api/categories/power-banks');
    expect(Object.keys(pb.body.data.facets).sort()).toEqual(['availability', 'capacity', 'color', 'connector', 'power', 'price']);
    expect(pb.body.data.facets.capacity.map((x: { value: number }) => x.value)).toEqual([5000, 10000, 20000]);
    const hp = await c.get('/api/categories/headphones');
    expect(hp.body.data.facets.capacity).toBeUndefined();
    expect(hp.body.data.facets.power).toBeUndefined();
    const te = await c.get('/api/categories/tech-essentials');
    expect(Object.keys(te.body.data.facets).sort()).toEqual(['availability', 'color', 'price']);
  });

  it('filters by category, capacity, power, connector, colour, availability and price', async () => {
    const byCap = await c.get('/api/products?category=power-banks&capacity=20000');
    expect(byCap.body.data.map((p: { sku: string }) => p.sku)).toEqual(['DEMO-PB-20K']);
    const byPower = await c.get('/api/products?category=charging-adapters&power=65');
    expect(byPower.body.data).toHaveLength(1);
    const byConn = await c.get('/api/products?category=cables&connector=lightning');
    expect(byConn.body.data.map((p: { sku: string }) => p.sku)).toEqual(['DEMO-CB-CL-1M']);
    const byColor = await c.get('/api/products?category=headphones&color=white');
    expect(byColor.body.data.length).toBe(2);
    const inStock = await c.get('/api/products?category=headphones&inStock=1');
    expect(inStock.body.data.every((p: { available: boolean }) => p.available)).toBe(true);
    expect(inStock.body.data.length).toBe(2);
    const price = await c.get('/api/products?minPrice=100&maxPrice=200');
    for (const p of price.body.data) expect(p.price).toBeGreaterThanOrEqual(10000);
    for (const p of price.body.data) expect(p.price).toBeLessThanOrEqual(20000);
  });

  it('searches in Arabic and English and by model', async () => {
    expect((await c.get('/api/products?q=' + encodeURIComponent('باور بانك'))).body.data.length).toBeGreaterThanOrEqual(3);
    expect((await c.get('/api/products?q=power%20bank')).body.data.length).toBeGreaterThanOrEqual(3);
    expect((await c.get('/api/products?q=DEMO-A65')).body.data[0].sku).toBe('DEMO-AD-65W');
    expect((await c.get('/api/products?q=' + encodeURIComponent('.*'))).body.data.length).toBe(0); // regex is escaped
  });

  it('sorts and paginates', async () => {
    const asc = await c.get('/api/products?sort=price_asc&limit=5');
    const prices = asc.body.data.map((p: { price: number }) => p.price);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    expect(asc.body.meta.pages).toBeGreaterThan(1);
    const p2 = await c.get('/api/products?sort=price_asc&limit=5&page=2');
    expect(p2.body.data[0]._id).not.toBe(asc.body.data[0]._id);
  });

  it('product detail exposes availability (not exact stock), warranty, delivery and related products', async () => {
    const r = await c.get('/api/products/demo-power-bank-20000');
    expect(r.status).toBe(200);
    const p = r.body.data;
    expect(p.stock).toBeUndefined();
    expect(p.available).toBe(true);
    expect(p.lowStock).toBe(true);
    expect(p.discountPercent).toBe(13);
    expect(p.warrantyMonths).toBe(24);
    expect(p.delivery.free).toBe(true);
    expect(p.dataSource).toBe('demo');
    expect(p.related.length).toBeGreaterThan(0);
    expect(p.bundles.map((b: { sku: string }) => b.sku)).toEqual([]);
    const pb = await c.get('/api/products/demo-power-bank-10000');
    expect(pb.body.data.bundles.map((b: { sku: string }) => b.sku)).toContain('DEMO-KIT-TRAVEL');
  });

  it('homepage payload includes categories, featured, bundles and best sellers (curated fallback)', async () => {
    const r = await c.get('/api/home');
    expect(r.body.data.categories).toHaveLength(6);
    expect(r.body.data.categoryProducts).toHaveLength(6);
    expect(r.body.data.featured.length).toBeGreaterThan(0);
    expect(r.body.data.bestSellers.source).toBe('curated');
    expect(r.body.data.collections.find((x: { slug: string }) => x.slug === 'bundles').products.length).toBe(2);
  });

  it('public settings never expose secrets and reflect confirmed decisions', async () => {
    const r = await c.get('/api/settings/public');
    const s = JSON.stringify(r.body.data);
    expect(s).not.toMatch(/SECRET|JWT|password/i);
    expect(r.body.data.commerce.freeDelivery).toBe(true);
    expect(r.body.data.commerce.warrantyMonths).toBe(24);
    expect(r.body.data.payments.cod).toBe(false);
    expect(r.body.data.payments.card).toBe(true);
    expect(r.body.data.reviewsEnabled).toBe(false);
  });

  it('serves draft legal pages and a sitemap with both languages', async () => {
    const p = await c.get('/api/pages/privacy');
    expect(p.body.data.status).toBe('draft');
    const sm = await c.get('/sitemap.xml');
    expect(sm.text).toContain('/ar/p/demo-power-bank-10000');
    expect(sm.text).toContain('/en/p/demo-power-bank-10000');
  });

  it('validates input and returns 404s consistently', async () => {
    expect((await c.get('/api/products/does-not-exist')).status).toBe(404);
    expect((await c.get('/api/products?limit=1000')).status).toBe(400);
    expect((await c.get('/api/products/BAD%20SLUG')).status).toBe(400);
    const nf = await c.get('/api/nope');
    expect(nf.body.ok).toBe(false);
  });

  it('newsletter subscription is idempotent', async () => {
    expect((await c.post('/api/newsletter').send({ email: 'n@test.local' })).status).toBe(201);
    expect((await c.post('/api/newsletter').send({ email: 'n@test.local' })).status).toBe(201);
  });
});
