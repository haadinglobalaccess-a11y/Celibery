/**
 * Content Security Policy — single source of truth used by:
 *  - the Express server (single-server deployments and the API) — server/src/app.ts;
 *  - the Vite build, which writes the policy into index.html for Vercel — client/vite.config.ts;
 *  - vercel.json (header-only directives: frame-ancestors, report-uri).
 *
 * Built from what the storefront and admin actually load (audited 3 Nov 2026):
 *  - scripts: own bundles and official YouTube/Vimeo player SDKs (no inline scripts or eval);
 *  - styles: own CSS + Google Fonts stylesheet (React style props use CSSOM, which CSP allows);
 *  - fonts: Google Fonts files;
 *  - images / video: own files, data:/blob: previews in the admin, and any https:// source because
 *    administrators may use external image/video URLs (media cannot execute script);
 *  - frames: YouTube (privacy-enhanced domain) and Vimeo players for hero/banner videos only;
 *  - connections: own API, plus the media bucket origin for direct admin uploads;
 *  - payments use full-page redirects to the gateway's hosted page, so no gateway origin is needed.
 * No dependencies — unit tested.
 */
export type CspOptions = {
  /** Extra origins for fetch/XHR (media bucket, separate API host…). */
  connectSrc?: (string | null | undefined)[];
  /** Report endpoint (header-only directive). */
  reportUri?: string;
  /** false for <meta> delivery, which ignores frame-ancestors / report-uri. */
  headerOnlyDirectives?: boolean;
  upgradeInsecureRequests?: boolean;
};

export const CSP_SOURCES = {
  fontsCss: 'https://fonts.googleapis.com',
  fontsFiles: 'https://fonts.gstatic.com',
  playerScripts: ['https://www.youtube.com', 'https://s.ytimg.com', 'https://player.vimeo.com'],
  frames: ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
};

const ORIGIN = /^https:\/\/[a-z0-9.-]+(?::\d{2,5})?$|^https:\/\/\*\.[a-z0-9.-]+$/i;

/** Only well-formed https origins are accepted for extra sources (no paths, no wildcards alone, no keywords). */
export function sanitizeOrigins(list: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const raw of list) {
    for (const part of String(raw ?? '').split(/[\s,]+/)) {
      const v = part.trim().replace(/\/$/, '');
      if (v && ORIGIN.test(v)) out.add(v.toLowerCase());
    }
  }
  return [...out];
}

export function cspDirectives(opts: CspOptions = {}): Record<string, string[]> {
  const d: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", ...CSP_SOURCES.playerScripts],
    'style-src': ["'self'", CSP_SOURCES.fontsCss],
    'font-src': ["'self'", CSP_SOURCES.fontsFiles, 'data:'],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'media-src': ["'self'", 'blob:', 'https:'],
    'connect-src': ["'self'", ...sanitizeOrigins(opts.connectSrc ?? [])],
    'frame-src': [...CSP_SOURCES.frames],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  };
  if (opts.headerOnlyDirectives !== false) {
    d['frame-ancestors'] = ["'none'"];
    if (opts.reportUri) d['report-uri'] = [opts.reportUri];
  }
  if (opts.upgradeInsecureRequests !== false) d['upgrade-insecure-requests'] = [];
  return d;
}

export function buildCsp(opts: CspOptions = {}): string {
  return Object.entries(cspDirectives(opts))
    .map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k))
    .join('; ');
}

/** Strict policy for JSON API responses (nothing to render). */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** Policy for user-uploaded files served from this origin (/media): never executable. */
export const MEDIA_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";
