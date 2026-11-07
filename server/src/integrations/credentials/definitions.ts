/**
 * Integrations whose credentials administrators can manage from Admin → Settings → Payments &
 * integrations. Pure data + validation (no database access) so it can be unit tested.
 *
 * Secret fields are encrypted at rest (see lib/secrets.ts), never returned by the API and only
 * shown masked. Public fields (publishable keys, merchant codes) are stored as plain text.
 */
export type Mode = 'test' | 'live';
export const MODES: Mode[] = ['test', 'live'];

export type FieldDef = {
  key: string;
  label: string;
  secret: boolean;
  /** Required for the integration to be considered configured. */
  required: boolean;
  hint?: string;
  maxLength?: number;
  /** Allows spaces (e.g. a display name in an email sender address). Line breaks are always refused. */
  allowSpaces?: boolean;
};

export type IntegrationDef = {
  key: IntegrationKey;
  label: string;
  kind: 'payment' | 'shipping' | 'notification' | 'storage';
  fields: FieldDef[];
  /** Whether the server can test the credentials against the provider's API. */
  verifiable: boolean;
  /** Whether the platform actually uses these credentials yet (false = stored for future use only). */
  inUse: boolean;
  docsUrl: string;
  /**
   * One set of credentials (stored in the "live" slot) instead of separate test/live sets —
   * for providers that have no test/live distinction (an SMTP server, a WhatsApp number).
   */
  singleMode?: boolean;
  /**
   * Fields whose values a verification result is tied to. Changing any of them resets the
   * verification. Defaults to the secret key (payment gateways).
   */
  verifyFields?: string[];
};

export const INTEGRATION_KEYS = ['moyasar', 'tabby', 'imile', 'smtp', 'whatsapp', 's3'] as const;
export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];

export const INTEGRATIONS: Record<IntegrationKey, IntegrationDef> = {
  moyasar: {
    key: 'moyasar',
    label: 'Moyasar (mada, Visa, Mastercard, Apple Pay, STC Pay)',
    kind: 'payment',
    verifiable: true,
    inUse: true,
    docsUrl: 'https://docs.moyasar.com',
    fields: [
      { key: 'publishableKey', label: 'Publishable key', secret: false, required: false, hint: 'pk_test_… or pk_live_…', maxLength: 200 },
      { key: 'secretKey', label: 'Secret API key', secret: true, required: true, hint: 'sk_test_… or sk_live_…', maxLength: 200 },
      { key: 'webhookSecret', label: 'Webhook shared secret', secret: true, required: false, hint: 'The secret token set on the webhook in the Moyasar dashboard', maxLength: 200 },
    ],
  },
  tabby: {
    key: 'tabby',
    label: 'Tabby (buy now, pay later)',
    kind: 'payment',
    verifiable: true,
    inUse: true,
    docsUrl: 'https://docs.tabby.ai',
    fields: [
      { key: 'publicKey', label: 'Public key', secret: false, required: false, hint: 'pk_test_… or pk_…', maxLength: 200 },
      { key: 'secretKey', label: 'Secret key', secret: true, required: true, hint: 'sk_test_… or sk_…', maxLength: 200 },
      { key: 'merchantCode', label: 'Merchant code', secret: false, required: true, hint: 'Supplied by Tabby for the Saudi store', maxLength: 80 },
      { key: 'webhookSecret', label: 'Webhook header secret', secret: true, required: false, hint: 'Value Tabby sends in the X-Celibery-Webhook-Secret header', maxLength: 200 },
    ],
  },
  imile: {
    key: 'imile',
    label: 'I Mile Logistics API',
    kind: 'shipping',
    verifiable: false,
    inUse: false,
    docsUrl: '',
    fields: [
      { key: 'customerId', label: 'Customer / account ID', secret: false, required: true, maxLength: 120 },
      { key: 'apiKey', label: 'API key / secret', secret: true, required: true, maxLength: 400 },
    ],
  },
  smtp: {
    key: 'smtp',
    label: 'Email (SMTP)',
    kind: 'notification',
    verifiable: true,
    inUse: true,
    singleMode: true,
    docsUrl: '',
    verifyFields: ['host', 'port', 'user', 'pass'],
    fields: [
      { key: 'host', label: 'SMTP server', secret: false, required: true, hint: 'e.g. smtp.office365.com, smtp.gmail.com, smtp.sendgrid.net', maxLength: 253 },
      { key: 'port', label: 'Port', secret: false, required: true, hint: '587 (STARTTLS) or 465 (SSL)', maxLength: 5 },
      { key: 'user', label: 'Username', secret: false, required: false, hint: 'Usually the mailbox address or "apikey"', maxLength: 200 },
      { key: 'pass', label: 'Password / API key', secret: true, required: false, maxLength: 400 },
      { key: 'from', label: 'Sender (From)', secret: false, required: true, hint: 'CELIBERY International <no-reply@your-domain.com>', maxLength: 200, allowSpaces: true },
    ],
  },
  whatsapp: {
    key: 'whatsapp',
    label: 'WhatsApp Business (Cloud API)',
    kind: 'notification',
    verifiable: true,
    inUse: true,
    singleMode: true,
    docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
    verifyFields: ['phoneNumberId', 'accessToken'],
    fields: [
      { key: 'phoneNumberId', label: 'Phone number ID', secret: false, required: true, hint: 'Meta Business → WhatsApp → API setup (digits only)', maxLength: 30 },
      { key: 'accessToken', label: 'Permanent access token', secret: true, required: true, hint: 'System-user token with whatsapp_business_messaging', maxLength: 600 },
      { key: 'orderTemplate', label: 'Order update template name', secret: false, required: true, hint: 'Approved template with 3 body parameters: name, status text, link', maxLength: 120 },
      { key: 'templateLangAr', label: 'Arabic template language', secret: false, required: false, hint: 'Default: ar', maxLength: 10 },
      { key: 'templateLangEn', label: 'English template language', secret: false, required: false, hint: 'Default: en', maxLength: 10 },
    ],
  },
  /**
   * Access key for the S3-compatible media bucket. Only the key pair is managed here: the
   * endpoint, bucket and public URL stay server settings (S3_ENDPOINT, S3_BUCKET,
   * MEDIA_PUBLIC_BASE_URL) because stored media URLs, deletions and the upload CSP depend on them —
   * changing them at runtime would break existing images. Rotating the key does not.
   */
  s3: {
    key: 's3',
    label: 'Media storage (S3) access key',
    kind: 'storage',
    verifiable: true,
    inUse: true,
    singleMode: true,
    docsUrl: '',
    verifyFields: ['accessKeyId', 'secretAccessKey'],
    fields: [
      { key: 'accessKeyId', label: 'Access key ID', secret: false, required: true, hint: 'Key with write + delete permission on the media bucket only', maxLength: 128 },
      { key: 'secretAccessKey', label: 'Secret access key', secret: true, required: true, maxLength: 128 },
    ],
  },
};

