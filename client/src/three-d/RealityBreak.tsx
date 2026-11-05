import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18n';
import { L } from '../lib/format';
import { useMediaQuery } from '../lib/media';
import type { ProductCardData } from '../lib/types';
import { ProductImage } from '../components/ProductCard';
import { Price } from '../components/ui';
import './realityBreak.css';

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const noise = (i: number) => { const n = Math.sin(i * 127.1 + 42.7) * 43758.5453; return n - Math.floor(n); };

/** An irregular triangulated pane. Each triangle keeps its original place until impact. */
function makeGlass(cols: number, rows: number) {
  const vertices = Array.from({ length: (cols + 1) * (rows + 1) }, (_, i) => {
    const x = i % (cols + 1), y = Math.floor(i / (cols + 1));
    return [100 * x / cols + (x && x < cols ? (noise(i) - .5) * 9 : 0), 100 * y / rows + (y && y < rows ? (noise(i + 90) - .5) * 11 : 0)];
  });
  return Array.from({ length: cols * rows * 2 }, (_, i) => {
    const cell = Math.floor(i / 2), x = cell % cols, y = Math.floor(cell / cols);
    const a = vertices[y * (cols + 1) + x], b = vertices[y * (cols + 1) + x + 1];
    const c = vertices[(y + 1) * (cols + 1) + x], d = vertices[(y + 1) * (cols + 1) + x + 1];
    const points = i % 2 ? [b, d, c] : [a, b, c];
    return { points: points.map(p => p.join(',')).join(' '), x: points.reduce((s, p) => s + p[0], 0) / 3, y: points.reduce((s, p) => s + p[1], 0) / 3, seed: noise(i + 200) };
  });
}

