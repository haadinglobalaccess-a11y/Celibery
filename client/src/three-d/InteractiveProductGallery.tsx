import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Icon } from '../components/Icon';
import { ProductImage } from '../components/ProductCard';
import { useI18n } from '../i18n/I18n';
import { L } from '../lib/format';
import type { Image, ProductVideo } from '../lib/types';
import { finePointer } from './env';
import { useTilt } from './TiltCard';

/** One slide of the product gallery: a photo (product or packaging) or a product video. */
export type GalleryItem = { kind: 'image'; image: Image; packaging?: boolean } | { kind: 'video'; video: ProductVideo };

/** Delay before a hovered thumbnail takes the main frame — long enough that sweeping across the strip doesn't flicker. */
const HOVER_INTENT_MS = 90;

/**
 * Product-page gallery: one main frame with a strip of thumbnails underneath.
 *  - Thumbnails: hovering one (mouse) or clicking/tapping it brings it into the main frame.
 *  - Photos: the frame tilts toward the pointer; click (or Enter) toggles the cursor-following zoom.
 *  - Videos: shown with their poster and a play button; choosing a video by click/tap starts it.
 *    YouTube / Vimeo / Facebook play in their official player, uploaded or linked files in <video>.
 *  - Swipe on touch, arrow keys and prev/next buttons step through every slide (mirrored in Arabic).
 * Re-mount with `key={product slug}` to reset when the product changes.
 */
export function InteractiveProductGallery({ items, name, category, stageRef }: { items: GalleryItem[]; name: string; category?: string; stageRef?: RefObject<HTMLDivElement> }) {
  const { t, lang } = useI18n();
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState<'next' | 'prev'>('next');
  const [zoomOn, setZoomOn] = useState(false);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  /** The video slide that is playing (null = poster shown). */
  const [playing, setPlaying] = useState<number | null>(null);
  const ownRef = useRef<HTMLDivElement | null>(null);
  const mainRef = stageRef ?? ownRef;
  useTilt(mainRef, { max: 6, touch: false });
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  const many = items.length > 1;
  const cur = items[idx];
  const isVideo = cur?.kind === 'video';

  const go = (n: number, d: 'next' | 'prev', play = false) => {
    const next = (n + items.length) % items.length;
    setDir(d);
    setZoomOn(false);
    setZoom(null);
    setIdx(next);
    setPlaying(play && items[next]?.kind === 'video' ? next : null);
  };
  const step = (d: number) => go(idx + d, d > 0 ? 'next' : 'prev');
  const pick = (i: number, play: boolean) => {
    window.clearTimeout(hoverTimer.current);
    if (i === idx) {
      if (play && items[i]?.kind === 'video') setPlaying(i);
      return;
    }
    go(i, i > idx ? 'next' : 'prev', play);
  };
  const hoverPick = (i: number) => {
    if (!finePointer()) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => i !== idx && go(i, i > idx ? 'next' : 'prev'), HOVER_INTENT_MS);
  };
  const rtl = lang === 'ar';

  const zoomAt = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    if (zoomOn && !isVideo) zoomAt(e);
  };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (isVideo || !finePointer() || (e.target as HTMLElement).closest('button')) return;
    if (zoomOn) {
      setZoomOn(false);
      setZoom(null);
    } else {
      setZoomOn(true);
      zoomAt(e);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (!many) return;
      e.preventDefault();
      const forward = (e.key === 'ArrowRight') !== rtl;
      step(forward ? 1 : -1);
    } else if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
      e.preventDefault();
      if (isVideo) {
        setPlaying(idx);
        return;
      }
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
    if (!s || !many || playing === idx) return; // never swipe away from a video that is playing
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - s.y)) step((dx < 0) !== rtl ? 1 : -1);
  };

  const label = (it: GalleryItem | undefined) => (it?.kind === 'video' ? L(it.video.title, lang) || t.product.video : L(it?.image.alt, lang) || name);
  const zoomed = zoomOn && zoom && !isVideo;
  return (
    <div className="gallery gallery--3d">
      <div
        ref={mainRef}
        className={`gallery__main tilt ${zoomed ? 'is-zoom' : ''} ${isVideo ? 'is-video' : ''}`}
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
        aria-label={`${name} — ${idx + 1} / ${items.length}${cur?.kind === 'image' && cur.packaging ? ` — ${t.product.packaging}` : isVideo ? ` — ${t.product.video}` : ''}`}
      >
        {isVideo ? null : <span className="gallery__floor" aria-hidden="true" />}
        {/* Re-keyed so each slide change plays the directional turn */}
        <div key={idx} className="gallery__frame" data-dir={dir} data-kind={cur?.kind}>
          {cur?.kind === 'video' ? (
            <VideoSlide video={cur.video} title={label(cur)} playing={playing === idx} onPlay={() => setPlaying(idx)} />
          ) : (
            <ProductImage src={cur?.image.url} image={cur?.image} sizes="(max-width: 899px) 100vw, 50vw" alt={label(cur)} category={category} eager />
          )}
        </div>
        {isVideo ? null : <span className="tilt__glare" aria-hidden="true" />}
        {cur?.kind === 'image' && cur.packaging ? (
          <span className="gallery__badge" data-testid="packaging-badge">
            {t.product.packaging}
          </span>
        ) : null}
        {isVideo ? null : (
          <span className="gallery__hint" aria-hidden="true">
            {t.premium.zoomHint}
          </span>
        )}
        {many ? (
          <>
            <span className="gallery__count ltr" aria-hidden="true">
              {idx + 1} / {items.length}
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
        <div className="gallery__thumbs" onMouseLeave={() => window.clearTimeout(hoverTimer.current)}>
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              aria-current={i === idx}
              aria-label={`${i + 1} — ${it.kind === 'video' ? t.product.video : it.packaging ? t.product.packaging : label(it)}`}
              data-kind={it.kind === 'video' ? 'video' : it.packaging ? 'packaging' : 'product'}
              onMouseEnter={() => hoverPick(i)}
              onFocus={() => i !== idx && pick(i, false)}
              onClick={() => pick(i, it.kind === 'video')}
            >
              {it.kind === 'video' ? (
                <>
                  {it.video.poster ? <img src={it.video.poster} alt="" loading="lazy" decoding="async" /> : <span className="gallery__thumb-video" />}
                  <span className="gallery__thumb-play" aria-hidden="true">
                    <Icon name="play" />
                  </span>
                </>
              ) : (
                <ProductImage src={it.image.url} image={it.image} sizes="96px" alt="" category={category} />
              )}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A product video in the main frame: poster + play button until started, then the player. */
function VideoSlide({ video, title, playing, onPlay }: { video: ProductVideo; title: string; playing: boolean; onPlay: () => void }) {
  const { t } = useI18n();
  if (playing) {
    if (video.embedUrl) return <iframe className="gallery__video" src={video.embedUrl} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />;
    return <video className="gallery__video" src={video.fileUrl} poster={video.poster || undefined} controls autoPlay playsInline preload="auto" aria-label={title} />;
  }
  return (
    <button type="button" className="gallery__poster" onClick={onPlay} aria-label={t.videos.play(title)}>
      {video.poster ? <img src={video.poster} alt="" decoding="async" /> : null}
      <span className="gallery__play" aria-hidden="true">
        <Icon name="play" />
      </span>
    </button>
  );
}
