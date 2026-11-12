import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18n';
import { L } from '../lib/format';
import { Markdown } from '../lib/markdown';
import type { FaqTranslationPolicy, HomeFaq as HomeFaqData, Lang, PublicFaq, PublicFaqCategory } from '../lib/types';
import '../styles/faq.css';

/**
 * FAQ presentation shared by the homepage preview and the /faq page. Every question, answer,
 * category and heading comes from Admin → Website → FAQ management (via /api/home and /api/faq);
 * only interface wording ("All", "Search…") lives in the translation files.
 */

export type ShownFaq = { id: string; categoryId: string | null; featured: boolean; question: string; answer: string; contentLang: Lang };

/**
 * Applies the admin's missing-translation policy. Each language is its own approved content:
 * a question without a translation is hidden in that language ('hide'), or shown in the other
 * language with that language's direction ('fallback') — never machine-translated.
 */
export function localiseFaqs(items: PublicFaq[], lang: Lang, policy: FaqTranslationPolicy = 'hide'): ShownFaq[] {
  const other: Lang = lang === 'ar' ? 'en' : 'ar';
  const out: ShownFaq[] = [];
  for (const f of items) {
    const has = (l: Lang) => Boolean(f.question?.[l]?.trim() && f.answer?.[l]?.trim());
    const use: Lang | null = has(lang) ? lang : policy === 'fallback' && has(other) ? other : null;
    if (!use) continue;
    out.push({ id: f.id, categoryId: f.categoryId, featured: f.featured, question: f.question[use], answer: f.answer[use], contentLang: use });
  }
  return out;
}

export function FaqCategoryFilter({ categories, value, onChange }: { categories: PublicFaqCategory[]; value: string; onChange: (id: string) => void }) {
  const { t, lang } = useI18n();
  if (categories.length < 2) return null;
  const chips: [string, string][] = [['', t.faq.all], ...categories.map((c): [string, string] => [c.id, L(c.name, lang) || L(c.name, lang === 'ar' ? 'en' : 'ar')])];
  return (
    <div className="faq-filter" role="group" aria-label={t.faq.filterLabel}>
      {chips.map(([id, label]) => (
        <button key={id || 'all'} type="button" className="faq-chip" aria-pressed={value === id} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * WAI-ARIA accordion: each question is a <button aria-expanded> inside a heading, controlling a
 * labelled region. Enter/Space toggle; ↑/↓/Home/End move between questions. Closed answers are
 * `inert` (not focusable, not read). Animation is CSS only and switched off for reduced motion.
 */
export function FaqAccordion({ items, allowMultiple = false, headingLevel = 3, openFromHash = false }: { items: ShownFaq[]; allowMultiple?: boolean; headingLevel?: 2 | 3; openFromHash?: boolean }) {
  const base = useId().replace(/:/g, '');
  const { lang } = useI18n();
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  // /faq#faq-<id> opens and scrolls to that question (shareable links).
  useEffect(() => {
    if (!openFromHash) return;
    const id = decodeURIComponent(window.location.hash.replace(/^#faq-/, ''));
    if (id && items.some((i) => i.id === id)) {
      setOpen(new Set([id]));
      requestAnimationFrame(() => document.getElementById(`faq-${id}`)?.scrollIntoView({ block: 'center' }));
    }
  }, [openFromHash, items]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(allowMultiple ? prev : []);
      if (prev.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = items.length - 1;
    const go = (n: number) => {
      e.preventDefault();
      buttons.current[n]?.focus();
    };
    if (e.key === 'ArrowDown') go(i === last ? 0 : i + 1);
    else if (e.key === 'ArrowUp') go(i === 0 ? last : i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(last);
  };

  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className="faq-list" data-testid="faq-list">
      {items.map((f, i) => {
        const isOpen = open.has(f.id);
        const qid = `${base}-q-${i}`;
        const pid = `${base}-a-${i}`;
        const dir = f.contentLang === 'ar' ? 'rtl' : 'ltr';
        const foreign = f.contentLang !== lang;
        return (
          <div key={f.id} id={`faq-${f.id}`} className={`faq-item${isOpen ? ' is-open' : ''}`} data-testid="faq-item">
            <H className="faq-q">
              <button
                ref={(el) => (buttons.current[i] = el)}
                id={qid}
                type="button"
                className="faq-q__btn"
                aria-expanded={isOpen}
                aria-controls={pid}
                onClick={() => toggle(f.id)}
                onKeyDown={(e) => onKey(e, i)}
              >
                <span className="faq-q__text" dir={dir} lang={foreign ? f.contentLang : undefined}>
                  {f.question}
                </span>
                <span className="faq-q__icon" aria-hidden="true" />
              </button>
            </H>
            <div id={pid} role="region" aria-labelledby={qid} className="faq-a" {...(isOpen ? {} : { inert: '' as unknown as boolean, 'aria-hidden': true })}>
              <div className="faq-a__clip">
                <div className="faq-a__body" dir={dir} lang={foreign ? f.contentLang : undefined}>
                  <Markdown source={f.answer} rich className="faq-prose" />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Homepage preview: placed before the newsletter; renders nothing until Admin publishes homepage questions. */
export function HomeFaq({ faq }: { faq?: HomeFaqData }) {
  const { t, lang, p } = useI18n();
  const [cat, setCat] = useState('');
  const items = useMemo(() => localiseFaqs(faq?.items ?? [], lang, faq?.missingTranslation), [faq, lang]);
  const categories = useMemo(() => (faq?.categories ?? []).filter((c) => items.some((i) => i.categoryId === c.id)), [faq, items]);
  if (!faq?.enabled || !items.length) return null;
  const shown = cat ? items.filter((i) => i.categoryId === cat) : items;
  return (
    <section className="faq-home" id="faq" aria-labelledby="faq-home-title" data-testid="home-faq">
      <div className="container faq-home__grid">
        <header className="faq-home__head">
          <span className="cx-eyebrow">{t.faq.eyebrow}</span>
          <h2 id="faq-home-title" className="faq-title">
            {L(faq.title, lang) || t.faq.title}
          </h2>
          <p className="faq-lead">{L(faq.subtitle, lang) || t.faq.subtitle}</p>
          <Link to={p('/faq')} className="faq-more" data-testid="faq-view-all">
            {t.faq.viewAll}
            <span aria-hidden="true" className="faq-more__arrow" />
          </Link>
        </header>
        <div className="faq-home__body">
          {faq.showCategoryFilters ? <FaqCategoryFilter categories={categories} value={cat} onChange={setCat} /> : null}
          <FaqAccordion key={cat} items={shown} allowMultiple={faq.allowMultipleOpen} />
        </div>
      </div>
    </section>
  );
}
