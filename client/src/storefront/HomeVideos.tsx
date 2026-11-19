import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/I18n';
import { storeCopy } from './copy';
import { useCached } from '../lib/hooks';
import { absoluteUrl } from '../lib/useSeo';
import { prefersReducedMotion } from '../lib/motion';
import type { HomeVideoItem, HomeVideoSectionData, Lang, Localized } from '../lib/types';
import '../styles/homeVideos.css';
import { Kinetic } from './motion';

/**
 * Homepage video showcase — up to eight Admin-managed positions, four in view on desktop with previous/next (Admin → Website → Homepage videos).
 * Every title, description, poster and source comes from /api/home/videos; nothing is hard-coded,
 * and the section is not rendered at all when the Admin has no published video placed.
 *
 * Performance: only posters load with the page (lazily). A provider player (iframe) or a video file
 * is created only when the visitor presses play, and only one plays at a time — starting another
 * returns the previous card to its poster, which unmounts its player. Optional silent previews
 * (uploaded/direct files only) play muted while on screen, never with reduced motion.
 */

const PROVIDER_LABEL: Record<HomeVideoItem['provider'], string> = { youtube: 'YouTube', vimeo: 'Vimeo', facebook: 'Facebook', file: '' };

/** Text for the page language; falls back to the other language with its own lang/dir. */
function pick(v: Localized | undefined, lang: Lang): { text: string; lang: Lang } {
  const other: Lang = lang === 'ar' ? 'en' : 'ar';
  if (v?.[lang]?.trim()) return { text: v[lang], lang };
  if (v?.[other]?.trim()) return { text: v[other], lang: other };
  return { text: '', lang };
}
const langAttrs = (p: { lang: Lang }, page: Lang) => (p.lang === page ? {} : { lang: p.lang, dir: p.lang === 'ar' ? 'rtl' : 'ltr' });

