import { useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Icon } from '../components/Icon';
import { ProductImage } from '../components/ProductCard';
import { useI18n } from '../i18n/I18n';
import { L } from '../lib/format';
import type { Image } from '../lib/types';
import { finePointer } from './env';
import { useTilt } from './TiltCard';

/**
 * Product-page gallery as a lit display stage.
 *  - Hover: the photo tilts in 3D toward the pointer with a moving studio light (mouse only).
 *  - Click (or Enter): toggles the existing cursor-following zoom; leaving the image exits it.
 *  - Swipe on touch, arrow keys, prev/next buttons and thumbnails change photo with a directional
 *    3D turn (mirrored in Arabic).
 * The photos are flat images presented in perspective — no rotation of a 3D model is implied.
 * Re-mount with `key={product slug}` to reset when the product changes.
 */
export function InteractiveProductGallery({ images, name, category, stageRef }: { images: Image[]; name: string; category?: string; stageRef?: RefObject<HTMLDivElement> }) {
  const { t, lang } = useI18n();
  const [img, setImg] = useState(0);
  const [dir, setDir] = useState<'next' | 'prev'>('next');
  const [zoomOn, setZoomOn] = useState(false);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const ownRef = useRef<HTMLDivElement | null>(null);
  const mainRef = stageRef ?? ownRef;
  useTilt(mainRef, { max: 6, touch: false });
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const many = images.length > 1;

  const go = (n: number, d: 'next' | 'prev') => {
    setDir(d);
    setZoomOn(false);
    setZoom(null);
    setImg((n + images.length) % images.length);
  };
  const step = (d: number) => go(img + d, d > 0 ? 'next' : 'prev');
  const rtl = lang === 'ar';

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!zoomOn) return;
    const r = e.currentTarget.getBoundingClientRect();
    setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!finePointer() || (e.target as HTMLElement).closest('button')) return;
    if (zoomOn) {
      setZoomOn(false);
      setZoom(null);
    } else {
      setZoomOn(true);
      onMoveNow(e);
    }
  };
  const onMoveNow = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (!many) return;
      e.preventDefault();
      const forward = (e.key === 'ArrowRight') !== rtl;
      step(forward ? 1 : -1);
    } else if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
      e.preventDefault();
      setZoomOn((z) => !z);
      setZoom({ x: 50, y: 50 });
    } else if (e.key === 'Escape') {
      setZoomOn(false);
      setZoom(null);
    }
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || !many) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - s.y)) step((dx < 0) !== rtl ? 1 : -1);
  };

  const zoomed = zoomOn && zoom;
  return (
    <div className="gallery gallery--3d">
      <div
        ref={mainRef}
        className={`gallery__main tilt ${zoomed ? 'is-zoom' : ''}`}
        style={zoomed ? ({ '--zx': `${zoom.x}%`, '--zy': `${zoom.y}%` } as CSSProperties) : undefined}
        onMouseMove={onMove}
        onMouseLeave={() => {
          setZoomOn(false);
          setZoom(null);
        }}
        onClick={onClick}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => (swipe.current = null)}
        tabIndex={0}
        role="group"
        aria-roledescription={lang === 'ar' ? 'معرض صور' : 'image gallery'}
        aria-label={`${name} — ${img + 1} / ${images.length}`}
      >
        <span className="gallery__floor" aria-hidden="true" />
        {/* Re-keyed so each image change plays the directional turn */}
        <div key={img} className="gallery__frame" data-dir={dir}>
          <ProductImage src={images[img]?.url} image={images[img]} sizes="(max-width: 899px) 100vw, 50vw" alt={L(images[img]?.alt, lang) || name} category={category} eager />
        </div>
        <span className="tilt__glare" aria-hidden="true" />
        <span className="gallery__hint" aria-hidden="true">
          {t.premium.zoomHint}
        </span>
        {many ? (
          <>
            <span className="gallery__count ltr" aria-hidden="true">
              {img + 1} / {images.length}
            </span>
            <button type="button" className="gallery__nav gallery__nav--prev" aria-label={t.premium.previous} onClick={() => step(-1)}>
              <Icon name="chevron" />
            </button>
            <button type="button" className="gallery__nav gallery__nav--next" aria-label={t.premium.next} onClick={() => step(1)}>
              <Icon name="chevron" />
            </button>
          </>
        ) : null}
      </div>
      {many ? (
        <div className="gallery__thumbs">
          {images.map((im, i) => (
            <button key={i} aria-current={i === img} aria-label={`${i + 1}`} onClick={() => i !== img && go(i, i > img ? 'next' : 'prev')}>
              <ProductImage src={im.url} image={im} sizes="96px" alt="" category={category} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
