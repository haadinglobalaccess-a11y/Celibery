import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProductImage } from '../components/ProductCard';
import { Price } from '../components/ui';
import { useI18n } from '../i18n/I18n';
import { L } from '../lib/format';
import { useMediaQuery } from '../lib/media';
import type { ProductCardData } from '../lib/types';
import './orbitalShowcase.css';

type Pose = { x: number; y: number; z: number; scale: number; angle: number };

/** CSS perspective + one bounded transform loop; no WebGL, new assets or business actions. */
export default function OrbitalShowcase({ products, loading }: { products: ProductCardData[]; loading: boolean }) {
  const { lang, p } = useI18n();
  const navigate = useNavigate();
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const poses = useRef(new Map<string, Pose>());
  const elapsed = useRef(0);
  const redraw = useRef<() => void>(() => {});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = products.find(product => product._id === selectedId) ?? products[0];
  const selection = useRef<string | null>(null);
  selection.current = selected?._id ?? null;
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const lite = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || Boolean(nav.connection?.saveData);
  const ids = products.map(product => product._id).join('|');

  useEffect(() => {
    const element = root.current;
    const chamber = stage.current;
    if (!element || !chamber) return;
    let frame = 0;
    let inView = true;
    let width = chamber.clientWidth;
    const slot = element.parentElement;
    let orbitSize = 88;
    let radiusX = 0;
    let radiusY = 0;
    let centerDepth = 150;
    let centerScale = 207 / 88;
    const measure = () => {
      width = chamber.clientWidth;
      const phone = width < 600;
      orbitSize = phone ? (width < 320 ? 24 : 32) : window.matchMedia('(max-width: 959px)').matches ? 72 : 88;
      centerDepth = phone ? 95 : 150;
      centerScale = (phone ? 128 : 207) / orbitSize;
      // Preserve the existing center's projected size, including CSS perspective.
      const centerSize = orbitSize * centerScale * 950 / (950 - centerDepth);
      const gap = phone ? 12 : 20;
      const edge = phone ? 12 : 24;
      const clearance = centerSize / 2 + orbitSize / 2 + gap;
      radiusX = Math.max(clearance + 1, width / 2 - orbitSize / 2 - edge);
      // An ellipse stays outside the expanded center rectangle when
      // (clearance / rx)^2 + (clearance / ry)^2 < 1, including its corners.
      radiusY = Math.max(clearance / Math.sqrt(1 - (clearance / radiusX) ** 2) * 1.04,
        orbitSize * Math.SQRT2 / (2 * Math.sin(Math.PI / Math.max(2, productIds.length - 1))) + gap);
      element.style.setProperty('--cel-orbit-size', `${orbitSize}px`);
      element.style.setProperty('--cel-radius-x', `${radiusX}px`);
      element.style.setProperty('--cel-radius-y', `${radiusY}px`);
      element.style.setProperty('--cel-center-half', `${centerSize / 2}px`);
      slot?.style.setProperty('--cel-chamber-height', `${Math.ceil(2 * (radiusY + orbitSize / 2 + edge) + 92)}px`);
    };
    let last = performance.now();
    let lastPaint = 0;
    let disposed = false;
    const productIds = ids ? ids.split('|') : [];
    const validIds = new Set(productIds);
    let arrangedFor: string | null | undefined;
    let ranks = new Map<string, number>();
    for (const id of poses.current.keys()) if (!validIds.has(id)) poses.current.delete(id);
    const paint = (dt: number, snap = false) => {
      if (arrangedFor !== selection.current) {
        arrangedFor = selection.current;
        ranks = new Map(productIds.filter(id => id !== arrangedFor).map((id, index) => [id, index]));
      }
      const count = Math.max(1, ranks.size);
      const blend = snap || reduced ? 1 : 1 - Math.exp(-dt / 180);
      productIds.forEach(id => {
        const index = ranks.get(id) ?? 0;
        const button = nodes.current.get(id);
        if (!button) return;
        const angle = index / count * Math.PI * 2 + elapsed.current * .00016;
        const center = selection.current === id;
        const target: Pose = center
          ? { x: 0, y: 0, z: centerDepth, scale: centerScale, angle }
          : { x: Math.cos(angle) * radiusX, y: Math.sin(angle) * radiusY, z: 0, scale: 1, angle };
        const previous = poses.current.get(id) ?? target;
        // Reflow along the perimeter, never take a straight chord through the center.
        const delta = Math.atan2(Math.sin(angle - previous.angle), Math.cos(angle - previous.angle));
        const nextAngle = previous.angle + delta * blend;
        const pose: Pose = center
          ? { x: previous.x + (target.x - previous.x) * blend, y: previous.y + (target.y - previous.y) * blend,
              z: previous.z + (target.z - previous.z) * blend, scale: previous.scale + (target.scale - previous.scale) * blend, angle }
          : { x: Math.cos(nextAngle) * radiusX, y: Math.sin(nextAngle) * radiusY, z: 0, scale: 1, angle: nextAngle };
        poses.current.set(id, pose);
        button.style.transform = `translate3d(${pose.x.toFixed(2)}px,${pose.y.toFixed(2)}px,${pose.z.toFixed(2)}px) scale(${pose.scale.toFixed(3)})`;
        button.style.zIndex = String(center ? 100 : 20);
        button.style.setProperty('--cel-depth', center ? '1.12' : '1');
      });
    };
    measure();
    redraw.current = () => paint(0, true);
    const tick = (now: number) => {
      if (disposed || document.hidden || !inView || reduced) return;
      const interval = lite || width < 600 ? 1000 / 24 : 1000 / 60;
      if (now - lastPaint >= interval) {
        const dt = Math.min(80, now - last);
        elapsed.current += dt; last = now; lastPaint = now;
        paint(dt);
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      const running = !document.hidden && inView && !reduced;
      element.dataset.running = String(running);
      last = performance.now(); lastPaint = 0;
      paint(0, reduced);
      if (running) frame = requestAnimationFrame(tick);
    };
    const resize = new ResizeObserver(() => { measure(); paint(0, true); });
    resize.observe(chamber);
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); });
    observer.observe(element);
    document.addEventListener('visibilitychange', sync);
    sync();
    element.dataset.ready = 'true';
    return () => { disposed = true; redraw.current = () => {}; cancelAnimationFrame(frame); resize.disconnect(); slot?.style.removeProperty('--cel-chamber-height'); observer.disconnect(); document.removeEventListener('visibilitychange', sync); };
  }, [ids, reduced, lite]);

  // Reduced motion still allows immediate, keyboard-accessible selection without a running loop.
  useEffect(() => {
    if (!reduced) return;
    redraw.current();
  }, [selectedId, reduced]);

  return <section ref={root} className="cel-orbit" style={{ '--cel-mobile-size': products.length > 16 ? '44px' : products.length > 8 ? '52px' : '64px' } as CSSProperties} data-lite={lite} data-selected={Boolean(selected)} data-loading={loading} aria-label={lang === 'ar' ? '\u0639\u0631\u0636 \u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a' : 'Orbital product showcase'}>
    <div ref={stage} className="cel-orbit__stage">
      <div className="cel-orbit__field" aria-hidden="true" />
      <div className="cel-orbit__rings" aria-hidden="true"><i /><i /><i /></div>
      <div className="cel-orbit__platform" aria-hidden="true"><i /><i /></div>
      <div className="cel-orbit__beam" aria-hidden="true" />
      <div className="cel-orbit__scan" aria-hidden="true" />
      <div className="cel-orbit__particles" aria-hidden="true">{[0, 1, 2, 3, 4, 5, 6, 7].map(i => <i key={i} style={{ '--cel-p': i } as CSSProperties} />)}</div>
      {products.map((product, index) => {
        const name = L(product.name, lang);
        const category = typeof product.category === 'object' ? product.category?.slug : undefined;
        return <button key={product._id} ref={node => { if (node) nodes.current.set(product._id, node); else nodes.current.delete(product._id); }} type="button" className="cel-orbit__product" data-selected={selected?._id === product._id} aria-label={name} aria-pressed={selected?._id === product._id} disabled={loading} onClick={() => selected?._id === product._id ? navigate(p(`/p/${product.slug}`)) : setSelectedId(product._id)} style={{ '--cel-i': index } as CSSProperties}>
          <span className="cel-orbit__float"><ProductImage src={product.images?.[0]?.url} image={product.images?.[0]} alt={name} category={category} sizes="(max-width: 599px) 150px, 250px" /><span className="cel-orbit__reflection" /><span className="cel-orbit__sweep" aria-hidden="true" /></span>
        </button>;
      })}
    </div>
    <div className="cel-orbit__information" aria-live="polite" aria-atomic="true">
      {selected ? <div key={selected._id}><strong>{L(selected.name, lang)}</strong><Price price={selected.price} compareAt={selected.compareAtPrice} /></div> : <p>{lang === 'ar' ? '\u0627\u062e\u062a\u0631 \u0645\u0646\u062a\u062c\u0627\u064b \u0644\u0639\u0631\u0636\u0647 \u0641\u064a \u0627\u0644\u0645\u0631\u0643\u0632' : 'Select a product to project it into the center'}</p>}
    </div>
  </section>;
}
