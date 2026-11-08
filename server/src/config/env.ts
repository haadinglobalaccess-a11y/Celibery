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
  WHATSAPP_ACCESS_TOKEN: z.string().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_ORDER_TEMPLATE: z.string().default('order_update'),
  WHATSAPP_TEMPLATE_LANG_AR: z.string().default('ar'),
  WHATSAPP_TEMPLATE_LANG_EN: z.string().default('en'),
  CRON_SECRET: z.string().default(''),

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
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Fails fast on configuration that would be unsafe in production. */
export function assertProductionConfig() {
  if (!isProd) return;
  const problems: string[] = [];
  if (!env.MONGODB_URI) problems.push('MONGODB_URI is required');
  if (env.JWT_SECRET.length < 32) problems.push('JWT_SECRET must be at least 32 characters');
  if (/replace-with|dev-only-insecure|change-me/i.test(env.JWT_SECRET)) problems.push('JWT_SECRET must be a unique production secret');
  const site = new URL(env.PUBLIC_SITE_URL);
  if (site.protocol !== 'https:' || /^(localhost|127\.|\[::1\])/.test(site.hostname)) problems.push('PUBLIC_SITE_URL must use the production HTTPS domain');
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
  if (problems.length) throw new Error('Unsafe production configuration: ' + problems.join('; '));
}

export function jwtSecret(): string {
  if (env.JWT_SECRET && env.JWT_SECRET.length >= 32) return env.JWT_SECRET;
  if (isProd) throw new Error('JWT_SECRET must be set (min. 32 characters) in production');
  // Development/test fallback only — never used in production (see assertProductionConfig).
  return 'dev-only-insecure-secret-change-me-0123456789abcdef';
}

/** SameSite for the session cookie (see COOKIE_SAMESITE). "none" always requires Secure. */
export function cookieSameSite(): 'lax' | 'strict' | 'none' {
  if (env.COOKIE_SAMESITE) return env.COOKIE_SAMESITE;
  return isProd ? 'none' : 'lax';
}

export const corsOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
