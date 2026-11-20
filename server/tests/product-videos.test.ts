import { beforeAll, describe, expect, it } from 'vitest';
import { MediaAsset, Product } from '../src/models';
import { client, createStaff, useDatabase } from './helpers';

/**
 * Product videos in the product-page gallery: saved and ordered from the admin, validated, played
 * through the official player URL (or a file), kept out of listing cards, and protected in the media library.
 */
useDatabase();
const shop = client();
let admin: Awaited<ReturnType<typeof createStaff>>;
const productBy = (sku: string) => Product.findOne({ sku }).lean().then((p) => p!);

beforeAll(async () => {
  admin = await createStaff('administrator');
});

describe('product videos', () => {
  it('are saved in order, published with a player URL and poster, and placed by the admin', async () => {
    const p = await productBy('DEMO-AD-65W');
    const videos = [
      { url: 'https://youtu.be/dQw4w9WgXcQ', title: { en: 'Unboxing', ar: 'فتح العلبة' } },
      { url: 'https://cdn.example.com/demo.mp4', posterUrl: 'https://cdn.example.com/demo.jpg' },
    ];
    expect((await admin.put(`/api/admin/products/${p._id}`).send({ videos, videoPlacement: 'after_photos' })).status).toBe(200);

    const pub = (await shop.get(`/api/products/${p.slug}`)).body.data;
    expect(pub.videoPlacement).toBe('after_photos');
    expect(pub.videos).toHaveLength(2);
    expect(pub.videos[0]).toMatchObject({ provider: 'youtube', poster: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', title: { en: 'Unboxing', ar: 'فتح العلبة' } });
    expect(pub.videos[0].embedUrl).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
    expect(pub.videos[1]).toMatchObject({ provider: 'file', fileUrl: 'https://cdn.example.com/demo.mp4', poster: 'https://cdn.example.com/demo.jpg' });
    expect(pub.videos[1].embedUrl).toBeUndefined();

    // Reorder + default placement
    await admin.put(`/api/admin/products/${p._id}`).send({ videos: [videos[1], videos[0]], videoPlacement: 'after_main' });
    const again = (await shop.get(`/api/products/${p.slug}`)).body.data;
    expect(again.videos.map((v: { provider: string }) => v.provider)).toEqual(['file', 'youtube']);
    expect(again.videoPlacement).toBe('after_main');
    // Photos are untouched.
    expect((await productBy('DEMO-AD-65W')).images).toHaveLength(p.images.length);

    // Listing cards stay light.
    const list = (await shop.get('/api/products?limit=50')).body.data;
    expect(JSON.stringify(list)).not.toContain('youtube-nocookie');
  });

  it('rejects links that cannot be played and caps the number of videos', async () => {
    const p = await productBy('DEMO-PB-10K');
    const bad = await admin.put(`/api/admin/products/${p._id}`).send({ videos: [{ url: 'https://example.com/page.html' }] });
    expect(bad.status).toBe(400);
    const js = await admin.put(`/api/admin/products/${p._id}`).send({ videos: [{ url: 'javascript:alert(1)' }] });
    expect(js.status).toBe(400);
    const many = Array.from({ length: 7 }, (_, i) => ({ url: `https://cdn.example.com/v${i}.mp4` }));
    expect((await admin.put(`/api/admin/products/${p._id}`).send({ videos: many })).status).toBe(400);
    expect((await productBy('DEMO-PB-10K')).videos ?? []).toHaveLength(0);
  });

  it('a video file used by a product cannot be deleted from the media library', async () => {
    const p = await productBy('DEMO-PB-10K');
    const url = 'https://cdn.example.com/in-use.mp4';
    const asset = await MediaAsset.create({ kind: 'video', source: 'upload', status: 'ready', url, storage: 'local', key: '' });
    expect((await admin.put(`/api/admin/products/${p._id}`).send({ videos: [{ url, mediaId: String(asset._id) }] })).status).toBe(200);
    expect((await admin.delete(`/api/admin/media/${asset._id}`)).status).toBe(409);
  });
});
