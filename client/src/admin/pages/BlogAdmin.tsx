import { useState, type FormEvent } from 'react';
import { ErrorState, Spinner } from '../../components/ui';
import { del, post, put } from '../../lib/api';
import { invalidateCache, useApi } from '../../lib/hooks';
import type { Localized } from '../../lib/types';
import { useToast } from '../../state/toast';
import { Card, dt, en, ErrorBox, F, LocInput, Modal, ProductPicker } from '../kit';
import { MediaField } from '../media';

/**
 * Admin → Website content → Blog. Buying guides and articles for SEO, AEO and GEO: answer one question
 * per article, put the direct answer in the summary, link the products it mentions.
 */
type BlogPostRow = {
  _id?: string;
  slug: string;
  title: Localized;
  excerpt: Localized;
  body: Localized;
  coverImage: { url: string; alt: Localized };
  tags: string[];
  relatedProducts: string[];
  author: string;
  status: 'draft' | 'published';
  publishedAt?: string | null;
  seo: { title: Localized; description: Localized };
  updatedAt?: string;
  createdAt?: string;
  __v?: number;
};
const emptyL = { ar: '', en: '' };
const blank = (): BlogPostRow => ({ slug: '', title: emptyL, excerpt: emptyL, body: emptyL, coverImage: { url: '', alt: emptyL }, tags: [], relatedProducts: [], author: 'CELIBERY', status: 'draft', publishedAt: null, seo: { title: emptyL, description: emptyL } });
const dateIn = (s?: string | null) => (s ? new Date(s).toISOString().slice(0, 16) : '');
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);

