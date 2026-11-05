import { Fragment, type ReactNode } from 'react';

/**
 * Tiny, safe Markdown renderer for policy pages (headings, lists, quotes, paragraphs, **bold**).
 * Produces React elements only — no HTML injection is possible.
 */
function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>));
}

export function Markdown({ source }: { source: string }) {
  const lines = source.split(/\r?\n/);
  const out: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (list.length) {
      out.push(
        <ul key={out.length}>
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
    if (para.length) {
      out.push(<p key={out.length}>{inline(para.join(' '))}</p>);
      para = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith('### ')) {
      flush();
      out.push(<h3 key={out.length}>{inline(line.slice(4))}</h3>);
    } else if (line.startsWith('## ')) {
      flush();
      out.push(<h2 key={out.length}>{inline(line.slice(3))}</h2>);
    } else if (line.startsWith('> ')) {
      flush();
      out.push(<blockquote key={out.length}>{inline(line.slice(2))}</blockquote>);
    } else if (/^[-*] /.test(line)) {
      if (para.length) flush();
      list.push(line.slice(2));
    } else {
      if (list.length) flush();
      para.push(line);
    }
  }
  flush();
  return <div className="prose">{out}</div>;
}
