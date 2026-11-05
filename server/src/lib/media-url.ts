/**
 * Validation and classification of external media URLs entered by administrators.
 * The server never downloads these URLs (no SSRF surface); it only checks their shape so the
 * storefront knows how to render them. Pure module, unit tested.
 * The storefront has a matching copy in client/src/lib/media.ts — keep both in sync.
 */
export type VideoSource =
  | { type: 'file'; url: string }
  | { type: 'youtube'; id: string; embedUrl: string }
  | { type: 'vimeo'; id: string; embedUrl: string };

export type UrlCheck = { ok: true } | { ok: false; reason: string };

export function checkMediaUrl(raw: string): UrlCheck {
  const v = raw.trim();
  if (!v) return { ok: false, reason: 'URL is empty' };
  if (v.length > 2000) return { ok: false, reason: 'URL is too long' };
  if (/[\s"'<>`]/.test(v)) return { ok: false, reason: 'URL contains invalid characters' };
  if (v.startsWith('/') && !v.startsWith('//')) return { ok: true }; // file served by this site
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { ok: false, reason: 'Not a valid URL' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'Only secure https:// links are accepted' };
  if (u.username || u.password) return { ok: false, reason: 'Links with embedded usernames/passwords are not accepted' };
  return { ok: true };
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;

/** Decides how a video URL can be played, or returns null when it is not a supported source. */
export function classifyVideoUrl(raw: string): VideoSource | null {
  const v = raw.trim();
  if (!checkMediaUrl(v).ok) return null;
  if (v.startsWith('/')) return /\.(mp4|webm)$/i.test(v.split('?')[0]) ? { type: 'file', url: v } : null;
  const u = new URL(v);
  const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  let yt: string | null = null;
  if (host === 'youtu.be') yt = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') yt = u.searchParams.get('v');
    else {
      const m = /^\/(?:embed|shorts|live)\/([^/?#]+)/.exec(u.pathname);
      if (m) yt = m[1];
    }
  }
  if (yt) {
    if (!YT_ID.test(yt)) return null;
    const params = new URLSearchParams({ autoplay: '1', mute: '1', loop: '1', playlist: yt, controls: '0', playsinline: '1', rel: '0', modestbranding: '1' });
    return { type: 'youtube', id: yt, embedUrl: `https://www.youtube-nocookie.com/embed/${yt}?${params}` };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = /^\/(?:video\/)?(\d+)/.exec(u.pathname);
    if (!m || !VIMEO_ID.test(m[1])) return null;
    const hash = u.searchParams.get('h') || /^\/(?:video\/)?\d+\/([a-z0-9]+)(?:\/|$)/i.exec(u.pathname)?.[1];
    if (hash && !/^[a-z0-9]{1,128}$/i.test(hash)) return null;
    const params = new URLSearchParams({ background: '1', autoplay: '1', muted: '1', loop: '1', dnt: '1' });
    if (hash) params.set('h', hash);
    return { type: 'vimeo', id: m[1], embedUrl: `https://player.vimeo.com/video/${m[1]}?${params}` };
  }
  if (/\.(mp4|webm)$/i.test(u.pathname)) return { type: 'file', url: v };
  return null;
}

export function videoUrlError(raw: string): string | null {
  if (!raw.trim()) return null;
  const c = checkMediaUrl(raw);
  if (!c.ok) return c.reason;
  return classifyVideoUrl(raw) ? null : 'Use a direct .mp4/.webm file link, a YouTube link or a Vimeo link';
}
