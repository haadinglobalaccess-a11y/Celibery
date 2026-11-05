import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/I18n';
import { useReveal } from '../lib/hooks';
import { reducedMotion } from './env';

/**
 * Horizontal product rail with spatial depth: items turn slightly toward the centre and recede at
 * the edges (perspective lives on the scroll container, so depth follows the visible window).
 *
 * Native scrolling is kept for touch, trackpads and keyboards (snap + momentum untouched); mouse
 * users can also drag, and get previous/next buttons. A drag never triggers the link underneath.
 * Items keep the staggered scroll reveal of the old `.scroller`.
 */
export function SpatialCarousel({ children, label, className = '' }: { children: ReactNode; label?: string; className?: string }) {
  const { t } = useI18n();
  const track = useReveal<HTMLDivElement>();
  const [edge, setEdge] = useState({ start: true, end: false, overflow: false });
  const edgeRef = useRef(edge);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const still = reducedMotion();
    let frame = 0;
    const update = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const mid = r.left + r.width / 2;
      if (!still) {
        for (const c of Array.from(el.children) as HTMLElement[]) {
          const cr = c.getBoundingClientRect();
          const off = Math.max(-1.6, Math.min(1.6, (cr.left + cr.width / 2 - mid) / (r.width / 2)));
          c.style.setProperty('--off', off.toFixed(3));
          c.style.setProperty('--abs', Math.abs(off).toFixed(3));
        }
      }
      const sl = Math.abs(el.scrollLeft);
      const next = { start: sl < 4, end: sl + el.clientWidth >= el.scrollWidth - 4, overflow: el.scrollWidth > el.clientWidth + 4 };
      const prev = edgeRef.current;
      if (next.start !== prev.start || next.end !== prev.end || next.overflow !== prev.overflow) {
        edgeRef.current = next;
        setEdge(next);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    el.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);

    // Mouse drag-to-scroll
    let down: { x: number; left: number; moved: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || (e.target as HTMLElement).closest('button, input, select')) return;
      down = { x: e.clientX, left: el.scrollLeft, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      if (!down.moved && Math.abs(dx) > 6) {
        down.moved = true;
        el.classList.add('is-dragging');
      }
      if (down.moved) el.scrollLeft = down.left - dx;
    };
    const onUp = () => {
      if (!down) return;
      if (down.moved) {
        const swallow = (ev: Event) => {
          ev.preventDefault();
          ev.stopPropagation();
        };
        el.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 50);
      }
      el.classList.remove('is-dragging');
      down = null;
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    const onDragStart = (e: DragEvent) => e.preventDefault(); // native image/link drag would fight the scroll
    el.addEventListener('dragstart', onDragStart);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      el.removeEventListener('scroll', schedule);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('dragstart', onDragStart);
    };
  }, [track]);

  const go = (toward: 'start' | 'end') => {
    const el = track.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const sign = (toward === 'end' ? 1 : -1) * (rtl ? -1 : 1);
    el.scrollBy({ left: sign * el.clientWidth * 0.8, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };

  return (
    <div className={`spatial ${className}`} data-overflow={edge.overflow}>
      <div ref={track} className="scroller spatial__track reveal stagger" aria-label={label} role={label ? 'region' : undefined}>
        {children}
      </div>
      {edge.overflow ? (
        <>
          <button type="button" className="spatial__nav spatial__nav--prev" aria-label={t.premium.previous} disabled={edge.start} onClick={() => go('start')}>
            <Icon name="chevron" />
          </button>
          <button type="button" className="spatial__nav spatial__nav--next" aria-label={t.premium.next} disabled={edge.end} onClick={() => go('end')}>
            <Icon name="chevron" />
          </button>
        </>
      ) : null}
    </div>
  );
}
