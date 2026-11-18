import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import { storage } from '../src/integrations/storage';
import { HomeVideo, MediaAsset, Role } from '../src/models';
import { __setOEmbedFetchForTests } from '../src/modules/home-videos/home-video.service';
import { client, createStaff, useDatabase } from './helpers';

/**
 * Homepage video showcase: the complete Admin → homepage workflow through the real API, with the
 * YouTube/Vimeo availability check (oEmbed) mocked. Uploads use local storage in a temp folder.
 */
useDatabase();
const shop = client();
let admin: Awaited<ReturnType<typeof createStaff>>;
let editorNoMedia: Awaited<ReturnType<typeof createStaff>>;
const oembedCalls: string[] = [];
const oembed: Record<string, number> = {}; // video id → HTTP status (default 200)

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2mp41'), Buffer.alloc(256)]);
const loc = (en: string, ar = '') => ({ en, ar });
const base = { title: loc('Launch film', 'فيلم الإطلاق'), description: loc('Our new charger', 'الشاحن الجديد'), posterAlt: loc('Charger on a desk'), active: true };

beforeAll(async () => {
  (env as Record<string, unknown>).MEDIA_LOCAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-hv-'));
  __setOEmbedFetchForTests((url) => {
    oembedCalls.push(url);
    const id = Object.keys(oembed).find((k) => decodeURIComponent(url).includes(k));
    const status = id ? oembed[id] : 200;
    return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve({ title: 'Provider title', thumbnail_url: 'https://i.vimeocdn.com/video/1_640.jpg' }) });
  });
  admin = await createStaff('admin');
  await Role.create({ key: 'video_editor_test', name: { ar: 'محرر', en: 'Video editor (test)' }, permissions: ['content:write'], system: false });
  editorNoMedia = await createStaff('video_editor_test');
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => __setOEmbedFetchForTests(null));

const publicVideos = async () => {
  const r = await shop.get('/api/home/videos');
  expect(r.status).toBe(200);
  return r.body.data as { enabled: boolean; title: { en: string }; videos: { id: string; position: number; provider: string; embedUrl: string | null; fileUrl: string | null; posterUrl: string; title: { en: string }; uploadDate: string | null }[] };
};

async function uploadVideo(c = admin) {
  const created = await c.post('/api/admin/media/uploads').send({ kind: 'video', filename: 'launch.mp4', parts: [{ role: 'original', contentType: 'video/mp4', size: MP4.length }] });
  expect(created.status).toBe(201);
  const { assetId, uploads } = created.body.data;
  expect((await c.agent.put(uploads[0].url).set('X-Requested-With', 'celibery').set('Content-Type', 'video/mp4').send(MP4)).status).toBe(200);
  const done = await c.post(`/api/admin/media/${assetId}/complete`).send({});
  expect(done.body.data.status).toBe('ready');
  return done.body.data as { _id: string; url: string; key?: string };
}

