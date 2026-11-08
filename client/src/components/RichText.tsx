import { Fragment, type ReactNode } from 'react';

/** **bold** → <strong>; everything else is plain text (React escapes it — no HTML is ever injected). */
function inline(text: string, key: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.length > 4 && part.startsWith('**') && part.endsWith('**') ? <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong> : <Fragment key={`${key}-${i}`}>{part.replace(/\*\*/g, '')}</Fragment>,
  );
}

/**
 * Renders product description text in the format the API serves (server/src/lib/text.ts):
 * paragraphs separated by a blank line, single line breaks kept, "- " list items, "### " sub-headings
 * and **bold**. Works the same for Arabic (RTL) and English.
 */
export function RichText({ text, className = '' }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  for (const [b, block] of text.split(/\n{2,}/).entries()) {
    let para: string[] = [];
    let list: string[] = [];
    const flushPara = () => {
      if (!para.length) return;
      const lines = para;
      blocks.push(
        <p key={`p${b}-${blocks.length}`}>
          {lines.map((l, i) => (
            <Fragment key={i}>
              {i ? <br /> : null}
              {inline(l, `${b}-${i}`)}
            </Fragment>
          ))}
        </p>,
      );
      para = [];
    };
    const flushList = () => {
      if (!list.length) return;
      const items = list;
      blocks.push(
        <ul key={`u${b}-${blocks.length}`}>
          {items.map((l, i) => (
            <li key={i}>{inline(l, `${b}-li${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    };
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('- ')) {
        flushPara();
        list.push(line.slice(2));
      } else if (/^#{1,6} /.test(line)) {
        flushPara();
        flushList();
        blocks.push(<h3 key={`h${b}-${blocks.length}`}>{inline(line.replace(/^#{1,6} /, ''), `${b}-h`)}</h3>);
      } else {
        flushList();
        para.push(line);
      }
    }
    flushPara();
    flushList();
  }
  return <div className={`cx-richtext ${className}`}>{blocks}</div>;
}
