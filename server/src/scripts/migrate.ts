/**
 * Safe, idempotent upgrade for existing databases (premium upgrade, 3 Nov 2026).
 *
 *   npm run migrate                 # apply
 *   npm run migrate -- --dry-run    # report only, change nothing
 *   npm run migrate -- --reencrypt  # after rotating CREDENTIALS_ENCRYPTION_KEY
 *
 * What it does — never deletes or overwrites business data:
 *  1. Roles: creates the new default roles (Administrator, Product Manager) if missing; adds the
 *     new permissions where the role already had the equivalent power before the upgrade
 *     (content/product editors → media:write; roles with settings:write → business:write);
 *     the Super Administrator always holds every permission. Renames default role labels only if
 *     they still carry the old default name.
 *  2. Pages: adds the new "refunds" policy page as a DRAFT if it does not exist.
 *  3. Orders: sets refundReservedAmount = 0 where missing (schema default covers reads anyway).
 *  4. Refund ledger: creates "legacy" succeeded Refund records for refunds recorded on payments
 *     before the ledger existed, so history and reconciliation see them.
 *  5. Webhook events: legacy ProcessedEvent records (no status) are marked "processed".
 *  6. --reencrypt: re-encrypts stored credentials with the current CREDENTIALS_ENCRYPTION_KEY.
 */
import { DEFAULT_ROLES, PERMISSIONS } from '../lib/permissions';
import { decryptSecret, encryptSecret, needsReencryption } from '../lib/secrets';
import { keyRing, secretContext } from '../integrations/credentials';
import type { IntegrationKey, Mode } from '../integrations/credentials/definitions';
import { IntegrationCredential, Order, Page, Payment, ProcessedEvent, Refund, Role, WITH_SECRETS } from '../models';
import { PAGES } from '../seed/base-data';
import { run } from './_run';

const dry = process.argv.includes('--dry-run');
const reencrypt = process.argv.includes('--reencrypt');
const log = (msg: string) => console.log(`${dry ? '[dry-run] ' : ''}${msg}`); // eslint-disable-line no-console

const OLD_NAMES: Record<string, string> = { admin: 'Administrator', content_editor: 'Content Editor' };

