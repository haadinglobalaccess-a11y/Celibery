import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repairMojibake } from '../../src/lib/text';

/**
 * Repository-wide encoding guard. Fails when any text file in the project:
 *  - is not valid UTF-8, or starts with a BOM (only the Excel CSV template needs one);
 *  - contains mojibake — UTF-8 shown as Windows-1252/Latin-1 (detected by exact byte reversal,
 *    so legitimate Arabic, Urdu, accents, symbols and emoji never trigger it);
 *  - contains raw invisible characters that cannot be reviewed: C0/C1 controls, U+FFFD, zero-width
 *    space, a BOM inside the file, line/paragraph separators, or bidirectional overrides/isolates
 *    ("Trojan Source"). Write such characters as escapes in code. Zero-width joiners and LRM/RLM
 *    marks (needed by Arabic, Urdu and emoji) are allowed.
 */
const ROOT = path.resolve(__dirname, '../../..');
const BOM_ALLOWED = new Set(['docs/product-import-template.csv']);
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|pdf|zip|glb|bin)$/i;

const forbidden = (cp: number) =>
  (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) ||
  (cp >= 0x7f && cp <= 0x9f) ||
  cp === 0xfffd ||
  cp === 0xfeff ||
  cp === 0x200b ||
  cp === 0x2028 ||
  cp === 0x2029 ||
  (cp >= 0x202a && cp <= 0x202e) ||
  (cp >= 0x2066 && cp <= 0x2069);

function projectFiles(): string[] {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const files = new Set([...git('ls-files'), ...git('ls-files', '--others', '--exclude-standard')]);
  return [...files].filter((f) => !BINARY.test(f) && !f.startsWith('e2e/.artifacts/') && fs.existsSync(path.join(ROOT, f)));
}

describe('repository text encoding', () => {
  const files = projectFiles();

  it('finds the project files', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('client/src/i18n/strings.ts');
  });

  it('every text file is valid UTF-8 without corruption', () => {
    const problems: string[] = [];
    const strict = new TextDecoder('utf-8', { fatal: true });
    for (const f of files) {
      const bytes = fs.readFileSync(path.join(ROOT, f));
      if (bytes.includes(0)) continue; // binary
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf && !BOM_ALLOWED.has(f)) problems.push(`${f}: starts with a UTF-8 BOM`);
      let text: string;
      try {
        text = strict.decode(bytes);
      } catch {
        problems.push(`${f}: not valid UTF-8 (saved in another encoding)`);
        continue;
      }
      text.split('\n').forEach((line, i) => {
        const body = i === 0 && BOM_ALLOWED.has(f) ? line.replace(/^./u, (c) => (c.codePointAt(0) === 0xfeff ? '' : c)) : line;
        const bad = [...body].filter((c) => forbidden(c.codePointAt(0)!));
        if (bad.length) problems.push(`${f}:${i + 1}: raw invisible/control character ${bad.map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(' ')}`);
        const repaired = repairMojibake(body);
        if (repaired !== body && !bad.length) problems.push(`${f}:${i + 1}: mojibake (UTF-8 shown as Windows-1252): ${JSON.stringify(body.trim().slice(0, 80))}`);
      });
    }
    expect(problems).toEqual([]);
  });

  it('the storefront declares UTF-8 before any text', () => {
    const html = fs.readFileSync(path.join(ROOT, 'client/index.html'), 'utf8');
    expect(html.indexOf('<meta charset="UTF-8"')).toBeGreaterThan(-1);
    expect(html.indexOf('<meta charset="UTF-8"')).toBeLessThan(html.indexOf('<title>'));
  });
});
