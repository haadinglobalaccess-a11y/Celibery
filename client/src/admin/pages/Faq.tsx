import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, del, patch, post, put, qs } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { Markdown } from '../../lib/markdown';
import type { Localized } from '../../lib/types';
import { useToast } from '../../state/toast';
import '../../styles/faq.css';
import { AIcon } from '../icons';
import { AHead, dt, EmptyState, ErrorBox, ErrorPanel, F, KpiCard, LocInput, Modal, Pager, SkeletonTable, Status, Tabs } from '../kit';

/**
 * Admin → Website → FAQ management. Questions, answers, categories and display settings all
 * live in the database (/api/admin/faq); the storefront homepage preview and /faq page read the
 * same records. Permission: content:write (enforced by the API).
 */

type Category = { _id: string; slug: string; name: Localized; visible: boolean; sortOrder: number; faqCount?: number; publishedCount?: number };
type Faq = {
  _id: string;
  question: Localized;
  answer: Localized;
  category: { _id: string; name: Localized; slug: string; visible: boolean } | null;
  status: 'draft' | 'published';
  showOnHomepage: boolean;
  featured: boolean;
  sortOrder: number;
  seoTitle?: Localized;
  seoDescription?: Localized;
  updatedAt: string;
  createdAt: string;
};
type Stats = { total: number; published: number; draft: number; homepage: number; categories: number };
type Settings = { homepageEnabled: boolean; homepageLimit: number; showCategoryFilters: boolean; title: Localized; subtitle: Localized; missingTranslation: 'hide' | 'fallback'; allowMultipleOpen: boolean };
type Draft = {
  _id?: string;
  question: Localized;
  answer: Localized;
  categoryId: string | null;
  status: 'draft' | 'published';
  showOnHomepage: boolean;
  featured: boolean;
  sortOrder?: number;
  seoTitle: Localized;
  seoDescription: Localized;
};

const EMPTY: Localized = { ar: '', en: '' };
const nameOf = (n?: Localized | null) => n?.en || n?.ar || '—';
const complete = (d: { question: Localized; answer: Localized }, l: 'ar' | 'en') => Boolean(d.question[l]?.trim() && d.answer[l]?.trim());

/** Starter categories offered once, on request — editable and deletable like any other. */
const SUGGESTED: Localized[] = [
  { en: 'Orders & Delivery', ar: 'الطلبات والتوصيل' },
  { en: 'Payments & Billing', ar: 'الدفع والفواتير' },
  { en: 'Products & Compatibility', ar: 'المنتجات والتوافق' },
  { en: 'Warranty & Support', ar: 'الضمان والدعم' },
  { en: 'Returns & Refunds', ar: 'الإرجاع والاسترداد' },
  { en: 'Account & Security', ar: 'الحساب والأمان' },
  { en: 'General Questions', ar: 'أسئلة عامة' },
];

export function FaqManagement() {
  const [tab, setTab] = useState<'faqs' | 'categories' | 'settings'>('faqs');
  const [editing, setEditing] = useState<Draft | null>(null);
  const [refresh, setRefresh] = useState(0);
  const cats = useApi<{ categories: Category[]; uncategorised: number }>(`/api/admin/faq/categories?r=${refresh}`);
  const bump = () => setRefresh((n) => n + 1);

  const newFaq = () => setEditing({ question: { ...EMPTY }, answer: { ...EMPTY }, categoryId: null, status: 'draft', showOnHomepage: false, featured: false, seoTitle: { ...EMPTY }, seoDescription: { ...EMPTY } });

  return (
    <div className="a-page" data-testid="admin-faq">
      <AHead title="FAQ management">
        <button className="btn btn--primary" onClick={newFaq} data-testid="faq-add">
          Add FAQ
        </button>
      </AHead>
      <p className="a-muted" style={{ marginTop: -8 }}>
        Questions shown on the homepage FAQ section and on the FAQ page ({' '}
        <a href="/ar/faq" target="_blank" rel="noreferrer">
          /ar/faq
        </a>{' '}
        ·{' '}
        <a href="/en/faq" target="_blank" rel="noreferrer">
          /en/faq
        </a>
        ). Arabic and English are written separately — nothing is translated automatically.
      </p>
      <Tabs
        tabs={[
          ['faqs', 'Questions'],
          ['categories', 'Categories'],
          ['settings', 'Display settings'],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'faqs' ? <FaqList categories={cats.data?.categories ?? []} refresh={refresh} onEdit={setEditing} onChanged={bump} /> : null}
      {tab === 'categories' ? <CategoryManager data={cats.data} error={cats.error} reload={bump} /> : null}
      {tab === 'settings' ? <DisplaySettings /> : null}
      {editing ? (
        <FaqEditor
          draft={editing}
          categories={cats.data?.categories ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            bump();
          }}
        />
      ) : null}
    </div>
  );
}

