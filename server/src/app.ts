import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { corsOrigins, env, isProd } from './config/env';
import { API_CSP, MEDIA_CSP, buildCsp } from './lib/csp';
import { integrationsMiddleware } from './integrations/credentials';
import { localDir, uploadOrigin } from './integrations/storage';
import { forbidden } from './lib/errors';
import { databaseReady } from './db/connect';
import { runMaintenanceJob, runReservationJob } from './jobs';
import { ah, ok } from './lib/http';
import { safeEqual } from './lib/tokens';
import { loadUser } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import { apiLimiter, csrfGuard } from './middleware/security';
import { accountRoutes } from './modules/account/account.routes';
import { adminRoutes } from './modules/admin';
import { authRoutes } from './modules/auth/auth.routes';
import { llms, robots, sitemap } from './modules/catalog/catalog.controller';
import { catalogRoutes } from './modules/catalog/catalog.routes';
import { orderRoutes } from './modules/orders/order.routes';
import { paymentRoutes } from './modules/payments/payment.routes';

export function createApp(opts: { serveClient?: string } = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Content-Security-Policy (lib/csp.ts — the same policy is written into index.html at build time
  // and sent by Vercel for the static site). JSON API responses get an even stricter policy.
  const siteCsp = buildCsp({
    connectSrc: [uploadOrigin(), env.CSP_CONNECT_SRC],
    reportUri: env.CSP_REPORT_URI || undefined,
    upgradeInsecureRequests: isProd,
  });
  app.use(
    helmet({
      contentSecurityPolicy: false, // set below: one policy for pages, a stricter one for the API
      crossOriginResourcePolicy: { policy: 'same-site' },
      strictTransportSecurity: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', req.path.startsWith('/api/') ? API_CSP : siteCsp);
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
    next();
  });
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || corsOrigins.includes(origin)),
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-Requested-With', 'X-Celibery-Webhook-Secret', 'Authorization'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  // Session, order and admin responses must never be cached by shared intermediaries.
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  // Uploaded media on local disk (development / single server with a persistent disk only).
  // Served as inert files: no script execution, no MIME sniffing, sandboxed.
  if (env.MEDIA_STORAGE === 'local') {
    app.use(
      '/media',
      express.static(path.join(localDir(), 'media'), {
        index: false,
        dotfiles: 'deny',
        fallthrough: false,
        maxAge: '365d',
        immutable: true,
        setHeaders: (res) => {
          res.setHeader('Content-Security-Policy', MEDIA_CSP);
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
        },
      }),
    );
  }
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => ok(res, { status: databaseReady() ? 'ok' : 'unavailable', time: new Date().toISOString() }, databaseReady() ? 200 : 503));
  app.get('/sitemap.xml', ah(sitemap));
  app.get('/robots.txt', ah(robots));
  app.get('/llms.txt', ah(llms));

  app.use('/api', apiLimiter, csrfGuard, integrationsMiddleware, loadUser);

  // Scheduled job (Vercel Cron sends Authorization: Bearer <CRON_SECRET>).
  app.get(
    '/api/cron/release-reservations',
    ah(async (req, res) => {
      const auth = req.get('authorization') ?? '';
      if (!env.CRON_SECRET || !safeEqual(auth, `Bearer ${env.CRON_SECRET}`)) throw forbidden();
      return ok(res, await runReservationJob());
    }),
  );
  // Refunds whose gateway outcome was uncertain, and abandoned media uploads.
  app.get(
    '/api/cron/maintenance',
    ah(async (req, res) => {
      const auth = req.get('authorization') ?? '';
      if (!env.CRON_SECRET || !safeEqual(auth, `Bearer ${env.CRON_SECRET}`)) throw forbidden();
      return ok(res, await runMaintenanceJob());
    }),
  );

  app.use('/api/auth', authRoutes);
  app.use('/api', paymentRoutes);
  app.use('/api', catalogRoutes);
  app.use('/api', orderRoutes);
  app.use('/api/me', accountRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', notFoundHandler);

  // Optional: serve the built storefront (single-server deployments and E2E tests).
  if (opts.serveClient && fs.existsSync(opts.serveClient)) {
    const dir = opts.serveClient;
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dir, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
