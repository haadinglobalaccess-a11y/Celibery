import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { buildCsp, dsnOrigin } from '../server/src/lib/csp';
import { isBot } from '../server/src/modules/seo/bots';

/**
 * Writes the production Content-Security-Policy into index.html (Vercel serves the storefront as
 * static files). The policy comes from server/src/lib/csp.ts — the same source the Express server
 * uses — so both deployments enforce one policy. Header-only directives (frame-ancestors) are sent
 * by vercel.json. Only applied to builds: the Vite dev server needs inline scripts for hot reload.
 */
function cspPlugin(mode: string): Plugin {
  const env = { ...loadEnv(mode, path.resolve(__dirname, '..'), ''), ...process.env };
  let uploadOrigin: string | null = null;
  if (env.MEDIA_STORAGE === 's3' && env.S3_ENDPOINT) {
    try {
      const e = new URL(env.S3_ENDPOINT);
      uploadOrigin = env.S3_FORCE_PATH_STYLE === 'true' ? e.origin : `${e.protocol}//${env.S3_BUCKET}.${e.host}`;
    } catch {
      uploadOrigin = null;
    }
  }
  const apiOrigin = env.VITE_API_BASE_URL ? new URL(env.VITE_API_BASE_URL).origin : null;
  const policy = buildCsp({ connectSrc: [uploadOrigin, apiOrigin, dsnOrigin(env.VITE_SENTRY_DSN), env.CSP_CONNECT_SRC], headerOnlyDirectives: false });
  return {
    name: 'celibery-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

/**
 * Opens the connections the first page needs while the HTML is still being parsed: the API (when it is
 * on another origin) and the Cloudinary image CDN. Without this the browser only starts DNS + TCP + TLS
 * to those hosts after the JavaScript has downloaded and run (measured 16 Nov 2026: API requests began
 * ~2.1 s into a desktop load). Credentialed fetches use the default connection pool, so the API hint
 * has no `crossorigin` attribute; image requests are no-cors, likewise.
 */
function preconnectPlugin(mode: string): Plugin {
  const env = { ...loadEnv(mode, path.resolve(__dirname, '..'), ''), ...process.env };
  const origins = new Set<string>(['https://res.cloudinary.com']);
  if (env.VITE_API_BASE_URL) {
    try {
      origins.add(new URL(env.VITE_API_BASE_URL).origin);
    } catch {
      /* invalid URL: the API client fails loudly elsewhere */
    }
  }
  if (env.MEDIA_PUBLIC_BASE_URL) {
    try {
      origins.add(new URL(env.MEDIA_PUBLIC_BASE_URL).origin);
    } catch {
      /* ignore */
    }
  }
  const tags = [...origins].map((o) => `<link rel="preconnect" href="${o}" />`).join('\n    ');
  return {
    name: 'celibery-preconnect',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<link rel="preconnect" href="https://fonts.googleapis.com" />', `${tags}\n    <link rel="preconnect" href="https://fonts.googleapis.com" />`),
  };
}

/**
 * `vite preview` (the Railway storefront service) sends `Cache-Control: no-cache` for everything, so
 * every visit re-validated every bundle (verified 13 Nov 2026). Files under /assets/ carry a content
 * hash in their name and never change: browsers and CDNs may keep them for a year. Everything else
 * (index.html, brand images) keeps no-cache so a deploy is picked up immediately.
 */
function immutableAssetsPlugin(): Plugin {
  return {
    name: 'celibery-immutable-assets',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/assets/')) {
          const setHeader = res.setHeader.bind(res);
          // sirv sets its own Cache-Control afterwards: keep ours for hashed assets.
          res.setHeader = (name: string, value: number | string | readonly string[]) =>
            name.toLowerCase() === 'cache-control' ? res : setHeader(name, value);
          setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
        next();
      });
    },
  };
}

/**
 * Railway runs the storefront (`vite preview`) and the API as two services. The SEO files and the
 * pages rendered for crawlers are made by the API (server/src/modules/seo/prerender.ts), but crawlers
 * request them from the storefront domain, where `vite preview` answered every path with the empty
 * index.html (verified 27 Nov 2026: sitemap.xml empty, crawlers saw a blank page, no 404s).
 *
 * This forwards to the API: /sitemap.xml, /robots.txt, /llms.txt, /llms-full.txt always, and the
 * storefront pages (/, /ar…, /en…) only for crawlers (modules/seo/bots.ts). People are never
 * forwarded. If the API fails, crawlers get the normal storefront page instead.
 */
function seoForwardPlugin(mode: string): Plugin {
  const env = { ...loadEnv(mode, path.resolve(__dirname, '..'), ''), ...process.env };
  let api: string | null = null;
  try {
    api = env.VITE_API_BASE_URL ? new URL(env.VITE_API_BASE_URL).origin : null;
  } catch {
    api = null;
  }
  const FILES = /^\/(?:sitemap\.xml|robots\.txt|llms\.txt|llms-full\.txt)$/;
  const PAGES = /^\/(?:(?:ar|en)(?:\/.*)?)?$/;
  return {
    name: 'celibery-seo-forward',
    configurePreviewServer(server) {
      if (!api) return; // one service (SERVE_CLIENT) or Vercel: nothing to forward
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '/';
        const p = url.split('?')[0];
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const file = FILES.test(p);
        const page = !file && PAGES.test(p) && isBot(req.headers['user-agent']);
        if (!file && !page) return next();
        try {
          const r = await fetch(api + url, {
            method: req.method,
            headers: { 'user-agent': String(req.headers['user-agent'] ?? ''), accept: String(req.headers.accept ?? '*/*') },
            redirect: 'manual',
            signal: AbortSignal.timeout(8000),
          });
          if (page && r.status >= 500) return next();
          res.statusCode = r.status;
          for (const h of ['content-type', 'cache-control', 'x-robots-tag', 'location']) {
            const v = r.headers.get(h);
            if (v) res.setHeader(h, v);
          }
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.end(req.method === 'HEAD' ? undefined : Buffer.from(await r.arrayBuffer()));
        } catch {
          next();
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), cspPlugin(mode), preconnectPlugin(mode), immutableAssetsPlugin(), seoForwardPlugin(mode)],
  envDir: '..',
  preview: {
    allowedHosts: ['celiberyclient-production.up.railway.app'],
    // The Railway storefront service is served by `vite preview`, which sends no security headers
    // by default (verified 11 Nov 2026). Same header set as vercel.json: the page — including
    // /admin — cannot be framed (clickjacking), HTTPS is pinned, MIME sniffing is off.
    headers: {
      'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(self)',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/sitemap.xml': 'http://localhost:4000',
      '/robots.txt': 'http://localhost:4000',
      '/llms.txt': 'http://localhost:4000',
      // Uploaded media when MEDIA_STORAGE=local.
      '/media': 'http://localhost:4000',
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: { react: ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
}));
