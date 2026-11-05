import { Router, type Request } from 'express';
import { z } from 'zod';
import { env, isProd } from '../../config/env';
import { audit } from '../../lib/audit';
import { badRequest, notFound, serviceUnavailable, unprocessable } from '../../lib/errors';
import { ah, ok } from '../../lib/http';
import { fingerprint, maskSecret } from '../../lib/secrets';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { encryptFor, integration, invalidateIntegrations, keyRing, loadIntegrations, secretContext } from '../../integrations/credentials';
import { INTEGRATIONS, MODES, isIntegrationKey, missingRequired, validateFieldValue, type IntegrationKey, type Mode } from '../../integrations/credentials/definitions';
import { moyasarProvider } from '../../integrations/payments/moyasar';
import { tabbyProvider } from '../../integrations/payments/tabby';
import type { CredentialCheck } from '../../integrations/payments/types';
import { decryptSecret } from '../../lib/secrets';
import { IntegrationCredential, WITH_SECRETS } from '../../models';
import { limiter } from '../../middleware/security';

/**
 * Admin → Settings → Payments & integrations.
 *
 * Security rules implemented here:
 *  - permission `payments:manage` (Super Administrator by default), enforced on every route;
 *  - secrets are encrypted before they reach the database and are never returned — the API only
 *    exposes a masked preview, a fingerprint and the verification result;
 *  - credentials are validated for the selected mode (no live key in the test slot and vice versa);
 *  - a gateway can only be enabled with credentials that passed verification;
 *  - switching to live mode requires typing LIVE as an explicit confirmation;
 *  - the audit log records which fields changed, never their values.
 */
export const adminIntegrationRoutes = Router();
adminIntegrationRoutes.use(requirePermission('payments:manage'));

const providerParam = z.object({ provider: z.string().refine(isIntegrationKey, 'Unknown integration') });
const modeParam = providerParam.extend({ mode: z.enum(['test', 'live']) });
const credentialsInput = z.object({
  /** string = set/replace, null = remove, absent = unchanged */
  values: z.record(z.string().max(64), z.string().trim().max(400).nullable()),
});
const activateInput = z.object({
  enabled: z.boolean(),
  mode: z.enum(['test', 'live']),
  /** Must be exactly "LIVE" when switching an enabled gateway to live mode. */
  confirm: z.string().trim().max(10).optional(),
});

const verifiers: Partial<Record<IntegrationKey, (values: Record<string, string>) => Promise<CredentialCheck>>> = {
  moyasar: (v) => moyasarProvider.verifyCredentials(v),
  tabby: (v) => tabbyProvider.verifyCredentials(v),
};

const verifyLimiter = limiter(10 * 60_000, 30);

