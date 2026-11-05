import { useEffect, useState } from 'react';

/**
 * How much 3D the current device gets.
 *  - full:   desktop/tablet with a fine pointer and enough cores — WebGL studio at adaptive resolution.
 *  - lite:   phones, low-memory devices or Data Saver — WebGL at low resolution, capped frame rate.
 *  - static: reduced motion or no WebGL — CSS-only presentation, nothing animates continuously.
 */
export type ImmersiveLevel = 'full' | 'lite' | 'static';

let webglCache: boolean | null = null;
/** True when the browser can create a WebGL context (cached; the probe context is released at once). */
export function hasWebGL(): boolean {
  if (webglCache !== null) return webglCache;
  if (typeof document === 'undefined') return (webglCache = false);
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl', { failIfMajorPerformanceCaveat: true }) || c.getContext('webgl')) as WebGLRenderingContext | null;
    webglCache = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webglCache = false;
  }
  return webglCache;
}

const mq = (q: string) => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(q).matches;
export const reducedMotion = () => mq('(prefers-reduced-motion: reduce)');
/** Mouse/trackpad users: pointer-driven tilt and parallax only run here. */
export const finePointer = () => mq('(hover: hover) and (pointer: fine)');

export function immersiveLevel(): ImmersiveLevel {
  if (typeof window === 'undefined') return 'static';
  if (reducedMotion() || !hasWebGL()) return 'static';
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const lowPower = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || nav.connection?.saveData === true;
  const phone = mq('(max-width: 639px)') || !finePointer();
  return lowPower || phone ? 'lite' : 'full';
}

/** React hook for the immersive level; updates if the visitor toggles reduced motion. */
export function useImmersiveLevel(): ImmersiveLevel {
  const [level, setLevel] = useState<ImmersiveLevel>(() => immersiveLevel());
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setLevel(immersiveLevel());
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return level;
}
