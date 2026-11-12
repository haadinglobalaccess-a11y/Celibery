import { Fragment, type ReactNode } from 'react';

/**
 * Tiny, safe Markdown renderer for policy pages (headings, lists, quotes, paragraphs, **bold**).
 * Produces React elements only — no HTML injection is possible.
 *
 * `rich` (FAQ answers) additionally supports numbered lists ("1. ") and links ([label](url)).
 * Links render only for https://… URLs and same-site paths (/…); anything else (javascript:,
 * data:, //host) stays plain text. The server applies the same rule when the text is saved.
 */
const SAFE_LINK = /^https?:\/\/[^\s/\\]+(?:[/?#][^\s]*)?$|^\/(?![/\\])[^\s]*$/i;

function bold(text: string, keyBase: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={`${keyBase}b${i}`}>{p.slice(2, -2)}</strong> : <Fragment key={`${keyBase}b${i}`}>{p}</Fragment>));
}

function inline(text: string, rich = false): ReactNode[] {
  if (!rich) return bold(text, '');
  const out: ReactNode[] = [];
  const re = /\[([^\]\n]{1,200})\]\(([^)\s]{1,1000})\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...bold(text.slice(last, m.index), `t${last}`));
    const [whole, label, url] = m;
    if (SAFE_LINK.test(url)) {
      const external = /^https?:/i.test(url);
      out.push(
        <a key={`l${m.index}`} href={url} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {bold(label, `l${m.index}`)}
        </a>,
      );
    } else out.push(<Fragment key={`l${m.index}`}>{whole}</Fragment>);
    last = m.index + whole.length;
  }
  if (last < text.length) out.push(...bold(text.slice(last), `t${last}`));
  return out;
}

export function Markdown({ source, rich = false, className = 'prose' }: { source: string; rich?: boolean; className?: string }) {
  const lines = source.split(/\r?\n/);
  const out: ReactNode[] = [];
  let list: string[] = [];
  let listKind: 'ul' | 'ol' = 'ul';
  let para: string[] = [];
  const flushList = () => {
    if (!list.length) return;
    const Tag = listKind;
    out.push(
      <Tag key={out.length}>
        {list.map((l, i) => (
          <li key={i}>{inline(l, rich)}</li>
        ))}
      </Tag>,
    );
    list = [];
  };
  const flushPara = () => {
    if (!para.length) return;
    out.push(<p key={out.length}>{inline(para.join(' '), rich)}</p>);
    para = [];
  };
  const flush = () => {
    flushList();
    flushPara();
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const ordered = rich ? /^\d{1,3}[.)] (.*)$/.exec(line) : null;
    if (line.startsWith('### ')) {
      flush();
      out.push(<h3 key={out.length}>{inline(line.slice(4), rich)}</h3>);
    } else if (line.startsWith('## ')) {
      flush();
      out.push(<h2 key={out.length}>{inline(line.slice(3), rich)}</h2>);
    } else if (line.startsWith('> ')) {
      flush();
      out.push(<blockquote key={out.length}>{inline(line.slice(2), rich)}</blockquote>);
    } else if (/^[-*] /.test(line) || ordered) {
      const kind = ordered ? 'ol' : 'ul';
      flushPara();
      if (list.length && listKind !== kind) flushList();
      listKind = kind;
      list.push(ordered ? ordered[1] : line.slice(2));
    } else {
      flushList();
      para.push(line);
    }
  }
  flush();
  return <div className={className}>{out}</div>;
}

/** Plain text of the same Markdown (for meta descriptions and structured data). */
export function markdownToText(source: string): string {
  return source
    .replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,1000})\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*(?:[-*]|\d{1,3}[.)]|#{2,3}|>)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
