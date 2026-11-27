import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { buildKeyRing } from '../lib/secrets';

// Load the shared .env at the repository root (and a server-local one if present).
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  PUBLIC_SITE_URL: z.string().url().default('http://localhost:5173'),
  /**
   * Public HTTPS origin of the API when it is NOT served from PUBLIC_SITE_URL (storefront and API as
   * two services). Payment gateways deliver webhooks here. Empty = same origin as PUBLIC_SITE_URL.
   */
  PUBLIC_API_URL: z.union([z.literal(''), z.string().url()]).default(''),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  MONGODB_URI: z.string().default(''),
  MONGODB_DB_NAME: z.string().default('celibery'),
  JWT_SECRET: z.string().default(''),
  SESSION_TTL_HOURS: z.coerce.number().positive().max(8760).default(168),
  COOKIE_SECURE: bool(false),
  /**
   * SameSite of the session cookie. Empty = "none" in production (storefront and API on different
   * sites, e.g. two *.up.railway.app services) and "lax" otherwise. Set "lax" when the store and
   * API share one origin (Vercel, or SERVE_CLIENT=1) — the stronger setting.
   */
  COOKIE_SAMESITE: z.enum(['', 'lax', 'strict', 'none']).default(''),
  /** Long-running servers run the scheduled jobs in-process; set true when an external cron calls /api/cron/*. */
  DISABLE_INTERNAL_SCHEDULER: bool(false),
  PAYMENT_GATEWAY: z.enum(['sandbox', 'moyasar']).default('sandbox'),
  ALLOW_SANDBOX_PAYMENTS: bool(false),
  MOYASAR_SECRET_KEY: z.string().default(''),
  MOYASAR_PUBLISHABLE_KEY: z.string().default(''),
  MOYASAR_WEBHOOK_SECRET: z.string().default(''),
  TABBY_SECRET_KEY: z.string().default(''),
  TABBY_PUBLIC_KEY: z.string().default(''),
  TABBY_MERCHANT_CODE: z.string().default(''),
  TABBY_WEBHOOK_SECRET: z.string().default(''),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  /** Legacy fallback only (Admin → Settings → Notifications is the primary place). No built-in sender address. */
  EMAIL_FROM: z.string().default(''),
  /** Resend API key (HTTPS email) — for hosts that block SMTP, e.g. Railway's Hobby plan. Uses EMAIL_FROM as the sender. */
  RESEND_API_KEY: z.string().default(''),
  /** Optional reply-to address for the Resend fallback. */
  EMAIL_REPLY_TO: z.string().default(''),
  WHATSAPP_ACCESS_TOKEN: z.string().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_ORDER_TEMPLATE: z.string().default('order_update'),
  WHATSAPP_TEMPLATE_LANG_AR: z.string().default('ar'),
  WHATSAPP_TEMPLATE_LANG_EN: z.string().default('en'),
  CRON_SECRET: z.string().default(''),

  // ---- Security hardening ------------------------------------------------------------------
  /**
   * Number of reverse-proxy hops in front of the app (Express "trust proxy"). 1 = Vercel or
   * Railway edge only. Use 2 when a CDN/WAF such as Cloudflare sits in front of Railway. Too high a
   * value lets clients spoof X-Forwarded-For and evade per-IP rate limits.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  /** Where rate-limit counters live: "mongo" (shared by every instance) or "memory" (one process only). */
  RATE_LIMIT_STORE: z.enum(['mongo', 'memory']).default('mongo'),
  /** When true, staff accounts must enrol two-factor authentication before using the admin. */
  STAFF_MFA_REQUIRED: z.string().optional(),
  /** Open cash-on-delivery orders allowed per phone number (0 = no limit). Default 3; tests default to no limit. */
  MAX_OPEN_COD_ORDERS_PER_PHONE: z.coerce.number().int().min(0).max(100).optional(),

  // Encryption at rest for credentials managed in Admin → Settings (lib/secrets.ts).
  // 32 random bytes, base64 or hex. Keep it OUT of the database and the repository.
  CREDENTIALS_ENCRYPTION_KEY: z.string().default(''),
  /** Comma-separated previous keys, kept only while `npm run migrate -- --reencrypt` runs. */
  CREDENTIALS_ENCRYPTION_KEY_PREVIOUS: z.string().default(''),

  // Media storage (integrations/storage). Never MongoDB.
  MEDIA_STORAGE: z.enum(['local', 's3']).default('local'),
  MEDIA_LOCAL_DIR: z.string().default(''),
  /** Local disk is not persistent on serverless hosting; allow it in production only on a server with a persistent disk. */
  ALLOW_LOCAL_MEDIA_STORAGE: bool(false),
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: bool(false),
  /** Public base URL the files are served from (bucket public URL or CDN), e.g. https://media.celibery.international */
  MEDIA_PUBLIC_BASE_URL: z.string().default(''),
  MEDIA_MAX_IMAGE_MB: z.coerce.number().min(1).max(50).default(10),
  MEDIA_MAX_VIDEO_MB: z.coerce.number().min(1).max(500).default(100),

  // Documented hosting regions (Q33) — shown read-only in Admin → Settings → Hosting & data.
  APP_REGION: z.string().default(''),
  DATABASE_REGION: z.string().default(''),
  MEDIA_REGION: z.string().default(''),

  // Optional Content-Security-Policy additions.
  /** Extra https origins the browser may call (e.g. a separate API domain). */
  CSP_CONNECT_SRC: z.string().default(''),
  /** Endpoint that receives CSP violation reports. */
  CSP_REPORT_URI: z.string().default(''),

  // ---- Scalability & operations (SCALABILITY_REMEDIATION_REPORT.md) -------------------------
  /** MongoDB connection pool per instance. Keep (instances × pool) below the cluster's connection limit. */
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(200).default(10),
  MONGODB_MIN_POOL_SIZE: z.coerce.number().int().min(0).max(50).default(0),
  /**
   * Seconds a public, anonymous payload (homepage, categories, public settings) may be reused by one
   * instance. Admin changes invalidate it on every instance within ~1 s. 0 turns the cache off.
   * Unset: 30 s (0 in the test suite).
   */
  PUBLIC_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(300).optional(),
  /** Bearer token for GET /api/health/metrics (process, pool and latency metrics). Empty = endpoint disabled. */
  METRICS_TOKEN: z.string().default(''),
  /** Requests slower than this are logged as `slow_request` (0 = off). */
  SLOW_REQUEST_MS: z.coerce.number().int().min(0).default(1500),
  /**
   * Worker threads for bcrypt (sign-in, registration, password change) so a sign-in burst does not
   * stall the event loop. 0 = hash on the main thread. Unset: 2 (0 on Vercel, one request per instance).
   */
  PASSWORD_HASH_THREADS: z.coerce.number().int().min(0).max(16).optional(),
  /** Password operations allowed to wait per instance before new sign-ins get 503 SIGN_IN_BUSY. */
  PASSWORD_HASH_MAX_QUEUE: z.coerce.number().int().min(1).max(10_000).default(64),

  // ---- Display currency (modules/currency) -------------------------------------------------
  // Prices are stored and charged in SAR; these only control the converted prices shown to visitors.
  /** Optional exchangerate-api.com v6 key (server-side only). Tried before the free providers. */
  EXCHANGE_RATE_API_KEY: z.string().default(''),
  /** Comma-separated HTTPS rate URLs ({base} / {base_lower} placeholders) replacing the free defaults; "off" disables them. */
  EXCHANGE_RATE_API_URL: z.string().default(''),
  /** Minutes before cached rates are refreshed. */
  EXCHANGE_RATE_REFRESH_MINUTES: z.coerce.number().int().min(15).max(10_080).default(360),
  /** Cached rates older than this are not used (the storefront shows SAR) while every provider is failing. */
  EXCHANGE_RATE_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  /** Header carrying the visitor's country set by a CDN in front of the app (e.g. cf-ipcountry). Never set it unless that proxy overwrites client values. Vercel's x-vercel-ip-country is used automatically on Vercel. */
  GEO_COUNTRY_HEADER: z.string().default(''),
  /** IP → country lookup used when no trusted header is available. HTTPS URL containing {ip}; "off" disables. Default https://api.country.is/{ip} (off in tests). */
  GEO_IP_LOOKUP_URL: z.string().default(''),
  /** Local development / tests only: pretend every visitor is in this country (ignored in production). */
  GEO_DEV_COUNTRY: z.string().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = {
  ...parsed.data,
  PUBLIC_CACHE_TTL_SECONDS: parsed.data.PUBLIC_CACHE_TTL_SECONDS ?? (parsed.data.NODE_ENV === 'test' ? 0 : 30),
  PASSWORD_HASH_THREADS: parsed.data.PASSWORD_HASH_THREADS ?? (process.env.VERCEL ? 0 : 2),
  STAFF_MFA_REQUIRED: staffMfaRequired(parsed.data),
};

