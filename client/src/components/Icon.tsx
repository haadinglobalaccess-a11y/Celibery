/*
 * One 24×24 grid, round caps and joins, the stroke width set once in <Icon>. The header set (search,
 * bag, heart, user, menu, close, chevronDown, globe) is drawn to the same optical footprint as before
 * (about 16–17 units), so the rendered size, alignment and spacing do not change. The heart stays a
 * single closed shape: wishlisted states fill it.
 */
const paths: Record<string, JSX.Element> = {
  search: (
    <>
      <circle cx="10.75" cy="10.75" r="6.25" />
      <path d="m15.5 15.5 4.25 4.25" />
    </>
  ),
  bag: (
    <>
      <path d="M5.4 8.25h13.2l-.86 10.4a1.9 1.9 0 0 1-1.9 1.75H8.16a1.9 1.9 0 0 1-1.9-1.75L5.4 8.25Z" />
      <path d="M8.75 11V7.25a3.25 3.25 0 0 1 6.5 0V11" />
    </>
  ),
  heart: <path d="M12 19.75s-7.75-4.6-7.75-10.05A4.2 4.2 0 0 1 8.45 5.5c1.5 0 2.8.78 3.55 2 .75-1.22 2.05-2 3.55-2a4.2 4.2 0 0 1 4.2 4.2c0 5.45-7.75 10.05-7.75 10.05Z" />,
  user: (
    <>
      <circle cx="12" cy="8.25" r="3.75" />
      <path d="M4.75 19.75a7.25 7.25 0 0 1 14.5 0" />
    </>
  ),
  menu: <path d="M4.25 7.25h15.5M4.25 12h15.5M4.25 16.75h15.5" />,
  close: <path d="m6.5 6.5 11 11m0-11-11 11" />,
  truck: (
    <>
      <path d="M2 7h11v9H2zM13 10h4l3 3v3h-7" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  chat: <path d="M4 20l1.5-4A8 8 0 1 1 9 19.3L4 20Z" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  chevronDown: <path d="m6.75 9.5 5.25 5.25 5.25-5.25" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  box: (
    <>
      <path d="M3 7l9-4 9 4-9 4-9-4Z" />
      <path d="M3 7v10l9 4 9-4V7M12 11v10" />
    </>
  ),
  check: <path d="m5 12 5 5 9-10" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M3.5 12h17M12 3.25c2.25 2.4 3.4 5.3 3.4 8.75s-1.15 6.35-3.4 8.75c-2.25-2.4-3.4-5.3-3.4-8.75s1.15-6.35 3.4-8.75Z" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
  return: <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />,
  alert: (
    <>
      <path d="M12 3 2 21h20L12 3Z" />
      <path d="M12 10v4M12 17.5v.5" />
    </>
  ),
  grid: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  logout: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
};

export function Icon({ name, className = 'icon', label }: { name: keyof typeof paths | string; className?: string; label?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {paths[name] ?? null}
    </svg>
  );
}

/** Direction-aware chevron (points "forward" in both RTL and LTR). */
export function Chevron() {
  return <Icon name="chevron" className="icon chevron-fwd" />;
}

export function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.4-.3Z" />
    </svg>
  );
}
