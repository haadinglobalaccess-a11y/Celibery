import { Router } from 'express';
import { z } from 'zod';
import { text } from './admin.schemas';
import { audit } from '../../lib/audit';
import { ah, ok } from '../../lib/http';
import { toHalalas } from '../../lib/money';
import { env } from '../../config/env';
import { forbidden } from '../../lib/errors';
import { requireAnyPermission, requirePermission } from '../../middleware/auth';
import { storageStatus } from '../../integrations/storage';
import { channelStatus } from '../../integrations/credentials';
import { q, validate } from '../../middleware/validate';
import { AuditLog, Notification, Settings, getSettings } from '../../models';
import { emailConfigured, whatsappConfigured } from '../../integrations/notifications';
import { gatewayDiagnostics } from '../payments/payment.service';
import { releaseExpiredReservations } from '../orders/order.service';
import { canonicalCity } from '../orders/delivery-rules';
import { reportQuery } from './admin.schemas';
import * as reports from './reports.service';

const loc = z.object({ ar: text(5000).default(''), en: text(5000).default('') });
const str = (max = 300) => text(max);
const urlish = z.string().trim().max(1000).refine((v) => v === '' || /^https?:\/\//.test(v) || v.startsWith('/'), 'Must be a URL');
const hex = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #1A2B3C');

/** One delivery zone as entered in the admin (money in SAR). */
const shippingZoneInput = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/, 'Use 2–40 lowercase letters, numbers or -'),
  name: loc,
  active: z.boolean().default(true),
  cities: z.array(z.string().trim().min(1).max(60)).min(1, 'Add at least one city').max(300),
  freeDelivery: z.boolean().default(false),
  deliveryFee: z.number().min(0).max(1000).default(0),
  freeDeliveryThreshold: z.number().min(0).max(1_000_000).nullable().default(null),
  codEnabled: z.boolean().default(true),
  codFee: z.number().min(0).max(1000).nullable().default(null),
  estimatedDelivery: loc.default({ ar: '', en: '' }),
});

/** Zone keys are unique and a city belongs to at most one active zone (otherwise pricing is ambiguous). */
function zonesConsistent(zones: z.infer<typeof shippingZoneInput>[], ctx: z.RefinementCtx) {
  const keys = new Set<string>();
  const owner = new Map<string, string>();
  zones.forEach((zone, i) => {
    if (keys.has(zone.key)) ctx.addIssue({ code: 'custom', path: [i, 'key'], message: `Zone key "${zone.key}" is used twice` });
    keys.add(zone.key);
    if (!zone.active) return;
    for (const city of zone.cities) {
      const n = canonicalCity(city);
      const other = owner.get(n);
      if (other && other !== zone.key) ctx.addIssue({ code: 'custom', path: [i, 'cities'], message: `${city} is already in zone "${other}"` });
      else owner.set(n, zone.key);
    }
  });
}

