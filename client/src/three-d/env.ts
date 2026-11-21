const mq = (q: string) => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(q).matches;
export const reducedMotion = () => mq('(prefers-reduced-motion: reduce)');
/** Mouse/trackpad users: pointer-driven tilt and parallax only run here. */
export const finePointer = () => mq('(hover: hover) and (pointer: fine)');