run(async () => {
  // 1. Roles ------------------------------------------------------------------------------
  for (const r of DEFAULT_ROLES) {
    const existing = await Role.findOne({ key: r.key }).lean();
    if (!existing) {
      log(`Create role ${r.key} (${r.name.en})`);
      if (!dry) await Role.create(r);
      continue;
    }
    const perms = new Set(existing.permissions as string[]);
    const add: string[] = [];
    if (r.key === 'admin') for (const p of PERMISSIONS) if (!perms.has(p)) add.push(p);
    if ((perms.has('content:write') || perms.has('products:write')) && !perms.has('media:write') && r.key !== 'sales_executive') add.push('media:write');
    if (perms.has('settings:write') && !perms.has('business:write')) add.push('business:write');
    // customers:write (suspend / reactivate accounts) was added later: grant it to the default roles defined with it.
    if (r.permissions.includes('customers:write') && !perms.has('customers:write')) add.push('customers:write');
    if (add.length) {
      log(`Role ${r.key}: add ${[...new Set(add)].join(', ')}`);
      if (!dry) await Role.updateOne({ _id: existing._id }, { $addToSet: { permissions: { $each: [...new Set(add)] } } });
    }
    if (OLD_NAMES[r.key] && existing.name?.en === OLD_NAMES[r.key]) {
      log(`Role ${r.key}: rename "${OLD_NAMES[r.key]}" → "${r.name.en}"`);
      if (!dry) await Role.updateOne({ _id: existing._id }, { $set: { name: r.name } });
    }
  }
  // Custom roles created by staff: keep parity for media (they could already set image URLs).
  const custom = await Role.find({ key: { $nin: DEFAULT_ROLES.map((r) => r.key) }, permissions: { $in: ['content:write', 'products:write'] }, 'permissions.0': { $exists: true } }).lean();
  for (const r of custom) {
    if ((r.permissions as string[]).includes('media:write')) continue;
    log(`Custom role ${r.key}: add media:write`);
    if (!dry) await Role.updateOne({ _id: r._id }, { $addToSet: { permissions: 'media:write' } });
  }

  // 2. Pages -------------------------------------------------------------------------------
  for (const p of PAGES) {
    if (!(await Page.exists({ slug: p.slug }))) {
      log(`Create draft page ${p.slug}`);
      if (!dry) await Page.create({ ...p, status: 'draft' });
    }
  }

  // 3. Orders ------------------------------------------------------------------------------
  const missing = await Order.countDocuments({ refundReservedAmount: { $exists: false } });
  if (missing) {
    log(`Orders: set refundReservedAmount=0 on ${missing} order(s)`);
    if (!dry) await Order.updateMany({ refundReservedAmount: { $exists: false } }, { $set: { refundReservedAmount: 0 } });
  }

  // 4. Legacy refunds → ledger ----------------------------------------------------------------
  const payments = await Payment.find({ 'refunds.0': { $exists: true } }).lean();
  let legacy = 0;
  for (const p of payments) {
    for (let i = 0; i < (p.refunds ?? []).length; i++) {
      const r = p.refunds[i] as { amount?: number; providerRefundId?: string; reason?: string; by?: unknown; at?: Date; refund?: unknown };
      if (r.refund) continue;
      const key = `legacy_${p._id}_${i}`;
      if (await Refund.exists({ idempotencyKey: key })) continue;
      legacy++;
      if (dry) continue;
      const doc = await Refund.create({
        order: p.order,
        payment: p._id,
        provider: p.provider,
        amount: r.amount ?? 0,
        reason: r.reason ?? '',
        idempotencyKey: key,
        status: 'succeeded',
        providerRefundId: r.providerRefundId ?? '',
        requestedBy: r.by,
        completedAt: r.at,
        legacy: true,
        history: [{ status: 'succeeded', note: 'Imported from the payment record (before the refund ledger)', at: r.at ?? new Date() }],
      });
      await Payment.updateOne({ _id: p._id }, { $set: { [`refunds.${i}.refund`]: doc._id } });
      await Order.updateOne({ _id: p.order, appliedRefunds: { $ne: doc._id } }, { $push: { appliedRefunds: doc._id } });
    }
  }
  if (legacy) log(`Refund ledger: ${legacy} legacy refund(s) recorded`);

  // 5. Webhook events ---------------------------------------------------------------------------
  const oldEvents = await ProcessedEvent.countDocuments({ status: { $exists: false } });
  if (oldEvents) {
    log(`Webhook events: mark ${oldEvents} legacy record(s) as processed`);
    if (!dry) await ProcessedEvent.updateMany({ status: { $exists: false } }, { $set: { status: 'processed' } });
  }

  // 6. Re-encrypt credentials -----------------------------------------------------------------------
  if (reencrypt) {
    const ring = keyRing();
    if (!ring) throw new Error('CREDENTIALS_ENCRYPTION_KEY is not configured');
    const docs = await IntegrationCredential.find().select(WITH_SECRETS).lean();
    for (const d of docs) {
      for (const mode of ['test', 'live'] as Mode[]) {
        const secrets = d.modes?.[mode]?.secrets ?? {};
        for (const [field, cipher] of Object.entries(secrets as Record<string, string>)) {
          if (!cipher || !needsReencryption(cipher, ring)) continue;
          const ctx = secretContext(d.provider as IntegrationKey, mode, field);
          const plain = decryptSecret(cipher, ring, ctx);
          log(`Re-encrypt ${d.provider} ${mode} ${field}`);
          if (!dry) await IntegrationCredential.updateOne({ _id: d._id }, { $set: { [`modes.${mode}.secrets.${field}`]: encryptSecret(plain, ring, ctx) } });
        }
      }
    }
  }
  log('Migration complete.');
});
