import { useEffect, useRef, type CSSProperties, type ElementType, type ReactNode, type RefObject } from 'react';
import { finePointer } from './env';

type TiltOptions = { max?: number; touch?: boolean };

/**
 * Pointer-driven 3D tilt. Writes CSS custom properties on the element — nothing re-renders:
 *   --rx / --ry  rotation in degrees, --gx / --gy  glare position in %, --tz 0..1 (lift),
 *   --px / --py  unitless pointer position -1..1 (for parallax inside the element)
 * and toggles `.is-tilting`. The stylesheet decides what moves (see immersive.css).
 *
 * Mouse: follows the pointer. Touch: a short "press" tilt toward the finger that releases on lift
 * or as soon as the browser starts scrolling (pointercancel) — it never blocks scrolling or taps.
 * Disabled under prefers-reduced-motion.
 */
export function useTilt<T extends HTMLElement>(ref: RefObject<T>, { max = 7, touch = true }: TiltOptions = {}) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fine = finePointer();
    if (!fine && !touch) return;
    let frame = 0;
    let next: { x: number; y: number } | null = null;
    const write = () => {
      frame = 0;
      if (!next) {
        el.classList.remove('is-tilting');
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
        el.style.setProperty('--tz', '0');
        el.style.setProperty('--px', '0');
        el.style.setProperty('--py', '0');
        return;
      }
      el.classList.add('is-tilting');
      el.style.setProperty('--rx', `${(-next.y * max).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${(next.x * max).toFixed(2)}deg`);
      el.style.setProperty('--gx', `${((next.x + 1) * 50).toFixed(1)}%`);
      el.style.setProperty('--gy', `${((next.y + 1) * 50).toFixed(1)}%`);
      el.style.setProperty('--tz', '1');
      el.style.setProperty('--px', next.x.toFixed(3));
      el.style.setProperty('--py', next.y.toFixed(3));
    };
    const queue = (v: { x: number; y: number } | null) => {
      next = v;
      if (!frame) frame = requestAnimationFrame(write);
    };
    const at = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)), y: Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1)) };
    };
    // While the pointer is over a control inside the panel (wishlist, arrows…), the panel holds
    // still so the target never moves under the cursor.
    const onControl = (e: PointerEvent) => !!(e.target as HTMLElement | null)?.closest?.('button, input, select, textarea');
    const onMove = (e: PointerEvent) => !motion.matches && e.pointerType === 'mouse' && fine && !onControl(e) && queue(at(e));
    const onLeave = () => queue(null);
    const onDown = (e: PointerEvent) => !motion.matches && e.pointerType !== 'mouse' && touch && !onControl(e) && queue({ x: at(e).x * 0.6, y: at(e).y * 0.6 });
    const onUp = (e: PointerEvent) => e.pointerType !== 'mouse' && queue(null);
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown, { passive: true });
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    motion.addEventListener('change', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      motion.removeEventListener('change', onLeave);
    };
  }, [ref, max, touch]);
}

/**
 * Wrapper element with tilt + glare. `as` keeps semantics: pass a router `Link` (with `to`), an
 * `article`, etc. — remaining props are forwarded to that element.
 */
export function TiltCard({ children, className = '', as: Tag = 'div', max, ...rest }: { children: ReactNode; className?: string; as?: ElementType; max?: number; style?: CSSProperties; [prop: string]: unknown }) {
  const ref = useRef<HTMLElement | null>(null);
  useTilt(ref, { max });
  return (
    <Tag ref={ref} className={`tilt ${className}`} {...rest}>
      {children}
      <span className="tilt__glare" aria-hidden="true" />
    </Tag>
  );
}
