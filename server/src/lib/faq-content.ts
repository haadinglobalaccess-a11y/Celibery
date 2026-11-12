/**
 * FAQ answer text rules (pure, unit tested).
 *
 * Answers are stored as plain text with a small Markdown subset that the storefront turns into
 * React elements (client/src/lib/markdown.tsx) — never into HTML strings:
 *   paragraphs (blank line) · "- " bulleted lists · "1. " numbered lists · **bold** · [label](url)
 *
 * Server-side safety (defence in depth; the renderer cannot execute markup anyway):
 *  - HTML tags and HTML comments are refused, so nobody stores markup expecting it to render;
 *  - every link must be an absolute http(s) URL with a host or a path on this site (no
 *    javascript:/data: URLs, no protocol-relative "//host" open redirects);
 *  - control characters are removed and line endings normalised.
 * Arabic, English and any other Unicode text is kept exactly as typed.
 */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const HTML_TAG = /<\s*\/?\s*[a-z!?][^>]*>/i;
const LINK = /\[([^\]\n]{1,200})\]\(([^)\s]{0,1000})\)/g;

/** Same rule as admin link fields (modules/admin/admin.schemas.ts → isSafeLink), duplicated here to keep this module dependency-free. */
export function isSafeFaqLink(v: string): boolean {
  return /^https?:\/\/[^\s/\\]+(?:[/?#][^\s]*)?$/i.test(v) || /^\/(?![/\\])[^\s]*$/.test(v);
}

export function cleanFaqText(s: string): string {
  return s.replace(/\r\n?/g, '\n').replace(CONTROL, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** A human-readable reason the text cannot be saved, or null when it is acceptable. */
export function faqTextProblem(s: string, opts: { rich: boolean }): string | null {
  if (HTML_TAG.test(s) || s.includes('<!--')) return 'HTML is not allowed. Use the formatting shown under the field (lists, **bold**, [link](https://…)).';
  if (!opts.rich) {
    if (/\n/.test(s)) return 'Questions must be a single line';
    return null;
  }
  for (const m of s.matchAll(LINK)) {
    const url = m[2];
    if (!url || !isSafeFaqLink(url)) return `Link "${m[1]}" must start with https:// or be a page on this site (/…)`;
  }
  return null;
}