/* ───────────── Questions list ───────────── */
function FaqList({ categories, refresh, onEdit, onChanged }: { categories: Category[]; refresh: number; onEdit: (d: Draft) => void; onChanged: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filters, setFilters] = useState({ category: '', status: '', homepage: '', sort: 'order' });
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => setPage(1), [debounced, filters]);
  const path = `/api/admin/faq${qs({ q: debounced, ...filters, page, limit: 50, r: refresh })}`;
  // One request returns the rows plus paging and dashboard stats (meta).
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ data: Faq[] | null; error: Error | null }>({ data: null, error: null });
  const [meta, setMeta] = useState<{ total: number; pages: number; stats: Stats } | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    api<Faq[]>(path, { signal: ctrl.signal })
      .then((r) => {
        setState({ data: r.data, error: null });
        setMeta(r.meta as { total: number; pages: number; stats: Stats });
      })
      .catch((e) => (e as Error).name !== 'AbortError' && setState({ data: null, error: e as Error }));
    return () => ctrl.abort();
  }, [path, nonce]);
  const list = { ...state, reload: () => setNonce((n) => n + 1) };

  const act = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try {
      await fn();
      toast(done);
      onChanged();
      list.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  const edit = (f: Faq) =>
    onEdit({
      _id: f._id,
      question: { ar: f.question.ar ?? '', en: f.question.en ?? '' },
      answer: { ar: f.answer.ar ?? '', en: f.answer.en ?? '' },
      categoryId: f.category?._id ?? null,
      status: f.status,
      showOnHomepage: f.showOnHomepage,
      featured: f.featured,
      sortOrder: f.sortOrder,
      seoTitle: { ar: f.seoTitle?.ar ?? '', en: f.seoTitle?.en ?? '' },
      seoDescription: { ar: f.seoDescription?.ar ?? '', en: f.seoDescription?.en ?? '' },
    });
  const set = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const s = meta?.stats;
  const canMove = filters.sort === 'order';

  return (
    <>
      <div className="a-kpis" style={{ marginBlock: 16 }}>
        <KpiCard label="Total FAQs" value={s?.total ?? '—'} tip="Every question, published or draft." />
        <KpiCard label="Published" value={s?.published ?? '—'} tip="Visible on the FAQ page (when its category is visible)." />
        <KpiCard label="Drafts" value={s?.draft ?? '—'} tip="Saved but not public." />
        <KpiCard label="On the homepage" value={s?.homepage ?? '—'} tip="Published questions selected for the homepage preview." />
        <KpiCard label="Categories" value={s?.categories ?? '—'} tip="FAQ categories (Categories tab)." />
      </div>
      <div className="a-card a-card--flush">
        <div className="a-filterbar" role="search">
          <label className="a-filterbar__search">
            <span className="sr-only">Search FAQs</span>
            <AIcon name="search" size={16} />
            <input className="a-input" type="search" maxLength={100} placeholder="Search questions and answers (Arabic or English)" value={q} onChange={(e) => setQ(e.target.value)} data-testid="faq-admin-search" />
          </label>
          <label>
            <span className="sr-only">Category</span>
            <select className="a-select" value={filters.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">All categories</option>
              <option value="none">No category</option>
              {categories.map((c) => (
                <option key={c._id} value={c._id}>
                  {nameOf(c.name)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Status</span>
            <select className="a-select" value={filters.status} onChange={(e) => set('status', e.target.value)}>
              <option value="">All statuses</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Homepage</span>
            <select className="a-select" value={filters.homepage} onChange={(e) => set('homepage', e.target.value)}>
              <option value="">Homepage: any</option>
              <option value="1">On the homepage</option>
              <option value="0">Not on the homepage</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Sort</span>
            <select className="a-select" value={filters.sort} onChange={(e) => set('sort', e.target.value)}>
              <option value="order">Display order</option>
              <option value="updated">Last updated</option>
              <option value="question">Question (A–Z)</option>
            </select>
          </label>
        </div>
        {list.error ? (
          <ErrorPanel onRetry={list.reload} message={list.error.message} />
        ) : !list.data ? (
          <SkeletonTable rows={6} cols={8} />
        ) : !list.data.length ? (
          <EmptyState
            title={debounced || filters.category || filters.status || filters.homepage ? 'No FAQ matches these filters' : 'No FAQs yet'}
            text={debounced || filters.category || filters.status || filters.homepage ? 'Change the search or filters.' : 'Add the first question. It stays a draft until you publish it.'}
          />
        ) : (
          <div className="table-wrap">
            <table className="table" data-testid="faq-admin-table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Order</th>
                  <th>Question (English)</th>
                  <th>Question (Arabic)</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Homepage</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.map((f, i) => (
                  <tr key={f._id} data-testid="faq-admin-row">
                    <td className="ltr">
                      <span className="a-muted">{f.sortOrder}</span>
                      {canMove ? (
                        <span style={{ display: 'inline-flex', gap: 2, marginInlineStart: 6 }}>
                          <button className="btn btn--ghost btn--sm" aria-label="Move up" disabled={busy === f._id || (page === 1 && i === 0)} onClick={() => act(f._id, () => post(`/api/admin/faq/${f._id}/move`, { direction: 'up' }), 'Moved up')}>
                            ↑
                          </button>
                          <button className="btn btn--ghost btn--sm" aria-label="Move down" disabled={busy === f._id || (page === (meta?.pages ?? 1) && i === list.data!.length - 1)} onClick={() => act(f._id, () => post(`/api/admin/faq/${f._id}/move`, { direction: 'down' }), 'Moved down')}>
                            ↓
                          </button>
                        </span>
                      ) : null}
                    </td>
                    <td dir="ltr" lang="en">
                      {f.question.en || <span className="a-muted">— not written</span>}
                      {f.featured ? <span className="badge" style={{ marginInlineStart: 6 }}>featured</span> : null}
                    </td>
                    <td dir="rtl" lang="ar">
                      {f.question.ar || <span className="a-muted">— غير مكتوب</span>}
                    </td>
                    <td>{f.category ? nameOf(f.category.name) + (f.category.visible ? '' : ' (hidden)') : <span className="a-muted">None</span>}</td>
                    <td>{f.status === 'published' ? <Status value="active" label="Published" /> : <Status value="draft" label="Draft" />}</td>
                    <td>{f.showOnHomepage ? (f.status === 'published' ? 'Yes' : 'Yes (after publishing)') : '—'}</td>
                    <td className="ltr">{dt(f.updatedAt)}</td>
                    <td className="actions">
                      <button className="btn btn--ghost btn--sm" onClick={() => edit(f)} data-testid="faq-edit">
                        Edit
                      </button>
                      {f.status === 'published' ? (
                        <button className="btn btn--ghost btn--sm" disabled={busy === f._id} onClick={() => act(f._id, () => patch(`/api/admin/faq/${f._id}/status`, { status: 'draft' }), 'Unpublished')}>
                          Unpublish
                        </button>
                      ) : (
                        <button className="btn btn--ghost btn--sm" disabled={busy === f._id} onClick={() => act(f._id, () => patch(`/api/admin/faq/${f._id}/status`, { status: 'published' }), 'Published')} data-testid="faq-publish">
                          Publish
                        </button>
                      )}
                      <button className="btn btn--ghost btn--sm" disabled={busy === f._id} onClick={() => act(f._id, () => post(`/api/admin/faq/${f._id}/duplicate`), 'Duplicated as a draft')}>
                        Duplicate
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        disabled={busy === f._id}
                        onClick={() => {
                          if (window.confirm(`Delete this FAQ permanently?\n\n${f.question.en || f.question.ar}`)) void act(f._id, () => del(`/api/admin/faq/${f._id}`), 'FAQ deleted');
                        }}
                        data-testid="faq-delete"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {meta && meta.pages > 1 ? <Pager page={page} pages={meta.pages} onPage={setPage} /> : null}
      </div>
    </>
  );
}

/* ───────────── Editor ───────────── */
function FaqEditor({ draft, categories, onClose, onSaved }: { draft: Draft; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(draft);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [err, setErr] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const langs = { ar: complete(d, 'ar'), en: complete(d, 'en') };

  const save = async (status: 'draft' | 'published') => {
    setErr(null);
    setSaving(true);
    try {
      const body = { question: d.question, answer: d.answer, categoryId: d.categoryId, status, showOnHomepage: d.showOnHomepage, featured: d.featured, sortOrder: d.sortOrder, seoTitle: d.seoTitle, seoDescription: d.seoDescription };
      if (d._id) await put(`/api/admin/faq/${d._id}`, body);
      else await post('/api/admin/faq', body);
      toast(status === 'published' ? 'Saved and published' : 'Saved as draft');
      onSaved();
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save(d.status);
  };

  return (
    <Modal title={d._id ? 'Edit FAQ' : 'Add FAQ'} onClose={onClose} wide>
      <Tabs
        tabs={[
          ['edit', 'Edit'],
          ['preview', 'Preview (Arabic & English)'],
        ]}
        value={view}
        onChange={setView}
      />
      {view === 'edit' ? (
        <form className="form-grid form-grid--2" onSubmit={submit} data-testid="faq-editor">
          <LocInput label="Question" value={d.question} onChange={(v) => set('question', v)} hint="One line. Write each language yourself; a language left empty is not shown in that language (see Display settings)." />
          <LocInput
            label="Answer"
            value={d.answer}
            onChange={(v) => set('answer', v)}
            textarea
            hint="Formatting: blank line = new paragraph · “- ” bulleted list · “1. ” numbered list · **bold** · [link text](https://… or /en/page). HTML is not accepted."
          />
          <F label="Category">
            <select className="a-select" value={d.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value || null)} data-testid="faq-category">
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c._id} value={c._id}>
                  {nameOf(c.name)}
                  {c.visible ? '' : ' (hidden)'}
                </option>
              ))}
            </select>
          </F>
          <F label="Display order" hint="Lower numbers appear first. Use ↑ ↓ in the list to move one step.">
            <input className="a-input ltr" type="number" min={0} max={1000000} value={d.sortOrder ?? ''} placeholder="Automatic (at the end)" onChange={(e) => set('sortOrder', e.target.value === '' ? undefined : Number(e.target.value))} />
          </F>
          <F label="Status">
            <select className="a-select" value={d.status} onChange={(e) => set('status', e.target.value as Draft['status'])} data-testid="faq-status">
              <option value="draft">Draft (not public)</option>
              <option value="published">Published</option>
            </select>
          </F>
          <div className="field">
            <span className="label">Visibility</span>
            <label className="check">
              <input type="checkbox" checked={d.showOnHomepage} onChange={(e) => set('showOnHomepage', e.target.checked)} data-testid="faq-homepage" /> Show in the homepage FAQ section
            </label>
            <label className="check">
              <input type="checkbox" checked={d.featured} onChange={(e) => set('featured', e.target.checked)} /> Featured (listed first on the FAQ page)
            </label>
          </div>
          <details className="span-2">
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>SEO (optional)</summary>
            <div className="form-grid form-grid--2" style={{ marginTop: 12 }}>
              <LocInput label="SEO title" value={d.seoTitle} onChange={(v) => set('seoTitle', v)} hint="Internal note for search wording (max 120). The FAQ page title comes from Display settings." />
              <LocInput label="SEO description" value={d.seoDescription} onChange={(v) => set('seoDescription', v)} textarea hint="Max 300 characters." />
            </div>
          </details>
          <p className="span-2 a-muted" style={{ margin: 0 }}>
            Arabic: {langs.ar ? '✓ complete' : 'missing'} · English: {langs.en ? '✓ complete' : 'missing'}
          </p>
          <div className="span-2">
            <ErrorBox error={err} />
          </div>
          <div className="span-2" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn" disabled={saving} onClick={() => void save('draft')} data-testid="faq-save-draft">
              Save as draft
            </button>
            <button type="button" className="btn btn--primary" disabled={saving || (!langs.ar && !langs.en)} onClick={() => void save('published')} data-testid="faq-save-publish">
              {d.status === 'published' ? 'Save (published)' : 'Publish'}
            </button>
          </div>
        </form>
      ) : (
        <div className="form-grid form-grid--2" data-testid="faq-preview">
          {(['ar', 'en'] as const).map((l) => (
            <div key={l} dir={l === 'ar' ? 'rtl' : 'ltr'} lang={l} className="a-card">
              <p className="a-muted" style={{ marginTop: 0 }}>
                {l === 'ar' ? 'العربية' : 'English'}
              </p>
              {complete(d, l) ? (
                <div className="faq-item is-open">
                  <h3 className="faq-q">
                    <span className="faq-q__btn" style={{ cursor: 'default' }}>
                      <span className="faq-q__text">{d.question[l]}</span>
                    </span>
                  </h3>
                  <div className="faq-a">
                    <div className="faq-a__clip">
                      <div className="faq-a__body">
                        <Markdown source={d.answer[l]} rich className="faq-prose" />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="a-muted">{l === 'ar' ? 'لا يوجد محتوى عربي — لن يظهر هذا السؤال بالعربية.' : 'No English content — this question will not appear in English.'}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ───────────── Categories ───────────── */
function CategoryManager({ data, error, reload }: { data: { categories: Category[]; uncategorised: number } | null; error: Error | null; reload: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState<{ _id?: string; name: Localized; slug: string; visible: boolean } | null>(null);
  const [removing, setRemoving] = useState<Category | null>(null);
  const [target, setTarget] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorPanel onRetry={reload} message={error.message} />;
  if (!data) return <SkeletonTable rows={4} cols={5} />;
  const cats = data.categories;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      toast(done);
      reload();
      return true;
    } catch (e) {
      setErr(e);
      toast((e as Error).message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const move = (i: number, dir: -1 | 1) => {
    const ids = cats.map((c) => c._id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    void run(() => post('/api/admin/faq/categories/reorder', { ids }), 'Order saved');
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { name: edit!.name, slug: edit!.slug, visible: edit!.visible };
    if (await run(() => (edit!._id ? put(`/api/admin/faq/categories/${edit!._id}`, body) : post('/api/admin/faq/categories', body)), 'Category saved')) setEdit(null);
  };

  return (
    <div className="a-card" style={{ marginTop: 16 }}>
      <div className="a-head" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Categories</h2>
        <div className="actions">
          {!cats.length ? (
            <button className="btn" disabled={busy} onClick={() => void run(async () => { for (const name of SUGGESTED) await post('/api/admin/faq/categories', { name, visible: true }); }, 'Suggested categories added')}>
              Add the 7 suggested categories
            </button>
          ) : null}
          <button className="btn btn--primary" onClick={() => setEdit({ name: { ...EMPTY }, slug: '', visible: true })} data-testid="faq-category-add">
            Add category
          </button>
        </div>
      </div>
      {!cats.length ? (
        <EmptyState title="No categories yet" text="Categories group the questions on the FAQ page. Add your own, or start from the suggested list (you can rename or delete them)." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>English</th>
                <th>Arabic</th>
                <th>FAQs (published)</th>
                <th>Visible</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cats.map((c, i) => (
                <tr key={c._id}>
                  <td>
                    <button className="btn btn--ghost btn--sm" aria-label="Move up" disabled={busy || i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button className="btn btn--ghost btn--sm" aria-label="Move down" disabled={busy || i === cats.length - 1} onClick={() => move(i, 1)}>
                      ↓
                    </button>
                  </td>
                  <td dir="ltr">{c.name.en || <span className="a-muted">—</span>}</td>
                  <td dir="rtl" lang="ar">
                    {c.name.ar || <span className="a-muted">—</span>}
                  </td>
                  <td>
                    {c.faqCount ?? 0} ({c.publishedCount ?? 0})
                  </td>
                  <td>{c.visible ? 'Visible' : <span className="a-muted">Hidden — its questions are not shown</span>}</td>
                  <td className="actions">
                    <button className="btn btn--ghost btn--sm" onClick={() => setEdit({ _id: c._id, name: { ar: c.name.ar ?? '', en: c.name.en ?? '' }, slug: c.slug, visible: c.visible })}>
                      Edit
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => {
                        if (c.faqCount) {
                          setTarget('');
                          setRemoving(c);
                        } else if (window.confirm(`Delete the category “${nameOf(c.name)}”?`)) void run(() => del(`/api/admin/faq/categories/${c._id}`), 'Category deleted');
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.uncategorised ? <p className="a-muted">{data.uncategorised} FAQ(s) have no category (they appear under “All” only).</p> : null}

      {edit ? (
        <Modal title={edit._id ? 'Edit category' : 'Add category'} onClose={() => setEdit(null)}>
          <form className="form-grid" onSubmit={save}>
            <LocInput label="Name" value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} />
            <F label="Web address (optional)" hint="Lowercase letters, numbers and dashes. Created from the English name when empty.">
              <input className="a-input ltr" value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} />
            </F>
            <label className="check">
              <input type="checkbox" checked={edit.visible} onChange={(e) => setEdit({ ...edit, visible: e.target.checked })} /> Visible on the storefront
            </label>
            <ErrorBox error={err} />
            <button className="btn btn--primary" disabled={busy}>
              Save category
            </button>
          </form>
        </Modal>
      ) : null}

      {removing ? (
        <Modal title={`Delete “${nameOf(removing.name)}”`} onClose={() => setRemoving(null)}>
          <div className="form-grid">
            <p style={{ margin: 0 }}>
              This category still has <strong>{removing.faqCount}</strong> FAQ(s). Choose where they go before deleting it.
            </p>
            <F label="Move its FAQs to">
              <select className="a-select" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Choose…</option>
                {cats
                  .filter((c) => c._id !== removing._id)
                  .map((c) => (
                    <option key={c._id} value={c._id}>
                      {nameOf(c.name)}
                    </option>
                  ))}
                <option value="none">No category</option>
              </select>
            </F>
            <button
              className="btn btn--primary"
              disabled={!target || busy}
              onClick={() =>
                void run(() => del(`/api/admin/faq/categories/${removing._id}${qs({ reassignTo: target })}`), 'Category deleted, FAQs moved').then((ok) => ok && setRemoving(null))
              }
            >
              Move FAQs and delete
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/* ───────────── Display settings ───────────── */
function DisplaySettings() {
  const toast = useToast();
  const loaded = useApi<Settings>('/api/admin/faq/settings');
  const [s, setS] = useState<Settings | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (loaded.data) setS(loaded.data);
  }, [loaded.data]);
  const preview = useMemo(() => (s ? `${s.homepageEnabled ? `Homepage shows up to ${s.homepageLimit} question(s)` : 'Homepage FAQ section off'}` : ''), [s]);
  if (loaded.error) return <ErrorPanel onRetry={loaded.reload} message={loaded.error.message} />;
  if (!s) return <SkeletonTable rows={3} cols={2} />;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setS(await put<Settings>('/api/admin/faq/settings', s));
      toast('Display settings saved');
    } catch (ex) {
      setErr(ex);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="a-card form-grid form-grid--2" style={{ marginTop: 16 }} onSubmit={save} data-testid="faq-settings">
      <div className="field span-2">
        <label className="check">
          <input type="checkbox" checked={s.homepageEnabled} onChange={(e) => setS({ ...s, homepageEnabled: e.target.checked })} /> Show the FAQ section on the homepage (before the newsletter)
        </label>
        <span className="hint">{preview}. The section only appears when at least one published question is selected for the homepage.</span>
      </div>
      <F label="Questions on the homepage">
        <input className="a-input ltr" type="number" min={1} max={12} value={s.homepageLimit} onChange={(e) => setS({ ...s, homepageLimit: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })} />
      </F>
      <div className="field">
        <span className="label">Homepage options</span>
        <label className="check">
          <input type="checkbox" checked={s.showCategoryFilters} onChange={(e) => setS({ ...s, showCategoryFilters: e.target.checked })} /> Category filters in the homepage section
        </label>
        <label className="check">
          <input type="checkbox" checked={s.allowMultipleOpen} onChange={(e) => setS({ ...s, allowMultipleOpen: e.target.checked })} /> Allow several answers open at once (otherwise opening one closes the others)
        </label>
      </div>
      <LocInput label="Section heading (optional)" value={s.title} onChange={(v) => setS({ ...s, title: v })} hint="Used on the homepage section and the FAQ page. Empty = the default wording." />
      <LocInput label="Subtitle (optional)" value={s.subtitle} onChange={(v) => setS({ ...s, subtitle: v })} textarea hint="Also the FAQ page’s search-engine description." />
      <F label="When a question is missing in one language" span>
        <select className="a-select" value={s.missingTranslation} onChange={(e) => setS({ ...s, missingTranslation: e.target.value as Settings['missingTranslation'] })}>
          <option value="hide">Hide it in that language (recommended)</option>
          <option value="fallback">Show it in the other language (marked with its own text direction)</option>
        </select>
      </F>
      <div className="span-2">
        <ErrorBox error={err} />
      </div>
      <div className="span-2">
        <button className="btn btn--primary" disabled={busy}>
          Save display settings
        </button>
      </div>
    </form>
  );
}
