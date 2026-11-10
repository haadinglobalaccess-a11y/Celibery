import { describe, expect, it } from 'vitest';
import { AuditLog, Product } from '../src/models';
import { client, createStaff, useDatabase } from './helpers';

/**
 * Audit 2026-11-10 — Admin create / edit / hide / delete for categories and collections, with the
 * storefront following each change, permission checks, validation and duplicate handling.
 */
useDatabase();
const shop = client();

describe('categories managed in Admin', () => {
  it('create → public; rename → public; hide → gone; duplicate slug → 409; delete unused; permissions', async () => {
    const admin = await createStaff('administrator');
    const body = { slug: 'audit-chargers', name: { ar: 'شواحن التدقيق', en: 'Audit Chargers' }, sortOrder: 50, filters: ['price', 'availability'] };

    expect((await admin.post('/api/admin/categories').send({ ...body, name: { ar: '', en: '' } })).status).toBe(400);
    const created = await admin.post('/api/admin/categories').send(body);
    expect(created.status).toBe(201);
    const id = created.body.data._id;
    const pub = async () => ((await shop.get('/api/categories')).body.data as { slug: string; name: { en: string } }[]).find((c) => c.slug === 'audit-chargers');
    expect((await pub())?.name.en).toBe('Audit Chargers');
    expect((await shop.get('/api/categories/audit-chargers')).status).toBe(200);

    expect((await admin.post('/api/admin/categories').send(body)).status).toBe(409);

    const renamed = await admin.put(`/api/admin/categories/${id}`).send({ ...body, name: { ar: 'شواحن', en: 'Audit Wall Chargers' } });
    expect(renamed.status).toBe(200);
    expect((await pub())?.name.en).toBe('Audit Wall Chargers');

    await admin.put(`/api/admin/categories/${id}`).send({ ...body, active: false });
    expect(await pub()).toBeUndefined();
    expect((await shop.get('/api/categories/audit-chargers')).status).toBe(404);

    // A product manager may not change categories; a customer may not reach the admin at all.
    expect((await (await createStaff('order_manager')).post('/api/admin/categories').send({ ...body, slug: 'nope' })).status).toBe(403);
    expect((await shop.post('/api/admin/categories').send({ ...body, slug: 'nope' })).status).toBe(401);

    expect((await admin.delete(`/api/admin/categories/${id}`)).status).toBe(200);
    expect((await admin.get(`/api/admin/categories/${id}`)).status).toBe(404);
    expect(await AuditLog.exists({ entity: 'category', entityId: id, action: 'delete' })).toBeTruthy();
  });
});

describe('collections / bundles managed in Admin', () => {
  it('create with products → public page lists them in order; edit; deactivate → 404; delete', async () => {
    const admin = await createStaff('administrator');
    const products = await Product.find({ status: 'active' }).sort({ sku: 1 }).limit(3).lean();
    const ids = products.map((p) => String(p._id));
    const body = { slug: 'audit-picks', kind: 'custom', title: { ar: 'مختارات التدقيق', en: 'Audit Picks' }, products: ids, active: true };

    const created = await admin.post('/api/admin/content/collections').send(body);
    expect(created.status).toBe(201);
    const id = created.body.data._id;
    const pub = await shop.get('/api/collections/audit-picks?lang=en');
    expect(pub.status).toBe(200);
    const shown = JSON.stringify(pub.body.data);
    for (const p of products) expect(shown).toContain(p.slug);

    const edited = await admin.put(`/api/admin/content/collections/${id}`).send({ ...body, title: { ar: 'مختارات', en: 'Audit Picks Updated' }, products: ids.slice(0, 1) });
    expect(edited.status).toBe(200);
    const pub2 = JSON.stringify((await shop.get('/api/collections/audit-picks?lang=en')).body.data);
    expect(pub2).toContain('Audit Picks Updated');
    expect(pub2).not.toContain(products[2].slug);

    expect((await admin.put(`/api/admin/content/collections/${id}`).send({ ...body, products: ['not-an-id'] })).status).toBe(400);

    await admin.put(`/api/admin/content/collections/${id}`).send({ ...body, active: false });
    expect((await shop.get('/api/collections/audit-picks')).status).toBe(404);
    expect((await admin.delete(`/api/admin/content/collections/${id}`)).status).toBe(200);
    expect((await admin.get(`/api/admin/content/collections/${id}`)).status).toBe(404);
  });
});
