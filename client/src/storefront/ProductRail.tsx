import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/I18n';
import { storeCopy } from './copy';

/**
 * Horizontal product rail: native scroll-snap (touch, trackpad and keyboard keep working) with
 * previous/next controls that respect RTL. Purely presentational — children are rendered as given.
 */
export function ProductRail({ children, label, tone = 'light' }: { children: ReactNode; label?: string; tone?: 'light' | 'dark' }) {
  const { lang } = useI18n();
  const c = storeCopy(lang);
  const track = useRef<HTMLDivElement | null>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const pos = Math.abs(el.scrollLeft); // RTL scrollLeft is negative in modern browsers
    setEdge({ start: pos <= 2, end: pos >= max - 2 });
  }, []);

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure, children]);

  const go = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    el.scrollBy({ left: dir * (rtl ? -1 : 1) * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  return (
    <div className={`cx-rail ${tone === 'dark' ? 'cx-rail--dark' : ''}`}>
      <div ref={track} className="cx-rail__track" role="list" aria-label={label}>
        {Array.isArray(children)
          ? children.map((child, i) => (
              <div className="cx-rail__item" role="listitem" key={(child as { key?: string })?.key ?? i}>
                {child}
              </div>
            ))
          : <div className="cx-rail__item" role="listitem">{children}</div>}
      </div>
      {edge.start && edge.end ? null : (
        <div className="cx-rail__nav">
          <button type="button" className="cx-round" onClick={() => go(-1)} disabled={edge.start} aria-label={c.prev}>
            <Icon name="chevron" className="icon cx-chev cx-chev--prev" />
          </button>
          <button type="button" className="cx-round" onClick={() => go(1)} disabled={edge.end} aria-label={c.next}>
            <Icon name="chevron" className="icon cx-chev" />
          </button>
        </div>
      )}
    </div>
  );
}