/**
 * Whether staff must enrol two-factor authentication before using the admin.
 *
 * Currently OFF unless STAFF_MFA_REQUIRED=true is set: the site is in owner/client testing and
 * repeated 2FA prompts are not wanted yet. At handover to the client, set STAFF_MFA_REQUIRED=true on
 * the production server (it needs CREDENTIALS_ENCRYPTION_KEY — the 2FA secrets are encrypted with it).
 * Staff can still turn 2FA on for their own account at any time (Admin → profile).
 */
export function staffMfaRequired(e: { STAFF_MFA_REQUIRED?: string }): boolean {
  const raw = (e.STAFF_MFA_REQUIRED ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes'].includes(raw);
}
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * True when the process runs on a hosting platform (Vercel, Railway, Render, Fly, Cloud Run,
 * Heroku…), whatever NODE_ENV says. Development fallbacks (built-in JWT secret, built-in
 * credential key) are never used there: a forgotten NODE_ENV=production must not turn the public
 * development secret into the key that signs admin sessions.
 */
export function isHostedPlatform(e: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(e.VERCEL || e.RAILWAY_ENVIRONMENT || e.RAILWAY_PROJECT_ID || e.RENDER || e.FLY_APP_NAME || e.K_SERVICE || e.DYNO);
}

/** Development fallbacks are allowed only for local development and tests. */
export const devFallbacksAllowed = () => !isProd && !isHostedPlatform();

/** Fails fast on configuration that would be unsafe in production. */
export function assertProductionConfig() {
  if (!isProd) {
    if (isHostedPlatform()) {
      // eslint-disable-next-line no-console
      console.warn('SECURITY WARNING: running on a hosting platform with NODE_ENV=' + env.NODE_ENV + '. Set NODE_ENV=production. Development secrets are disabled.');
      if (env.JWT_SECRET.length < 32) throw new Error('Unsafe configuration: JWT_SECRET (min. 32 characters) is required on a hosting platform');
    }
    return;
  }
  const problems: string[] = [];
  if (!env.MONGODB_URI) problems.push('MONGODB_URI is required');
  if (env.JWT_SECRET.length < 32) problems.push('JWT_SECRET must be at least 32 characters');
  if (/replace-with|dev-only-insecure|change-me/i.test(env.JWT_SECRET)) problems.push('JWT_SECRET must be a unique production secret');
  const site = new URL(env.PUBLIC_SITE_URL);
  if (site.protocol !== 'https:' || /^(localhost|127\.|\[::1\])/.test(site.hostname)) problems.push('PUBLIC_SITE_URL must use the production HTTPS domain');
  if (env.PUBLIC_API_URL) {
    const api = new URL(env.PUBLIC_API_URL);
    if (api.protocol !== 'https:' || /^(localhost|127\.|\[::1\])/.test(api.hostname)) problems.push('PUBLIC_API_URL must use the production HTTPS domain');
  }
  const origins = env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean);
  if (!origins.length || origins.some(origin => { try { const url = new URL(origin); return url.protocol !== 'https:' || url.origin !== origin; } catch { return true; } }))
    problems.push('CORS_ORIGINS must contain explicit HTTPS origins');
  if (env.CRON_SECRET.length < 32 || /replace-with/i.test(env.CRON_SECRET)) problems.push('CRON_SECRET must be a unique secret of at least 32 characters');
  if (env.MEDIA_STORAGE === 'local' && !env.ALLOW_LOCAL_MEDIA_STORAGE) problems.push('Use MEDIA_STORAGE=s3, or explicitly allow persistent local media storage');
  // Bucket location is infrastructure (stored media URLs depend on it). The access key may instead be
  // managed in Admin → Settings → Hosting & data; without either, the site runs and only uploads are off.
  if (env.MEDIA_STORAGE === 's3' && (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.MEDIA_PUBLIC_BASE_URL))
    problems.push('S3 storage requires S3_ENDPOINT, S3_BUCKET and MEDIA_PUBLIC_BASE_URL');
  if (env.MEDIA_STORAGE === 's3' && Boolean(env.S3_ACCESS_KEY_ID) !== Boolean(env.S3_SECRET_ACCESS_KEY))
    problems.push('Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither (and manage the key in the admin)');
  if (env.PAYMENT_GATEWAY === 'sandbox' && !env.ALLOW_SANDBOX_PAYMENTS)
    problems.push('PAYMENT_GATEWAY=sandbox is not allowed in production (set a real gateway or ALLOW_SANDBOX_PAYMENTS=true for private staging)');
  if (!env.CREDENTIALS_ENCRYPTION_KEY) {
    // Not fatal: environment-variable credentials keep working, but nothing can be stored from the admin.
    // eslint-disable-next-line no-console
    console.warn('CREDENTIALS_ENCRYPTION_KEY is not set: payment credentials cannot be managed from the admin dashboard.');
  } else {
    try {
      // Validates the key format early (32 bytes, base64 or hex).
      buildKeyRing(env.CREDENTIALS_ENCRYPTION_KEY, env.CREDENTIALS_ENCRYPTION_KEY_PREVIOUS);
    } catch (e) {
      problems.push(String((e as Error).message));
    }
  }
  if (!env.STAFF_MFA_REQUIRED) {
    // Not fatal (a start-up failure would take the whole store offline), but loud in the deploy log.
    // eslint-disable-next-line no-console
    console.warn('NOTICE: staff two-factor authentication is not required (testing phase). Set STAFF_MFA_REQUIRED=true before handing the site to the client.');
  } else if (!env.CREDENTIALS_ENCRYPTION_KEY) {
    // eslint-disable-next-line no-console
    console.warn('SECURITY WARNING: STAFF_MFA_REQUIRED=true but CREDENTIALS_ENCRYPTION_KEY is not set — staff cannot enrol two-factor authentication and are locked out of the admin.');
  }
  if (env.TRUST_PROXY_HOPS > 2) problems.push('TRUST_PROXY_HOPS above 2 lets clients spoof their IP address; use the real number of proxies');
  if (problems.length) throw new Error('Unsafe production configuration: ' + problems.join('; '));
}

export function jwtSecret(): string {
  if (env.JWT_SECRET && env.JWT_SECRET.length >= 32) return env.JWT_SECRET;
  if (!devFallbacksAllowed()) throw new Error('JWT_SECRET must be set (min. 32 characters) in production and on hosting platforms');
  // Development/test fallback only — never used in production (see assertProductionConfig).
  return 'dev-only-insecure-secret-change-me-0123456789abcdef';
}

/** SameSite for the session cookie (see COOKIE_SAMESITE). "none" always requires Secure. */
export function cookieSameSite(): 'lax' | 'strict' | 'none' {
  if (env.COOKIE_SAMESITE) return env.COOKIE_SAMESITE;
  return isProd ? 'none' : 'lax';
}

/** Public origin of the API (no trailing slash): PUBLIC_API_URL, or the site itself when the API shares its origin. */
export const publicApiOrigin = () => (env.PUBLIC_API_URL || env.PUBLIC_SITE_URL).replace(/\/+$/, '');

export const corsOrigins =env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
