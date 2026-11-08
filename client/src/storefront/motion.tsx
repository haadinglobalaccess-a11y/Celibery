import { useEffect, useRef, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { createReplayObserver } from '../lib/hooks';

/**
 * CELIBERY motion theatre — one IntersectionObserver per page scope.
 *
 * Elements opt in with `data-fx="<effect>"` (iris · split · spotlight · kinetic · rise · stagger ·
 * draw · line · chrome). Each time an element enters the viewport — scrolling down or back up — it
 * receives `.fx-in`; once it is completely off screen the class is removed so the same transition
 * plays again on the next entry (lib/hooks.ts createReplayObserver). Only compositor-friendly CSS
 * transitions run (transform · opacity · clip-path). Hidden start states only apply inside an armed scope
 * (`.cx-theatre`), so content is never hidden if JavaScript is unavailable. With
 * prefers-reduced-motion every element is shown immediately.
 */
export function useTheatre<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window);
    const seen = new WeakSet<Element>();
    // Start slightly before the element is fully in view so it is already moving on arrival.
    const io = reduce ? null : createReplayObserver('fx-in', { rootMargin: '0px 0px -6% 0px', threshold: 0.12 });
    const scan = () => {
      root.querySelectorAll('[data-fx]').forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        if (io) io.observe(el);
        else el.classList.add('fx-in');
      });
    };
    scan();
    root.classList.add('cx-theatre');
    // Panels that mount later (tabs, data arriving) join the same observer.
    let queued = 0;
    const mo = new MutationObserver(() => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        scan();
      });
    });
    mo.observe(root, { childList: true, subtree: true });
    return () => {
      io?.disconnect();
      mo.disconnect();
      if (queued) cancelAnimationFrame(queued);
    };
  }, []);
  return ref;
}

/**
 * Kinetic headline: each word rises from behind its own mask, in reading order (works for RTL —
 * words are split on spaces, letters inside an Arabic word stay joined). Screen readers and tests
 * read the full text once through aria-label.
 */
export function Kinetic({ text, as: Tag = 'h2', className = '', id, style }: { text: string; as?: ElementType; className?: string; id?: string; style?: CSSProperties }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <Tag id={id} className={`${className} cx-kinetic`} data-fx="kinetic" aria-label={text} style={style}>
      {words.map((w, i) => (
        <span key={i} aria-hidden="true">
          {i ? ' ' : null}
          <span className="cx-kw">
            <span style={{ '--w': i } as CSSProperties}>{w}</span>
          </span>
        </span>
      ))}
    </Tag>
  );
}

/** Convenience wrapper for a staggered group; children receive --i for their delay. */
export function Stagger({ as: Tag = 'div', className = '', children, fx = 'stagger' }: { as?: ElementType; className?: string; children: ReactNode; fx?: string }) {
  return (
    <Tag className={className} data-fx={fx}>
      {children}
    </Tag>
  );
}

/** A scoped theatre stage: mounts with its content, so the observer always sees real elements. */
export function TheatreStage({ children, className = '', as: Tag = 'div' }: { children: ReactNode; className?: string; as?: ElementType }) {
  const ref = useTheatre<HTMLElement>();
  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}
