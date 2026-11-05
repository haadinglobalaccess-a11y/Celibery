import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { finePointer, reducedMotion } from './env';

/** Magnetic hover: the element leans a few px toward the pointer and a light spot follows it. */
export function useMagnetic<T extends HTMLElement>(ref: RefObject<T>, strength = 6) {
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion() || !finePointer()) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
        el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
        el.style.setProperty('--tx', `${((x - 0.5) * strength).toFixed(2)}px`);
        el.style.setProperty('--ty', `${((y - 0.5) * strength).toFixed(2)}px`);
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(frame);
      el.style.setProperty('--tx', '0px');
      el.style.setProperty('--ty', '0px');
    };
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [ref, strength]);
}

type Common = { children: ReactNode; className?: string; variant?: string; size?: 'sm' | 'lg' };

/**
 * The existing `.btn` with depth: layered bevel, magnetic hover and a pointer-following light.
 * Renders a router Link when `to` is given, otherwise a native button (all button props pass through,
 * so forms, `disabled` and data-testids keep working).
 */
export function PremiumButton(props: Common & ({ to: string } | ({ to?: undefined } & ButtonHTMLAttributes<HTMLButtonElement>))) {
  const ref = useRef<HTMLAnchorElement & HTMLButtonElement>(null);
  useMagnetic(ref);
  const { children, className = '', variant = 'primary', size, ...rest } = props;
  const cls = `btn btn--${variant} ${size ? `btn--${size}` : ''} btn--3d ${className}`.trim();
  const inner = (
    <>
      <span className="btn__light" aria-hidden="true" />
      {children}
    </>
  );
  if ('to' in rest && rest.to) {
    return (
      <Link ref={ref} className={cls} to={rest.to}>
        {inner}
      </Link>
    );
  }
  const { to: _to, ...buttonProps } = rest as { to?: undefined } & ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button ref={ref} className={cls} {...buttonProps}>
      {inner}
    </button>
  );
}
