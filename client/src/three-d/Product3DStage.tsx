import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { L } from '../lib/format';
import type { Lang, ProductCardData } from '../lib/types';
import { reducedMotion } from './env';
import { FloatingProduct } from './FloatingProduct';
import { claimIntro, INTRO_DURATION, introState, PARTICLE_FRAGMENT, PARTICLE_VERTEX, RESTING, tileExplode, type IntroPhase } from './heroIntro';
import { accentRgb, makeCamera, projectUv, STAGE, STUDIO_FRAGMENT, type Camera } from './studio';
import { ThreeDScene, type FrameInfo, type UniformSetter } from './ThreeDScene';

/**
 * Hero product stage: the WebGL studio as the full-bleed environment, with real catalogue photos
 * standing on the pedestal as dimensional slabs. Loaded lazily (own chunk) by CinematicHero.
 *
 * The stage fits itself to a layout "spacer" element in the hero grid, so the pedestal lands in the
 * right column on desktop (left in Arabic/RTL) and below the copy on phones — no hard-coded offsets.
 *
 * On the first homepage view of a page load it plays the "The future is here" opening sequence
 * (heroIntro.ts) before settling into the resting composition. `onIntroDone` fires at the end — or
 * immediately when the sequence is skipped (already played, or reduced motion).
 */
