import { env, isProd } from '../../config/env';
import { logger } from '../../lib/logger';
import { buildKeyRing, decryptSecret, encryptSecret, fingerprint, type KeyRing } from '../../lib/secrets';
import { IntegrationCredential, WITH_SECRETS } from '../../models/IntegrationCredential';
import { INTEGRATIONS, inferModeFromKey, missingRequired, upgradeValues, verificationSubject, type IntegrationKey, type Mode } from './definitions';

/**
 * Resolves the credentials each integration should use right now.
 *
 * Precedence (backward compatible):
 *  1. A record managed in Admin → Settings (encrypted in the database) — once it exists, the
 *     admin decides: its enabled flag and active mode are authoritative.
 *  2. Otherwise the legacy environment variables (MOYASAR_*, TABBY_*), unchanged from before.
 *
 * The resolved snapshot is cached in memory for a short time so payment code can read it
 * synchronously; `loadIntegrations()` refreshes it (called by a middleware on every API request
 * and by services before they talk to a gateway). Admin changes invalidate it immediately on the
 * instance that made them; other serverless instances pick them up within CACHE_MS.
 */
export type ResolvedIntegration = {
  provider: IntegrationKey;
  source: 'admin' | 'env' | 'none';
  enabled: boolean;
  mode: Mode;
  /** Decrypted secrets and public values for the active mode (server-side only, never sent to a browser). */
  values: Record<string, string>;
  configured: boolean;
  error?: string;
};

const CACHE_MS = 30_000;
let snapshot: { at: number; data: Partial<Record<IntegrationKey, ResolvedIntegration>> } | null = null;
let inflight: Promise<void> | null = null;

let ringCache: { raw: string; ring: KeyRing | null } | null = null;

/** The encryption key ring, or null when CREDENTIALS_ENCRYPTION_KEY is not configured. */
export function keyRing(): KeyRing | null {
  const raw = `${env.CREDENTIALS_ENCRYPTION_KEY}|${env.CREDENTIALS_ENCRYPTION_KEY_PREVIOUS}`;
  if (ringCache?.raw === raw) return ringCache.ring;
  let ring = buildKeyRing(env.CREDENTIALS_ENCRYPTION_KEY, env.CREDENTIALS_ENCRYPTION_KEY_PREVIOUS);
  if (!ring && !isProd) {
    // Development/test only: a fixed, clearly non-secret key so the feature works locally.
    // Production refuses to store credentials without a real key (see requireKeyRing).
    ring = buildKeyRing('ZGV2LW9ubHktaW5zZWN1cmUta2V5LWRvLW5vdC11c2U=', '');
  }
  ringCache = { raw, ring };
  return ring;
}

export function requireKeyRing(): KeyRing {
  const ring = keyRing();
  if (!ring) {
    const e = new Error('CREDENTIALS_ENCRYPTION_KEY is not configured on the server. Ask the developer to set it before storing credentials.');
    (e as Error & { code: string }).code = 'ENCRYPTION_KEY_MISSING';
    throw e;
  }
  return ring;
}

export const secretContext = (provider: string, mode: Mode, field: string) => `${provider}:${mode}:${field}`;

export function encryptFor(provider: IntegrationKey, mode: Mode, field: string, value: string) {
  return encryptSecret(value, requireKeyRing(), secretContext(provider, mode, field));
}

function fromEnv(provider: IntegrationKey): ResolvedIntegration {
  if (provider === 'moyasar' && env.MOYASAR_SECRET_KEY) {
    return {
      provider,
      source: 'env',
      enabled: true,
      mode: inferModeFromKey(env.MOYASAR_SECRET_KEY),
      values: { secretKey: env.MOYASAR_SECRET_KEY, publishableKey: env.MOYASAR_PUBLISHABLE_KEY, webhookSecret: env.MOYASAR_WEBHOOK_SECRET },
      configured: true,
    };
  }
  if (provider === 'tabby' && env.TABBY_SECRET_KEY) {
    return {
      provider,
      source: 'env',
      enabled: true,
      mode: inferModeFromKey(env.TABBY_SECRET_KEY),
      values: { secretKey: env.TABBY_SECRET_KEY, publicKey: env.TABBY_PUBLIC_KEY, merchantCode: env.TABBY_MERCHANT_CODE, webhookSecret: env.TABBY_WEBHOOK_SECRET },
      configured: Boolean(env.TABBY_MERCHANT_CODE),
    };
  }
  if (provider === 'smtp' && env.SMTP_HOST) {
    return {
      provider,
      source: 'env',
      enabled: Boolean(env.EMAIL_FROM),
      mode: 'live',
      values: upgradeValues('smtp', { host: env.SMTP_HOST, port: String(env.SMTP_PORT), user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.EMAIL_FROM }),
      // No built-in sender address: the legacy fallback needs EMAIL_FROM too.
      configured: Boolean(env.EMAIL_FROM),
    };
  }
  if (provider === 'whatsapp' && env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
    return {
      provider,
      source: 'env',
      enabled: true,
      mode: 'live',
      values: {
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
        accessToken: env.WHATSAPP_ACCESS_TOKEN,
        orderTemplate: env.WHATSAPP_ORDER_TEMPLATE,
        templateLangAr: env.WHATSAPP_TEMPLATE_LANG_AR,
        templateLangEn: env.WHATSAPP_TEMPLATE_LANG_EN,
      },
      configured: true,
    };
  }
  if (provider === 's3' && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
    return { provider, source: 'env', enabled: true, mode: 'live', values: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }, configured: true };
  }
  return { provider, source: 'none', enabled: false, mode: INTEGRATIONS[provider].singleMode ? 'live' : 'test', values: {}, configured: false };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveRecord(provider: IntegrationKey, doc: any): ResolvedIntegration {
  const mode: Mode = INTEGRATIONS[provider].singleMode || doc.activeMode === 'live' ? 'live' : 'test';
  const m = doc.modes?.[mode] ?? {};
  const values: Record<string, string> = {};
  const toObj = (x: unknown) => (x instanceof Map ? Object.fromEntries(x) : ((x as Record<string, string>) ?? {}));
  Object.assign(values, toObj(m.values));
  const secrets = toObj(m.secrets) as Record<string, string>;
  let error: string | undefined;
  const ring = keyRing();
  for (const [field, cipher] of Object.entries(secrets)) {
    if (!cipher) continue;
    if (!ring) {
      error = 'Encryption key not configured';
      continue;
    }
    try {
      values[field] = decryptSecret(cipher, ring, secretContext(provider, mode, field));
    } catch (e) {
      error = (e as Error).message;
      logger.error('Stored credential could not be decrypted', { provider, mode, field });
    }
  }
  Object.assign(values, upgradeValues(provider, values));
  delete values.from;
  const present = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Boolean(v)]));
  const configured = !error && missingRequired(provider, present).length === 0;
  return { provider, source: 'admin', enabled: Boolean(doc.enabled) && configured, mode, values, configured, error };
}

