import nodemailer, { type Transporter } from 'nodemailer';
import { isProd } from '../../config/env';
import { integration, loadIntegrations } from '../credentials';
import { upgradeValues } from '../credentials/definitions';
import type { CredentialCheck } from '../payments/types';

/**
 * Email / WhatsApp provider settings, entered by the administrator in Admin → Settings →
 * Notifications & reviews (stored encrypted in the database). The legacy SMTP_* / EMAIL_FROM /
 * WHATSAPP_* environment variables are only an optional fallback while nothing has been saved
 * there; once the dashboard holds settings, they are ignored.
 */
export type SmtpConfig = {
  host: string;
  port: number;
  /** 'ssl' = implicit TLS (465); 'starttls' = plain connection upgraded with STARTTLS (587). */
  security: 'ssl' | 'starttls';
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
};
export type WhatsAppConfig = {
  businessPhoneNumber: string;
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
  orderTemplate: string;
  langAr: string;
  langEn: string;
};

export const DEFAULT_GRAPH_VERSION = 'v20.0';

export function toSmtpConfig(raw: Record<string, string>): SmtpConfig | null {
  const v = upgradeValues('smtp', raw);
  if (!v.host || !v.fromEmail) return null;
  const port = Number(v.port) || 587;
  return {
    host: v.host,
    port,
    security: v.security === 'ssl' || v.security === 'starttls' ? v.security : port === 465 ? 'ssl' : 'starttls',
    user: v.user ?? '',
    pass: v.pass ?? '',
    fromEmail: v.fromEmail,
    fromName: v.fromName ?? '',
    replyTo: v.replyTo ?? '',
  };
}

export function toWhatsAppConfig(v: Record<string, string>): WhatsAppConfig | null {
  if (!v.phoneNumberId || !v.accessToken) return null;
  return {
    businessPhoneNumber: (v.businessPhoneNumber ?? '').replace(/\D/g, ''),
    phoneNumberId: v.phoneNumberId,
    accessToken: v.accessToken,
    apiVersion: v.apiVersion || DEFAULT_GRAPH_VERSION,
    orderTemplate: v.orderTemplate || 'order_update',
    langAr: v.templateLangAr || 'ar',
    langEn: v.templateLangEn || 'en',
  };
}

/** The SMTP configuration in use right now, or null when email is not configured / disabled. */
export async function activeSmtp(): Promise<SmtpConfig | null> {
  await loadIntegrations();
  const i = integration('smtp');
  return i.enabled ? toSmtpConfig(i.values) : null;
}

export async function activeWhatsApp(): Promise<WhatsAppConfig | null> {
  await loadIntegrations();
  const i = integration('whatsapp');
  return i.enabled ? toWhatsAppConfig(i.values) : null;
}

/** nodemailer "from" with the administrator's display name and address. */
export const smtpFrom = (c: SmtpConfig) => (c.fromName ? { name: c.fromName, address: c.fromEmail } : c.fromEmail);

let cached: { key: string; transporter: Transporter } | null = null;

export function smtpTransport(c: SmtpConfig, opts: { fresh?: boolean } = {}): Transporter {
  const key = JSON.stringify([c.host, c.port, c.security, c.user, c.pass]);
  if (!opts.fresh && cached?.key === key) return cached.transporter;
  const transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.security === 'ssl',
    // STARTTLS: always attempted when the server offers it; refusing to continue without it is
    // enforced in production (a development SMTP catcher usually has no TLS).
    requireTLS: c.security === 'starttls' && isProd,
    disableFileAccess: true,
    disableUrlAccess: true,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
  });
  if (!opts.fresh) {
    cached?.transporter.close();
    cached = { key, transporter };
  }
  return transporter;
}

