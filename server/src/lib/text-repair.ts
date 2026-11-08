import fs from 'node:fs';
import path from 'node:path';
import { Types, type Model } from 'mongoose';
import { Banner, Campaign, Category, MessageTemplate, Order, Page, Product, ProductCollection, Settings } from '../models';
import { hasReplacementChar, repairMojibake } from './text';

/**
 * Finds and repairs encoding damage in stored, customer-visible text (product names and descriptions,
 * categories, collections, banners, campaigns, policy pages, settings, message templates).
 *
 * Safe by construction:
 *  - only strings whose damage reverses EXACTLY (UTF-8 read as Windows-1252) are changed; nothing is
 *    guessed, rewritten or translated. Text containing "\ufffd" lost its characters before it was saved and
 *    is only reported — it must be re-entered from the original;
 *  - before anything is written, every original value is saved to a JSON backup file;
 *  - each update applies only if the field still holds the value that was scanned (no lost edits);
 *  - `restoreTextRepairs(backup)` puts every original value back.
 * Orders are financial records: their item names are reported, and repaired only on explicit request.
 */
export type TextFinding = { collection: string; id: string; path: string; before: string; after: string | null };

const SKIP_KEYS = new Set(['_id', '__v', 'passwordHash', 'accessTokenHash', 'tokenVersion', 'idempotencyKey', 'createdAt', 'updatedAt']);

function walk(value: unknown, at: string, out: { path: string; before: string; after: string | null }[]) {
  if (typeof value === 'string') {
    const fixed = repairMojibake(value);
    if (fixed !== value) out.push({ path: at, before: value, after: fixed });
    else if (hasReplacementChar(value)) out.push({ path: at, before: value, after: null });
    return;
  }
  if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${at}.${i}`, out));
  if (value && typeof value === 'object' && !(value instanceof Date) && (value as { _bsontype?: string })._bsontype === undefined) {
    for (const [k, v] of Object.entries(value)) if (!SKIP_KEYS.has(k)) walk(v, at ? `${at}.${k}` : k, out);
  }
}

const CONTENT: Model<never>[] = [Product, Category, ProductCollection, Banner, Campaign, Page, Settings, MessageTemplate] as unknown as Model<never>[];

export async function scanStoredText(): Promise<TextFinding[]> {
  const findings: TextFinding[] = [];
  const scan = async (model: Model<never>, projection?: Record<string, 1>) => {
    const cursor = model.collection.find({}, projection ? { projection } : undefined);
    for await (const doc of cursor) {
      const found: { path: string; before: string; after: string | null }[] = [];
      walk(doc, '', found);
      for (const f of found) findings.push({ collection: model.collection.collectionName, id: String(doc._id), ...f });
    }
  };
  for (const m of CONTENT) await scan(m);
  // Order item names are shown in order history (reported always; repaired only with includeOrders).
  await scan(Order as unknown as Model<never>, { 'items.name': 1 });
  return findings;
}

const collectionByName = (name: string) => {
  const all = [...CONTENT, Order as unknown as Model<never>];
  const m = all.find((x) => x.collection.collectionName === name);
  if (!m) throw new Error(`Unknown collection ${name}`);
  return m.collection;
};

/** Writes the backup first, then applies each reversible repair conditionally. Returns the backup path. */
export async function applyTextRepairs(findings: TextFinding[], backupDir: string, opts: { includeOrders?: boolean } = {}) {
  const orders = Order.collection.collectionName;
  const todo = findings.filter((f) => f.after !== null && (opts.includeOrders || f.collection !== orders));
  fs.mkdirSync(backupDir, { recursive: true });
  const file = path.join(backupDir, `text-repair-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), repairs: todo }, null, 2), 'utf8');
  let applied = 0;
  const skipped: TextFinding[] = [];
  for (const f of todo) {
    const r = await collectionByName(f.collection).updateOne({ _id: toId(f.id), [f.path]: f.before }, { $set: { [f.path]: f.after } });
    if (r.modifiedCount === 1) applied++;
    else skipped.push(f); // changed since the scan: left as it is
  }
  return { backup: file, applied, skipped };
}

/** Undoes a previous apply from its backup file (only where the repaired value is still in place). */
export async function restoreTextRepairs(backupFile: string) {
  const { repairs } = JSON.parse(fs.readFileSync(backupFile, 'utf8')) as { repairs: TextFinding[] };
  let restored = 0;
  for (const f of repairs) {
    const r = await collectionByName(f.collection).updateOne({ _id: toId(f.id), [f.path]: f.after }, { $set: { [f.path]: f.before } });
    if (r.modifiedCount === 1) restored++;
  }
  return { restored, total: repairs.length };
}

/** Every scanned collection uses ObjectId ids. */
const toId = (id: string) => new Types.ObjectId(id);
