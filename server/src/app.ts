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
import { apiLimiter, csrfGuard, rejectOperatorKeys } from './middleware/security';
import { securityEvent } from './lib/security-log';
import { accountRoutes } from './modules/account/account.routes';
import { adminRoutes } from './modules/admin';
import { authRoutes } from './modules/auth/auth.routes';
import { llms, robots, sitemap } from './modules/catalog/catalog.controller';
import { catalogRoutes } from './modules/catalog/catalog.routes';
import { orderRoutes } from './modules/orders/order.routes';
import { draftRoutes } from './modules/checkout-drafts/draft.routes';
import { paymentRoutes } from './modules/payments/payment.routes';
import { metricsSnapshot, requestMetrics } from './lib/metrics';
import { bumpPublicCacheVersion } from './lib/public-cache';
import { databaseGate } from './middleware/db-gate';
import type { NextFunction, Request, Response } from 'express';

/**
 * Any successful admin change (product, price, banner, settings, FAQ…) invalidates the public
 * cache on every instance BEFORE the success response is sent, so the storefront never shows the
 * previous version after the admin's save completes (lib/public-cache.ts).
 */
function invalidatePublicCacheOnAdminWrite(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  let bumped = false;
  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 400) return json(body);
    bumped = true;
    void bumpPublicCacheVersion().finally(() => json(body));
    return res;
  }) as Response['json'];
  // Responses that do not go through res.json (e.g. res.send / redirects): bump afterwards.
  res.on('finish', () => {
    if (!bumped && res.statusCode < 400) void bumpPublicCacheVersion();
  });
  next();
}

export function createApp(opts: { serveClient?: string } = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestMetrics);
  // Exactly the number of proxies in front of the app (TRUST_PROXY_HOPS): req.ip is then the real
  // client address and a forged X-Forwarded-For cannot dodge per-IP rate limits.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

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

  // Readiness (load balancers / deploy health checks): 503 while the database is unreachable.
  app.get('/api/health', (_req, res) => ok(res, { status: databaseReady() ? 'ok' : 'unavailable', time: new Date().toISOString() }, databaseReady() ? 200 : 503));
  // Liveness: the process is up and serving, whatever the database state (restart only if this fails).
  app.get('/api/health/live', (_req, res) => ok(res, { status: 'ok' }));
  // Operational metrics for monitoring/alerting. Disabled (404) unless METRICS_TOKEN is set.
  app.get('/api/health/metrics', (req, res, next) => {
    if (!env.METRICS_TOKEN) return next();
    if (!safeEqual(req.get('authorization') ?? '', `Bearer ${env.METRICS_TOKEN}`)) {
      securityEvent('metrics.bad_token', req);
      return next(forbidden());
    }
    return ok(res, metricsSnapshot());
  });
  app.get('/sitemap.xml', databaseGate, ah(sitemap));
  app.get('/robots.txt', databaseGate, ah(robots));
  app.get('/llms.txt', databaseGate, ah(llms));

  // databaseGate first: during a database outage requests fail fast (or serve cached public pages).
  app.use('/api', databaseGate, apiLimiter, csrfGuard, rejectOperatorKeys, integrationsMiddleware, loadUser);

  // Scheduled job (Vercel Cron sends Authorization: Bearer <CRON_SECRET>).
  app.get(
    '/api/cron/release-reservations',
    ah(async (req, res) => {
      const auth = req.get('authorization') ?? '';
      if (!env.CRON_SECRET || !safeEqual(auth, `Bearer ${env.CRON_SECRET}`)) {
        securityEvent('cron.bad_secret', req);
        throw forbidden();
      }
      return ok(res, await runReservationJob());
    }),
  );
  // Refunds whose gateway outcome was uncertain, and abandoned media uploads.
  app.get(
    '/api/cron/maintenance',
    ah(async (req, res) => {
      const auth = req.get('authorization') ?? '';
      if (!env.CRON_SECRET || !safeEqual(auth, `Bearer ${env.CRON_SECRET}`)) {
        securityEvent('cron.bad_secret', req);
        throw forbidden();
      }
      return ok(res, await runMaintenanceJob());
    }),
  );

  app.use('/api/auth', authRoutes);
  app.use('/api', paymentRoutes);
  app.use('/api', catalogRoutes);
  app.use('/api', draftRoutes);
  app.use('/api', orderRoutes);
  app.use('/api/me', accountRoutes);
  app.use('/api/admin', invalidatePublicCacheOnAdminWrite, adminRoutes);
  app.use('/api', notFoundHandler);

  // Optional: serve the built storefront (single-server deployments and E2E tests).
  if (opts.serveClient && fs.existsSync(opts.serveClient)) {
    const dir = opts.serveClient;
    // Hashed bundles (/assets/*) never change: cache for a year. index.html and unhashed files are
    // revalidated, so a deploy is picked up at once (a cached index.html could reference bundles that
    // a new deploy removed).
    app.use(
      express.static(dir, {
        index: false,
        setHeaders: (res, file) => {
          res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      }),
    );
    app.get('*', (_req, res) => res.sendFile(path.join(dir, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