export function isIntegrationKey(v: string): v is IntegrationKey {
  return (INTEGRATION_KEYS as readonly string[]).includes(v);
}

/**
 * Format checks that stop the most damaging mistakes — a live key in the test slot or a test
 * key in the live slot. Returns an error message, or null when the value is acceptable.
 */
export function validateFieldValue(integration: IntegrationKey, field: string, mode: Mode, value: string): string | null {
  const def = INTEGRATIONS[integration].fields.find((f) => f.key === field);
  if (!def) return `Unknown field "${field}"`;
  if (def.allowSpaces ? /[\r\n\t]/.test(value) : /\s/.test(value)) return `${def.label} must not contain ${def.allowSpaces ? 'line breaks' : 'spaces or line breaks'}`;
  if (def.maxLength && value.length > def.maxLength) return `${def.label} is too long`;

  if (integration === 'smtp') {
    if (field === 'host' && !/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(value))
      return 'SMTP server must be a host name such as smtp.example.com (no https:// and no port)';
    if (field === 'port' && !(/^\d{1,5}$/.test(value) && Number(value) >= 1 && Number(value) <= 65535)) return 'Port must be a number between 1 and 65535';
    if (field === 'from' && !/^(?:[^<>\r\n]{1,120}<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/.test(value))
      return 'Sender must be an email address, optionally with a name: Name <address@domain>';
  }
  if (integration === 's3' && field === 'accessKeyId' && !/^[A-Za-z0-9_-]{16,128}$/.test(value)) return 'Access key IDs are 16–128 letters and digits (e.g. AKIA… or a Cloudflare R2 key)';
  if (integration === 'whatsapp') {
    if (field === 'phoneNumberId' && !/^\d{5,30}$/.test(value)) return 'Phone number ID is the numeric ID from Meta (not the phone number itself)';
    if (field === 'orderTemplate' && !/^[a-z0-9_]{1,120}$/.test(value)) return 'Template names use lowercase letters, numbers and underscores';
    if ((field === 'templateLangAr' || field === 'templateLangEn') && !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(value)) return 'Language codes look like ar, en or en_US';
  }

  if (integration === 'moyasar' && (field === 'secretKey' || field === 'publishableKey')) {
    const p = field === 'secretKey' ? 'sk' : 'pk';
    const expected = `${p}_${mode}_`;
    if (!value.startsWith(expected)) return `${def.label} for ${mode} mode must start with "${expected}"`;
  }
  if (integration === 'tabby' && (field === 'secretKey' || field === 'publicKey')) {
    const p = field === 'secretKey' ? 'sk' : 'pk';
    const isTestKey = value.startsWith(`${p}_test_`);
    if (mode === 'live' && isTestKey) return `${def.label}: a test key cannot be used in live mode`;
    if (mode === 'test' && value.startsWith(`${p}_`) && !isTestKey) return `${def.label}: a live key cannot be used in test mode`;
  }
  return null;
}

/** Infers the mode of legacy environment-variable credentials from the key prefix. */
export function inferModeFromKey(secretKey: string): Mode {
  return /_test_/.test(secretKey) ? 'test' : 'live';
}

/** The mode slot a single-mode integration stores its one set of credentials in. */
export const SINGLE_MODE_SLOT: Mode = 'live';

/**
 * Stable digest input for the values a verification result covers: changing any of them makes a
 * previous "connection verified" result stale. Payment gateways keep their original behaviour
 * (the secret key alone) so existing verification results stay valid after upgrading.
 */
export function verificationSubject(integration: IntegrationKey, values: Record<string, string>): string {
  const fields = INTEGRATIONS[integration].verifyFields;
  if (!fields) return values.secretKey ?? values.apiKey ?? '';
  return fields.map((f) => `${f}=${values[f] ?? ''}`).join('\n');
}

export function missingRequired(integration: IntegrationKey, present: Record<string, boolean>): string[] {
  return INTEGRATIONS[integration].fields.filter((f) => f.required && !present[f.key]).map((f) => f.key);
}
