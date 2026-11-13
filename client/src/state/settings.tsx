import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { cachedGet } from '../lib/hooks';
import type { PublicSettings } from '../lib/types';

const SettingsCtx = createContext<PublicSettings | null>(null);

/**
 * The server's original default accent (#2563EB) was a placeholder written before the client
 * supplied its logo. It is treated as "not set", so the CELIBERY turquoise from tokens.css applies.
 * Any other colour saved in Admin → Settings → Brand still overrides it.
 */
const LEGACY_PLACEHOLDER_ACCENTS = new Set(['#2563eb']);

/** Relative luminance (WCAG 2.x) of a #rrggbb colour. */
function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** Applies an admin-configured accent and picks the text colour that reads best on it. */
export function applyBrandAccent(color: string | undefined) {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color) || LEGACY_PLACEHOLDER_ACCENTS.has(color.toLowerCase())) return;
  const root = document.documentElement.style;
  root.setProperty('--accent', color);
  // Contrast against near-black (#111, L≈0.0056) vs white (L=1): choose the higher ratio.
  const L = luminance(color);
  const onDark = (L + 0.05) / (0.0056 + 0.05);
  const onWhite = 1.05 / (L + 0.05);
  root.setProperty('--accent-ink', onDark >= onWhite ? '#111111' : '#ffffff');
}

/** Loads public store settings once and applies the configurable brand accent colour (Q2). */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  useEffect(() => {
    cachedGet<PublicSettings>('/api/settings/public')
      .then((s) => {
        setSettings(s);
        applyBrandAccent(s.brand?.accentColor);
      })
      .catch(() => setSettings(null));
  }, []);
  return <SettingsCtx.Provider value={settings}>{children}</SettingsCtx.Provider>;
}

export const useSettings = () => useContext(SettingsCtx);

export function whatsappLink(number: string | undefined, text = '') {
  const digits = (number ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
