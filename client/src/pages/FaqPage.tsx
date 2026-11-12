import { useMemo, useState } from 'react';
import { ErrorState } from '../components/ui';
import { useI18n } from '../i18n/I18n';
import { L } from '../lib/format';
import { useApi } from '../lib/hooks';
import { markdownToText } from '../lib/markdown';
import type { FaqPageData } from '../lib/types';
import { useSeo } from '../lib/useSeo';
import { useSettings } from '../state/settings';
import { FaqAccordion, FaqCategoryFilter, localiseFaqs, type ShownFaq } from '../storefront/Faq';

/** Search normalisation: case, Arabic diacritics (tashkeel, tatweel) and alef / yaa / taa-marbuta variants. */
function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[آأإ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Dedicated FAQ page (/:lang/faq). Data: /api/faq — published questions only, fetched fresh on
 * every visit (no stale content after Admin publishes or unpublishes).
 */
export default function FaqPage() {
  const { t, lang } = useI18n();
  const settings = useSettings();
  const { data, error, reload } = useApi<FaqPageData>('/api/faq');
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('');

  const all = useMemo(() => (data ? localiseFaqs(data.items, lang, data.settings.missingTranslation) : []), [data, lang]);
  const categories = useMemo(() => (data?.categories ?? []).filter((c) => all.some((i) => i.categoryId === c.id)), [data, all]);
  const shown: ShownFaq[] = useMemo(() => {
    const needle = norm(query.slice(0, 100));
    let list = cat ? all.filter((i) => i.categoryId === cat) : all;
    if (needle) list = list.filter((i) => norm(`${i.question} ${markdownToText(i.answer)}`).includes(needle));
    // Featured questions lead the full list (admin order is kept within each group).
    if (!needle && !cat) list = [...list.filter((i) => i.featured), ...list.filter((i) => !i.featured)];
    return list;
  }, [all, cat, query]);

  const title = L(data?.settings.title, lang) || t.faq.pageTitle;
  const subtitle = L(data?.settings.subtitle, lang) || t.faq.pageSubtitle;
  // FAQPage structured data: only the questions actually published and shown in this language.
  const jsonLd = all.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        inLanguage: lang === 'ar' ? 'ar-SA' : 'en-SA',
        mainEntity: all
          .filter((f) => f.contentLang === lang)
          .slice(0, 100)
          .map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: markdownToText(f.answer) } })),
      }
    : undefined;
  useSeo(title, L(data?.settings.subtitle, lang) || t.faq.metaDescription, { jsonLd: jsonLd && jsonLd.mainEntity.length ? jsonLd : undefined });

  const wa = settings?.business?.whatsappNumber?.replace(/\D/g, '');
  const email = settings?.business?.email;
  const contactHref = wa ? `https://wa.me/${wa}` : email ? `mailto:${email}` : '';

  if (error) return <ErrorState message={t.faq.loadError} onRetry={reload} />;

  return (
    <div className="faq-page" data-testid="faq-page">
      <div className="container faq-page__inner">
        <header className="faq-page__head">
          <span className="cx-eyebrow">{t.faq.eyebrow}</span>
          <h1 className="faq-title faq-title--page">{title}</h1>
          <p className="faq-lead">{subtitle}</p>
        </header>

        {!data ? (
          <div className="faq-list" aria-busy="true">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="faq-item">
                <div className="skeleton" style={{ height: 22, width: `${70 - i * 6}%`, margin: '28px 0' }} />
              </div>
            ))}
          </div>
        ) : !all.length ? (
          <p className="faq-empty" data-testid="faq-empty">
            {t.faq.empty}
          </p>
        ) : (
          <>
            <div className="faq-tools">
              <label className="faq-search">
                <span className="sr-only">{t.faq.searchLabel}</span>
                <span className="faq-search__icon" aria-hidden="true" />
                <input
                  type="search"
                  className="faq-search__input"
                  placeholder={t.faq.searchPlaceholder}
                  value={query}
                  maxLength={100}
                  onChange={(e) => setQuery(e.target.value)}
                  data-testid="faq-search"
                  aria-describedby="faq-count"
                />
              </label>
              <FaqCategoryFilter categories={categories} value={cat} onChange={setCat} />
            </div>
            <p id="faq-count" className="faq-count" aria-live="polite">
              {query || cat ? t.faq.results.replace('{n}', String(shown.length)) : ''}
            </p>
            {shown.length ? (
              <FaqAccordion key={`${cat}|${query}`} items={shown} allowMultiple={data.settings.allowMultipleOpen} openFromHash={!query && !cat} />
            ) : (
              <div className="faq-empty" data-testid="faq-no-results">
                <p className="faq-empty__title">{t.faq.noResults}</p>
                <p>{t.faq.noResultsHint}</p>
                {query ? (
                  <button type="button" className="faq-more" onClick={() => setQuery('')}>
                    {t.faq.clearSearch}
                  </button>
                ) : null}
              </div>
            )}
          </>
        )}

        {contactHref && data ? (
          <p className="faq-contact">
            <a href={contactHref} className="faq-more" {...(wa ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
              {t.faq.contact}
              <span aria-hidden="true" className="faq-more__arrow" />
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}