/** Every field optional: the admin sends only the section it edits. Money inputs are in SAR. */
const settingsUpdate = z
  .object({
    business: z
      .object({
        name: loc,
        description: loc,
        legalName: loc,
        address: loc,
        crNumber: str(40),
        vatNumber: z.string().trim().regex(/^(3\d{13}3)?$/, 'Saudi VAT numbers are 15 digits starting and ending with 3'),
        sbcVerified: z.boolean(),
        sbcVerificationUrl: urlish,
        sbcBadgeImageUrl: urlish,
        email: z.string().trim().email().or(z.literal('')),
        phone: str(30),
        whatsappNumber: z.string().trim().regex(/^(\+?\d{8,15})?$/, 'International format, e.g. 9665XXXXXXXX'),
        supportHours: loc,
        social: z.object({ instagram: urlish, tiktok: urlish, snapchat: urlish, x: urlish, youtube: urlish, facebook: urlish }).partial(),
      })
      .partial(),
    brand: z.object({ accentColor: hex, logoUrl: urlish, logoDarkUrl: urlish }).partial(),
    commerce: z
      .object({
        vatRatePercent: z.number().min(0).max(100),
        freeDelivery: z.boolean(),
        deliveryFee: z.number().min(0).max(1000),
        freeDeliveryThreshold: z.number().min(0).max(1_000_000).nullable(),
        shippingAvailable: z.boolean(),
        shippingUnavailableMessage: loc,
        // 'api' stays refused until an I Mile API integration exists and is tested.
        fulfilmentMode: z.literal('manual'),
        courierName: str(80),
        courierTrackingUrlTemplate: urlish,
        estimatedDelivery: loc,
        warrantyEnabled: z.boolean(),
        warrantyMonths: z.number().int().min(0).max(120),
        codEnabled: z.boolean(),
        codFee: z.number().min(0).max(1000),
        codMaxOrderTotal: z.number().min(0).max(1_000_000).nullable(),
        codMinOrderTotal: z.number().min(0).max(1_000_000).nullable(),
        codAllowedCities: z.array(z.string().trim().min(1).max(60)).max(200),
        lowStockThreshold: z.number().int().min(0).max(10000),
        reservationMinutes: z.number().int().min(5).max(1440),
        maxQuantityPerItem: z.number().int().min(1).max(99),
        shippingZones: z.array(shippingZoneInput).max(50).superRefine(zonesConsistent),
        deliverToUnlistedCities: z.boolean(),
        returnsEnabled: z.boolean(),
        returnWindowDays: z.number().int().min(0).max(365),
      })
      .partial(),
    payments: z.object({ card: z.boolean(), applepay: z.boolean(), stcpay: z.boolean(), tabby: z.boolean() }).partial(),
    notifications: z.object({ emailOrderUpdates: z.boolean(), whatsappOrderUpdates: z.boolean() }).partial(),
    announcement: z.object({ enabled: z.boolean(), text: loc, link: urlish }).partial(),
    homepage: z
      .object({
        heroEnabled: z.boolean(),
        heroSortOrder: z.number().int(),
        heroDurationSec: z.number().finite().positive(),
        heroVideoDurationSec: z.number().finite().nonnegative(),
        heroVideoFallbackSec: z.number().min(2).max(300),
        heroDescription: loc,
        heroVideoUrl: urlish,
        heroPosterUrl: urlish,
        heroMobileVideoUrl: urlish,
        heroMobilePosterUrl: urlish,
        heroTitle: loc,
        heroSubtitle: loc,
        heroCtaLabel: loc,
        heroCtaLink: urlish,
        brandStory: loc,
        brandStoryImageUrl: urlish,
        newsletterEnabled: z.boolean(),
      })
      .partial(),
    reviews: z.object({ enabled: z.boolean() }).partial(),
    checkoutRecovery: z.object({ enabled: z.boolean(), abandonAfterMinutes: z.number().int().min(5).max(10080), retentionDays: z.number().int().min(1).max(365) }).partial(),
    seo: z.object({ title: loc, description: loc, allowAiCrawlers: z.boolean() }).partial(),
  })
  .partial();

/** Flattens nested input into dotted $set paths so sections merge instead of replacing. */
function toSetPaths(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    const isLocalized = v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every((x) => x === 'ar' || x === 'en');
    if (v && typeof v === 'object' && !Array.isArray(v) && !isLocalized) Object.assign(out, toSetPaths(v as Record<string, unknown>, key));
    else out[key] = v;
  }
  return out;
}

export const adminSystemRoutes = Router();

adminSystemRoutes.get(
  '/overview',
  requirePermission('overview:read'),
  ah(async (_req, res) => {
    void releaseExpiredReservations(20).catch(() => undefined);
    return ok(res, await reports.overview());
  }),
);

adminSystemRoutes.get(
  '/reports/sales',
  requirePermission('reports:read'),
  validate(reportQuery, 'query'),
  ah(async (req, res) => {
    const query = q(req, reportQuery);
    return ok(res, await reports.salesReport(query.from, query.to));
  }),
);

