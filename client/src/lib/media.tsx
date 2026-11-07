import { useEffect, useState } from 'react';
import type { Image } from './types';

/**
 * Storefront media helpers. classifyVideoUrl mirrors server/src/lib/media-url.ts (which is the
 * unit-tested reference) — keep both in sync.
 */
export type VideoSource = { type: 'file'; url: string } | { type: 'youtube'; id: string; embedUrl: string } | { type: 'vimeo'; id: string; embedUrl: string };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function classifyVideoUrl(raw: string | undefined | null): VideoSource | null {
  const v = (raw ?? '').trim();
  if (!v || /[\s"'<>`]/.test(v)) return null;
  if (v.startsWith('/') && !v.startsWith('//')) return /\.(mp4|webm)$/i.test(v.split('?')[0]) ? { type: 'file', url: v } : null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  let yt: string | null = null;
  if (host === 'youtu.be') yt = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') yt = u.searchParams.get('v');
    else yt = /^\/(?:embed|shorts|live)\/([^/?#]+)/.exec(u.pathname)?.[1] ?? null;
  }
  if (yt) {
    if (!YT_ID.test(yt)) return null;
    const params = new URLSearchParams({ autoplay: '1', mute: '1', loop: '1', playlist: yt, controls: '0', playsinline: '1', rel: '0', modestbranding: '1' });
    return { type: 'youtube', id: yt, embedUrl: `https://www.youtube-nocookie.com/embed/${yt}?${params}` };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = /^\/(?:video\/)?(\d{6,12})/.exec(u.pathname)?.[1];
    if (!id) return null;
    const hash = u.searchParams.get('h') || /^\/(?:video\/)?\d+\/([a-z0-9]+)(?:\/|$)/i.exec(u.pathname)?.[1];
    if (hash && !/^[a-z0-9]{1,128}$/i.test(hash)) return null;
    const params = new URLSearchParams({ background: '1', autoplay: '1', muted: '1', loop: '1', dnt: '1' });
    if (hash) params.set('h', hash);
    return { type: 'vimeo', id, embedUrl: `https://player.vimeo.com/video/${id}?${params}` };
  }
  return /\.(mp4|webm)$/i.test(u.pathname) ? { type: 'file', url: v } : null;
}

/** srcset for uploaded images with responsive variants; undefined for plain URL images. */
/** Widths requested from Cloudinary for images stored as a single original (no recorded variants). */
const CLOUDINARY_WIDTHS = [160, 480, 800, 1200];
const CLOUDINARY_UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/;

/**
 * Cloudinary delivery variants: the same stored original, resized and re-encoded (WebP/AVIF where
 * supported) on Cloudinary's side. Nothing is uploaded or changed — the URL only asks for a size.
 */
function cloudinarySrcSet(url: string): string | undefined {
  const m = CLOUDINARY_UPLOAD.exec(url);
  if (!m || /^[a-z]{1,3}_/.test(m[2])) return undefined; // URL already carries a transformation
  return CLOUDINARY_WIDTHS.map((w) => `${m[1]}c_limit,w_${w},f_auto,q_auto/${m[2]} ${w}w`).join(', ');
}

export function srcSetFor(image?: Pick<Image, 'url' | 'variants' | 'width'> | null): string | undefined {
  const variants = image?.variants?.filter((v) => v.url && v.width) ?? [];
  if (!variants.length) return image?.url ? cloudinarySrcSet(image.url) : undefined;
  const entries = variants.map((v) => `${v.url} ${v.width}w`);
  if (image?.width && !variants.some((v) => v.width >= image.width!)) entries.push(`${image.url} ${image.width}w`);
  return entries.join(', ');
}

export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [query]);
  return matches;
}

/** Background video for the hero and banners: file → <video>, YouTube/Vimeo → privacy-enhanced embed. */
export function BackgroundVideo({ src, poster, reduced, className }: { src: string; poster?: string; reduced: boolean; className?: string }) {
  const v = classifyVideoUrl(src);
  if (!v) return poster ? <img className={className} src={poster} alt="" /> : null;
  // Visitors who prefer reduced motion see the poster instead of an autoplaying video.
  if (reduced && poster) return <img className={className} src={poster} alt="" />;
  if (v.type === 'file') {
    return <video className={className} src={v.url} poster={poster || undefined} autoPlay={!reduced} muted loop playsInline preload="metadata" aria-hidden="true" />;
  }
  return (
    <div className={`embed-cover ${className ?? ''}`} aria-hidden="true">
      <iframe
        src={v.embedUrl}
        title="Background video"
        tabIndex={-1}
        allow="autoplay; encrypted-media; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
      />
    </div>
  );
}