/** Real catalogue photography on a dimensional plane; no invented product geometry. */
export function RealityBreak({ product }: { product: ProductCardData }) {
  const { lang, p } = useI18n();
  const id = useId();
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const mobile = useMediaQuery('(max-width: 639px)');
  const glass = useMemo(() => makeGlass(mobile ? 4 : 6, mobile ? 3 : 5), [mobile]);
  const scene = useRef<HTMLDivElement>(null);
  const camera = useRef<HTMLDivElement>(null);
  const photo = useRef<HTMLDivElement>(null);
  const pieces = useRef<(HTMLDivElement | null)[]>([]);
  const [ready, setReady] = useState(false);
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    const image = photo.current?.querySelector('img');
    if (image?.complete && image.naturalWidth) setReady(true);
  }, [product._id]);

  useEffect(() => {
    const host = scene.current, rig = camera.current, tile = photo.current;
    if (!host || !rig || !tile) return;
    let frame = 0, elapsed = 0, last = 0, rendered = 0, inView = false;
    const duration = 9;
    const draw = (t: number) => {
      const impact = t >= 2.4;
      const burst = t < 3.15 ? smooth((t - 2.4) / .75) * .46
        : t < 6 ? .46 + (t - 3.15) / 2.85 * .075 : .535 + smooth((t - 6) / 3) * .465;
      const emerge = smooth((t - 2.4) / 3.8);
      const z = t < 2.4 ? -210 * (1 - smooth(t / 2.4)) : 145 * emerge - 35 * smooth((t - 7) / 2);
      const orbit = Math.sin(clamp(t / duration) * Math.PI);
      rig.style.transform = `rotateX(${-2 * orbit}deg) rotateY(${(mobile ? 2 : 4) * orbit}deg)`;
      tile.style.transform = `translate3d(-50%, -50%, ${z}px) rotateY(${-5 * orbit}deg)`;
      host.style.setProperty('--rb-impact', String(impact ? 1 - smooth((t - 2.4) / .6) : 0));
      host.style.setProperty('--rb-shadow', String(.12 + emerge * .14));
      host.dataset.phase = reduced ? 'static' : t < 2.4 ? 'approach' : t < 3.15 ? 'break' : t < 6 ? 'slow-motion' : t < 9 ? 'drift' : 'showcase';
      const fade = impact ? 1 - smooth((t - 6.3) / 2.4) : 0;
      glass.forEach((piece, i) => {
        const node = pieces.current[i];
        if (!node) return;
        const dx = (piece.x - 50) * (mobile ? 3.2 : 5.8) * burst;
        const dy = (piece.y - 50) * (mobile ? 2.9 : 4.8) * burst + 80 * burst * burst;
        const dz = (90 + piece.seed * 230) * burst;
        node.style.opacity = String(fade * (.35 + piece.seed * .45));
        node.style.transform = `translate3d(calc(-50% + ${dx}px),calc(-50% + ${dy}px),${dz}px) rotateX(${(piece.seed - .5) * 150 * burst}deg) rotateY(${(noise(i + 500) - .5) * 170 * burst}deg) rotateZ(${(piece.seed - .5) * 65 * burst}deg)`;
      });
    };
    draw(reduced ? duration : 0);
    const tick = (now: number) => {
      frame = 0;
      if (!last) last = now;
      elapsed = Math.min(duration, elapsed + Math.min((now - last) / 1000, .1));
      last = now;
      if (now - rendered >= (mobile ? 1000 / 30 : 1000 / 60) || elapsed === duration) { draw(elapsed); rendered = now; }
      if (elapsed < duration) frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame); frame = 0; last = 0;
      if (ready && inView && !document.hidden && !reduced && elapsed < duration) frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); }, { threshold: .25 });
    observer.observe(host);
    document.addEventListener('visibilitychange', sync);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('visibilitychange', sync); };
  }, [ready, replay, reduced, mobile, glass]);

  return <section className="section reality-break" aria-labelledby={id}>
    <div className="container">
      <div className="section__head"><div><span className="eyebrow eyebrow--line">REALITY BREAK</span><h2 id={id}>{lang === 'ar' ? 'ما وراء المألوف' : 'Beyond the ordinary.'}</h2><p className="muted section__lead">{lang === 'ar' ? 'لحظة تتجاوز الحدود.' : 'A moment beyond the surface.'}</p></div></div>
      <div className="reality-break__layout">
        <div ref={scene} className="reality-break__scene" data-phase="approach" aria-label={lang === 'ar' ? 'عرض سينمائي للمنتج' : 'Cinematic product showcase'}>
          <div className="reality-break__floor" aria-hidden="true" />
          <div ref={camera} className="reality-break__camera">
            <div className="reality-break__screen" aria-hidden="true"><span /><span /><span /></div>
            <div ref={photo} className="reality-break__product" onLoadCapture={() => setReady(true)}>
              <ProductImage eager src={product.images[0]?.url} image={product.images[0]} alt={L(product.name, lang)} sizes="(max-width: 639px) 70vw, 400px" />
              <span className="reality-break__reflection" aria-hidden="true" />
            </div>
            <div className="reality-break__glass" aria-hidden="true">
              {glass.map((piece, i) => <div key={i} ref={el => { pieces.current[i] = el; }} className="reality-break__shard" style={{ transformOrigin: `${piece.x}% ${piece.y}%` }}>
                <svg viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points={piece.points} fill={`rgba(226,235,247,${.035 + piece.seed * .1})`} stroke="rgba(255,255,255,.8)" strokeWidth=".18" /><polygon points={piece.points} fill="none" stroke="rgba(100,116,139,.5)" strokeWidth=".08" /></svg>
              </div>)}
            </div>
          </div>
          {!ready ? <span className="reality-break__loading">{lang === 'ar' ? 'جارٍ تحميل المنتج' : 'Loading product'}</span> : null}
          {!reduced ? <button type="button" className="reality-break__replay btn btn--outline btn--sm" onClick={() => setReplay(value => value + 1)} disabled={!ready}>{lang === 'ar' ? 'إعادة العرض' : 'Replay moment'} <span aria-hidden="true">↻</span></button> : null}
        </div>
        <div className="reality-break__copy"><span className="eyebrow">CELIBERY</span><h3>{L(product.name, lang)}</h3>{L(product.shortDescription, lang) ? <p className="muted">{L(product.shortDescription, lang)}</p> : null}<Price price={product.price} compareAt={product.compareAtPrice} /><Link className="btn btn--primary" to={p(`/p/${product.slug}`)}>{lang === 'ar' ? 'عرض المنتج' : 'View Product'} <span aria-hidden="true">{lang === 'ar' ? '←' : '→'}</span></Link></div>
      </div>
    </div>
  </section>;
}
