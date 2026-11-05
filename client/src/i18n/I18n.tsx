import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import type { Lang } from '../lib/types';
import { dictionaries, type Dict } from './strings';

type Ctx = {
  lang: Lang;
  t: Dict;
  dir: 'rtl' | 'ltr';
  /** Builds a link in the current language: p('/cart') → /ar/cart */
  p: (path: string) => string;
  /** Same page in the other language (keeps path and query) */
  switchHref: string;
};

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const location = useLocation();
  const value = useMemo<Ctx>(() => {
    const other: Lang = lang === 'ar' ? 'en' : 'ar';
    const rest = location.pathname.replace(/^\/(ar|en)(?=\/|$)/, '');
    return {
      lang,
      t: dictionaries[lang],
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      p: (path: string) => `/${lang}${path === '/' ? '' : path}`,
      switchHref: `/${other}${rest}${location.search}`,
    };
  }, [lang, location.pathname, location.search]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    try {
      localStorage.setItem('cel_lang', lang);
    } catch {
      /* storage unavailable */
    }
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}

/** Like useI18n but returns null outside a provider (for shared components such as Spinner). */
export function useMaybeI18n() {
  return useContext(I18nContext);
}

export function preferredLang(): Lang {
  try {
    const saved = localStorage.getItem('cel_lang');
    if (saved === 'en' || saved === 'ar') return saved;
  } catch {
    /* ignore */
  }
  return 'ar'; // Q10: Arabic is the default language
}
