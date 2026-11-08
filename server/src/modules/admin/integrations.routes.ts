import { Router, type Request } from 'express';
import { z } from 'zod';
import { env, isProd } from '../../config/env';
import { audit } from '../../lib/audit';
import { badRequest, notFound, serviceUnavailable, unprocessable } from '../../lib/errors';
import { ah, ok } from '../../lib/http';
import { fingerprint, maskSecret } from '../../lib/secrets';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { channelStatus, encryptFor, integration, invalidateIntegrations, keyRing, loadIntegrations, secretContext } from '../../integrations/credentials';
import { EMAIL_RX, INTEGRATIONS, MODES, SINGLE_MODE_SLOT, isIntegrationKey, missingRequired, upgradeValues, validateFieldValue, verificationSubject, type IntegrationKey, type Mode } from '../../integrations/credentials/definitions';
import { smtpError, toSmtpConfig, toWhatsAppConfig, verifySmtp, verifyWhatsApp } from '../../integrations/notifications/providers';
import { deliverEmail, deliverWhatsApp, normalizeSaudiPhone } from '../../integrations/notifications';
import { moyasarProvider } from '../../integrations/payments/moyasar';
import { tabbyProvider } from '../../integrations/payments/tabby';
import type { CredentialCheck } from '../../integrations/payments/types';
import { decryptSecret } from '../../lib/secrets';
import { IntegrationCredential, Notification, WITH_SECRETS } from '../../models';
import { verifyS3 } from '../../integrations/storage';
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
  smtp: (v) => verifySmtp(v),
  whatsapp: (v) => verifyWhatsApp(v),
  s3: (v) => verifyS3(v),
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
      const values = upgradeValues(key, toObj(m.values) as Record<string, string>);
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
    singleMode: Boolean(def.singleMode),
    inUse: def.inUse,
    verifiable: def.verifiable,
    docsUrl: def.docsUrl,
    fieldDefs: def.fields,
    managed: Boolean(doc),
    enabled: Boolean(doc?.enabled),
    activeMode: def.singleMode ? SINGLE_MODE_SLOT : ((doc?.activeMode as Mode) ?? 'test'),
    liveConfirmedAt: doc?.liveConfirmedAt ?? null,
    updatedAt: doc?.updatedAt ?? null,
    modes,
    effective: { source: resolved.source, enabled: resolved.enabled, mode: resolved.mode, configured: resolved.configured, error: resolved.error ?? null },
    env: envMasked,
  };
}

/** Public view plus, for email/WhatsApp, the status of the saved admin configuration. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function viewWithStatus(key: IntegrationKey, doc: any) {
  return { ...publicView(key, doc), channel: INTEGRATIONS[key].kind === 'notification' ? await channelStatus(key) : null };
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
  return upgradeValues(key, out);
}

async function runVerification(key: IntegrationKey, values: Record<string, string>): Promise<CredentialCheck> {
  const v = verifiers[key];
  if (!INTEGRATIONS[key].verifiable || !v) return { ok: false, status: 'unsupported', message: 'This integration cannot be tested automatically' };
  return v(values);
}

/** Ties a verification result to the exact values it tested (see verificationSubject). */
const secretFingerprint = (key: IntegrationKey, values: Record<string, string>) => fingerprint(verificationSubject(key, values));

/** Single-mode integrations (email, WhatsApp) keep their one credential set in the live slot. */
function assertModeAllowed(key: IntegrationKey, mode: Mode) {
  if (INTEGRATIONS[key].singleMode && mode !== SINGLE_MODE_SLOT) throw badRequest('MODE_NOT_SUPPORTED', `${INTEGRATIONS[key].label} has a single set of credentials (no test/live modes)`);
}

function actor(req: Request) {
  return `${req.user?.name ?? ''} <${req.user?.email ?? ''}>`;
}

