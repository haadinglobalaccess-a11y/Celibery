import { useEffect, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { useReveal } from './hooks';

/** True when the visitor asked the OS for reduced motion. */
export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Observe the actual heading, including headings arriving with async catalogue data. */
export function useLuxuryHeadings() {
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const selector = 'h1, .section__head h2, .product-story__intro h2';
    const headings = new Set<HTMLElement>();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => entry.target.classList.toggle('is-in-view', entry.isIntersecting));
    }, { rootMargin: '-68px 0px -8% 0px' });
    const register = (element: Element) => {
      const candidates = [...element.querySelectorAll<HTMLElement>(selector)];
      if (element.matches(selector)) candidates.push(element as HTMLElement);
      candidates.forEach(heading => {
        if (!heading.closest('#main') || headings.has(heading)) return;
        headings.add(heading);
        heading.classList.add('luxury-heading');
        observer.observe(heading);
      });
    };
    const main = document.getElementById('main');
    if (!main) return;
    register(main);
    const changes = new MutationObserver(records => {
      for (const record of records) record.addedNodes.forEach(node => { if (node instanceof Element) register(node); });
      headings.forEach(heading => { if (!heading.isConnected) { observer.unobserve(heading); headings.delete(heading); } });
    });
    changes.observe(main, { childList: true, subtree: true });
    return () => {
      changes.disconnect(); observer.disconnect();
      headings.forEach(heading => heading.classList.remove('luxury-heading', 'is-in-view'));
    };
  }, []);
}

/**
 * Scroll reveal wrapper. `variant` picks the entrance; `stagger` animates direct children one by
 * one; `index` delays this element inside a list. Uses IntersectionObserver (no scroll listeners).
 */
export function Reveal({
  children,
  className = '',
  variant = 'up',
  stagger = false,
  index,
  as: Tag = 'div',
  style,
}: {
  children: ReactNode;
  className?: string;
  variant?: 'up' | 'fade' | 'scale' | 'start' | 'end' | 'depth' | 'rise';
  stagger?: boolean;
  index?: number;
  as?: ElementType;
  style?: CSSProperties;
}) {
  const ref = useReveal<HTMLElement>();
  const cls = ['reveal', variant !== 'up' ? `reveal--${variant}` : '', stagger ? 'stagger' : '', className].filter(Boolean).join(' ');
  return (
    <Tag ref={ref} className={cls} style={index !== undefined ? ({ ...style, '--i': index } as CSSProperties) : style}>
      {children}
    </Tag>
  );
}

/**
 * MotionReveal — the 3D-capable name for Reveal. Extra variants: `depth` (comes forward from behind
 * the page plane with a slight tilt) and `rise` (tilts up from the floor). Same IntersectionObserver,
 * same reduced-motion behaviour.
 */
export const MotionReveal = Reveal;

/**
 * Masked word-by-word headline reveal. Splits on explicit line breaks ("\n") and spaces; each word
 * slides up from behind its line mask. Screen readers get the plain text once via aria-label.
 */
export function SplitText({ text, as: Tag = 'h1', delay = 0, className = '' }: { text: string; as?: ElementType; delay?: number; className?: string }) {
  const lines = text.split('\n');
  let w = 0;
  return (
    <Tag className={`split ${className}`} aria-label={text.replace(/\n/g, ' ')}>
      {lines.map((line, li) => (
        <span className="split__line" key={`${li}-${line}`} aria-hidden="true">
          {line.split(' ').map((word, wi) => (
            <span key={wi}>
              <span className="split__word" style={{ '--w': w++, '--d': `${delay}ms` } as CSSProperties}>
                {word}
              </span>
              {wi < line.split(' ').length - 1 ? ' ' : null}
            </span>
          ))}
        </span>
      ))}
    </Tag>
  );
}

/** Whether the page has scrolled past `offset` px (header compaction). rAF-throttled, passive. */
export function useScrolled(offset = 24) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setScrolled(window.scrollY > offset);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [offset]);
  return scrolled;
}

/** Cycles 0..count-1 every `ms`; pauses for reduced motion and while the tab is hidden. */
export function useRotation(count: number, ms = 5500) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (count < 2 || paused || prefersReducedMotion()) return;
    const id = setInterval(() => {
      if (!document.hidden) setI((x) => (x + 1) % count);
    }, ms);
    return () => clearInterval(id);
  }, [count, ms, paused, i]);
  return { index: i % Math.max(count, 1), setIndex: setI, setPaused };
}