export default function Product3DStage({
  products,
  active,
  level,
  lang,
  heroRef,
  spacerRef,
  card,
  onReady,
  onFail,
  onIntroDone,
}: {
  products: ProductCardData[];
  active: number;
  level: 'full' | 'lite';
  lang: Lang;
  heroRef: RefObject<HTMLElement>;
  spacerRef: RefObject<HTMLElement>;
  card?: ReactNode;
  onReady?: () => void;
  onFail?: () => void;
  onIntroDone?: (played: boolean) => void;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const state = useRef({ px: 0, py: 0, yaw: 0, pitch: 0.14, intro: 0, accent: accentRgb(''), lastAccent: -10, rel: { x: 0, y: 0, w: 0, h: 0 }, anchor: 0.8, fill: 0.6 });
  // Opening sequence: decided once per mount; its clock only advances on rendered frames.
  const [playing] = useState(() => !reducedMotion() && claimIntro());
  const [introOn, setIntroOn] = useState(playing); // intro-only DOM is removed once the sequence ends
  const seq = useRef({ playing, t: 0, lastTime: -1, phase: '' as IntroPhase | '', after: playing ? 0 : 1, tiles: [] as HTMLElement[], tilesFor: -1 });
  const doneCb = useRef(onIntroDone);
  doneCb.current = onIntroDone;
  useEffect(() => {
    if (!playing) doneCb.current?.(false);
  }, [playing]);
  const points = useMemo(() => ({ vertex: PARTICLE_VERTEX, fragment: PARTICLE_FRAGMENT, count: level === 'full' ? 6500 : 2400 }), [level]);

  // Pointer → camera orbit (desktop only); the hero element receives the events.
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero || level !== 'full') return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = hero.getBoundingClientRect();
      state.current.px = ((e.clientX - r.left) / r.width) * 2 - 1;
      state.current.py = ((e.clientY - r.top) / r.height) * 2 - 1;
    };
    const onLeave = () => {
      state.current.px = 0;
      state.current.py = 0;
    };
    hero.addEventListener('pointermove', onMove, { passive: true });
    hero.addEventListener('pointerleave', onLeave);
    return () => {
      hero.removeEventListener('pointermove', onMove);
      hero.removeEventListener('pointerleave', onLeave);
    };
  }, [heroRef, level]);

  // Spacer position relative to the hero (measured on resize, not every frame).
  useEffect(() => {
    const hero = heroRef.current;
    const spacer = spacerRef.current;
    if (!hero || !spacer) return;
    const measure = () => {
      const h = hero.getBoundingClientRect();
      const s = spacer.getBoundingClientRect();
      state.current.rel = { x: s.left - h.left, y: s.top - h.top, w: s.width, h: s.height };
      // Layout hints from CSS (phones place the pedestal higher to leave room for the product card)
      const cs = getComputedStyle(spacer);
      state.current.anchor = parseFloat(cs.getPropertyValue('--stage-anchor')) || 0.8;
      state.current.fill = parseFloat(cs.getPropertyValue('--stage-fill')) || 0.6;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(hero);
    ro.observe(spacer);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [heroRef, spacerRef]);

  const onFrame = (set: UniformSetter, f: FrameInfo) => {
    const s = state.current;
    if (f.time - s.lastAccent > 2) {
      // Admin → Brand accent is applied at runtime as --accent; follow it.
      s.accent = accentRgb(getComputedStyle(document.documentElement).getPropertyValue('--accent'));
      s.lastAccent = f.time;
    }
    // Sequence clock (capped step: a long pause resumes smoothly instead of jumping ahead)
    const q = seq.current;
    const dt = q.lastTime < 0 ? 0 : Math.min(0.05, Math.max(0, f.time - q.lastTime));
    q.lastTime = f.time;
    if (q.playing) {
      q.t += dt;
      if (q.t >= INTRO_DURATION) {
        q.playing = false;
        layerRef.current?.classList.remove('is-intro');
        layerRef.current?.setAttribute('data-intro', 'done');
        setIntroOn(false);
        doneCb.current?.(true);
      }
    } else q.after = Math.min(1, q.after + dt / 1.2);
    const st = q.playing ? introState(q.t) : RESTING;
    // Choreographed camera during the sequence; the visitor's pointer takes over gradually after it
    const idle = Math.sin(f.time * 0.18);
    const choreo = q.playing ? Math.sin(q.t * 0.55) * 0.12 * (1 - Math.min(1, q.t / 9)) : 0;
    const targetYaw = (level === 'full' ? s.px * 0.24 * q.after + idle * 0.05 : Math.sin(f.time * 0.22) * 0.16) + choreo;
    const targetPitch = 0.14 + (level === 'full' ? s.py * -0.05 * q.after : 0);
    s.yaw += (targetYaw - s.yaw) * 0.05;
    s.pitch += (targetPitch - s.pitch) * 0.05;
    s.intro = Math.min(1, s.intro + 1 / 90);
    const W = f.cssWidth;
    const H = f.cssHeight;
    const r = s.rel.w ? s.rel : { x: W * 0.55, y: H * 0.15, w: W * 0.4, h: H * 0.7 };
    // Fit: product height ≈ --stage-fill of the spacer, pedestal no wider than ~1.1× the spacer
    const targetPh = Math.max(120, r.h * s.fill);
    const distH = (STAGE.productHeight * STAGE.focal * H) / targetPh;
    const distW = (2 * STAGE.pedestalRadius * STAGE.focal * H) / Math.max(1, r.w * 1.1);
    const dist = Math.min(16, Math.max(5, distH, distW)) * st.cam;
    const cam: Camera = makeCamera(s.yaw, s.pitch, dist);
    const ax = r.x + r.w / 2;
    const ay = r.y + r.h * s.anchor;
    const [x0, y0] = projectUv(cam, [0, STAGE.pedestalTop, 0]);
    const offX = (ax - W / 2) / H - x0;
    const offY = (H / 2 - ay) / H - y0;
    const [, yTop] = projectUv(cam, [0, STAGE.pedestalTop + STAGE.productHeight, 0]);
    const ph = (yTop - y0) * H;

    set('uRo', ...cam.ro);
    set('uFw', ...cam.fw);
    set('uRt', ...cam.rt);
    set('uUp', ...cam.up);
    set('uFl', cam.fl);
    set('uOff', offX, offY);
    set('uAccent', ...s.accent);
    set('uIntro', q.playing ? st.light : 1 - Math.pow(1 - s.intro, 3));
    set('uPortal', st.portal);
    set('uPortalFade', st.portalFade);
    set('uFlash', st.flash);
    set('uShock', st.shock);
    set('uFoot', (STAGE.productHeight * STAGE.productAspect) / 2, 0.07);

    const layer = layerRef.current;
    if (layer) {
      layer.style.setProperty('--ax', `${ax.toFixed(1)}px`);
      layer.style.setProperty('--ay', `${ay.toFixed(1)}px`);
      layer.style.setProperty('--ph', `${ph.toFixed(1)}px`);
      layer.style.setProperty('--yaw', `${((-s.yaw * 180) / Math.PI).toFixed(2)}deg`);
      layer.style.setProperty('--pitch', `${(((s.pitch - 0.14) * 180) / Math.PI).toFixed(2)}deg`);
      layer.style.setProperty('--glare', `${(50 + s.yaw * 160).toFixed(1)}%`);
      if (q.playing) {
        if (q.phase !== st.phase) {
          q.phase = st.phase;
          layer.setAttribute('data-intro', st.phase);
        }
        const v = (k: string, n: number) => layer.style.setProperty(k, n.toFixed(4));
        v('--emerge', st.emerge);
        v('--sep', st.sep);
        v('--tiles-op', st.tilesOp);
        v('--face-op', st.faceOp);
        v('--edge-op', st.edgeOp);
        v('--wire-op', st.wireOp);
        v('--scan', st.scan);
        v('--reveal', st.reveal);
        v('--scan-op', st.scanOp);
        v('--glint', st.glint);
        v('--glow', st.glow);
        // Exploded view: each component gets its own staggered amount
        if (st.tilesOp > 0) {
          if (q.tilesFor !== active || !q.tiles.length) {
            q.tiles = Array.from(layer.querySelectorAll<HTMLElement>('.fp[data-active="true"] .fp__tile'));
            q.tilesFor = active;
          }
          q.tiles.forEach((el, i) => el.style.setProperty('--e', tileExplode(q.t, i, q.tiles.length).toFixed(4)));
        }
      }
    }
    if (!q.playing) return false;
    set('uWA', st.wA);
    set('uTA', st.tA);
    set('uWB', st.wB);
    set('uTB', st.tB);
    set('uWD', st.wD);
    set('uD1', st.d1);
    set('uD2', st.d2);
    set('uDT', st.dT);
    set('uSlab', (STAGE.productHeight * STAGE.productAspect) / 2, STAGE.productHeight);
    return st.wA > 0 || st.wB > 0 || st.wD > 0;
  };

  return (
    <>
      <ThreeDScene fragment={STUDIO_FRAGMENT} level={level} className="p3d__canvas" onFrame={onFrame} onReady={onReady} onFail={onFail} points={playing ? points : undefined} />
      <div className={`p3d__layer ${introOn ? 'is-intro' : ''}`} ref={layerRef} data-intro={introOn ? 'portal' : 'done'}>
        <div className="p3d__anchor">
          <span className="p3d__shadow" aria-hidden="true" />
          <div className="p3d__orbit">
            {products.map((pr, i) => {
              const cat = typeof pr.category === 'object' ? pr.category?.slug : undefined;
              return <FloatingProduct key={pr._id} image={pr.images?.[0]} alt={L(pr.name, lang)} category={cat} active={i === active} eager={i === 0} index={i} intro={introOn && i === active} />;
            })}
          </div>
          {card ? <div className="p3d__card">{card}</div> : null}
        </div>
      </div>
    </>
  );
}