adminIntegrationRoutes.get(
  '/',
  ah(async (_req, res) => {
    await loadIntegrations(true);
    const docs = await IntegrationCredential.find().lean();
    const list = await Promise.all((Object.keys(INTEGRATIONS) as IntegrationKey[]).map((k) => viewWithStatus(k, docs.find((d: { provider: string }) => d.provider === k))));
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
    assertModeAllowed(key, mode);
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
    const inUse = Boolean(doc?.enabled) && (def.singleMode ? true : doc?.activeMode === mode);
    let verification: CredentialCheck | null = null;
    const secretChanged = secretFingerprint(key, next) !== secretFingerprint(key, current);
    if (inUse && def.verifiable && secretChanged) {
      verification = await runVerification(key, next);
      if (!verification.ok) throw unprocessable('VERIFICATION_FAILED', `The new credentials were not saved: ${verification.message}`);
    }

    const set: Record<string, unknown> = { updatedBy: actor(req) };
    const unset: Record<string, 1> = {};
    const changed: string[] = [];
    // Values upgraded from an older shape (e.g. the combined SMTP "from") are written in the new
    // shape on this save, and the legacy key is removed.
    const raw = (toObj(doc?.modes?.[mode]?.values) as Record<string, string>) ?? {};
    for (const f of def.fields) if (!f.secret && next[f.key] && raw[f.key] !== next[f.key] && !(f.key in input)) set[`modes.${mode}.values.${f.key}`] = next[f.key];
    if (key === 'smtp' && raw.from !== undefined) unset[`modes.${mode}.values.from`] = 1;
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
        ? { status: verification.status, message: verification.message, checkedAt: new Date(), fingerprint: secretFingerprint(key, next) }
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
    return ok(res, await viewWithStatus(key, fresh));
  }),
);

adminIntegrationRoutes.post(
  '/:provider/:mode/verify',
  verifyLimiter,
  validate(modeParam, 'params'),
  ah(async (req, res) => {
    const key = req.params.provider as IntegrationKey;
    const mode = req.params.mode as Mode;
    assertModeAllowed(key, mode);
    const doc = await IntegrationCredential.findOne({ provider: key }).select(WITH_SECRETS).lean();
    if (!doc) throw notFound('Saved credentials');
    const values = decryptedValues(key, mode, doc);
    const check = await runVerification(key, values);
    await IntegrationCredential.updateOne(
      { provider: key },
      { $set: { [`modes.${mode}.verification`]: { status: check.status, message: check.message, checkedAt: new Date(), fingerprint: secretFingerprint(key, values) } } },
    );
    invalidateIntegrations();
    await audit(req, 'credentials_verify', 'integration', key, `${mode}: ${check.status}`);
    const fresh = await IntegrationCredential.findOne({ provider: key }).lean();
    return ok(res, { check, integration: await viewWithStatus(key, fresh) });
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
    assertModeAllowed(key, mode);
    const doc = await IntegrationCredential.findOne({ provider: key }).select(WITH_SECRETS).lean();
    if (!doc && enabled) throw unprocessable('NOT_CONFIGURED', 'Save the credentials first');

    if (enabled) {
      if (!def.inUse) throw unprocessable('NOT_IMPLEMENTED', `${def.label} is not connected to the platform yet — its credentials are stored for the future API integration only`);
      const values = decryptedValues(key, mode, doc);
      const missing = missingRequired(key, Object.fromEntries(Object.keys(values).map((k) => [k, Boolean(values[k])])));
      if (missing.length) throw unprocessable('NOT_CONFIGURED', `Missing ${mode} credentials: ${missing.join(', ')}`);
      const v = doc?.modes?.[mode]?.verification;
      if (def.verifiable && (v?.status !== 'ok' || v?.fingerprint !== secretFingerprint(key, values))) {
        throw unprocessable('NOT_VERIFIED', `Run “Test connection” for the ${mode} credentials successfully before enabling`);
      }
      // Typing LIVE is required where live mode means real customer money (payment gateways).
      const goingLive = def.kind === 'payment' && mode === 'live' && !(doc?.enabled && doc?.activeMode === 'live');
      if (goingLive && confirm !== 'LIVE') throw unprocessable('LIVE_CONFIRMATION_REQUIRED', 'Type LIVE to confirm that real customer payments will be processed');
    }

    const set: Record<string, unknown> = { enabled, activeMode: mode, updatedBy: actor(req) };
    if (enabled && def.kind === 'payment' && mode === 'live' && confirm === 'LIVE') Object.assign(set, { liveConfirmedBy: actor(req), liveConfirmedAt: new Date() });
    await IntegrationCredential.updateOne({ provider: key }, { $set: set }, { upsert: true });
    invalidateIntegrations();
    await loadIntegrations(true);
    await audit(req, enabled ? 'integration_enable' : 'integration_disable', 'integration', key, `${enabled ? 'enabled' : 'disabled'} in ${mode} mode`);
    const fresh = await IntegrationCredential.findOne({ provider: key }).lean();
    return ok(res, await viewWithStatus(key, fresh));
  }),
);