adminSystemRoutes.get(
  '/reports/orders.csv',
  requirePermission('reports:read'),
  validate(reportQuery, 'query'),
  ah(async (req, res) => {
    const query = q(req, reportQuery);
    const csv = await reports.ordersCsv(query.from, query.to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="celibery-orders-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('\ufeff' + csv); // BOM so Excel opens Arabic text correctly
  }),
);

/** Legal identity fields: editable only with `business:write` (Q29/Q30). */
const LEGAL_FIELDS = ['legalName', 'crNumber', 'vatNumber', 'sbcVerified', 'sbcVerificationUrl', 'sbcBadgeImageUrl'];
const MONEY_FIELDS = ['deliveryFee', 'codFee', 'codMaxOrderTotal', 'codMinOrderTotal', 'freeDeliveryThreshold'];

/** Documented hosting regions (read-only: moving data is an infrastructure migration, Q33). */
function hostingInfo() {
  const undocumented = 'Not documented yet — the developer sets this on the server';
  return {
    appRegion: env.APP_REGION || undocumented,
    databaseRegion: env.DATABASE_REGION || undocumented,
    mediaRegion: env.MEDIA_REGION || (env.MEDIA_STORAGE === 'local' ? 'Same server as the website (local disk)' : undocumented),
    mediaStorage: storageStatus(),
  };
}

adminSystemRoutes.get(
  '/settings',
  requireAnyPermission('settings:write', 'business:write', 'payments:manage'),
  ah(async (_req, res) =>
    ok(res, {
      settings: await getSettings(),
      integrations: {
        ...gatewayDiagnostics(),
        emailConfigured: emailConfigured(),
        whatsappConfigured: whatsappConfigured(),
        // Q28: status of the configuration saved in the admin (not environment variables).
        email: await channelStatus('smtp'),
        whatsapp: await channelStatus('whatsapp'),
      },
      hosting: hostingInfo(),
    }),
  ),
);

adminSystemRoutes.put(
  '/settings',
  requireAnyPermission('settings:write', 'business:write'),
  validate(settingsUpdate),
  ah(async (req, res) => {
    const body = structuredClone(req.body) as z.infer<typeof settingsUpdate>;
    // Permission split (enforced here, not only by hiding tabs in the dashboard).
    const perms = req.user!.permissions;
    const legalKeys = Object.keys(body.business ?? {}).filter((k) => LEGAL_FIELDS.includes(k));
    const otherSections = Object.keys(body).filter((k) => k !== 'business');
    const otherBusiness = Object.keys(body.business ?? {}).filter((k) => !LEGAL_FIELDS.includes(k));
    if (legalKeys.length && !perms.has('business:write')) throw forbidden('Changing legal & business identity requires the business:write permission');
    if ((otherSections.length || otherBusiness.length) && !perms.has('settings:write')) throw forbidden();

    const c = body.commerce as Record<string, unknown> | undefined;
    if (c) for (const k of MONEY_FIELDS) if (typeof c[k] === 'number') c[k] = toHalalas(c[k] as number);
    if (c && Array.isArray(c.shippingZones)) {
      c.shippingZones = (c.shippingZones as Record<string, unknown>[]).map((zone) => {
        const out: Record<string, unknown> = { ...zone, deliveryFee: toHalalas(zone.deliveryFee as number) };
        for (const k of ['freeDeliveryThreshold', 'codFee']) {
          if (typeof zone[k] === 'number') out[k] = toHalalas(zone[k] as number);
          else delete out[k]; // null = not set: no threshold / store-wide COD fee
        }
        return out;
      });
    }
    await getSettings();
    const set = toSetPaths(body as Record<string, unknown>);
    const unset: Record<string, 1> = {};
    for (const [k, v] of Object.entries(set)) if (v === null) (unset[k] = 1), delete set[k];
    const updated = await Settings.findOneAndUpdate({ key: 'store' }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { new: true, runValidators: true }).lean();
    const changed = [...Object.keys(set), ...Object.keys(unset)];
    await audit(req, legalKeys.length ? 'update_legal' : 'update', 'settings', 'store', changed.join(', '));
    return ok(res, updated);
  }),
);

adminSystemRoutes.get(
  '/audit',
  requirePermission('audit:read'),
  ah(async (_req, res) => ok(res, await AuditLog.find().sort({ createdAt: -1 }).limit(300).lean())),
);

adminSystemRoutes.get(
  '/notifications',
  requirePermission('orders:read'),
  ah(async (_req, res) => ok(res, await Notification.find().sort({ createdAt: -1 }).limit(200).lean())),
);
