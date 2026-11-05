import { useLayoutEffect, type RefObject } from 'react';

type Group = { cards: Set<HTMLElement>; heads: HTMLElement[]; restored: Map<HTMLElement, string[]>; visible: boolean };
const groups = new Map<HTMLElement, Group>();
let observer: IntersectionObserver | undefined;
let cardObserver: IntersectionObserver | undefined;
let media: MediaQueryList | undefined;

function setDelay(card: HTMLElement) {
  // Start a fresh stagger on each grid row, including after responsive resizing.
  const row = Array.from(card.parentElement?.children ?? []).filter(
    (item): item is HTMLElement => item instanceof HTMLElement && item.matches('.card') && item.offsetTop === card.offsetTop,
  );
  card.style.setProperty('--product-delay', `${100 + Math.min(Math.max(0, row.indexOf(card)), 5) * 140}ms`);
}

function show(section: HTMLElement, group: Group, visible: boolean) {
  group.visible = visible;
  section.classList.toggle('product-motion--visible', visible || !!media?.matches);
  group.heads.forEach(head => head.classList.toggle('product-motion__heading--visible', visible || !!media?.matches));
}

function motionChanged() {
  groups.forEach((group, section) => show(section, group, group.visible));
}

/** Cards register their existing section; one observer is shared across the storefront. */
export function useProductMotion(ref: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card || !('IntersectionObserver' in window)) return;
    const section = card.closest<HTMLElement>('section') ?? card.closest<HTMLElement>('.container');
    if (!section) return;
    if (!observer) {
      media = window.matchMedia('(prefers-reduced-motion: reduce)');
      media.addEventListener('change', motionChanged);
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          const group = groups.get(entry.target as HTMLElement);
          if (group) show(entry.target as HTMLElement, group, entry.isIntersecting);
        });
      }, { threshold: 0 }); // Also handles sections taller than the viewport.
      cardObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) setDelay(entry.target as HTMLElement);
          entry.target.classList.toggle('product-motion__card--visible', entry.isIntersecting);
        });
      }, { rootMargin: '-64px 0px -8% 0px', threshold: 0 });
    }
    let group = groups.get(section);
    if (!group) {
      group = { cards: new Set(), heads: [], restored: new Map(), visible: false };
      groups.set(section, group);
      section.classList.add('product-motion');
      group.heads = Array.from(section.querySelectorAll<HTMLElement>('.section__head, .editorial__copy, .page-head, .campaign-hero'));
      if (section.matches('[aria-live="polite"]')) {
        const heading = section.closest('.container')?.querySelector<HTMLElement>('.page-head');
        if (heading) group.heads.push(heading);
      }
      group.heads.forEach(head => head.classList.add('product-motion__heading'));
      observer.observe(section);
      show(section, group, false);
    }
    // Existing one-shot reveals must not hide or move the new repeatable reveal.
    for (let el = card.parentElement; el && el !== section; el = el.parentElement) {
      const removed = ['reveal', 'stagger', 'anim-in'].filter(name => el!.classList.contains(name));
      if (removed.length) {
        group.restored.set(el, [...(group.restored.get(el) ?? []), ...removed]);
        el.classList.remove(...removed);
      }
    }
    group.heads.forEach(head => {
      if (head.classList.contains('reveal')) {
        group!.restored.set(head, ['reveal']);
        head.classList.remove('reveal');
      }
    });
    group.cards.add(card);
    card.classList.add('product-motion__card');
    cardObserver!.observe(card);
    setDelay(card);
    return () => {
      cardObserver?.unobserve(card);
      card.classList.remove('product-motion__card', 'product-motion__card--visible');
      card.style.removeProperty('--product-delay');
      group!.cards.delete(card);
      if (!group!.cards.size) {
        observer?.unobserve(section);
        section.classList.remove('product-motion', 'product-motion--visible');
        group!.heads.forEach(head => head.classList.remove('product-motion__heading', 'product-motion__heading--visible'));
        group!.restored.forEach((names, el) => el.classList.add(...names));
        groups.delete(section);
      }
      if (!groups.size) {
        observer?.disconnect();
        observer = undefined;
        cardObserver?.disconnect();
        cardObserver = undefined;
        media?.removeEventListener('change', motionChanged);
        media = undefined;
      }
    };
  }, [ref]);
}
