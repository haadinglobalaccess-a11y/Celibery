import type { FilterQuery, Types } from 'mongoose';
import { z } from 'zod';
import { escapeRegex } from '../../lib/http';
import { logger } from '../../lib/logger';
import { randomToken, sha256 } from '../../lib/tokens';
import { CheckoutDraft, DRAFT_PROGRESS_FIELDS, PAYMENT_METHODS, getSettings, type CheckoutDraftDoc, type DraftProgressField, type DraftStatus } from '../../models';
import { quote } from '../orders/order.service';

/* ─────────────────────────── settings ─────────────────────────── */

export async function recoverySettings() {
  const s = await getSettings();
  const r = s?.checkoutRecovery ?? {};
  return {
    enabled: r.enabled !== false,
    abandonAfterMinutes: Number(r.abandonAfterMinutes ?? 60),
    retentionDays: Number(r.retentionDays ?? 30),
  };
}
const minutes = (n: number) => n * 60_000;
const days = (n: number) => n * 86_400_000;

/* ─────────────────────────── input & sanitising ─────────────────────────── */

/** True when the text contains a 13–19 digit number that passes the Luhn check (a payment card). */
export function containsCardNumber(text: string): boolean {
  for (const m of text.matchAll(/\d(?:[ -]?\d){12,18}/g)) {
    const digits = m[0].replace(/\D/g, '');
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

/** C0 and C1 control characters (built from code points so the source stays plain text). */
const CONTROL_CHARS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}-${String.fromCharCode(0x9f)}]`, 'g');

/** Trimmed, single-spaced, length-limited text without control characters or card numbers. */
export function cleanField(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const s = value
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return containsCardNumber(s) ? '' : s;
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
const digitsOf = (s: string) => s.replace(/\D/g, '');
/** Contact details are only kept once they are actually usable (not half-typed fragments). */
const usableEmail = (s: string) => (EMAIL.test(s) ? s.toLowerCase() : '');
const usablePhone = (s: string) => {
  const d = digitsOf(s);
  return d.length >= 9 && d.length <= 15 ? s.replace(/[^\d+]/g, '') : '';
};
const usableName = (s: string) => (s.length >= 2 ? s : '');

const loose = (max: number) => z.string().max(max * 4).optional();
/** Unknown keys (card fields or anything else) are dropped by zod before the service sees the input. */
export const draftInput = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  items: z.array(z.object({ productId: z.string().regex(/^[a-f0-9]{24}$/i), quantity: z.number().int().min(1).max(99) })).max(50).default([]),
  contact: z.object({ name: loose(120), email: loose(200), phone: loose(30) }).partial().default({}),
  shippingAddress: z
    .object({ fullName: loose(120), phone: loose(30), city: loose(80), district: loose(120), street: loose(200), buildingNumber: loose(10), postalCode: loose(10), shortAddress: loose(10) })
    .partial()
    .default({}),
  paymentMethod: z.enum(PAYMENT_METHODS).optional().or(z.literal('')),
  discountCode: z.string().max(40).optional(),
  lang: z.enum(['ar', 'en']).default('ar'),
});
export type DraftInput = z.infer<typeof draftInput>;

function sanitize(input: DraftInput) {
  const c = input.contact ?? {};
  const a = input.shippingAddress ?? {};
  return {
    contact: { name: usableName(cleanField(c.name, 120)), email: usableEmail(cleanField(c.email, 200)), phone: usablePhone(cleanField(c.phone, 30)) },
    shippingAddress: {
      fullName: usableName(cleanField(a.fullName, 120)),
      phone: usablePhone(cleanField(a.phone, 30)),
      city: cleanField(a.city, 80),
      district: cleanField(a.district, 120),
      street: cleanField(a.street, 200),
      buildingNumber: cleanField(a.buildingNumber, 10),
      postalCode: cleanField(a.postalCode, 10),
      shortAddress: cleanField(a.shortAddress, 10).toUpperCase(),
    },
    paymentMethod: input.paymentMethod ?? '',
    discountCode: cleanField(input.discountCode, 40).toUpperCase(),
    lang: input.lang,
  };
}

type Clean = ReturnType<typeof sanitize>;
function progressOf(d: Pick<Clean, 'contact' | 'shippingAddress' | 'paymentMethod'>) {
  const done: Record<DraftProgressField, boolean> = {
    name: Boolean(d.contact.name),
    email: Boolean(d.contact.email),
    phone: Boolean(d.contact.phone),
    fullName: Boolean(d.shippingAddress.fullName),
    addressPhone: Boolean(d.shippingAddress.phone),
    city: d.shippingAddress.city.length >= 2,
    district: d.shippingAddress.district.length >= 2,
    street: d.shippingAddress.street.length >= 2,
    paymentMethod: Boolean(d.paymentMethod),
  };
  const completed = DRAFT_PROGRESS_FIELDS.filter((f) => done[f]);
  return { completedFields: completed, progress: Math.round((completed.length / DRAFT_PROGRESS_FIELDS.length) * 100) };
}

/** Server-priced snapshot of the cart (prices from the database, never from the browser). */
async function pricedItems(items: DraftInput['items'], clean: Clean) {
  if (!items.length) return { items: [], subtotal: 0, total: 0, currency: 'SAR' };
  try {
    const q = await quote(items, { city: clean.shippingAddress.city || undefined, paymentMethod: clean.paymentMethod || undefined, discountCode: clean.discountCode || undefined });
    const lines = q.lines.filter((l) => l.available && l.quantity > 0);
    return {
      items: lines.map((l) => ({ product: l.productId, sku: l.sku, slug: l.slug, model: l.model, name: l.name, image: l.image, unitPrice: l.unitPrice, quantity: l.quantity, lineTotal: l.lineTotal })),
      subtotal: q.subtotal,
      total: q.total,
      currency: q.currency,
    };
  } catch (err) {
    logger.warn('Checkout draft pricing failed', { err: String(err) });
    return null; // keep the previously saved items
  }
}

/* ─────────────────────────── ownership ─────────────────────────── */

type Who = { customerId?: string };

/**
 * The draft a request may use: the one its token belongs to (never someone else's — a draft linked
 * to a customer account is only available to that signed-in customer), or the signed-in customer's
 * most recent unfinished draft. Converted drafts are finished: a new checkout starts a new draft.
 */
async function resolveDraft(token: string | undefined, who: Who) {
  if (token) {
    const d = await CheckoutDraft.findOne({ tokenHash: sha256(token) });
    if (d && d.status !== 'converted' && (!d.customer || String(d.customer) === who.customerId)) return d;
    if (d) return null;
  }
  if (who.customerId) return CheckoutDraft.findOne({ customer: who.customerId, status: { $ne: 'converted' } }).sort({ lastActivityAt: -1 });
  return null;
}

const isAbandoned = (d: Pick<CheckoutDraftDoc, 'status' | 'lastActivityAt'>, cutoff: Date) =>
  d.status === 'abandoned' || (d.status !== 'converted' && new Date(d.lastActivityAt) < cutoff);

/* ─────────────────────────── customer API ─────────────────────────── */

export async function saveDraft(input: DraftInput, who: Who) {
  const cfg = await recoverySettings();
  if (!cfg.enabled) return { enabled: false as const };
  const clean = sanitize(input);
  const now = new Date();
  const cutoff = new Date(now.getTime() - minutes(cfg.abandonAfterMinutes));
  const priced = await pricedItems(input.items, clean);
  const base = {
    ...clean,
    ...progressOf(clean),
    ...(priced ?? {}),
    lastActivityAt: now,
    expiresAt: new Date(now.getTime() + days(cfg.retentionDays)),
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await resolveDraft(input.token, who);
    if (existing) {
      const returned = isAbandoned(existing, cutoff);
      const set: Record<string, unknown> = { ...base };
      if (who.customerId && !existing.customer) set.customer = who.customerId;
      if (returned) Object.assign(set, { status: 'recovered', recoveredAt: now });
      const updated = await CheckoutDraft.findOneAndUpdate(
        { _id: existing._id, status: { $ne: 'converted' } },
        { $set: set, ...(returned ? { $inc: { returnCount: 1 } } : {}) },
        { new: true },
      ).lean();
      if (updated) return { enabled: true as const, token: null, status: updated.status as DraftStatus, progress: updated.progress, savedAt: now };
    }
    // New draft. The browser generates its token before the first save and reuses it for every request
    // (including the one sent while the page closes), so a lost response can never create a duplicate.
    // A token that already belongs to another or a finished checkout is never reused: a fresh one is issued.
    const own = input.token && !(await CheckoutDraft.exists({ tokenHash: sha256(input.token) })) ? input.token : null;
    const token = own ?? randomToken(32);
    try {
      const created = await CheckoutDraft.create({ ...base, tokenHash: sha256(token), customer: who.customerId, status: 'in_progress' });
      return { enabled: true as const, token: own ? null : token, status: created.status as DraftStatus, progress: created.progress, savedAt: now };
    } catch (err) {
      // Two first saves with the same token raced: the other one created it — update that one instead.
      if ((err as { code?: number }).code !== 11000 || attempt) throw err;
    }
  }
  throw new Error('Could not save checkout draft');
}

/** What the customer gets back to resume: their own entries and cart (no internal fields). */
export async function getDraftForCustomer(token: string | undefined, who: Who) {
  const cfg = await recoverySettings();
  if (!cfg.enabled) return null;
  const d = await resolveDraft(token, who);
  if (!d) return null;
  const now = new Date();
  // Coming back after the inactivity threshold counts as a recovered checkout.
  if (isAbandoned(d, new Date(now.getTime() - minutes(cfg.abandonAfterMinutes)))) {
    await CheckoutDraft.updateOne(
      { _id: d._id, status: { $ne: 'converted' } },
      { $set: { status: 'recovered', recoveredAt: now, lastActivityAt: now, expiresAt: new Date(now.getTime() + days(cfg.retentionDays)) }, $inc: { returnCount: 1 } },
    );
  }
  return {
    contact: d.contact,
    shippingAddress: d.shippingAddress,
    paymentMethod: d.paymentMethod,
    discountCode: d.discountCode,
    items: d.items.map((i) => ({ productId: String(i.product), slug: i.slug, model: i.model, name: i.name, image: i.image, price: i.unitPrice, quantity: i.quantity })),
    savedAt: d.lastActivityAt,
  };
}

/** The customer can erase what was saved ("Clear saved details"). */
export async function deleteDraftForCustomer(token: string | undefined, who: Who) {
  const d = await resolveDraft(token, who);
  if (!d) return { deleted: false };
  await CheckoutDraft.deleteOne({ _id: d._id, status: { $ne: 'converted' } });
  return { deleted: true };
}

/**
 * Links the checkout to the order it produced (status "converted"). Idempotent: a replayed checkout
 * request links nothing twice, and one order can only ever belong to one draft (unique index).
 */
export async function markConverted(token: string | undefined, who: Who, order: { _id: Types.ObjectId | string; orderNumber: string }) {
  try {
    const d = await resolveDraft(token, who);
    if (!d) return false;
    const cfg = await recoverySettings();
    const now = new Date();
    const r = await CheckoutDraft.updateOne(
      { _id: d._id, status: { $ne: 'converted' } },
      { $set: { status: 'converted', convertedAt: now, lastActivityAt: now, order: order._id, orderNumber: order.orderNumber, expiresAt: new Date(now.getTime() + days(cfg.retentionDays)) } },
    );
    return r.modifiedCount === 1;
  } catch (err) {
    // Never fail a successful order because of draft bookkeeping (e.g. the order is already linked).
    logger.warn('Could not link checkout draft to order', { err: String(err) });
    return false;
  }
}

/* ─────────────────────────── scheduled job ─────────────────────────── */

/** Records abandonment (time = last activity + threshold) for checkouts that went quiet. */
export async function markAbandonedDrafts() {
  const cfg = await recoverySettings();
  const ms = minutes(cfg.abandonAfterMinutes);
  const r = await CheckoutDraft.updateMany({ status: { $in: ['in_progress', 'recovered'] }, lastActivityAt: { $lt: new Date(Date.now() - ms) } }, [
    { $set: { status: 'abandoned', abandonedAt: { $add: ['$lastActivityAt', ms] } } },
  ]);
  return { abandoned: r.modifiedCount };
}

/* ─────────────────────────── admin ─────────────────────────── */

export const ADMIN_FILTERS = ['incomplete', 'abandoned_recent', 'abandoned', 'in_progress', 'recovered', 'converted', 'all'] as const;
export type AdminFilter = (typeof ADMIN_FILTERS)[number];
const RECENT_DAYS = 7;

/** Status filters evaluated from last activity, so they are correct even before the job has run. */
function filterFor(f: AdminFilter, cutoff: Date): FilterQuery<CheckoutDraftDoc> {
  const abandoned = { status: { $ne: 'converted' }, $or: [{ status: 'abandoned' }, { lastActivityAt: { $lt: cutoff } }] };
  switch (f) {
    case 'incomplete':
      return { status: { $ne: 'converted' } };
    case 'abandoned':
      return abandoned;
    case 'abandoned_recent':
      return { $and: [abandoned, { lastActivityAt: { $gte: new Date(Date.now() - days(RECENT_DAYS)) } }] };
    case 'in_progress':
      return { status: 'in_progress', lastActivityAt: { $gte: cutoff } };
    case 'recovered':
      return { status: 'recovered', lastActivityAt: { $gte: cutoff } };
    case 'converted':
      return { status: 'converted' };
    default:
      return {};
  }
}

export function effectiveStatus(d: Pick<CheckoutDraftDoc, 'status' | 'lastActivityAt'>, cutoff: Date): DraftStatus {
  if (d.status === 'converted') return 'converted';
  return isAbandoned(d, cutoff) ? 'abandoned' : (d.status as DraftStatus);
}

function adminView(d: CheckoutDraftDoc, cfg: { abandonAfterMinutes: number }, cutoff: Date) {
  const status = effectiveStatus(d, cutoff);
  const missingFields = DRAFT_PROGRESS_FIELDS.filter((f) => !(d.completedFields ?? []).includes(f));
  return {
    id: String(d._id),
    status,
    customer: d.customer ? String(d.customer) : null,
    contact: d.contact,
    shippingAddress: d.shippingAddress,
    paymentMethod: d.paymentMethod,
    discountCode: d.discountCode,
    lang: d.lang,
    items: d.items.map((i) => ({ productId: String(i.product), sku: i.sku, slug: i.slug, model: i.model, name: i.name, image: i.image, unitPrice: i.unitPrice, quantity: i.quantity, lineTotal: i.lineTotal })),
    itemCount: d.items.reduce((s, i) => s + i.quantity, 0),
    currency: d.currency,
    subtotal: d.subtotal,
    total: d.total,
    progress: d.progress,
    completedFields: d.completedFields,
    missingFields,
    startedAt: d.createdAt,
    lastActivityAt: d.lastActivityAt,
    abandonedAt: status === 'abandoned' ? (d.abandonedAt ?? new Date(new Date(d.lastActivityAt).getTime() + minutes(cfg.abandonAfterMinutes))) : (d.abandonedAt ?? null),
    returned: (d.returnCount ?? 0) > 0,
    returnCount: d.returnCount ?? 0,
    recoveredAt: d.recoveredAt ?? null,
    convertedAt: d.convertedAt ?? null,
    order: d.order ? { id: String(d.order), orderNumber: d.orderNumber } : null,
    expiresAt: d.expiresAt,
  };
}

export async function adminListDrafts(q: { filter: AdminFilter; q?: string; page: number; limit: number }) {
  const cfg = await recoverySettings();
  const cutoff = new Date(Date.now() - minutes(cfg.abandonAfterMinutes));
  const status = filterFor(q.filter, cutoff);
  let where: FilterQuery<CheckoutDraftDoc> = status;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    const search = { $or: [{ 'contact.name': rx }, { 'contact.email': rx }, { 'contact.phone': rx }, { 'shippingAddress.fullName': rx }, { 'shippingAddress.phone': rx }, { orderNumber: rx }] };
    where = { $and: [status, search] };
  }
  const [items, total, counts] = await Promise.all([
    CheckoutDraft.find(where).sort({ lastActivityAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    CheckoutDraft.countDocuments(where),
    Promise.all(ADMIN_FILTERS.map(async (f) => [f, await CheckoutDraft.countDocuments(filterFor(f, cutoff))] as const)),
  ]);
  return {
    items: items.map((d) => adminView(d as CheckoutDraftDoc, cfg, cutoff)),
    total,
    page: q.page,
    pages: Math.max(1, Math.ceil(total / q.limit)),
    counts: Object.fromEntries(counts),
    abandonAfterMinutes: cfg.abandonAfterMinutes,
    retentionDays: cfg.retentionDays,
  };
}

export async function adminGetDraft(id: string) {
  const cfg = await recoverySettings();
  const d = await CheckoutDraft.findById(id).lean();
  if (!d) return null;
  return adminView(d as CheckoutDraftDoc, cfg, new Date(Date.now() - minutes(cfg.abandonAfterMinutes)));
}
