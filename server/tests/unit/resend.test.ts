import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateFieldValue } from '../../src/integrations/credentials/definitions';
import { emailError, sendEmailWith, verifyResend, type EmailConfig } from '../../src/integrations/notifications/providers';

/** Resend (email over HTTPS): request shape, error messages and key checks — fetch is stubbed. */
const account: EmailConfig = { kind: 'resend', apiKey: 're_test_123456789', fromEmail: 'orders@celibery.test', fromName: 'CELIBERY International', replyTo: 'support@celibery.test' };
const content = { subject: 'Your order has shipped', html: '<p>Hi</p>', text: 'Hi' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('Resend email', () => {
  it('posts the message to the Resend API with sender name, reply-to and both bodies', async () => {
    const fetchMock = vi.fn(async () => json(200, { id: 'abc' }));
    vi.stubGlobal('fetch', fetchMock);
    await sendEmailWith(account, 'customer@example.com', content);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_123456789');
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'CELIBERY International <orders@celibery.test>',
      to: ['customer@example.com'],
      subject: 'Your order has shipped',
      html: '<p>Hi</p>',
      text: 'Hi',
      reply_to: 'support@celibery.test',
    });
  });

  it('throws with a readable reason when Resend refuses the message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(403, { name: 'validation_error', message: 'The celibery.test domain is not verified.' })));
    const err = await sendEmailWith(account, 'customer@example.com', content).catch((e) => e);
    expect(emailError(err, account)).toMatch(/domain is not verified/);
    expect(emailError(err, account)).toMatch(/check the API key/);
  });

  it('accepts a sending-only key and checks the sender domain with a full-access key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { name: 'restricted_api_key', message: 'This API key is restricted to only send emails' })));
    expect((await verifyResend({ apiKey: 're_x123456789', fromEmail: 'orders@celibery.test' })).ok).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => json(200, { data: [{ name: 'celibery.test', status: 'pending' }] })));
    const pending = await verifyResend({ apiKey: 're_x123456789', fromEmail: 'orders@celibery.test' });
    expect(pending.ok).toBe(false);
    expect(pending.message).toMatch(/pending/);

    vi.stubGlobal('fetch', vi.fn(async () => json(200, { data: [{ name: 'celibery.test', status: 'verified' }] })));
    expect((await verifyResend({ apiKey: 're_x123456789', fromEmail: 'orders@celibery.test' })).ok).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => json(401, { name: 'validation_error', message: 'API key is invalid' })));
    expect((await verifyResend({ apiKey: 're_bad123456789', fromEmail: 'orders@celibery.test' })).ok).toBe(false);
  });

  it('validates the admin fields', () => {
    expect(validateFieldValue('resend', 'apiKey', 'live', 'sk_live_123')).toMatch(/start with re_/);
    expect(validateFieldValue('resend', 'apiKey', 'live', 're_AbC123456_xyz')).toBeNull();
    expect(validateFieldValue('resend', 'fromEmail', 'live', 'not-an-email')).toMatch(/valid email/);
    expect(validateFieldValue('resend', 'fromName', 'live', 'CELIBERY International')).toBeNull();
  });
});
