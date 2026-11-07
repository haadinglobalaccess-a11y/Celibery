import nodemailer, { type Transporter } from 'nodemailer';
import { isProd } from '../../config/env';
import { integration, loadIntegrations } from '../credentials';
import type { CredentialCheck } from '../payments/types';

/**
 * Resolved email / WhatsApp provider settings. Values come from Admin → Settings →
 * Notifications (encrypted credentials) and fall back to the legacy environment variables
 * (SMTP_*, EMAIL_FROM, WHATSAPP_*) while nothing has been saved in the dashboard.
 */
export type SmtpConfig = { host: string; port: number; user: string; pass: string; from: string };
export type WhatsAppConfig = { phoneNumberId: string; accessToken: string; orderTemplate: string; langAr: string; langEn: string };

const GRAPH = 'https://graph.facebook.com/v20.0';

export function toSmtpConfig(v: Record<string, string>): SmtpConfig | null {
  if (!v.host || !v.from) return null;
  return { host: v.host, port: Number(v.port) || 587, user: v.user ?? '', pass: v.pass ?? '', from: v.from };
}

export function toWhatsAppConfig(v: Record<string, string>): WhatsAppConfig | null {
  if (!v.phoneNumberId || !v.accessToken) return null;
  return { phoneNumberId: v.phoneNumberId, accessToken: v.accessToken, orderTemplate: v.orderTemplate || 'order_update', langAr: v.templateLangAr || 'ar', langEn: v.templateLangEn || 'en' };
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

let cached: { key: string; transporter: Transporter } | null = null;

export function smtpTransport(c: SmtpConfig, opts: { fresh?: boolean } = {}): Transporter {
  const key = JSON.stringify([c.host, c.port, c.user, c.pass]);
  if (!opts.fresh && cached?.key === key) return cached.transporter;
  const transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.port === 465,
    requireTLS: isProd && c.port !== 465,
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
  if (!c) return { ok: false, status: 'failed', message: 'SMTP server and sender address are required' };
  const t = smtpTransport(c, { fresh: true });
  try {
    await t.verify();
    return { ok: true, status: 'ok', message: `Connected to ${c.host}:${c.port}${c.user ? ' and signed in' : ''}` };
  } catch (e) {
    return { ok: false, status: 'failed', message: smtpError(e) };
  } finally {
    t.close();
  }
}

function smtpError(e: unknown): string {
  const err = e as { code?: string; responseCode?: number; message?: string };
  if (err.code === 'EAUTH' || err.responseCode === 535) return 'The server rejected the username or password';
  if (err.code === 'ECONNREFUSED') return 'Connection refused — check the server name and port';
  if (err.code === 'ETIMEDOUT' || (err.code === 'ESOCKET' && /timeout/i.test(err.message ?? ''))) return 'Timed out connecting to the server — check the server name, port and firewall';
  if (err.code === 'EDNS' || /ENOTFOUND|EAI_AGAIN/.test(err.message ?? '')) return 'Server name not found';
  return `SMTP error: ${String(err.message ?? e).slice(0, 200)}`;
}

/** Checks the phone number ID and token against the WhatsApp Cloud API (no message is sent). */
export async function verifyWhatsApp(values: Record<string, string>): Promise<CredentialCheck> {
  const c = toWhatsAppConfig(values);
  if (!c) return { ok: false, status: 'failed', message: 'Phone number ID and access token are required' };
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(c.phoneNumberId)}?fields=display_phone_number,verified_name`, {
      headers: { Authorization: `Bearer ${c.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { display_phone_number?: string; verified_name?: string; error?: { message?: string } };
    if (!res.ok) return { ok: false, status: 'failed', message: `WhatsApp API ${res.status}: ${String(body.error?.message ?? 'request rejected').slice(0, 200)}` };
    return { ok: true, status: 'ok', message: `Connected: ${[body.verified_name, body.display_phone_number].filter(Boolean).join(' · ') || c.phoneNumberId}` };
  } catch (e) {
    return { ok: false, status: 'failed', message: `Could not reach the WhatsApp API: ${String((e as Error).message).slice(0, 150)}` };
  }
}

export function whatsappMessagesUrl(c: WhatsAppConfig) {
  return `${GRAPH}/${encodeURIComponent(c.phoneNumberId)}/messages`;
}