export function BlogAdmin() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<BlogPostRow[]>('/api/admin/content/blog');
  const [edit, setEdit] = useState<BlogPostRow | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState message={error.message} />;
  if (loading || !data) return <Spinner />;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const row = edit!;
    const body = {
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      body: row.body,
      coverImage: row.coverImage,
      tags: row.tags,
      relatedProducts: row.relatedProducts.map(String),
      author: row.author,
      status: row.status,
      publishedAt: row.publishedAt || null,
      seo: row.seo,
    };
    setBusy(true);
    try {
      if (row._id) await put(`/api/admin/content/blog/${row._id}`, body);
      else await post('/api/admin/content/blog', body);
      invalidateCache();
      setEdit(null);
      reload();
      toast(row.status === 'published' ? 'Article published' : 'Draft saved');
    } catch (ex) {
      setErr(ex);
    } finally {
      setBusy(false);
    }
  };
  const starter = async () => {
    setBusy(true);
    try {
      const r = await post<{ added: string[] }>('/api/admin/content/blog/starter');
      toast(r.added.length ? `${r.added.length} starter guides added as drafts` : 'The starter guides are already here');
      reload();
    } catch (ex) {
      toast(ex instanceof Error ? ex.message : 'Could not add the guides');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (row: BlogPostRow) => {
    if (!row._id || !window.confirm(`Delete the article “${en(row.title)}”? This cannot be undone.`)) return;
    await del(`/api/admin/content/blog/${row._id}`);
    reload();
  };

  return (
    <>
      <Card
        title="Blog & buying guides"
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => void starter()}>
              Add starter guides
            </button>
            <button className="btn btn--primary btn--sm" onClick={() => setEdit(blank())}>
              + New article
            </button>
          </div>
        }
      >
        <p className="muted" style={{ fontSize: 13 }}>
          Each article gets a page at /blog/&lt;slug&gt; in Arabic and English, is listed in the sitemap and in llms.txt for AI assistants, and links to the products you choose. Best results: one customer
          question per article, the direct answer in the summary, sub-headings phrased as questions (<code>### Can I take a power bank on a plane?</code>), real facts only.
        </p>
        {data.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Status</th>
                  <th>Published</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row._id}>
                    <td>
                      {en(row.title)} <span className="muted">/blog/{row.slug}</span>
                    </td>
                    <td>{row.status === 'published' ? <span className="badge badge--success">published</span> : <span className="badge">draft</span>}</td>
                    <td>{row.publishedAt ? dt(row.publishedAt) : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn--ghost btn--sm" onClick={() => setEdit({ ...blank(), ...row, relatedProducts: (row.relatedProducts ?? []).map(String) })}>
                        Edit
                      </button>
                      <button className="btn btn--ghost btn--sm" onClick={() => void remove(row)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No articles yet. Start with “Add starter guides” (three buying guides as drafts) or write a new article.</p>
        )}
      </Card>
      {edit ? (
        <Modal title={edit._id ? 'Edit article' : 'New article'} onClose={() => setEdit(null)} wide>
          <form className="form-grid form-grid--2" onSubmit={save}>
            <div className="span-2">
              <ErrorBox error={err} />
            </div>
            <LocInput label="Title" required value={edit.title} onChange={(v) => setEdit({ ...edit, title: v, slug: edit._id || edit.slug ? edit.slug : slugify(v.en) })} />
            <F label="Slug (URL)" hint="Lowercase letters, numbers and dashes, e.g. how-to-choose-a-power-bank">
              <input className="input" required value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value.toLowerCase() })} />
            </F>
            <F label="Status">
              <select className="select" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as 'draft' | 'published' })}>
                <option value="draft">Draft (not public)</option>
                <option value="published">Published</option>
              </select>
            </F>
            <LocInput label="Summary — the direct answer in 1–2 sentences (list card, Google and AI search)" textarea value={edit.excerpt} onChange={(v) => setEdit({ ...edit, excerpt: v })} />
            <div className="field span-2">
              <span className="label">Article</span>
              <span className="hint">Blank line = new paragraph · “### ” sub-heading · “- ” list item · **bold**</span>
              <div className="loc-pair">
                <label>
                  <span className="tag">العربية</span>
                  <textarea className="textarea" dir="rtl" lang="ar" rows={16} value={edit.body.ar} onChange={(e) => setEdit({ ...edit, body: { ...edit.body, ar: e.target.value } })} />
                </label>
                <label>
                  <span className="tag">ENGLISH</span>
                  <textarea className="textarea" dir="ltr" lang="en" rows={16} value={edit.body.en} onChange={(e) => setEdit({ ...edit, body: { ...edit.body, en: e.target.value } })} />
                </label>
              </div>
            </div>
            <MediaField label="Cover image (16:9, studio style)" kind="image" value={edit.coverImage.url} onChange={(url) => setEdit({ ...edit, coverImage: { ...edit.coverImage, url } })} />
            <div className="span-2">
              <ProductPicker label="Products in this article" value={edit.relatedProducts} onChange={(ids) => setEdit({ ...edit, relatedProducts: ids })} />
            </div>
            <F label="Tags (comma separated)">
              <input className="input" value={edit.tags.join(', ')} onChange={(e) => setEdit({ ...edit, tags: e.target.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) })} />
            </F>
            <F label="Author">
              <input className="input" value={edit.author} onChange={(e) => setEdit({ ...edit, author: e.target.value })} />
            </F>
            <F label="Publish date (empty = when published)">
              <input className="input" type="datetime-local" value={dateIn(edit.publishedAt)} onChange={(e) => setEdit({ ...edit, publishedAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </F>
            <LocInput label="SEO title (optional — default is the title)" value={edit.seo.title} onChange={(v) => setEdit({ ...edit, seo: { ...edit.seo, title: v } })} />
            <LocInput label="SEO description (optional — default is the summary)" value={edit.seo.description} onChange={(v) => setEdit({ ...edit, seo: { ...edit.seo, description: v } })} />
            <div className="actions span-2">
              <button className="btn btn--outline" type="button" onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button className="btn btn--primary" disabled={busy}>
                {edit.status === 'published' ? 'Save and publish' : 'Save draft'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
