import { Types } from 'mongoose';
import { env } from '../../config/env';
import { conflict, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { Product, RestockSubscription, templateOverride } from '../../models';
import { sendEmail } from '../../integrations/notifications';
import { backInStockEmail } from '../../integrations/notifications/templates';

/**
 * "Notify me when restocked".
 *
 * Delivery is a sweep, not a hook on one code path: stock can come back through an admin
 * adjustment, a CSV import, a cancelled/expired order releasing its reservation, or a return being
 * restocked. The sweep looks for open requests whose product is active and in stock, so every path
 * is covered. It runs right after admin stock changes and on the scheduled job.
 *
 * Exactly-once per request: each request is claimed atomically (active → sending) before its email
 * is sent, so concurrent sweeps (several instances, cron + admin trigger) never email twice. Then:
 *  - provider accepted the email      → notified (closed)
 *  - email not configured ("skipped") → back to active, retried in 1 h, attempt not counted
 *  - delivery failed                  → back to active with backoff; failed after MAX_ATTEMPTS
 * A request stuck in "sending" (process died mid-send) is released after STALE_SENDING_MS. In that
 * rare case the customer may get the email twice — never zero times.
 */

const MAX_ATTEMPTS = 5;
const STALE_SENDING_MS = 15 * 60_000;
const NOT_CONFIGURED_RETRY_MS = 60 * 60_000;
const backoffMs = (attempt: number) => Math.min(6 * 3_600_000, 5 * 60_000 * 2 ** (attempt - 1)); // 5 min, 10, 20, 40… ≤ 6 h

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const validEmail = (e: string) => e.length <= 254 && EMAIL_RX.test(e);

/** Creates (or keeps) the open request for this product + email. Idempotent. */
export async function subscribe(slug: string, input: { email: string; lang: 'ar' | 'en'; userId?: string }) {
  const product = await Product.findOne({ slug, status: 'active' }).select('_id stock').lean();
  if (!product) throw notFound('Product');
  if (product.stock > 0) throw conflict('IN_STOCK', 'This product is in stock');
  const email = input.email.trim().toLowerCase();
  try {
    await RestockSubscription.updateOne(
      { product: product._id, email, open: true },
      { $setOnInsert: { product: product._id, email, user: input.userId ?? null, lang: input.lang, status: 'active', open: true, nextAttemptAt: new Date() } },
      { upsert: true },
    );
  } catch (e) {
    // Two identical requests at the same moment: the unique index kept one — same outcome.
    if ((e as { code?: number }).code !== 11000) throw e;
  }
  // Same answer whether or not this email had already asked (does not reveal other sign-ups).
  return { subscribed: true };
}

async function releaseStaleClaims() {
  await RestockSubscription.updateMany(
    { status: 'sending', claimedAt: { $lt: new Date(Date.now() - STALE_SENDING_MS) } },
    { $set: { status: 'active', nextAttemptAt: new Date() } },
  );
}

type SweepResult = { sent: number; retry: number; failed: number; skipped: number; products: number };

/** Sends due notifications for in-stock products (optionally only `productIds`). Never throws. */
export async function sweepRestock(opts: { productIds?: string[]; limit?: number } = {}): Promise<SweepResult> {
  const result: SweepResult = { sent: 0, retry: 0, failed: 0, skipped: 0, products: 0 };
  try {
    await releaseStaleClaims();
    const now = new Date();
    const dueFilter: Record<string, unknown> = { status: 'active', nextAttemptAt: { $lte: now } };
    if (opts.productIds?.length) dueFilter.product = { $in: opts.productIds };
    const productIds = await RestockSubscription.distinct('product', dueFilter);
    if (!productIds.length) return result;
    const products = await Product.find({ _id: { $in: productIds }, status: 'active', stock: { $gt: 0 } }).select('slug name').lean();
    let budget = opts.limit ?? 200;
    for (const p of products) {
      result.products++;
      while (budget > 0) {
        // Claim one due request for this product (atomic: no other worker can take it).
        const sub = await RestockSubscription.findOneAndUpdate(
          { product: p._id, status: 'active', nextAttemptAt: { $lte: new Date() } },
          { $set: { status: 'sending', claimedAt: new Date() } },
          { new: true, sort: { createdAt: 1 } },
        ).lean();
        if (!sub) break;
        budget--;
        // Stock may have run out again while we were sending: stop and leave the rest waiting.
        const still = await Product.exists({ _id: p._id, status: 'active', stock: { $gt: 0 } });
        if (!still) {
          await RestockSubscription.updateOne({ _id: sub._id, status: 'sending' }, { $set: { status: 'active' } });
          break;
        }
        const lang = sub.lang === 'en' ? 'en' : 'ar';
        const name = p.name?.[lang] || p.name?.[lang === 'ar' ? 'en' : 'ar'] || p.slug;
        const link = `${env.PUBLIC_SITE_URL.replace(/\/$/, '')}/${lang}/p/${p.slug}`;
        let outcome: 'sent' | 'skipped' | 'failed';
        try {
          outcome = (await sendEmail(sub.email, backInStockEmail(lang, name, link, await templateOverride('product.back_in_stock')), { template: 'product.back_in_stock', user: sub.user ?? undefined })).status;
        } catch (e) {
          logger.warn('Restock notification error', { err: String(e) });
          outcome = 'failed';
        }
        if (outcome === 'sent') {
          await RestockSubscription.updateOne({ _id: sub._id }, { $set: { status: 'notified', open: false, notifiedAt: new Date(), lastError: '' }, $inc: { attempts: 1 } });
          result.sent++;
        } else if (outcome === 'skipped') {
          await RestockSubscription.updateOne({ _id: sub._id }, { $set: { status: 'active', lastError: 'Email (SMTP) is not configured', nextAttemptAt: new Date(Date.now() + NOT_CONFIGURED_RETRY_MS) } });
          result.skipped++;
          return result; // nothing can be sent until email is configured
        } else {
          const attempts = (sub.attempts ?? 0) + 1;
          const giveUp = attempts >= MAX_ATTEMPTS;
          await RestockSubscription.updateOne(
            { _id: sub._id },
            {
              $set: giveUp
                ? { status: 'failed', open: false, attempts, lastError: 'Delivery failed repeatedly' }
                : { status: 'active', attempts, lastError: 'Delivery failed — will retry', nextAttemptAt: new Date(Date.now() + backoffMs(attempts)) },
            },
          );
          if (giveUp) result.failed++;
          else result.retry++;
        }
      }
      if (budget <= 0) break;
    }
  } catch (e) {
    logger.warn('Restock sweep failed', { err: String(e) });
  }
  return result;
}

/** Fire-and-forget sweep after a stock change (the scheduled job is the safety net). */
export function triggerRestock(productIds: string[]) {
  if (!productIds.length) return;
  void sweepRestock({ productIds }).catch(() => undefined);
}

/** Admin: requests for one product, newest first, plus counts. */
export async function forProduct(productId: string) {
  const [items, counts] = await Promise.all([
    RestockSubscription.find({ product: productId }).sort({ createdAt: -1 }).limit(200).select('email lang status attempts lastError notifiedAt createdAt').lean(),
    RestockSubscription.aggregate<{ _id: string; n: number }>([{ $match: { product: new Types.ObjectId(productId) } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  return { items, counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) as Record<string, number> };
}
