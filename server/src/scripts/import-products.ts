/**
 * npm run import:products -- --file ../docs/product-import-template.csv [--dry-run]
 * Upserts products by SKU from the CSV template. Use --dry-run to validate without saving.
 */
import fs from 'node:fs';
import path from 'node:path';
import { importProductsCsv } from '../modules/admin/import.service';
import { seedBase } from '../seed/seed';
import { arg, run } from './_run';

run(async () => {
  const file = arg('file');
  if (!file) throw new Error('Usage: npm run import:products -- --file path/to/products.csv [--dry-run]');
  const text = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
  await seedBase();
  return importProductsCsv(text, undefined, arg('dry-run') !== undefined);
});
