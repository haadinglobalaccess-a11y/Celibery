import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { forbidden, notFound } from '../../lib/errors';
import { ah, ok } from '../../lib/http';
import { logger } from '../../lib/logger';
import { safeEqual } from '../../lib/tokens';
import { securityEvent } from '../../lib/security-log';
import { sandboxAllowed } from '../../integrations/payments';
import { SandboxPayment } from '../../integrations/payments/sandbox';
import { Payment, ProcessedEvent } from '../../models';
import { validate } from '../../middleware/validate';
import { integration } from '../../integrations/credentials';
import { verifyPayment } from './payment.service';
import { claimDecision, responseFor, sanitizeError, WEBHOOK_LEASE_MS, type ClaimDecision, type WebhookStatus } from './webhook-lifecycle';

export const paymentRoutes = Router();

/**
 * Webhook secret for a provider: the encrypted admin-managed value once an administrator manages
 * the integration, otherwise the legacy environment variable (read live).
 */
function webhookSecret(provider: 'moyasar' | 'tabby'): string {
  const i = integration(provider);
  if (i.source === 'admin') return i.values.webhookSecret ?? '';
  return provider === 'moyasar' ? env.MOYASAR_WEBHOOK_SECRET : env.TABBY_WEBHOOK_SECRET;
}

type Claim = { decision: ClaimDecision; id?: unknown };

/**
 * Claims a webhook event for processing (webhook-lifecycle.ts). Exactly one delivery processes an
 * event at a time; an event becomes "processed" only after its handler succeeded, so a failure is
 * retried on the provider's next delivery instead of being dropped as a duplicate.
 */
async function claimEvent(provider: string, eventId: string): Promise<Claim> {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + WEBHOOK_LEASE_MS);
  try {
    const doc = await ProcessedEvent.create({ provider, eventId, status: 'processing', attempts: 1, lockedUntil });
    return { decision: 'claim', id: doc._id };
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
  }
  const existing = await ProcessedEvent.findOne({ provider, eventId }).lean<{ _id: unknown; status?: WebhookStatus; lockedUntil?: Date; attempts?: number; updatedAt?: Date }>();
  if (!existing) return { decision: 'in_progress' };
  const decision = claimDecision(existing, now);
  if (decision !== 'claim') return { decision };
  // Take over atomically: only if nobody else changed the record since we read it.
  const taken = await ProcessedEvent.findOneAndUpdate(
    { _id: existing._id, status: existing.status ?? { $exists: false }, updatedAt: existing.updatedAt },
    { $set: { status: 'processing', lockedUntil }, $inc: { attempts: 1 } },
    { new: true },
  ).lean();
  return taken ? { decision: 'claim', id: existing._id } : { decision: 'in_progress' };
}

async function finishEvent(id: unknown, status: WebhookStatus, detail: { result?: string; error?: unknown } = {}) {
  await ProcessedEvent.updateOne(
    { _id: id },
    {
      $set: {
        status,
        result: (detail.result ?? '').slice(0, 100),
        lastError: detail.error ? sanitizeError(detail.error) : '',
        ...(status === 'processed' ? { processedAt: new Date() } : {}),
      },
      $unset: { lockedUntil: 1 },
    },
  ).catch((err: unknown) => logger.error('Could not record webhook outcome', { err: sanitizeError(err) }));
}

