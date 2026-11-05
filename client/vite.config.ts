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

export default defineConfig(({ mode }) => ({
  plugins: [react(), cspPlugin(mode)],
  envDir: '..',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/sitemap.xml': 'http://localhost:4000',
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
