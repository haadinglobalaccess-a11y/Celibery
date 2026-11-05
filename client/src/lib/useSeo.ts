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

/** Sets title, description, canonical and hreflang alternates for the current page. */
export function useSeo(title: string, description?: string) {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = title ? `${title} | CELIBERY` : 'CELIBERY International';
    if (description) setMeta('meta[name="description"]', 'name', 'description', description.slice(0, 160));
    const origin = window.location.origin;
    const rest = pathname.replace(/^\/(ar|en)(?=\/|$)/, '');
    setMeta('link[rel="canonical"]', 'rel', 'canonical', origin + pathname);
    for (const [lang, hreflang] of [
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
      link.href = `${origin}/${lang}${rest}`;
    }
  }, [title, description, pathname]);
}
