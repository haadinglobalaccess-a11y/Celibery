/* Run against the isolated e2e server only: node e2e/hero-slider.check.cjs.
 * Generates local test media; never writes campaign fixtures to the application's frontend.
 */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.HERO_TEST_BASE_URL || 'http://localhost:4174';
const credentialsPath = process.env.HERO_TEST_CREDENTIALS || 'e2e/.artifacts/admin.json';
const headers = { 'X-Requested-With': 'celibery' };
const english = value => ({ en: value, ar: value });
const log = message => console.log('PASS: ' + message);

(async () => {
  const browser = await chromium.launch({ channel: process.env.HERO_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  const admin = await context.newPage();
  const created = []; const existing = []; let originalHome;
  const json = async response => { assert.ok(response.ok(), `${response.status()} ${await response.text()}`); return (await response.json()).data; };
  const api = async (method, path, data) => json(await context.request.fetch(base + path, { method, headers, data }));
  try {
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    await admin.goto(base + '/admin');
    await admin.getByLabel('Email', { exact: true }).fill(credentials.email);
    await admin.getByLabel('Password', { exact: true }).fill(credentials.password);
    await admin.getByTestId('admin-login').click();
    await admin.getByRole('link', { name: 'Website content', exact: true }).click();
    originalHome = (await api('GET', '/api/admin/settings')).settings.homepage;
    for (const banner of await api('GET', '/api/admin/content/banners')) if (banner.placement === 'hero' && banner.active) {
      existing.push(banner); await api('PATCH', '/api/admin/content/banners/' + banner._id, { active: false });
    }
    await api('PUT', '/api/admin/settings', { homepage: { heroVideoUrl: '', heroMobileVideoUrl: '', heroPosterUrl: '', heroMobilePosterUrl: '' } });
    const fixtures = await admin.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 136;
      const ctx = canvas.getContext('2d'); const stream = canvas.captureStream(15);
      const record = (type, ms) => new Promise(resolve => {
        const recorder = new MediaRecorder(stream, { mimeType: type }); const chunks = [];
        recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        recorder.onstop = async () => resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())));
        recorder.start(); setTimeout(() => recorder.stop(), ms);
      });
      let n = 0;
      const timer = setInterval(() => { ctx.fillStyle = '#14253b'; ctx.fillRect(0, 0, 240, 136); ctx.fillStyle = '#fff'; ctx.fillRect(n++ * 5 % 220, 50, 20, 20); }, 60);
      const [mp4, webm] = await Promise.all([record('video/mp4;codecs=avc1.42001E', 15000), record('video/webm;codecs=vp8', 15000)]);
      clearInterval(timer); stream.getTracks().forEach(track => track.stop());
      return { mp4, webm, png: canvas.toDataURL('image/png').split(',')[1] };
    });
    const upload = async (kind, mime, bytes) => {
      const plan = await api('POST', '/api/admin/media/uploads', { kind, filename: 'hero-fixture.' + mime.split('/')[1], parts: [{ role: 'original', contentType: mime, size: bytes.length }] });
      const target = plan.uploads[0];
      assert.equal(target.direct, false, 'This check requires isolated local storage');
      await json(await context.request.put(base + target.url, { headers: { ...headers, 'Content-Type': mime }, data: bytes }));
      return api('POST', '/api/admin/media/' + plan.assetId + '/complete', {});
    };
    const image = await upload('image', 'image/png', Buffer.from(fixtures.png, 'base64'));
    const mp4 = await upload('video', 'video/mp4', Buffer.from(fixtures.mp4));
    const webm = await upload('video', 'video/webm', Buffer.from(fixtures.webm));
    log('generated PNG, MP4 and WebM uploaded through the existing storage API');

    await admin.getByRole('tab', { name: 'Banners', exact: true }).click();
    await admin.getByRole('button', { name: '+ New banner', exact: true }).click();
    const dialog = admin.getByRole('dialog');
    await dialog.locator('input[lang=en]').first().fill('Image A');
    await dialog.locator('input[lang=ar]').first().fill('Image A');
    await dialog.getByLabel('Image duration (seconds)', { exact: false }).fill('1.5');
    await dialog.getByLabel('Video fallback (seconds)', { exact: false }).fill('3');
    await dialog.getByLabel('Sort order', { exact: true }).fill('10');
    for (const language of ['English', 'Arabic']) await dialog.getByRole('textbox', { name: 'Image \u2014 desktop, ' + language + ' site URL', exact: true }).fill(image.url);
    const saved = admin.waitForResponse(r => r.url().endsWith('/api/admin/content/banners') && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Save banner', exact: true }).click();
    const first = await json(await saved); created.push(first._id);
    assert.equal(first.durationSec, 1.5); assert.equal(first.videoFallbackSec, 3);
    const add = async (name, order, changes = {}) => {
      const banner = await api('POST', '/api/admin/content/banners', { placement: 'hero', title: english(name), subtitle: english(''), description: english(''), imageUrl: english(image.url), mobileImageUrl: english(image.url), sortOrder: order, durationSec: 1, videoFallbackSec: 3, active: true, ...changes });
      created.push(banner._id); return banner;
    };
    // Intentionally save out of order: display order must come from the admin sort field.
    await add('Video long', 30, { videoUrl: mp4.url, durationSec: 1, videoFallbackSec: 4 });
    await add('Image B', 20, { durationSec: 1 });
    await add('Image C', 40, { durationSec: 1 });
    await add('Video short', 50, { videoUrl: webm.url, videoFallbackSec: 2 });
    await add('Video consecutive', 60, { videoUrl: mp4.url });
    await add('Broken video', 70, { videoUrl: '/media/hero-missing.mp4', videoFallbackSec: 2 });
    await add('Missing image', 80, { imageUrl: english('/media/hero-missing.png'), mobileImageUrl: english('') });
    await add('YouTube', 90, { videoUrl: 'https://www.youtube.com/watch?v=M7lc1UVf-VE', videoFallbackSec: 20 });
    await add('After YouTube', 100);
    await add('Vimeo', 110, { videoUrl: 'https://vimeo.com/59777392', videoFallbackSec: 20 });
    await add('Final image', 120, { durationSec: 1.5 });
    const payload = await api('GET', '/api/home');
    assert.deepEqual(payload.hero.banners.map(b => b.title.en), ['Image A', 'Image B', 'Video long', 'Image C', 'Video short', 'Video consecutive', 'Broken video', 'Missing image', 'YouTube', 'After YouTube', 'Vimeo', 'Final image']);
    assert.ok(payload.hero.banners.every(b => b.videoDurationSec === 0));
    log('admin durations and automatic-video zero persist; saved sort order preserved');

    // Deterministic provider contracts. Live provider playback is checked separately.
    await context.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'text/javascript', body: `window.YT={Player:class{constructor(slot,opts){this.opts=opts;this.seconds=0;this.duration=60;this.frame=document.createElement('iframe');slot.replaceWith(this.frame);window.__testYT=this;setTimeout(()=>opts.events.onReady(),0)}mute(){}playVideo(){this.opts.events.onStateChange({data:1})}pauseVideo(){}getCurrentTime(){return this.seconds}getDuration(){return this.duration}destroy(){this.destroyed=true;this.frame.remove()}seekTo(t){this.seconds=t}finish(){this.opts.events.onStateChange({data:0})}}};window.onYouTubeIframeAPIReady?.();` }));
    await context.route('https://player.vimeo.com/api/player.js', route => route.fulfill({ contentType: 'text/javascript', body: `window.Vimeo={Player:class{constructor(frame){this.frame=frame;this.handlers={};window.__testVimeo=this}on(n,fn){this.handlers[n]=fn}off(n){delete this.handlers[n]}ready(){return Promise.resolve()}setLoop(){return Promise.resolve(false)}setMuted(){return Promise.resolve(true)}play(){this.handlers.playing?.();return Promise.resolve()}pause(){return Promise.resolve()}destroy(){this.destroyed=true;this.frame.remove();return Promise.resolve()}emit(n,d){this.handlers[n]?.(d)}}};` }));
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const heading = name => page.waitForFunction(value => document.querySelector('.campaign-copy h1')?.textContent === value, name);
    const progress = () => page.locator('.campaign-hero-slider').evaluate(el => Number(el.style.getPropertyValue('--progress')) || 0);
    const jump = async index => { await page.locator('.campaign-indicators button').nth(index).click(); };
    await page.goto(base + '/en'); await heading('Image A'); await page.waitForTimeout(400);
    const imageProgress = await progress(); assert.ok(imageProgress > 0.1 && imageProgress < 0.7, String(imageProgress));
    assert.equal(await page.getByRole('button', { name: /^(Play|Pause) campaigns$/ }).count(), 0);
    await page.locator('.campaign-copy a').first().focus();
    await heading('Image B'); const imageBStart = Date.now(); await heading('Video long');
    assert.ok(Date.now() - imageBStart <= 1400, 'Configured image duration was not honored');
    log('Image to Image to MP4 automatic transitions; configured durations; no playback controls; copy focus does not stop autoplay');
    const video = page.locator('.campaign-media video'); await page.waitForFunction(() => document.querySelector('.campaign-media video')?.currentTime > 0.2);
    await page.waitForTimeout(8200); await heading('Video long');
    const native = await video.evaluate(v => ({ time: v.currentTime, duration: v.duration }));
    assert.ok(Number.isFinite(native.duration) && native.duration > 14, JSON.stringify(native));
    assert.ok(Math.abs(await progress() - native.time / native.duration) < 0.05);
    assert.equal(await page.locator('.campaign-indicators button[data-completed=true]').count(), 2);
    log('15-second MP4 is not cut off by image/default/fallback timers; progress matches playback');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => document.querySelector('.campaign-media video').paused);
    const hiddenTime = await video.evaluate(v => v.currentTime); await page.waitForTimeout(400);
    assert.ok(Math.abs(hiddenTime - await video.evaluate(v => v.currentTime)) < 0.05);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => !document.querySelector('.campaign-media video').paused);
    log('visibility events pause and resume video and progress');
    await video.evaluate(v => { v.currentTime = v.duration - 0.25; });
    await heading('Image C'); const imageCStart = Date.now(); await heading('Video short');
    assert.ok(Date.now() - imageCStart <= 1400, 'Second configured image duration was not honored');
    await page.waitForFunction(() => document.querySelector('.campaign-media video')?.currentTime > 3);
    await heading('Video short');
    log('durationless WebM keeps playing beyond its 2-second fallback; no total elapsed cutoff');
    await heading('Video consecutive');
    log('actual native ended events: MP4 to Image to WebM to consecutive video');
    const outgoing = await page.locator('.campaign-media video').elementHandle();
    await jump(6); await heading('Broken video'); assert.equal(await outgoing.evaluate(v => v.paused), true);
    await heading('Missing image'); await heading('YouTube');
    log('inactive video paused; broken video and missing image recover without freezing');
    await page.waitForFunction(() => !!window.__testYT && document.querySelector('.campaign-video.is-ready'));
    await page.evaluate(() => window.__testYT.seekTo(30));
    await page.waitForTimeout(100); assert.ok(Math.abs(await progress() - 0.5) < 0.02);
    await page.evaluate(() => window.__testYT.finish()); await heading('After YouTube');
    assert.equal(await page.evaluate(() => window.__testYT.destroyed), true);
    log('YouTube SDK progress and completion events advance to image and destroy player');
    await heading('Vimeo'); await page.waitForFunction(() => !!window.__testVimeo);
    await page.evaluate(() => window.__testVimeo.emit('timeupdate', { seconds: 15, duration: 60 }));
    await page.waitForTimeout(100); assert.ok(Math.abs(await progress() - 0.25) < 0.02);
    await page.evaluate(() => window.__testVimeo.emit('ended', {})); await heading('Final image');
    assert.equal(await page.evaluate(() => window.__testVimeo.destroyed), true);
    await heading('Image A');
    assert.equal(await page.locator('.campaign-indicators button[data-completed=true]').count(), 0);
    log('Vimeo SDK progress/end; final image loops to first; completed indicators reset');
    await jump(2); await heading('Video long'); assert.ok(await progress() < 0.15);
    await page.keyboard.press('ArrowRight'); await heading('Image C');
    await page.setViewportSize({ width: 390, height: 844 }); await jump(2); await heading('Video long');
    await page.waitForFunction(() => document.querySelector('.campaign-media video')?.currentTime > 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 400 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y: 400 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await heading('Image C');
    await page.emulateMedia({ reducedMotion: 'reduce' }); await jump(2); await heading('Video long');
    assert.equal(await page.locator('.campaign-media video').count(), 0);
    log('indicator clicks reset progress; keyboard and mobile swipe work; no overflow; reduced-motion poster');
    assert.deepEqual(errors, []); log('no React/runtime exceptions');
  } finally {
    for (const id of created) await api('DELETE', '/api/admin/content/banners/' + id).catch(() => {});
    for (const banner of existing) await api('PATCH', '/api/admin/content/banners/' + banner._id, { active: true }).catch(() => {});
    if (originalHome) await api('PUT', '/api/admin/settings', { homepage: originalHome }).catch(() => {});
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
