import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

function setMeta(selector: string, attr: string, key: string, content: string) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = document.createElement(selector.startsWith('link') ? 'link' : 'meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute(selector.startsWith('link') ? 'href' : 'content', content);
}

const removeMeta = (selector: string) => document.head.querySelector(selector)?.remove();

/** Absolute URL for a media path (structured data and social previews need absolute URLs). */
export function absoluteUrl(url: string | undefined | null): string {
  if (!url) return '';
  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return '';
  }
}

export type SeoOptions = {
  /** Share image for Open Graph / Twitter cards (relative or absolute). */
  image?: string;
  /** Open Graph type: 'product' on product pages, 'website' otherwise. */
  type?: 'website' | 'product';
  /** schema.org JSON-LD for this page (null/undefined = none). Only real data — never invented. */
  jsonLd?: Record<string, unknown> | null;
  /** Keeps private pages (account, checkout, order tracking) out of search results. */
  noindex?: boolean;
};

const LD_ID = 'celibery-page-ld';

/** Sets title, description, canonical, hreflang alternates, social preview tags and structured data. */
export function useSeo(title: string, description?: string, opts: SeoOptions = {}) {
  const { pathname } = useLocation();
  const { image, type = 'website', noindex = false } = opts;
  const ld = opts.jsonLd ? JSON.stringify(opts.jsonLd) : '';
  useEffect(() => {
    const fullTitle = title ? `${title} | CELIBERY` : 'CELIBERY International';
    document.title = fullTitle;
    if (description) setMeta('meta[name="description"]', 'name', 'description', description.slice(0, 160));
    const origin = window.location.origin;
    const rest = pathname.replace(/^\/(ar|en)(?=\/|$)/, '');
    const lang = pathname.startsWith('/en') ? 'en' : 'ar';
    setMeta('link[rel="canonical"]', 'rel', 'canonical', origin + pathname);
    for (const [l, hreflang] of [
      ['ar', 'ar-SA'],
      ['en', 'en-SA'],
    ]) {
      let link = document.head.querySelector<HTMLLinkElement>(`link[hreflang="${hreflang}"]`);
      if (!link) {
        link = document.createElement('link');
        link.rel = 'alternate';
        link.hreflang = hreflang;
        document.head.appendChild(link);
      }
      link.href = `${origin}/${l}${rest}`;
    }

    // Social previews (WhatsApp, X, Snapchat, iMessage…).
    setMeta('meta[property="og:site_name"]', 'property', 'og:site_name', 'CELIBERY International');
    setMeta('meta[property="og:title"]', 'property', 'og:title', fullTitle);
    setMeta('meta[property="og:type"]', 'property', 'og:type', type);
    setMeta('meta[property="og:url"]', 'property', 'og:url', origin + pathname);
    setMeta('meta[property="og:locale"]', 'property', 'og:locale', lang === 'ar' ? 'ar_SA' : 'en_SA');
    if (description) setMeta('meta[property="og:description"]', 'property', 'og:description', description.slice(0, 200));
    else removeMeta('meta[property="og:description"]');
    const img = absoluteUrl(image);
    if (img) setMeta('meta[property="og:image"]', 'property', 'og:image', img);
    else removeMeta('meta[property="og:image"]');
    setMeta('meta[name="twitter:card"]', 'name', 'twitter:card', img ? 'summary_large_image' : 'summary');

    if (noindex) setMeta('meta[name="robots"]', 'name', 'robots', 'noindex, follow');
    else removeMeta('meta[name="robots"]');

    let script = document.getElementById(LD_ID);
    if (ld) {
      if (!script) {
        script = document.createElement('script');
        script.id = LD_ID;
        script.setAttribute('type', 'application/ld+json');
        document.head.appendChild(script);
      }
      // JSON.stringify output cannot close the script element once "<" is escaped.
      script.textContent = ld.replace(/</g, '\\u003c');
    } else script?.remove();
  }, [title, description, pathname, image, type, ld, noindex]);
}
