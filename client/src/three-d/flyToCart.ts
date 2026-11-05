import { reducedMotion } from './env';

/**
 * Add-to-cart feedback: a copy of the product photo flies in an arc from where it was added to the
 * header cart icon, which then bumps. Purely visual — the cart itself is updated by the caller
 * before this runs, so nothing depends on the animation finishing. Skipped for reduced motion.
 */
export function flyToCart(source: Element | null | undefined) {
  if (!source || reducedMotion() || typeof document === 'undefined') return;
  const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="cart-link"]'));
  const target = targets.find((t) => t.offsetParent !== null && t.getBoundingClientRect().width > 0);
  const img = source instanceof HTMLImageElement ? source : source.querySelector('img');
  if (!target || !img) return;
  const from = img.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (!from.width || !to.width) return;
  const size = Math.min(from.width, from.height, 180);
  const ghost = document.createElement('div');
  ghost.className = 'fly-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.cssText = `width:${size}px;height:${size}px;left:${from.left + (from.width - size) / 2}px;top:${from.top + (from.height - size) / 2}px`;
  const clone = img.cloneNode() as HTMLImageElement;
  clone.removeAttribute('srcset');
  clone.removeAttribute('sizes');
  clone.alt = '';
  ghost.appendChild(clone);
  document.body.appendChild(ghost);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const anim = ghost.animate(
    [
      { transform: 'translate3d(0,0,0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: `translate3d(${dx * 0.45}px, ${dy * 0.45 - 90}px, 0) scale(0.55) rotate(-8deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.12) rotate(-14deg)`, opacity: 0.4 },
    ],
    { duration: 820, easing: 'cubic-bezier(0.55, 0, 0.3, 1)' },
  );
  const done = () => {
    ghost.remove();
    target.classList.remove('is-bump');
    void target.offsetWidth; // restart the bump animation
    target.classList.add('is-bump');
    setTimeout(() => target.classList.remove('is-bump'), 700);
  };
  anim.onfinish = done;
  anim.oncancel = () => ghost.remove();
}
