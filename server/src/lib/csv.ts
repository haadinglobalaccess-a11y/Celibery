/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF, UTF-8 BOM). */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

export function csvToObjects(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  // A leading ' before = + - @ is the formula guard added by csvCell (our own exports): remove it.
  const unguard = (v: string) => (/^'[=+\-@]/.test(v) ? v.slice(1) : v);
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, unguard((r[i] ?? '').trim())])));
}

/** One CSV cell. Values starting with = + - @ are prefixed with ' so spreadsheets never run them as formulas. */
export const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\n');
