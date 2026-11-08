import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, get } from './api';

type State<T> = { data: T | null; error: ApiError | null; loading: boolean };

/** Fetches JSON for a path; re-fetches when the path changes. Pass null to skip. */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: Boolean(path) });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ data: s.data, error: null, loading: true }));
    get<T>(path, ctrl.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => {
        if ((error as Error).name === 'AbortError') return;
        setState({ data: null, error: error as ApiError, loading: false });
      });
    return () => ctrl.abort();
  }, [path, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

/** Module-level cache for data shared by many components (home payload, settings). */
const cache = new Map<string, Promise<unknown>>();
export function cachedGet<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    const p = get<T>(path).catch((e) => {
      cache.delete(path);
      throw e;
    });
    cache.set(path, p);
  }
  return cache.get(path) as Promise<T>;
}
export function invalidateCache(path?: string) {
  if (path) cache.delete(path);
  else cache.clear();
}

export function useCached<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => {
    let alive = true;
    cachedGet<T>(path)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [path]);
  return { data, error, loading: !data && !error };
}

/**
 * Scroll-triggered animation that replays on every entry, scrolling down or up.
 *
 * `className` is added when the element enters (with the section's own `enter` options, so each
 * animation starts exactly where it always did) and removed only once the element is completely
 * outside the viewport. The gap between the two points means an element resting at the edge of the
 * screen never toggles back and forth, and the reset happens out of sight, so the CSS transitions
 * replay unchanged on the next entry.
 */
export function createReplayObserver(className: string, enter: IntersectionObserverInit) {
  const enterIo = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) e.target.classList.add(className);
  }, enter);
  const exitIo = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (!e.isIntersecting) e.target.classList.remove(className);
    },
    { threshold: 0 },
  );
  return {
    observe(el: Element) {
      enterIo.observe(el);
      exitIo.observe(el);
    },
    unobserve(el: Element) {
      enterIo.unobserve(el);
      exitIo.unobserve(el);
    },
    disconnect() {
      enterIo.disconnect();
      exitIo.disconnect();
    },
  };
}

/** Adds .is-visible when an element scrolls into view (balanced animation, Q6) — on every entry. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('is-visible');
      return;
    }
    const io = createReplayObserver('is-visible', { rootMargin: '0px 0px -10% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