/** YouTube's portrait thumbnail for an automatic YouTube poster (exists for Shorts / vertical videos). */
const youtubePortraitPoster = (poster: string) => {
  const m = /^https:\/\/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{11})\//.exec(poster || '');
  return m ? `https://i.ytimg.com/vi/${m[1]}/oardefault.jpg` : null;
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function HomeVideos() {
  const { t, lang } = useI18n();
  const { data } = useCached<HomeVideoSectionData>('/api/home/videos');
  const [playing, setPlaying] = useState<string | null>(null);
  const videos = data?.enabled ? data.videos.slice(0, 8) : [];
  const c = storeCopy(lang);

  // Previous/next controls for the row (shown only while the cards overflow it; RTL-aware).
  const track = useRef<HTMLOListElement | null>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const pos = Math.abs(el.scrollLeft); // RTL scrollLeft is negative in modern browsers
    setEdge({ start: pos <= 2, end: pos >= max - 2 });
  }, []);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure, videos.length]);
  const go = (dir: 1 | -1) => {
    const el = track.current;
    const slot = el?.querySelector<HTMLElement>('.hv__slot');
    if (!el || !slot) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const step = slot.offsetWidth + parseFloat(getComputedStyle(el).columnGap || '0');
    el.scrollBy({ left: dir * (rtl ? -1 : 1) * step, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  // VideoObject structured data — only for uploaded files, where the upload date is genuinely known.
  useEffect(() => {
    const items = videos
      .filter((v) => v.provider === 'file' && v.uploadDate && v.posterUrl && v.fileUrl && pick(v.title, lang).text)
      .map((v) => ({
        '@type': 'VideoObject',
        name: pick(v.title, lang).text,
        ...(pick(v.description, lang).text ? { description: pick(v.description, lang).text } : {}),
        thumbnailUrl: absoluteUrl(v.posterUrl),
        uploadDate: v.uploadDate,
        contentUrl: absoluteUrl(v.fileUrl!.split('#')[0]),
        ...(v.durationSec ? { duration: `PT${Math.round(v.durationSec)}S` } : {}),
      }));
    if (!items.length) return;
    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = 'celibery-home-videos-ld';
    el.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': items });
    document.head.appendChild(el);
    return () => el.remove();
  }, [videos, lang]);

  if (!videos.length) return null;
  const eyebrow = pick(data!.eyebrow, lang);
  const title = pick(data!.title, lang);
  const subtitle = pick(data!.subtitle, lang);

  return (
    <section className="hv" aria-labelledby="hv-title" data-testid="home-videos">
      <div className="container">
        <div className="hv__top">
        <div className="hv__head">
          {eyebrow.text ? (
            <span className="cx-eyebrow hv__eyebrow" data-fx="rise" {...langAttrs(eyebrow, lang)}>
              {eyebrow.text}
            </span>
          ) : null}
          {title.text ? (
            <Kinetic id="hv-title" text={title.text} className="cx-display hv__title" />
          ) : (
            <h2 id="hv-title" className="sr-only">
              {t.videos.heading}
            </h2>
          )}
          {subtitle.text ? (
            <p className="hv__lead" data-fx="rise" style={{ '--d': '240ms' } as CSSProperties} {...langAttrs(subtitle, lang)}>
              {subtitle.text}
            </p>
          ) : null}
        </div>
          {edge.start && edge.end ? null : (
            <div className="hv__nav">
              <button type="button" className="cx-round" onClick={() => go(-1)} disabled={edge.start} aria-label={c.prev}>
                <Icon name="chevron" className="icon cx-chev cx-chev--prev" />
              </button>
              <button type="button" className="cx-round" onClick={() => go(1)} disabled={edge.end} aria-label={c.next}>
                <Icon name="chevron" className="icon cx-chev" />
              </button>
            </div>
          )}
        </div>
        <ol className="hv__grid" data-count={videos.length} ref={track}>
          {videos.map((v, i) => (
            <li key={v.id} className="hv__slot" data-fx="rise" style={{ '--d': `${120 + i * 90}ms` } as CSSProperties}>
              <VideoCard video={v} index={i} active={playing === v.id} onPlay={() => setPlaying(v.id)} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function VideoCard({ video: v, index, active, onPlay }: { video: HomeVideoItem; index: number; active: boolean; onPlay: () => void }) {
  const { t, lang } = useI18n();
  const title = pick(v.title, lang);
  const description = pick(v.description, lang);
  const alt = pick(v.posterAlt, lang);
  const [posterFailed, setPosterFailed] = useState(false);
  // A poster that is not (nearly) the card's 9:16 shape is shown whole over its own soft copy — never cropped.
  const [posterWhole, setPosterWhole] = useState(false);
  // YouTube Shorts: YouTube's own portrait (9:16) thumbnail fits the card exactly; videos without one
  // (regular landscape videos) fall back to the saved poster, shown whole.
  const [posterSrc, setPosterSrc] = useState(() => youtubePortraitPoster(v.posterUrl) ?? v.posterUrl);
  const [frameFailed, setFrameFailed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const playerRef = useRef<HTMLIFrameElement & HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [embedSrc, setEmbedSrc] = useState<string | null>(null);
  const label = title.text || t.videos.heading;

  // Move focus into the player once it exists, so keyboard users can control it straight away.
  useEffect(() => {
    if (active && !failed) playerRef.current?.focus({ preventScroll: true });
  }, [active, failed, attempt]);

  const start = () => {
    // Facebook's player lays itself out from width/height parameters: give it the real card width.
    let src = v.embedUrl;
    if (src && v.provider === 'facebook') {
      const w = Math.max(320, Math.min(1280, Math.round(frameRef.current?.clientWidth ?? 640)));
      src = `${src}&width=${w}&height=${Math.round((w * 9) / 16)}`;
    }
    setEmbedSrc(src);
    setFailed(false);
    setAttempt((n) => n + 1);
    onPlay();
  };
  const hasPoster = Boolean(posterSrc) && !posterFailed;
  const provider = PROVIDER_LABEL[v.provider];

  return (
    <article className={`hv-card ${active ? 'is-playing' : ''} ${failed ? 'is-failed' : ''}`} data-fit={posterWhole ? 'contain' : v.fit} aria-label={label}>
      <div className="hv-card__frame" ref={frameRef}>
        {active && !failed ? (
          embedSrc ? (
            <iframe
              key={attempt}
              ref={playerRef}
              className="hv-card__player"
              data-provider={v.provider}
              src={embedSrc}
              title={t.videos.playing(label)}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : v.fileUrl ? (
            <video
              key={attempt}
              ref={playerRef}
              className="hv-card__player"
              src={v.fileUrl}
              poster={hasPoster ? v.posterUrl : undefined}
              controls
              autoPlay
              playsInline
              loop={v.loop}
              preload="auto"
              aria-label={t.videos.playing(label)}
              onError={() => setFailed(true)}
            />
          ) : null
        ) : (
          <>
            {hasPoster ? (
              <>
                {/* Soft copy of the poster: shown only when the Admin sets the poster to "fit whole"
                    (contain), filling the card around it — no black bars. */}
                <img className="hv-card__backdrop" src={posterSrc} alt="" aria-hidden="true" loading="lazy" decoding="async" />
                <img className="hv-card__poster" src={posterSrc} alt={alt.text} {...langAttrs(alt, lang)} loading="lazy" decoding="async"
                  onError={() => (posterSrc !== v.posterUrl ? setPosterSrc(v.posterUrl) : setPosterFailed(true))}
                  onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && Math.abs(i.naturalWidth / i.naturalHeight - 9 / 16) / (9 / 16) > 0.08) setPosterWhole(true); }} />
              </>
            ) : v.fileUrl && !frameFailed ? (
              // No poster for a direct video link: show a frame from the video itself (loads only its start).
              <video className="hv-card__poster" src={`${v.fileUrl.split('#')[0]}#t=1`} muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1} onError={() => setFrameFailed(true)}
                onLoadedMetadata={(e) => { const m = e.currentTarget; if (m.videoWidth && Math.abs(m.videoWidth / m.videoHeight - 9 / 16) / (9 / 16) > 0.08) setPosterWhole(true); }} />
            ) : (
              <span className="hv-card__placeholder" aria-hidden="true" />
            )}
            {v.mutedPreview && v.fileUrl && !failed ? <SilentPreview src={v.fileUrl} poster={hasPoster ? v.posterUrl : undefined} fit={v.fit} /> : null}
            <span className="hv-card__shade" aria-hidden="true" />
            {failed ? (
              <div className="hv-card__error" role="status">
                <span>{t.videos.error}</span>
                <button type="button" className="hv-card__retry" onClick={start}>
                  {t.videos.retry}
                </button>
              </div>
            ) : (
              <button type="button" className="hv-card__play" onClick={start} aria-label={t.videos.play(label)}>
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.4-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5Z" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>
      <div className="hv-card__caption">
        <div className="hv-card__meta" aria-hidden="true">
          <span className="hv-card__index ltr">{String(index + 1).padStart(2, '0')}</span>
          {provider ? <span className="hv-card__badge ltr">{provider}</span> : null}
          {v.durationSec ? <span className="hv-card__badge ltr">{clock(v.durationSec)}</span> : null}
        </div>
        {title.text ? (
          <h3 className="hv-card__title" {...langAttrs(title, lang)}>
            {title.text}
          </h3>
        ) : null}
        {description.text ? (
          <p className="hv-card__text" {...langAttrs(description, lang)}>
            {description.text}
          </p>
        ) : null}
      </div>
    </article>
  );
}

/** Muted, looping preview of a file while the card is on screen (never with reduced motion). */
function SilentPreview({ src, poster, fit }: { src: string; poster?: string; fit: 'cover' | 'contain' }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [broken, setBroken] = useState(false);
  const reduced = prefersReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) el.play().catch(() => undefined); // autoplay refused: the poster stays
        else el.pause();
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      el.pause();
      el.removeAttribute('src');
      el.load(); // release the network connection and decoder
    };
  }, [reduced, src]);
  if (reduced || broken) return null;
  return <video ref={ref} className="hv-card__preview" src={src} poster={poster} data-fit={fit} muted loop playsInline preload="none" aria-hidden="true" tabIndex={-1} onError={() => setBroken(true)} />;
}
