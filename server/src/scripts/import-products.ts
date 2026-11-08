/**
 * npm run import:products -- --file ../docs/product-import-template.csv [--dry-run]
 * Upserts products by SKU from the CSV template. Use --dry-run to validate without saving.
 */
import fs from 'node:fs';
import { decodeTextBytes } from '../lib/text';
import path from 'node:path';
import { importProductsCsv } from '../modules/admin/import.service';
import { seedBase } from '../seed/seed';
import { arg, run } from './_run';

run(async () => {
  const file = arg('file');
  if (!file) throw new Error('Usage: npm run import:products -- --file path/to/products.csv [--dry-run]');
  // Excel's plain "CSV" is Windows-1256/1252, not UTF-8: decode what was really saved (lib/text.ts).
  const decoded = decodeTextBytes(fs.readFileSync(path.resolve(process.cwd(), file)));
  if (decoded.encoding !== 'utf-8') console.warn(`Note: ${file} is ${decoded.encoding}, not UTF-8; it was converted. Check the names in the report.`); // eslint-disable-line no-console
  const text = decoded.text;
  await seedBase();
  return importProductsCsv(text, undefined, arg('dry-run') !== undefined);
});
