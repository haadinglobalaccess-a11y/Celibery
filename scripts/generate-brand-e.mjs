/**
 * Extracts the two lightning-cut E letters from the client's official logo, for the
 * "The CELIBERY story" watermark (HomeSections.tsx → BrandStory).
 *
 *   node scripts/generate-brand-e.mjs
 *
 * Source: docs/brand/celibery-logo-cropped.png. In the wordmark each E is three separate shapes —
 * the bolt fused with the middle bar, the top bar and the bottom bar. Exactly those shapes are kept
 * (connected-component selection, so the neighbouring C / B / R are excluded even where their boxes
 * overlap the bolt), as white-on-transparent PNGs used as a CSS mask: the page paints them in the
 * brand accent. Nothing is redrawn.
 *
 * It also prints where the letters' cap height sits inside each image, which the CSS uses to put the
 * E's on the same baseline and cap line as the surrounding watermark letters.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(root, 'docs/brand/celibery-logo-cropped.png');
const OUT = path.join(root, 'client/public/brand');

// Shape bounding boxes measured on the source (x0, y0, x1, y1): the parts of each E.
const LETTERS = {
  'story-e1.png': [
    [292, 4, 543, 460], // bolt + middle bar
    [356, 75, 575, 141], // top bar
    [417, 299, 574, 359], // bottom bar
  ],
  'story-e2.png': [
    [1205, 38, 1449, 445],
    [1253, 73, 1477, 135],
    [1340, 299, 1477, 358],
  ],
};

const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
try {
  const page = await browser.newPage();
  const src = `data:image/png;base64,${fs.readFileSync(SOURCE).toString('base64')}`;
  const result = await page.evaluate(
    async ({ src, LETTERS }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const W = img.naturalWidth, H = img.naturalHeight;
      const c = new OffscreenCanvas(W, H);
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, W, H).data;
      const ink = (i) => d[i * 4 + 3] > 8;
      // Label connected ink (8-neighbour, alpha > 8) once.
      const lab = new Int32Array(W * H);
      let n = 0;
      const boxes = [];
      for (let s = 0; s < W * H; s++) {
        if (!ink(s) || lab[s]) continue;
        n++;
        let x0 = W, y0 = H, x1 = 0, y1 = 0, area = 0;
        const st = [s];
        lab[s] = n;
        while (st.length) {
          const q = st.pop();
          const qx = q % W, qy = (q / W) | 0;
          area++;
          if (qx < x0) x0 = qx;
          if (qx > x1) x1 = qx;
          if (qy < y0) y0 = qy;
          if (qy > y1) y1 = qy;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const nx = qx + dx, ny = qy + dy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              const nb = ny * W + nx;
              if (ink(nb) && !lab[nb]) {
                lab[nb] = n;
                st.push(nb);
              }
            }
        }
        boxes[n] = { x0, y0, x1, y1, area };
      }
      const out = {};
      for (const [file, parts] of Object.entries(LETTERS)) {
        // Components whose box matches each listed part (±6px), largest first.
        const ids = parts.map(([a, b, cc, dd]) => {
          let best = 0;
          boxes.forEach((bx, id) => {
            if (bx && Math.abs(bx.x0 - a) <= 6 && Math.abs(bx.y0 - b) <= 6 && Math.abs(bx.x1 - cc) <= 6 && Math.abs(bx.y1 - dd) <= 6 && (!best || bx.area > boxes[best].area)) best = id;
          });
          if (!best) throw new Error(`${file}: no shape at ${parts}`);
          return best;
        });
        const keep = new Set(ids);
        let X0 = W, Y0 = H, X1 = 0, Y1 = 0;
        for (const id of ids) {
          const b = boxes[id];
          X0 = Math.min(X0, b.x0); Y0 = Math.min(Y0, b.y0); X1 = Math.max(X1, b.x1); Y1 = Math.max(Y1, b.y1);
        }
        const w = X1 - X0 + 1, h = Y1 - Y0 + 1;
        const o = new OffscreenCanvas(w, h);
        const ox = o.getContext('2d');
        const od = ox.createImageData(w, h);
        // Keep the anti-aliased edge: a pixel belongs to the letter if it, or a labelled neighbour, is ours.
        for (let yy = 0; yy < h; yy++)
          for (let xx = 0; xx < w; xx++) {
            const sx = X0 + xx, sy = Y0 + yy, si = sy * W + sx;
            let mine = keep.has(lab[si]);
            if (!mine && d[si * 4 + 3] > 0)
              for (let dy = -1; dy <= 1 && !mine; dy++) for (let dx = -1; dx <= 1 && !mine; dx++) { const ni = (sy + dy) * W + (sx + dx); mine = keep.has(lab[ni]); }
            if (!mine) continue;
            const oi = (yy * w + xx) * 4;
            od.data[oi] = od.data[oi + 1] = od.data[oi + 2] = 255;
            od.data[oi + 3] = d[si * 4 + 3];
          }
        ox.putImageData(od, 0, 0);
        const blob = await o.convertToBlob({ type: 'image/png' });
        const buf = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
        // Cap height = the top/bottom bars' extent (the bolt overshoots it).
        const capTop = Math.min(boxes[ids[1]].y0, boxes[ids[2]].y0, boxes[ids[1]].y0) - Y0;
        const capBottom = Math.max(boxes[ids[1]].y1, boxes[ids[2]].y1) - Y0;
        out[file] = { b64: btoa(bin), w, h, capTop, capBottom, barLeft: Math.min(boxes[ids[1]].x0, boxes[ids[2]].x0) - X0 };
      }
      return out;
    },
    { src, LETTERS },
  );
  for (const [file, r] of Object.entries(result)) {
    fs.writeFileSync(path.join(OUT, file), Buffer.from(r.b64, 'base64'));
    console.log(`${file}  ${r.w}×${r.h}  cap ${r.capTop}–${r.capBottom} (cap height ${r.capBottom - r.capTop}, below baseline ${r.h - 1 - r.capBottom}), bars start x=${r.barLeft}`);
  }
} finally {
  await browser.close();
}
