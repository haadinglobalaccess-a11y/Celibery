import { checkMediaUrl } from './media-url';

/**
 * Video sources for the homepage video showcase (Admin → Website → Homepage videos).
 *
 * Separate from lib/media-url.ts on purpose: that module drives the cinematic hero's muted
 * background players and stays unchanged. Showcase videos are click-to-play with sound, and also
 * accept Facebook. Pure module (no I/O) — unit tested.
 *
 * Every embed uses the provider's official player:
 *  - YouTube  → youtube-nocookie.com/embed (privacy-enhanced mode)
 *  - Vimeo    → player.vimeo.com/video (dnt=1)
 *  - Facebook → facebook.com/plugins/video.php (Facebook's embedded video player)
 *  - direct .mp4 / .webm files → native <video> (ImageKit and Cloudinary links also get an automatic
 *    poster, and their .mov / .mkv / .avi files are delivered as MP4 by the service itself)
 */
export type ShowcaseProvider = 'youtube' | 'vimeo' | 'facebook' | 'file';

export type ShowcaseSource = {
  provider: ShowcaseProvider;
  /** Provider video id ('' for files). */
  id: string;
  /** Canonical URL of the video on its platform (or the file URL). */
  canonicalUrl: string;
  /** Vimeo private-link hash, kept so unlisted videos still play. */
  hash?: string;
};

export type ClassifyResult = { ok: true; source: ShowcaseSource } | { ok: false; reason: string };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;
const FB_ID = /^\d{5,25}$/;
const FB_HOSTS = new Set(['facebook.com', 'web.facebook.com', 'fb.com']);
const FILE_RX = /\.(mp4|webm|m4v)$/i;
/** Formats a video CDN converts on request; delivered as MP4 so every browser can play them. */
const CONVERTIBLE_RX = /\.(mov|mkv|avi)$/i;

const isImageKit = (u: URL) => u.hostname.toLowerCase() === 'ik.imagekit.io';
const isCloudinaryVideo = (u: URL) => u.hostname.toLowerCase() === 'res.cloudinary.com' && u.pathname.includes('/video/upload/');

/** An ImageKit / Cloudinary .mov/.mkv/.avi link rewritten so the CDN delivers MP4 (null otherwise). */
function cdnAsMp4(u: URL): string | null {
  if (!CONVERTIBLE_RX.test(u.pathname)) return null;
  const c = new URL(u.href);
  if (isCloudinaryVideo(u)) {
    c.pathname = c.pathname.replace(CONVERTIBLE_RX, '.mp4');
    return c.href;
  }
  if (isImageKit(u)) {
    const tr = c.searchParams.get('tr');
    c.searchParams.set('tr', tr ? `${tr},f-mp4` : 'f-mp4');
    return c.href;
  }
  return null;
}

export const SUPPORTED_HINT = 'Use a YouTube, Vimeo or Facebook video link, an ImageKit or Cloudinary video link, or a direct .mp4 / .webm file link';

