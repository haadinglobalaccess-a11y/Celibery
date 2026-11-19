/**
 * Builds the CELIBERY favicon / app-icon set from the client's official logo file.
 *
 *   node scripts/generate-favicons.mjs
 *
 * Source: docs/brand/celibery-logo-cropped.png (the client PNG, cropped to its content).
 * The wordmark is 4.5:1 — far too wide for a square icon — so the icon uses its opening
 * "C⚡E" cluster: the C, the lightning bolt and the E it cuts through. Those pixels are copied
 * unchanged (no redraw, no recolour); the cluster ends at x≈575 and the next letter (L) starts
 * at x≈602, so a straight crop takes nothing else. It is placed on a Midnight Black (#111111)
 * tile, matching the site's theme-color, so the turquoise reads in light and dark browser tabs.
 *
 * Rendering uses the Chromium canvas through the Playwright install the e2e suite already has,
 * so no image library is added to the project.
 *
 * Outputs (client/public):
 *   favicon.ico                    16, 32, 48 px (PNG-compressed ICO) — legacy / default request
 *   brand/icons/favicon-32.png     <link rel="icon" sizes="32x32">
 *   brand/icons/icon-192.png       web manifest, rounded tile
 *   brand/icons/icon-512.png       web manifest, rounded tile
 *   brand/icons/icon-maskable-512.png  web manifest, full-bleed (Android adaptive mask safe zone)
 *   brand/icons/apple-touch-icon.png   180 px, full-bleed (iOS applies its own rounding)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(root, 'docs/brand/celibery-logo-cropped.png');
const PUBLIC = path.join(root, 'client/public');
const ICONS = path.join(PUBLIC, 'brand/icons');

// Crop of the source that holds the C⚡E cluster (measured: ink spans x 4–575, y 4–460 of 2088×465).
const CROP = { x: 0, y: 0, w: 590, h: 465 };
const TILE = '#111111';

// pad = share of the edge left empty on each side; radius = corner radius as a share of the edge.
const OUTPUTS = [
  { name: 'ico-16', size: 16, pad: 0.06, radius: 0.18 },
  { name: 'ico-32', size: 32, pad: 0.09, radius: 0.2 },
  { name: 'ico-48', size: 48, pad: 0.1, radius: 0.2 },
  { name: 'favicon-32.png', size: 32, pad: 0.09, radius: 0.2 },
  { name: 'icon-192.png', size: 192, pad: 0.16, radius: 0.22 },
  { name: 'icon-512.png', size: 512, pad: 0.16, radius: 0.22 },
  { name: 'icon-maskable-512.png', size: 512, pad: 0.24, radius: 0 },
  { name: 'apple-touch-icon.png', size: 180, pad: 0.17, radius: 0 },
];

/** ICO container holding PNG-encoded images (supported by every current browser and Windows Vista+). */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

// Same browser choice as e2e/playwright.config.ts (Edge on Windows, bundled Chromium elsewhere).
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
try {
  const page = await browser.newPage();
  const src = `data:image/png;base64,${fs.readFileSync(SOURCE).toString('base64')}`;
  const rendered = await page.evaluate(
    async ({ src, CROP, TILE, OUTPUTS }) => {
      const img = new Image();
      img.src = src;
      await img.decode();

      // Trim the crop to its opaque pixels so every icon is centred on the ink, not the crop box.
      const c0 = new OffscreenCanvas(CROP.w, CROP.h);
      const x0 = c0.getContext('2d');
      x0.drawImage(img, CROP.x, CROP.y, CROP.w, CROP.h, 0, 0, CROP.w, CROP.h);
      const px = x0.getImageData(0, 0, CROP.w, CROP.h).data;
      let minX = CROP.w, minY = CROP.h, maxX = 0, maxY = 0;
      for (let y = 0; y < CROP.h; y++)
        for (let x = 0; x < CROP.w; x++)
          if (px[(y * CROP.w + x) * 4 + 3] > 8) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
      const mw = maxX - minX + 1, mh = maxY - minY + 1;
      const mark = new OffscreenCanvas(mw, mh);
      mark.getContext('2d').drawImage(c0, minX, minY, mw, mh, 0, 0, mw, mh);

      // Progressive halving keeps thin strokes (the bolt) clean at 16–48 px.
      const scaled = (w, h) => {
        let cur = mark, cw = mw, ch = mh;
        while (cw / 2 >= w && ch / 2 >= h) {
          const n = new OffscreenCanvas(Math.round(cw / 2), Math.round(ch / 2));
          const nx = n.getContext('2d');
          nx.imageSmoothingQuality = 'high';
          nx.drawImage(cur, 0, 0, n.width, n.height);
          cur = n; cw = n.width; ch = n.height;
        }
        return cur;
      };

      const out = [];
      for (const o of OUTPUTS) {
        const S = o.size;
        const c = new OffscreenCanvas(S, S);
        const x = c.getContext('2d');
        x.fillStyle = TILE;
        x.beginPath();
        x.roundRect(0, 0, S, S, o.radius * S);
        x.fill();
        const box = S * (1 - 2 * o.pad);
        const k = Math.min(box / mw, box / mh);
        const w = mw * k, h = mh * k;
        x.imageSmoothingQuality = 'high';
        x.drawImage(scaled(w, h), (S - w) / 2, (S - h) / 2, w, h);
        const blob = await c.convertToBlob({ type: 'image/png' });
        const buf = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
        out.push({ name: o.name, size: S, b64: btoa(bin) });
      }
      return { out, mark: { w: mw, h: mh, minX, minY } };
    },
    { src, CROP, TILE, OUTPUTS },
  );

  fs.mkdirSync(ICONS, { recursive: true });
  const ico = [];
  for (const r of rendered.out) {
    const data = Buffer.from(r.b64, 'base64');
    if (r.name.startsWith('ico-')) ico.push({ size: r.size, data });
    else fs.writeFileSync(path.join(ICONS, r.name), data);
  }
  fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), buildIco(ico));
  console.log(`mark ${rendered.mark.w}×${rendered.mark.h} from source (x ${rendered.mark.minX}, y ${rendered.mark.minY})`);
  for (const f of ['favicon.ico', ...fs.readdirSync(ICONS).map((n) => `brand/icons/${n}`)]) {
    console.log(`${f.padEnd(36)} ${fs.statSync(path.join(PUBLIC, f)).size} bytes`);
  }
} finally {
  await browser.close();
}
