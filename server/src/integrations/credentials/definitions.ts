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
};

export type IntegrationDef = {
  key: IntegrationKey;
  label: string;
  kind: 'payment' | 'shipping';
  fields: FieldDef[];
  /** Whether the server can test the credentials against the provider's API. */
  verifiable: boolean;
  /** Whether the platform actually uses these credentials yet (false = stored for future use only). */
  inUse: boolean;
  docsUrl: string;
};

export const INTEGRATION_KEYS = ['moyasar', 'tabby', 'imile'] as const;
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
  if (/\s/.test(value)) return `${def.label} must not contain spaces or line breaks`;
  if (def.maxLength && value.length > def.maxLength) return `${def.label} is too long`;

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

export function missingRequired(integration: IntegrationKey, present: Record<string, boolean>): string[] {
  return INTEGRATIONS[integration].fields.filter((f) => f.required && !present[f.key]).map((f) => f.key);
}
