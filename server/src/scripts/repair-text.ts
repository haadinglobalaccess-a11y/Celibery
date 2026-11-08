/**
 * Finds (and, on request, repairs) encoding damage in stored customer-visible text.
 *
 *   npm run repair:text                          # dry run: lists every affected record, changes nothing
 *   npm run repair:text -- --apply               # backup of original values first, then repair
 *   npm run repair:text -- --apply --include-orders   # also order item-name snapshots
 *   npm run repair:text -- --restore <backup.json>    # undo a previous --apply
 *
 * Backups are written to server/text-repair-backups/ (git-ignored). See lib/text-repair.ts.
 */
import path from 'node:path';
import { applyTextRepairs, restoreTextRepairs, scanStoredText } from '../lib/text-repair';
import { arg, run } from './_run';

run(async () => {
  const restore = arg('restore');
  if (restore) return restoreTextRepairs(path.resolve(process.cwd(), restore));

  const findings = await scanStoredText();
  const fixable = findings.filter((f) => f.after !== null);
  const lost = findings.filter((f) => f.after === null);
  for (const f of findings) {
    const show = (s: string) => JSON.stringify(s.length > 120 ? `${s.slice(0, 120)}…` : s);
    console.log(`${f.after === null ? 'UNRECOVERABLE' : 'repairable   '} ${f.collection} ${f.id} ${f.path}: ${show(f.before)}${f.after === null ? '' : ` → ${show(f.after)}`}`); // eslint-disable-line no-console
  }
  const summary = { scanned: 'products, categories, collections, banners, campaigns, pages, settings, message templates, order item names', repairable: fixable.length, unrecoverable: lost.length };
  if (arg('apply') === undefined) return { ...summary, mode: 'dry run — nothing changed. Re-run with --apply to repair (a backup is written first).' };
  const result = await applyTextRepairs(findings, path.resolve(__dirname, '../../text-repair-backups'), { includeOrders: arg('include-orders') !== undefined });
  return { ...summary, mode: 'applied', ...result, restoreWith: `npm run repair:text -- --restore ${result.backup}` };
});