/** Runs one webhook event through the lifecycle and answers the provider. */
async function handleEvent(res: Response, provider: 'moyasar' | 'tabby', eventId: string, ref: string) {
  const claim = await claimEvent(provider, eventId);
  if (claim.decision !== 'claim') {
    const r = responseFor(claim.decision);
    return res.status(r.status).json({ ok: r.status < 300, data: r.body });
  }
  const payment = await Payment.findOne({ provider, providerRef: ref }).lean();
  if (!payment) {
    // Possibly a delivery that raced ahead of our own record: allowed to be retried later.
    logger.warn('Webhook for unknown payment', { provider, ref });
    await finishEvent(claim.id, 'ignored', { result: 'unknown_payment' });
    return ok(res, { ignored: true });
  }
  try {
    // The webhook body is never trusted for the outcome: the status is fetched from the gateway.
    const result = await verifyPayment(String(payment._id));
    await finishEvent(claim.id, 'processed', { result: String(result) });
    return ok(res, { result });
  } catch (err) {
    await finishEvent(claim.id, 'failed', { error: err });
    logger.warn('Webhook processing failed — the provider will retry', { provider, eventId, err: sanitizeError(err) });
    throw err; // non-2xx → the provider re-delivers
  }
}

/** Moyasar webhook: shared secret in the payload, then the status is fetched from Moyasar's API. */
paymentRoutes.post(
  '/webhooks/moyasar',
  ah(async (req: Request, res: Response) => {
    const secret = webhookSecret('moyasar');
    const body = req.body as { id?: string; type?: string; secret_token?: string; data?: { id?: string; invoice_id?: string } };
    // Invalid signatures are rejected before any record is written.
    if (!secret || !body?.secret_token || !safeEqual(String(body.secret_token), secret)) {
      securityEvent('webhook.bad_signature', req, { provider: 'moyasar', configured: Boolean(secret) });
      throw forbidden('Invalid webhook signature');
    }
    const ref = body.data?.invoice_id;
    if (!ref || !body.id) return ok(res, { ignored: true });
    return handleEvent(res, 'moyasar', String(body.id), String(ref));
  }),
);

/** Tabby webhook — authenticated by the secret header configured when registering the webhook. */
paymentRoutes.post(
  '/webhooks/tabby',
  ah(async (req: Request, res: Response) => {
    const secret = webhookSecret('tabby');
    const given = req.get('x-celibery-webhook-secret') ?? '';
    if (!secret || !safeEqual(given, secret)) {
      securityEvent('webhook.bad_signature', req, { provider: 'tabby', configured: Boolean(secret) });
      throw forbidden('Invalid webhook signature');
    }
    const body = req.body as { id?: string; status?: string };
    if (!body?.id) return ok(res, { ignored: true });
    return handleEvent(res, 'tabby', `${body.id}:${String(body.status ?? '').toLowerCase()}`, String(body.id));
  }),
);

// ---- Sandbox gateway (development / private staging only) ---------------------------

const refParam = z.object({ ref: z.string().regex(/^sbx_[A-Za-z0-9_-]{8,40}$/) });

function requireSandbox(_req: Request, _res: Response, next: (e?: unknown) => void) {
  if (env.PAYMENT_GATEWAY !== 'sandbox' || !sandboxAllowed()) return next(notFound());
  next();
}

paymentRoutes.get(
  '/payments/sandbox/:ref',
  requireSandbox,
  validate(refParam, 'params'),
  ah(async (req, res) => {
    const p = await SandboxPayment.findOne({ ref: req.params.ref }).select('ref amount currency method status orderNumber').lean();
    if (!p) throw notFound('Payment');
    return ok(res, p);
  }),
);

paymentRoutes.post(
  '/payments/sandbox/:ref/complete',
  requireSandbox,
  validate(refParam, 'params'),
  validate(z.object({ outcome: z.enum(['success', 'failure', 'cancel']) })),
  ah(async (req, res) => {
    const p = await SandboxPayment.findOne({ ref: req.params.ref });
    if (!p) throw notFound('Payment');
    if (p.status === 'pending') {
      const outcome = req.body.outcome as 'success' | 'failure' | 'cancel';
      p.status = outcome === 'success' ? (p.method === 'tabby' ? 'authorized' : 'paid') : outcome === 'cancel' ? 'cancelled' : 'failed';
      await p.save();
    }
    const url = p.status === 'paid' || p.status === 'authorized' ? p.returnUrl : p.cancelUrl;
    return ok(res, { status: p.status, redirectUrl: url });
  }),
);
