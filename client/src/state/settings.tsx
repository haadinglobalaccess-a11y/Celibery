import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { cachedGet } from '../lib/hooks';
import type { PublicSettings } from '../lib/types';

const SettingsCtx = createContext<PublicSettings | null>(null);

/** Loads public store settings once and applies the configurable brand accent colour (Q2). */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  useEffect(() => {
    cachedGet<PublicSettings>('/api/settings/public')
      .then((s) => {
        setSettings(s);
        if (s.brand?.accentColor && /^#[0-9a-f]{6}$/i.test(s.brand.accentColor)) {
          document.documentElement.style.setProperty('--accent', s.brand.accentColor);
        }
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