describe('homepage videos — admin workflow', () => {
  const ids: Record<string, string> = {};

  it('starts empty: no section rendered, nothing invented', async () => {
    expect((await publicVideos()).videos).toEqual([]);
  });

  it('1–2. YouTube link → appears on the homepage with the official privacy-enhanced embed', async () => {
    const r = await admin.post('/api/admin/home-videos').send({ ...base, sourceType: 'url', url: 'https://youtu.be/dQw4w9WgXcQ', position: 1 });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ provider: 'youtube', externalId: 'dQw4w9WgXcQ', position: 1, availability: { status: 'ok' } });
    expect(r.body.data.posterUrl).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg'); // 16:9 provider thumbnail when none given
    ids.yt = r.body.data._id;
    const pub = await publicVideos();
    expect(pub.videos).toHaveLength(1);
    expect(pub.videos[0]).toMatchObject({ position: 1, provider: 'youtube', title: { en: 'Launch film' }, fileUrl: null });
    expect(pub.videos[0].embedUrl).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?autoplay=1/);
  });

  it('3. Vimeo link', async () => {
    const r = await admin.post('/api/admin/home-videos').send({ ...base, sourceType: 'url', url: 'https://vimeo.com/76979871', position: 2, posterUrl: 'https://cdn.example.com/p.jpg' });
    expect(r.status).toBe(201);
    ids.vimeo = r.body.data._id;
    // Without an admin poster, Vimeo's own thumbnail (from oEmbed) is used.
    const noPoster = await admin.post('/api/admin/home-videos/inspect').send({ url: 'https://vimeo.com/76979872' });
    expect(noPoster.body.data.suggestedPoster).toBe('https://i.vimeocdn.com/video/1_640.jpg');
    expect(r.body.data.posterUrl).toBe('https://cdn.example.com/p.jpg'); // the admin's poster wins
    const v = (await publicVideos()).videos.find((x) => x.id === ids.vimeo)!;
    expect(v.embedUrl).toMatch(/^https:\/\/player\.vimeo\.com\/video\/76979871\?autoplay=1&dnt=1/);
  });

  it('4. Facebook link → Facebook embedded player; admin is told it cannot be checked in advance', async () => {
    const before = oembedCalls.length;
    const r = await admin.post('/api/admin/home-videos').send({ ...base, sourceType: 'url', url: 'https://www.facebook.com/celibery/videos/1234567890123456/', position: 3 });
    expect(r.status).toBe(201);
    expect(r.body.data.availability).toMatchObject({ status: 'unverified' });
    expect(r.body.data.availability.message).toMatch(/Only public videos/);
    expect(oembedCalls.length).toBe(before); // nothing is sent to Facebook
    ids.fb = r.body.data._id;
    const v = (await publicVideos()).videos.find((x) => x.id === ids.fb)!;
    expect(v.embedUrl).toMatch(/^https:\/\/www\.facebook\.com\/plugins\/video\.php\?href=/);
    // Short links are refused with an explanation.
    const s = await admin.post('/api/admin/home-videos').send({ ...base, sourceType: 'url', url: 'https://fb.watch/abcDEF123/' });
    expect(s.status).toBe(400);
    expect(s.body.error.message).toMatch(/cannot be embedded/);
  });

  it('5. direct MP4 link → native video', async () => {
    const r = await admin.post('/api/admin/home-videos').send({ ...base, sourceType: 'url', url: 'https://cdn.example.com/films/launch.mp4', position: 4, display: { fit: 'contain', mutedPreview: true, loop: true, startAt: 0 } });
    expect(r.status).toBe(201);
    ids.file = r.body.data._id;
    const v = (await publicVideos()).videos.find((x) => x.id === ids.file)!;
    expect(v).toMatchObject({ provider: 'file', embedUrl: null, fileUrl: 'https://cdn.example.com/films/launch.mp4' });
    expect((await publicVideos()).videos.map((x) => x.position)).toEqual([1, 2, 3, 4]);
  });

  it('12. invalid, unsupported and unavailable sources are refused', async () => {
    expect((await admin.post('/api/admin/home-videos').send({ ...base, sourceType: 'url', url: 'http://cdn.example.com/x.mp4' })).status).toBe(400);
    expect((await admin.post('/api/admin/home-videos').send({ ...base, sourceType: 'url', url: 'https://example.com/page.html' })).status).toBe(400);
    expect((await admin.post('/api/admin/home-videos').send({ ...base, sourceType: 'url', url: '' })).status).toBe(400);
    expect((await admin.post('/api/admin/home-videos').send({ ...base, title: loc(''), sourceType: 'url', url: 'https://youtu.be/dQw4w9WgXcQ' })).status).toBe(400);
    oembed.AAAAAAAAAAA = 404; // private / deleted
    const priv = await admin.post('/api/admin/home-videos').send({ ...base, sourceType: 'url', url: 'https://youtu.be/AAAAAAAAAAA' });
    expect(priv.status).toBe(422);
    expect(priv.body.error.code).toBe('VIDEO_UNAVAILABLE');
    oembed.BBBBBBBBBBB = 401; // embedding disabled by the owner
    expect((await admin.post('/api/admin/home-videos').send({ ...base, sourceType: 'url', url: 'https://youtu.be/BBBBBBBBBBB' })).body.error.message).toMatch(/disabled embedding/);
    // Preview endpoint explains without saving.
    const insp = await admin.post('/api/admin/home-videos/inspect').send({ url: 'https://youtu.be/AAAAAAAAAAA' });
    expect(insp.body.data).toMatchObject({ ok: true, provider: 'youtube', availability: { status: 'unavailable' } });
    expect(await HomeVideo.countDocuments()).toBe(4);
  });

  it('6. upload a video file (content verified, stored in media storage) and place it', async () => {
    const asset = await uploadVideo();
    const r = await admin.post('/api/admin/home-videos').send({ ...base, title: loc('Uploaded film'), sourceType: 'upload', mediaId: asset._id, position: 2 });
    expect(r.status).toBe(201);
    ids.upload = r.body.data._id;
    ids.asset = asset._id;
    // Placed in slot 2: the Vimeo video that was there moves to the slot the new one left (none) → unplaced.
    expect((await HomeVideo.findById(ids.vimeo).lean())!.position).toBeNull();
    const v = (await publicVideos()).videos.find((x) => x.id === ids.upload)!;
    expect(v).toMatchObject({ provider: 'file', position: 2, fileUrl: asset.url });
    expect(v.uploadDate).toBeTruthy();
    expect(fs.existsSync(path.join(String(env.MEDIA_LOCAL_DIR), asset.url.replace(/^\//, '')))).toBe(true);
    // A renamed non-video file is refused by its content.
    const fake = Buffer.from('this is not an mp4 file at all ........................');
    const c2 = await admin.post('/api/admin/media/uploads').send({ kind: 'video', filename: 'fake.mp4', parts: [{ role: 'original', contentType: 'video/mp4', size: fake.length }] });
    expect((await admin.agent.put(c2.body.data.uploads[0].url).set('X-Requested-With', 'celibery').set('Content-Type', 'video/mp4').send(fake)).status).toBe(422);
    // Oversized / wrong type are refused before upload.
    expect((await admin.post('/api/admin/media/uploads').send({ kind: 'video', filename: 'big.mp4', parts: [{ role: 'original', contentType: 'video/mp4', size: 10_000 * 1024 * 1024 }] })).status).toBe(400);
    expect((await admin.post('/api/admin/media/uploads').send({ kind: 'video', filename: 'clip.mov', parts: [{ role: 'original', contentType: 'video/quicktime', size: 100 }] })).status).toBe(400);
  });

  it('7. edit title and description', async () => {
    const cur = (await HomeVideo.findById(ids.yt).lean())!;
    const r = await admin.put(`/api/admin/home-videos/${ids.yt}`).send({ ...base, sourceType: 'url', url: cur.url, title: loc('Edited title', 'عنوان معدل'), description: loc('Edited description'), position: 1 });
    expect(r.status).toBe(200);
    const v = (await publicVideos()).videos.find((x) => x.id === ids.yt)!;
    expect(v.title.en).toBe('Edited title');
  });

  it('8. reorder all four slots at once', async () => {
    const r = await admin.put('/api/admin/home-videos/slots').send({ slots: [ids.file, ids.fb, ids.upload, ids.yt] });
    expect(r.status).toBe(200);
    expect((await publicVideos()).videos.map((x) => x.id)).toEqual([ids.file, ids.fb, ids.upload, ids.yt]);
    expect((await admin.put('/api/admin/home-videos/slots').send({ slots: [ids.yt, ids.yt, null, null] })).status).toBe(400);
  });

  it('9. disabling hides it from the homepage; fewer than four leaves no placeholder', async () => {
    expect((await admin.patch(`/api/admin/home-videos/${ids.fb}/status`).send({ active: false })).status).toBe(200);
    const pub = await publicVideos();
    expect(pub.videos.map((x) => x.id)).not.toContain(ids.fb);
    expect(pub.videos).toHaveLength(3);
  });

  it('archive frees the slot and hides the video; restore brings it back unplaced', async () => {
    await admin.patch(`/api/admin/home-videos/${ids.fb}/archive`).send({ archived: true });
    expect((await HomeVideo.findById(ids.fb).lean())).toMatchObject({ archived: true, active: false, position: null });
    expect((await admin.put('/api/admin/home-videos/slots').send({ slots: [ids.fb, null, null, null] })).status).toBe(409);
    await admin.patch(`/api/admin/home-videos/${ids.fb}/archive`).send({ archived: false });
    expect((await HomeVideo.findById(ids.fb).lean())).toMatchObject({ archived: false, position: null });
  });

  it('10. deleting an external entry removes only the website record — no request to any platform', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const before = oembedCalls.length;
    const r = await admin.delete(`/api/admin/home-videos/${ids.yt}?deleteFile=1`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ deleted: true, sourceType: 'url', file: 'not_applicable' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(oembedCalls.length).toBe(before);
    expect(await HomeVideo.findById(ids.yt)).toBeNull();
  });

  it('11. deleting an uploaded video: needs media permission, keeps files still in use, then cleans storage', async () => {
    const asset = (await MediaAsset.findById(ids.asset).lean())!;
    const file = path.join(String(env.MEDIA_LOCAL_DIR), asset.url.replace(/^\//, ''));
    // The media library refuses to delete a file a homepage video uses.
    expect((await admin.delete(`/api/admin/media/${ids.asset}`)).status).toBe(409);
    // A second entry using the same file.
    const twin = await admin.post('/api/admin/home-videos').send({ ...base, sourceType: 'upload', mediaId: ids.asset });
    // Editor without media:write cannot delete stored files.
    expect((await editorNoMedia.delete(`/api/admin/home-videos/${ids.upload}?deleteFile=1`)).status).toBe(403);
    // Still referenced by the twin → record removed, file kept.
    const first = await admin.delete(`/api/admin/home-videos/${ids.upload}?deleteFile=1`);
    expect(first.body.data).toMatchObject({ deleted: true, sourceType: 'upload', file: 'in_use' });
    expect(fs.existsSync(file)).toBe(true);
    // Last reference, storage delete fails → file and library entry kept for a retry.
    const del = vi.spyOn(storage()!, 'delete').mockRejectedValueOnce(new Error('bucket unavailable'));
    const failed = await admin.delete(`/api/admin/home-videos/${twin.body.data._id}?deleteFile=1`);
    expect(failed.body.data.file).toBe('failed');
    expect(await MediaAsset.findById(ids.asset)).not.toBeNull();
    del.mockRestore();
    // Re-use it once more, then delete for real.
    const third = await admin.post('/api/admin/home-videos').send({ ...base, sourceType: 'upload', mediaId: ids.asset });
    const ok = await admin.delete(`/api/admin/home-videos/${third.body.data._id}?deleteFile=1`);
    expect(ok.body.data.file).toBe('deleted');
    expect(fs.existsSync(file)).toBe(false);
    expect(await MediaAsset.findById(ids.asset)).toBeNull();
  });

  it('deleting an uploaded entry without deleteFile keeps the file in the media library', async () => {
    const asset = await uploadVideo();
    const v = await admin.post('/api/admin/home-videos').send({ ...base, sourceType: 'upload', mediaId: asset._id });
    const r = await admin.delete(`/api/admin/home-videos/${v.body.data._id}`);
    expect(r.body.data.file).toBe('kept');
    expect(await MediaAsset.findById(asset._id)).not.toBeNull();
  });

  it('section heading and switch are admin-managed', async () => {
    await admin.put('/api/admin/home-videos/section').send({ enabled: true, eyebrow: loc('Watch'), title: loc('CELIBERY in motion', 'سيليبري بالحركة'), subtitle: loc('') });
    expect((await publicVideos()).title.en).toBe('CELIBERY in motion');
    await admin.put('/api/admin/home-videos/section').send({ enabled: false, eyebrow: loc(''), title: loc(''), subtitle: loc('') });
    const off = await publicVideos();
    expect(off).toMatchObject({ enabled: false, videos: [] });
    await admin.put('/api/admin/home-videos/section').send({ enabled: true, eyebrow: loc(''), title: loc('Videos'), subtitle: loc('') });
  });

  it('only staff with content permission can manage; the public payload exposes no internals', async () => {
    expect((await shop.get('/api/admin/home-videos')).status).toBe(401);
    const orders = await createStaff('order_manager');
    expect((await orders.get('/api/admin/home-videos')).status).toBe(403);
    expect((await orders.post('/api/admin/home-videos').send({ ...base, sourceType: 'url', url: 'https://youtu.be/dQw4w9WgXcQ' })).status).toBe(403);
    const pub = await shop.get('/api/home/videos');
    const json = JSON.stringify(pub.body);
    for (const k of ['createdBy', 'updatedBy', 'availability', 'storage', '"key"', 'media"']) expect(json).not.toContain(k);
  });

  it('the existing homepage payload is unchanged', async () => {
    const home = await shop.get('/api/home');
    expect(home.status).toBe(200);
    expect(home.body.data).not.toHaveProperty('videos');
    expect(home.body.data.hero).toBeTruthy();
  });
});