const toObj = (x: unknown): Record<string, unknown> => (x instanceof Map ? Object.fromEntries(x) : ((x as Record<string, unknown>) ?? {}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function publicView(key: IntegrationKey, doc: any) {
  const def = INTEGRATIONS[key];
  const resolved = integration(key);
  const modes = Object.fromEntries(
    MODES.map((mode) => {
      const m = doc?.modes?.[mode] ?? {};
      const values = toObj(m.values) as Record<string, string>;
      const meta = toObj(m.secretMeta) as Record<string, { masked?: string; fingerprint?: string; updatedAt?: Date }>;
      const fields = def.fields.map((f) =>
        f.secret
          ? { key: f.key, secret: true, set: Boolean(meta[f.key]?.fingerprint), masked: meta[f.key]?.masked ?? '', updatedAt: meta[f.key]?.updatedAt ?? null }
          : { key: f.key, secret: false, set: Boolean(values[f.key]), value: values[f.key] ?? '' },
      );
      const present = Object.fromEntries(fields.map((f) => [f.key, f.set]));
      return [mode, { fields, missing: missingRequired(key, present), verification: m.verification ?? { status: 'unverified' } }];
    }),
  );
  const envMasked =
    resolved.source === 'env'
      ? Object.fromEntries(def.fields.map((f) => [f.key, f.secret ? maskSecret(resolved.values[f.key]) : (resolved.values[f.key] ?? '')]))
      : null;
  return {
    key,
    label: def.label,
    kind: def.kind,
    inUse: def.inUse,
    verifiable: def.verifiable,
    docsUrl: def.docsUrl,
    fieldDefs: def.fields,
    managed: Boolean(doc),
    enabled: Boolean(doc?.enabled),
    activeMode: (doc?.activeMode as Mode) ?? 'test',
    liveConfirmedAt: doc?.liveConfirmedAt ?? null,
    updatedAt: doc?.updatedAt ?? null,
    modes,
    effective: { source: resolved.source, enabled: resolved.enabled, mode: resolved.mode, configured: resolved.configured, error: resolved.error ?? null },
    env: envMasked,
  };
}

/** Decrypted values of one mode (server-side only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decryptedValues(key: IntegrationKey, mode: Mode, doc: any): Record<string, string> {
  const m = doc?.modes?.[mode] ?? {};
  const out: Record<string, string> = { ...(toObj(m.values) as Record<string, string>) };
  const ring = keyRing();
  for (const [field, cipher] of Object.entries(toObj(m.secrets) as Record<string, string>)) {
    if (!cipher || !ring) continue;
    try {
      out[field] = decryptSecret(cipher, ring, secretContext(key, mode, field));
    } catch {
      throw unprocessable('CREDENTIALS_UNREADABLE', `The stored ${mode} ${field} cannot be decrypted with the server's current encryption key — enter it again`);
    }
  }
  return out;
}

async function runVerification(key: IntegrationKey, values: Record<string, string>): Promise<CredentialCheck> {
  const v = verifiers[key];
  if (!INTEGRATIONS[key].verifiable || !v) return { ok: false, status: 'unsupported', message: 'This integration cannot be tested automatically' };
  return v(values);
}

const secretFingerprint = (values: Record<string, string>) => fingerprint(values.secretKey ?? values.apiKey ?? '');

function actor(req: Request) {
  return `${req.user?.name ?? ''} <${req.user?.email ?? ''}>`;
}

adminIntegrationRoutes.get(
  '/',
  ah(async (_req, res) => {
    await loadIntegrations(true);
    const docs = await IntegrationCredential.find().lean();
    const list = (Object.keys(INTEGRATIONS) as IntegrationKey[]).map((k) => publicView(k, docs.find((d: { provider: string }) => d.provider === k)));
    return ok(res, {
      integrations: list,
      encryptionKeyConfigured: Boolean(env.CREDENTIALS_ENCRYPTION_KEY),
      encryptionAvailable: Boolean(keyRing()),
      production: isProd,
    });
  }),
);

adminIntegrationRoutes.put(
  '/:provider/:mode/credentials',
  validate(modeParam, 'params'),
  validate(credentialsInput),
  ah(async (req, res) => {
    const key = req.params.provider as IntegrationKey;
    const mode = req.params.mode as Mode;
    const def = INTEGRATIONS[key];
    if (!keyRing()) throw serviceUnavailable('ENCRYPTION_KEY_MISSING', 'CREDENTIALS_ENCRYPTION_KEY is not configured on the server. Ask the developer to set it before storing credentials.');

    const input = req.body.values as Record<string, string | null>;
    const errors: Record<string, string> = {};
    for (const [field, value] of Object.entries(input)) {
      if (!def.fields.some((f) => f.key === field)) errors[field] = 'Unknown field';
      else if (value) {
        const e = validateFieldValue(key, field, mode, value);
        if (e) errors[field] = e;
      }
    }
    if (Object.keys(errors).length) throw badRequest('VALIDATION_ERROR', 'Some credentials are invalid', { fieldErrors: Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, [v]])) });

    const doc = await IntegrationCredential.findOne({ provider: key }).select(WITH_SECRETS).lean();
    const current = doc ? decryptedValues(key, mode, doc) : {};
    const next = { ...current };
    for (const [field, value] of Object.entries(input)) {
      if (value === null || value === '') delete next[field];
      else next[field] = value;
    }

    // Replacing the credentials of the live configuration in use: test them first so a typo can
    // never take payments down.
    const inUse = Boolean(doc?.enabled) && doc?.activeMode === mode;
    let verification: CredentialCheck | null = null;
    const secretChanged = secretFingerprint(next) !== secretFingerprint(current);
    if (inUse && def.verifiable && secretChanged) {
      verification = await runVerification(key, next);
      if (!verification.ok) throw unprocessable('VERIFICATION_FAILED', `The new credentials were not saved: ${verification.message}`);
    }

    const set: Record<string, unknown> = { updatedBy: actor(req) };
    const unset: Record<string, 1> = {};
    const changed: string[] = [];
    for (const f of def.fields) {
      if (!(f.key in input)) continue;
      const value = next[f.key];
      changed.push(`${f.key}${value ? '' : ' (removed)'}`);
      if (f.secret) {
        if (value) {
          set[`modes.${mode}.secrets.${f.key}`] = encryptFor(key, mode, f.key, value);
          set[`modes.${mode}.secretMeta.${f.key}`] = { masked: maskSecret(value), fingerprint: fingerprint(value), updatedAt: new Date() };
        } else {
          unset[`modes.${mode}.secrets.${f.key}`] = 1;
          unset[`modes.${mode}.secretMeta.${f.key}`] = 1;
        }
      } else if (value) set[`modes.${mode}.values.${f.key}`] = value;
      else unset[`modes.${mode}.values.${f.key}`] = 1;
    }
    if (secretChanged || Object.keys(input).some((k) => k === 'merchantCode')) {
      set[`modes.${mode}.verification`] = verification
        ? { status: verification.status, message: verification.message, checkedAt: new Date(), fingerprint: secretFingerprint(next) }
        : { status: 'unverified', message: 'Credentials changed — run “Test connection”', checkedAt: null, fingerprint: '' };
    }
    // A gateway in use cannot be left without its required credentials.
    if (inUse && missingRequired(key, Object.fromEntries(Object.keys(next).map((k) => [k, Boolean(next[k])]))).length) {
      throw unprocessable('REQUIRED_CREDENTIAL', 'Disable the gateway before removing a required credential');
    }

    await IntegrationCredential.updateOne({ provider: key }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { upsert: true });
    invalidateIntegrations();
    await audit(req, 'credentials_update', 'integration', key, `${mode}: ${changed.join(', ')}`);
    const fresh = await IntegrationCredential.findOne({ provider: key }).lean();
    await loadIntegrations(true);
    return ok(res, publicView(key, fresh));
  }),
);

adminIntegrationRoutes.post(
  '/:provider/:mode/verify',
  verifyLimiter,
  validate(modeParam, 'params'),
  ah(async (req, res) => {
    const key = req.params.provider as IntegrationKey;
    const mode = req.params.mode as Mode;
    const doc = await IntegrationCredential.findOne({ provider: key }).select(WITH_SECRETS).lean();
    if (!doc) throw notFound('Saved credentials');
    const values = decryptedValues(key, mode, doc);
    const check = await runVerification(key, values);
    await IntegrationCredential.updateOne(
      { provider: key },
      { $set: { [`modes.${mode}.verification`]: { status: check.status, message: check.message, checkedAt: new Date(), fingerprint: secretFingerprint(values) } } },
    );
    invalidateIntegrations();
    await audit(req, 'credentials_verify', 'integration', key, `${mode}: ${check.status}`);
    const fresh = await IntegrationCredential.findOne({ provider: key }).lean();
    return ok(res, { check, integration: publicView(key, fresh) });
  }),
);

adminIntegrationRoutes.post(
  '/:provider/activate',
  validate(providerParam, 'params'),
  validate(activateInput),
  ah(async (req, res) => {
    const key = req.params.provider as IntegrationKey;
    const def = INTEGRATIONS[key];
    const { enabled, mode, confirm } = req.body as z.infer<typeof activateInput>;
    const doc = await IntegrationCredential.findOne({ provider: key }).select(WITH_SECRETS).lean();
    if (!doc && enabled) throw unprocessable('NOT_CONFIGURED', 'Save the credentials first');

    if (enabled) {
      if (!def.inUse) throw unprocessable('NOT_IMPLEMENTED', `${def.label} is not connected to the platform yet — its credentials are stored for the future API integration only`);
      const values = decryptedValues(key, mode, doc);
      const missing = missingRequired(key, Object.fromEntries(Object.keys(values).map((k) => [k, Boolean(values[k])])));
      if (missing.length) throw unprocessable('NOT_CONFIGURED', `Missing ${mode} credentials: ${missing.join(', ')}`);
      const v = doc?.modes?.[mode]?.verification;
      if (def.verifiable && (v?.status !== 'ok' || v?.fingerprint !== secretFingerprint(values))) {
        throw unprocessable('NOT_VERIFIED', `Run “Test connection” for the ${mode} credentials successfully before enabling`);
      }
      const goingLive = mode === 'live' && !(doc?.enabled && doc?.activeMode === 'live');
      if (goingLive && confirm !== 'LIVE') throw unprocessable('LIVE_CONFIRMATION_REQUIRED', 'Type LIVE to confirm that real customer payments will be processed');
    }

    const set: Record<string, unknown> = { enabled, activeMode: mode, updatedBy: actor(req) };
    if (enabled && mode === 'live' && confirm === 'LIVE') Object.assign(set, { liveConfirmedBy: actor(req), liveConfirmedAt: new Date() });
    await IntegrationCredential.updateOne({ provider: key }, { $set: set }, { upsert: true });
    invalidateIntegrations();
    await loadIntegrations(true);
    await audit(req, enabled ? 'integration_enable' : 'integration_disable', 'integration', key, `${enabled ? 'enabled' : 'disabled'} in ${mode} mode`);
    const fresh = await IntegrationCredential.findOne({ provider: key }).lean();
    return ok(res, publicView(key, fresh));
  }),
);