const testMessageInput = z.object({ to: z.string().trim().max(200).optional(), lang: z.enum(['ar', 'en']).default('ar') });

/**
 * Sends a real test message with the SAVED settings (works before the channel is enabled, so
 * delivery can be confirmed first):
 *  - smtp: a test email to the address the administrator enters (default: their own);
 *  - whatsapp: the approved order-update template with sample values to the number they enter.
 * Every attempt is recorded in the delivery log; failures return the provider's reason.
 */
adminIntegrationRoutes.post(
  '/:provider/test-message',
  verifyLimiter,
  validate(providerParam, 'params'),
  validate(testMessageInput),
  ah(async (req, res) => {
    const key = req.params.provider as IntegrationKey;
    if (key !== 'smtp' && key !== 'whatsapp') throw badRequest('NOT_SUPPORTED', 'Test messages are available for email and WhatsApp only');
    const doc = await IntegrationCredential.findOne({ provider: key }).select(WITH_SECRETS).lean();
    if (!doc) throw notFound('Saved settings');
    const values = decryptedValues(key, SINGLE_MODE_SLOT, doc);

    if (key === 'smtp') {
      const smtp = toSmtpConfig(values);
      if (!smtp) throw unprocessable('NOT_CONFIGURED', 'Save the SMTP host and sender email address first');
      const to = (req.body.to as string | undefined) || req.user!.email;
      if (!EMAIL_RX.test(to)) throw badRequest('VALIDATION_ERROR', 'Enter a valid recipient email address', { fieldErrors: { to: ['Enter a valid email address'] } });
      try {
        await deliverEmail(
          smtp,
          to,
          {
            subject: 'CELIBERY — test email',
            text: `This is a test email from the CELIBERY admin dashboard, sent from ${smtp.fromEmail} through ${smtp.host}:${smtp.port}. Email delivery is working.`,
            html: `<p>This is a test email from the CELIBERY admin dashboard, sent from <strong>${escHtml(smtp.fromEmail)}</strong> through <strong>${escHtml(smtp.host)}:${smtp.port}</strong>.</p><p>Email delivery is working.</p>`,
          },
          { fresh: true },
        );
      } catch (e) {
        const detail = smtpError(e, smtp);
        await Notification.create({ channel: 'email', to, template: 'admin.smtp_test', user: req.user!.id, status: 'failed', detail });
        await audit(req, 'credentials_test_message', 'integration', key, `failed to ${to}`);
        throw unprocessable('SEND_FAILED', `The test email could not be sent: ${detail}`);
      }
      await Notification.create({ channel: 'email', to, template: 'admin.smtp_test', user: req.user!.id, status: 'sent' });
      await audit(req, 'credentials_test_message', 'integration', key, `sent to ${to}`);
      return ok(res, { sent: true, to, from: smtp.fromEmail });
    }

    const wa = toWhatsAppConfig(values);
    if (!wa) throw unprocessable('NOT_CONFIGURED', 'Save the phone number ID and access token first');
    const to = normalizeSaudiPhone(String(req.body.to ?? ''));
    if (!/^\d{8,15}$/.test(to)) throw badRequest('VALIDATION_ERROR', 'Enter the recipient WhatsApp number, e.g. 9665XXXXXXXX', { fieldErrors: { to: ['Enter a valid number'] } });
    const lang = req.body.lang === 'en' ? 'en' : 'ar';
    try {
      await deliverWhatsApp(wa, to, lang, [req.user!.name || 'CELIBERY', lang === 'ar' ? 'رسالة تجريبية من لوحة التحكم' : 'Test message from the admin dashboard', env.PUBLIC_SITE_URL]);
    } catch (e) {
      const detail = String((e as Error).message ?? e).slice(0, 300);
      await Notification.create({ channel: 'whatsapp', to, template: 'admin.whatsapp_test', user: req.user!.id, status: 'failed', detail });
      await audit(req, 'credentials_test_message', 'integration', key, `failed to ${to}`);
      throw unprocessable('SEND_FAILED', `The test WhatsApp message could not be sent: ${detail}`);
    }
    await Notification.create({ channel: 'whatsapp', to, template: 'admin.whatsapp_test', user: req.user!.id, status: 'sent' });
    await audit(req, 'credentials_test_message', 'integration', key, `sent to ${to}`);
    return ok(res, { sent: true, to, from: wa.businessPhoneNumber || wa.phoneNumberId });
  }),
);

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