export function classifyShowcaseUrl(raw: string): ClassifyResult {
  const v = (raw ?? '').trim();
  const check = checkMediaUrl(v);
  if (!check.ok) return { ok: false, reason: check.reason };
  if (v.startsWith('/')) {
    return FILE_RX.test(v.split(/[?#]/)[0]) ? { ok: true, source: { provider: 'file', id: '', canonicalUrl: v } } : { ok: false, reason: SUPPORTED_HINT };
  }
  const u = new URL(v);
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');

  // YouTube
  if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (u.pathname === '/watch') id = u.searchParams.get('v');
    else id = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(u.pathname)?.[1] ?? null;
    if (!id || !YT_ID.test(id)) return { ok: false, reason: 'This YouTube link does not point to a single video (playlists and channels are not supported)' };
    return { ok: true, source: { provider: 'youtube', id, canonicalUrl: `https://www.youtube.com/watch?v=${id}` } };
  }

  // Vimeo
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = /^\/(?:video\/)?(\d+)(?:\/([a-z0-9]+))?\/?$/i.exec(u.pathname);
    if (!m || !VIMEO_ID.test(m[1])) return { ok: false, reason: 'This Vimeo link does not point to a single video' };
    const hash = u.searchParams.get('h') || m[2] || undefined;
    if (hash && !/^[a-z0-9]{1,128}$/i.test(hash)) return { ok: false, reason: 'This Vimeo link is not valid' };
    return { ok: true, source: { provider: 'vimeo', id: m[1], canonicalUrl: `https://vimeo.com/${m[1]}${hash ? `/${hash}` : ''}`, ...(hash ? { hash } : {}) } };
  }

  // Facebook — only full video links can be given to Facebook's embedded player.
  if (host === 'fb.watch' || (FB_HOSTS.has(host) && /^\/share\//.test(u.pathname))) {
    return { ok: false, reason: 'Short or share links (fb.watch, facebook.com/share/…) cannot be embedded. Open the video on Facebook and copy its full address (facebook.com/…/videos/…).' };
  }
  if (FB_HOSTS.has(host)) {
    let id: string | null = null;
    let canonical = '';
    const videos = /^\/([A-Za-z0-9.\-_]+)\/videos\/(?:[^/]+\/)?(\d+)\/?$/.exec(u.pathname);
    if (videos) {
      id = videos[2];
      canonical = `https://www.facebook.com/${videos[1]}/videos/${id}/`;
    } else if ((u.pathname === '/watch' || u.pathname === '/watch/' || u.pathname === '/video.php') && u.searchParams.get('v')) {
      id = u.searchParams.get('v');
      canonical = `https://www.facebook.com/watch/?v=${id}`;
    } else {
      const reel = /^\/reel\/(\d+)\/?$/.exec(u.pathname);
      if (reel) {
        id = reel[1];
        canonical = `https://www.facebook.com/reel/${id}`;
      }
    }
    if (!id || !FB_ID.test(id)) return { ok: false, reason: 'This Facebook link is not a video link. Use the address of the video itself (facebook.com/…/videos/…, facebook.com/watch/?v=…, or facebook.com/reel/…).' };
    return { ok: true, source: { provider: 'facebook', id, canonicalUrl: canonical } };
  }

  if (FILE_RX.test(u.pathname)) return { ok: true, source: { provider: 'file', id: '', canonicalUrl: v } };
  const mp4 = cdnAsMp4(u);
  if (mp4) return { ok: true, source: { provider: 'file', id: '', canonicalUrl: mp4 } };
  return { ok: false, reason: SUPPORTED_HINT };
}

const clampStart = (s?: number | null) => (s && Number.isFinite(s) && s > 0 ? Math.min(Math.floor(s), 86_400) : 0);

/** Official click-to-play player URL (iframe) — null for direct files, which use <video>. */
export function embedUrlFor(source: ShowcaseSource, opts: { startAt?: number | null } = {}): string | null {
  const start = clampStart(opts.startAt);
  if (source.provider === 'youtube') {
    const p = new URLSearchParams({ autoplay: '1', rel: '0', modestbranding: '1', playsinline: '1' });
    if (start) p.set('start', String(start));
    return `https://www.youtube-nocookie.com/embed/${source.id}?${p}`;
  }
  if (source.provider === 'vimeo') {
    const p = new URLSearchParams({ autoplay: '1', dnt: '1', title: '0', byline: '0', portrait: '0' });
    if (source.hash) p.set('h', source.hash);
    return `https://player.vimeo.com/video/${source.id}?${p}${start ? `#t=${start}s` : ''}`;
  }
  if (source.provider === 'facebook') {
    const p = new URLSearchParams({ href: source.canonicalUrl, show_text: 'false', autoplay: 'true' });
    return `https://www.facebook.com/plugins/video.php?${p}`;
  }
  return null;
}

/** Direct file URL with an optional start time (media fragment). */
export function fileUrlFor(url: string, startAt?: number | null) {
  const start = clampStart(startAt);
  return start ? `${url.split('#')[0]}#t=${start}` : url;
}

/** Poster the provider itself serves for public videos (used only when the admin set none). */
export function providerPoster(source: ShowcaseSource): string {
  if (source.provider === 'youtube') return `https://i.ytimg.com/vi/${source.id}/hqdefault.jpg`;
  if (source.provider !== 'file' || source.canonicalUrl.startsWith('/')) return '';
  let u: URL;
  try {
    u = new URL(source.canonicalUrl);
  } catch {
    return '';
  }
  // ImageKit: a frame from the video itself, one second in (ImageKit's ik-thumbnail.jpg).
  if (isImageKit(u)) return `${u.origin}${u.pathname}/ik-thumbnail.jpg?tr=so-1`;
  // Cloudinary: the same file delivered as a JPEG frame at one second.
  if (isCloudinaryVideo(u)) return `${u.origin}${u.pathname.replace('/video/upload/', '/video/upload/so_1/').replace(/\.[a-z0-9]+$/i, '.jpg')}`;
  return '';
}