/** Connects to the SMTP server and authenticates (no email is sent). */
export async function verifySmtp(values: Record<string, string>): Promise<CredentialCheck> {
  const c = toSmtpConfig(values);
  if (!c) return { ok: false, status: 'failed', message: 'SMTP host and sender email address are required' };
  const t = smtpTransport(c, { fresh: true });
  try {
    await t.verify();
    return { ok: true, status: 'ok', message: `Connected to ${c.host}:${c.port} (${c.security === 'ssl' ? 'SSL/TLS' : 'STARTTLS'})${c.user ? ' and signed in' : ''}` };
  } catch (e) {
    return { ok: false, status: 'failed', message: smtpError(e, c) };
  } finally {
    t.close();
  }
}

export function smtpError(e: unknown, c?: SmtpConfig): string {
  const err = e as { code?: string; responseCode?: number; message?: string };
  const msg = String(err.message ?? e);
  if (err.code === 'EAUTH' || err.responseCode === 535) return 'The server rejected the username or password';
  if (err.code === 'ECONNREFUSED') return 'Connection refused — check the SMTP host and port';
  if (err.code === 'ETIMEDOUT' || (err.code === 'ESOCKET' && /timeout/i.test(msg))) return 'Timed out connecting to the server — check the host, port and firewall';
  if (err.code === 'EDNS' || /ENOTFOUND|EAI_AGAIN/.test(msg)) return 'SMTP host not found';
  if (/wrong version number|ssl3_get_record|packet length too long/i.test(msg))
    return c?.security === 'ssl' ? 'This port does not use SSL/TLS — choose STARTTLS (usually port 587)' : 'TLS handshake failed — check the security setting and port';
  if (err.code === 'ETLS' || /STARTTLS/i.test(msg)) return 'The server did not accept STARTTLS — check the security setting and port';
  return `SMTP error: ${msg.slice(0, 200)}`;
}

const graph = (c: WhatsAppConfig, path: string) => `https://graph.facebook.com/${c.apiVersion}/${path}`;

/**
 * Checks the token and phone number ID against the WhatsApp Cloud API, and that the ID belongs to
 * the WhatsApp Business number the administrator entered (no message is sent).
 */
export async function verifyWhatsApp(values: Record<string, string>): Promise<CredentialCheck> {
  const c = toWhatsAppConfig(values);
  if (!c) return { ok: false, status: 'failed', message: 'Phone number ID and access token are required' };
  if (!c.businessPhoneNumber) return { ok: false, status: 'failed', message: 'Enter the WhatsApp Business phone number that should send customer updates' };
  try {
    const res = await fetch(graph(c, `${encodeURIComponent(c.phoneNumberId)}?fields=display_phone_number,verified_name`), {
      headers: { Authorization: `Bearer ${c.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { display_phone_number?: string; verified_name?: string; error?: { message?: string } };
    if (!res.ok) return { ok: false, status: 'failed', message: `WhatsApp API ${res.status}: ${String(body.error?.message ?? 'request rejected').slice(0, 200)}` };
    const display = (body.display_phone_number ?? '').replace(/\D/g, '');
    if (c.businessPhoneNumber && display && display !== c.businessPhoneNumber)
      return { ok: false, status: 'failed', message: `This phone number ID belongs to +${display}, not +${c.businessPhoneNumber}. Use the ID of the number that should send updates.` };
    return { ok: true, status: 'ok', message: `Connected: ${[body.verified_name, body.display_phone_number].filter(Boolean).join(' · ') || c.phoneNumberId}` };
  } catch (e) {
    return { ok: false, status: 'failed', message: `Could not reach the WhatsApp API: ${String((e as Error).message).slice(0, 150)}` };
  }
}

export function whatsappMessagesUrl(c: WhatsAppConfig) {
  return graph(c, `${encodeURIComponent(c.phoneNumberId)}/messages`);
}

/** Body of a template message (the approved order-update template with its 3 parameters). */
export function whatsappTemplateBody(c: WhatsAppConfig, to: string, lang: 'ar' | 'en', params: string[]) {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: c.orderTemplate,
      language: { code: lang === 'ar' ? c.langAr : c.langEn },
      components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
    },
  };
}
