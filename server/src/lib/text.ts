/**
 * Clean, consistent product text (Arabic and English).
 *
 * Descriptions reach the database from the Admin form, CSV imports (Shopify exports carry HTML) and
 * copy-paste from Word / web pages. Shown verbatim, that produced raw markup ("<p>…</p>", "&amp;"),
 * encoding damage ("â€™", "Ø§Ù„") and inconsistent bullets on the product page. Everything is
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

/** Typical signatures of UTF-8 read as Windows-1252/Latin-1: "â€™", "Ã©", "Ø§", "Ù„". */
const MOJIBAKE = /(?:â€|Ã[\u0080-ÿ]|[ØÙ][\u0080-ÿŒ-™])/;

/** Repairs UTF-8 that was decoded as Windows-1252 — only when the whole text converts cleanly. */
export function repairMojibake(s: string): string {
  if (!MOJIBAKE.test(s)) return s;
  const bytes: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xff) bytes.push(cp);
    else if (CP1252[cp] !== undefined) bytes.push(CP1252[cp]);
    else return s; // a genuine non-Latin character: this is not mojibake, leave it alone
  }
  const fixed = Buffer.from(bytes).toString('utf8');
  return fixed.includes('�') ? s : fixed;
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
  s = s.replace(/[﻿​­]/g, '');
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
