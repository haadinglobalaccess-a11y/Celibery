/**
 * Clean, consistent product text (Arabic and English).
 *
 * Descriptions reach the database from the Admin form, CSV imports (Shopify exports carry HTML) and
 * copy-paste from Word / web pages. Shown verbatim, that produced raw markup ("<p>…</p>", "&amp;"),
 * encoding damage (UTF-8 shown as Windows-1252 — an apostrophe as three Latin characters, Arabic as Ø/Ù pairs) and inconsistent bullets on the product page. Everything is
 * reduced to one small, safe plain-text format that the storefront renders:
 *
 *   paragraphs separated by a blank line · "- " list items · "### " sub-headings · **bold**
 *
 * The functions are idempotent: cleaning already-clean text returns it unchanged, so they run both
 * when text is saved and when it is served (data saved before this existed is fixed on display).
 */

// Windows-1252 code points for bytes 0x80–0x9F (used to undo UTF-8 text decoded as cp1252).
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89,
  0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Byte value of a character as Windows-1252 would have displayed it (undefined if it cannot be one). */
const cpByte = (ch: string): number | undefined => {
  const c = ch.codePointAt(0)!;
  return c <= 0xff ? c : CP1252[c];
};

/** Quick test: a UTF-8 lead byte (as cp1252) followed by a continuation byte (as cp1252). */
const SUSPECT = /[\u00c2-\u00f4][\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]/;
const C1 = /[\u0080-\u009f]/g;
const HAS_C1 = /[\u0080-\u009f]/; // non-global: .test() keeps no state
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Repairs UTF-8 text that was decoded as Windows-1252 / Latin-1 ("mojibake"), one character at a time:
 * a lead byte followed by exactly the continuation bytes UTF-8 requires is replaced only when those
 * bytes strictly decode. Correct text around a damaged run (Arabic, English, accents) is never touched,
 * so mixed strings are repaired too. Leftover C1 control characters (never legitimate text) are removed.
 */
export function repairMojibake(s: string): string {
  // Text damaged twice (double-encoded) needs one pass per layer; each pass is strictly validated.
  let cur = s;
  for (let pass = 0; pass < 3; pass++) {
    const next = repairOnce(cur);
    if (next === cur) break;
    cur = next;
  }
  // Only after every layer: in double-encoded text a C1 character can be a byte the next pass needs.
  return HAS_C1.test(cur) ? cur.replace(C1, '') : cur;
}

function repairOnce(s: string): string {
  if (!SUSPECT.test(s)) return s;
  const chars = [...s];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const lead = cpByte(chars[i]);
    const need = lead === undefined ? 0 : lead >= 0xc2 && lead <= 0xdf ? 1 : lead >= 0xe0 && lead <= 0xef ? 2 : lead >= 0xf0 && lead <= 0xf4 ? 3 : 0;
    if (need) {
      const bytes = [lead!];
      for (let k = 1; k <= need; k++) {
        const b = i + k < chars.length ? cpByte(chars[i + k]) : undefined;
        if (b === undefined || b < 0x80 || b > 0xbf) break;
        bytes.push(b);
      }
      if (bytes.length === need + 1) {
        try {
          out += strictUtf8.decode(Uint8Array.from(bytes));
          i += need;
          continue;
        } catch {
          /* not a valid sequence: keep the original character */
        }
      }
    }
    out += chars[i];
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', deg: '°', times: '×' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const HAS_TAG = /<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?\/?>/i;

/** HTML (e.g. Shopify body_html) → the plain-text format above. Tags are removed, never rendered. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|template|iframe|object|svg)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '\n\n### ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|ul|ol|table|section|article|blockquote|header|footer)\s*>/gi, '\n\n')
    .replace(/<\/li\s*>/gi, '') // the next <li> starts its own line: no blank line inside a list
    .replace(/<\/tr\s*>/gi, '\n')
    .replace(/<\/?(strong|b)(\s[^>]*)?>/gi, '**')
    .replace(/<\/t[dh]\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '');
}

/** Multi-line description text: paragraphs, "- " lists, "### " headings and **bold** survive. */
export function cleanRichText(input: string | null | undefined): string {
  if (!input) return '';
  // Repair encoding first: in damaged Arabic, U+00AD is half of a letter (ح = D8 AD), not a soft hyphen.
  let s = repairMojibake(String(input).replace(/\r\n?/g, '\n'));
  s = s.replace(/[\ufeff\u200b\u00ad]/g, '');
  if (HAS_TAG.test(s)) s = htmlToText(s);
  s = decodeEntities(s).replace(/ /g, ' ');
  const lines = s.split('\n').map((line) =>
    line
      .replace(/[ \t\f\v]+/g, ' ')
      .trim()
      // One bullet style: •, ·, ▪, ◦, ●, ■, a single * and "- " / "– " become "- " ("**bold**" is not a bullet).
      .replace(/^(?:[•·▪◦●■]|\*(?!\*)(?=\s)|[-–](?=\s))\s*/, '- ')
      // Empty bold markers left behind by stripped markup.
      .replace(/\*\*\s*\*\*/g, '')
      .replace(/^- $/, ''),
  );
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Single-line text (names, short descriptions, spec values): no markup, no line breaks. */
export function cleanLineText(input: string | null | undefined): string {
  return cleanRichText(input)
    .split('\n')
    .map((l) => l.replace(/^(?:- |#{1,6} )/, ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

type Loc = { ar?: string | null; en?: string | null } | null | undefined;
export const cleanLocRich = (v: Loc) => ({ ar: cleanRichText(v?.ar), en: cleanRichText(v?.en) });
export const cleanLocLine = (v: Loc) => ({ ar: cleanLineText(v?.ar), en: cleanLineText(v?.en) });

/** True when text contains U+FFFD: characters already lost before they reached the store (not repairable). */
export const hasReplacementChar = (s: string) => s.includes('\ufffd');

const ARABIC_LETTER = /[\u0621-\u064a]/;

/**
 * Decodes a text file (product CSV) in the encoding it was saved in: strict UTF-8 (BOM removed), else
 * Windows-1256 when that gives Arabic letters (Excel "CSV" on Arabic Windows), else Windows-1252.
 * Same logic as client/src/lib/textFile.ts (Admin upload); tests run the same fixtures against both.
 */
export function decodeTextBytes(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1256' | 'windows-1252' } {
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: 'utf-8' };
  } catch {
    /* not UTF-8 */
  }
  const arabic = new TextDecoder('windows-1256').decode(body);
  if (ARABIC_LETTER.test(arabic)) return { text: arabic, encoding: 'windows-1256' };
  return { text: new TextDecoder('windows-1252').decode(body), encoding: 'windows-1252' };
}
