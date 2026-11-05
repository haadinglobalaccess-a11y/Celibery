/**
 * Removes secrets from anything that is about to be logged. Applied by lib/logger to every
 * log line's metadata, so a careless `logger.error('…', { body })` can never write a payment
 * key, password, token or cookie to the logs. Pure function, unit tested.
 */
const SECRET_KEY = /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|signature|credential|private|card|cvv|cvc|iban)/i;
const PATTERNS: [RegExp, string][] = [
  [/\b(mongodb(?:\+srv)?|https?|smtps?):\/\/[^\s/@]+(?::[^\s/@]*)?@/gi, '$1://[redacted]@'],
  [/\b(sk|pk)_(test|live)_[A-Za-z0-9]{6,}\b/g, '$1_$2_[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]'],
  [/\bBasic\s+[A-Za-z0-9+/=]{8,}/gi, 'Basic [redacted]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[jwt-redacted]'],
  [/(X-Amz-Signature|X-Amz-Credential)=[^&\s"]+/gi, '$1=[redacted]'],
  [/\bv1:[0-9a-f]{8}:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+/g, '[ciphertext]'],
];

export function redactString(s: string): string {
  let out = s;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) && v !== '' && v != null && typeof v !== 'boolean' ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}