export async function loadIntegrations(force = false): Promise<void> {
  if (!force && snapshot && Date.now() - snapshot.at < CACHE_MS) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const docs = await IntegrationCredential.find().select(WITH_SECRETS).lean();
      const data: Partial<Record<IntegrationKey, ResolvedIntegration>> = {};
      for (const key of Object.keys(INTEGRATIONS) as IntegrationKey[]) {
        const doc = docs.find((d: { provider: string }) => d.provider === key);
        // Only admin-managed records are cached; environment values are always read live.
        if (doc) data[key] = resolveRecord(key, doc);
      }
      snapshot = { at: Date.now(), data };
    } catch (e) {
      // Database unavailable: keep the previous snapshot (or env values) rather than failing payments.
      logger.warn('Could not load integration credentials', { err: String((e as Error).message) });
      if (!snapshot) snapshot = { at: Date.now() - CACHE_MS + 5_000, data: {} };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function invalidateIntegrations() {
  snapshot = null;
}

/** Synchronous read of the resolved integration (admin record when one exists, else environment variables). */
export function integration(provider: IntegrationKey): ResolvedIntegration {
  return snapshot?.data[provider] ?? fromEnv(provider);
}

/** Express middleware: keeps the snapshot fresh (one indexed query at most every 30 s per instance). */
export function integrationsMiddleware(_req: unknown, _res: unknown, next: (e?: unknown) => void) {
  loadIntegrations().then(() => next(), () => next());
}

export type ChannelStatus = {
  /** Status of the configuration SAVED IN THE ADMIN DASHBOARD (environment variables never count). */
  status: 'not_configured' | 'configured' | 'failed';
  message: string;
  /** The administrator switched this channel on (Admin → Settings → Notifications). */
  enabled: boolean;
  checkedAt: Date | null;
  /** Messages are currently sent through environment-variable credentials (legacy fallback). */
  usingEnvFallback: boolean;
};

/**
 * Configured = saved in the admin, every required field present, and the CURRENT values passed
 * "Test connection". Failed = the last test of the current values failed. Anything else (nothing
 * saved, missing fields, changed but not re-tested) = not configured.
 */
export async function channelStatus(provider: IntegrationKey): Promise<ChannelStatus> {
  const doc = await IntegrationCredential.findOne({ provider }).select(WITH_SECRETS).lean();
  const envFallback = !doc && fromEnv(provider).enabled;
  if (!doc) return { status: 'not_configured', message: 'Not set up in the admin yet', enabled: false, checkedAt: null, usingEnvFallback: envFallback };
  const r = resolveRecord(provider, doc);
  const mode = r.mode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = (doc as any).modes?.[mode]?.verification ?? {};
  const base = { enabled: Boolean(doc.enabled), checkedAt: (v.checkedAt as Date) ?? null, usingEnvFallback: false };
  if (r.error) return { ...base, status: 'failed', message: 'The saved credentials cannot be decrypted — enter them again' };
  const missing = missingRequired(provider, Object.fromEntries(Object.entries(r.values).map(([k, x]) => [k, Boolean(x)])));
  if (missing.length) return { ...base, status: 'not_configured', message: `Missing: ${missing.map((f) => INTEGRATIONS[provider].fields.find((d) => d.key === f)?.label ?? f).join(', ')}` };
  const current = v.fingerprint && v.fingerprint === fingerprint(verificationSubject(provider, r.values));
  if (current && v.status === 'ok') return { ...base, status: 'configured', message: v.message || 'Connection verified' };
  if (current && v.status === 'failed') return { ...base, status: 'failed', message: v.message || 'Connection failed' };
  return { ...base, status: 'not_configured', message: 'Saved — run “Test connection” to validate' };
}
