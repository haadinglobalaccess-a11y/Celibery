import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { buildCsp } from '../server/src/lib/csp';

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
  const policy = buildCsp({ connectSrc: [uploadOrigin, apiOrigin, env.CSP_CONNECT_SRC], headerOnlyDirectives: false });
  return {
    name: 'celibery-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
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

export default defineConfig(({ mode }) => ({
  plugins: [react(), cspPlugin(mode), immutableAssetsPlugin()],
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
