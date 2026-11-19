import { useState, type FormEvent } from 'react';
import { ApiError, del, patch, post, put, qs } from '../../lib/api';
import { useApi, useDebounced } from '../../lib/hooks';
import type { Localized } from '../../lib/types';
import { useToast } from '../../state/toast';
import { AHead, dt, EmptyState, ErrorBox, ErrorPanel, F, Modal, Pager, ProductPicker, SkeletonTable } from '../kit';
import { MediaField } from '../media';

/**
 * Admin → Reviews. Site reviews come from signed-in customers with a delivered order (shown as
 * verified purchases); staff approve, reject, hide or delete them but never edit them. Staff can
 * also enter REAL reviews customers gave on WhatsApp, Instagram, by phone… — published with their
 * source shown ("Shared on WhatsApp"), never labelled verified. Only approved reviews are public
 * and counted. Actions are audit-logged.
 */
type Row = {
  _id: string;
  rating: number;
  title: string;
  body: string;
  displayName: string;
  lang: string;
  status: 'pending' | 'approved' | 'rejected' | 'hidden';
  images?: { url: string }[];
  reportCount?: number;
  reports?: { reason?: string; at?: string }[];
  editedAt?: string;
  moderationNote?: string;
  createdAt: string;
  product?: { _id: string; sku: string; slug: string; name: Localized } | null;
  customer?: { name: string; email: string } | null;
  order?: { orderNumber: string } | null;
  source?: string;
  evidenceUrl?: string;
};

const SOURCES: [string, string][] = [
  ['whatsapp', 'WhatsApp'],
  ['instagram', 'Instagram'],
  ['tiktok', 'TikTok'],
  ['facebook', 'Facebook'],
  ['snapchat', 'Snapchat'],
  ['email', 'Email'],
  ['phone', 'Phone call'],
  ['store', 'In store'],
  ['other', 'Other'],
];
const sourceLabel = (s?: string) => SOURCES.find(([k]) => k === s)?.[1] ?? 'Other';
const isStaffEntered = (r: Row) => Boolean(r.source && r.source !== 'customer');
type Payload = { items: Row[]; total: number; page: number; pages: number; counts: Record<string, number> };

const STATUS_LABEL: Record<Row['status'], string> = { pending: 'Pending', approved: 'Published', rejected: 'Rejected', hidden: 'Hidden' };
const TONE: Record<Row['status'], string> = { pending: 'st--cod', approved: 'st--paid', rejected: 'st--negative', hidden: 'st--neutral' };

export function ReviewsModeration() {
  const [status, setStatus] = useState<'' | Row['status']>('pending');
  const [rating, setRating] = useState('');
  const [reported, setReported] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [nonce, setNonce] = useState(0);
  const query = useDebounced(q.trim(), 300);
  const { data, error, loading, reload } = useApi<Payload>(`/api/admin/reviews${qs({ status: status || undefined, rating: rating || undefined, reported: reported ? '1' : undefined, q: query || undefined, page, r: nonce })}`);
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState<Row | 'new' | null>(null);

  const act = async (r: Row, next: 'approved' | 'rejected' | 'hidden') => {
    const note = next === 'approved' ? '' : (window.prompt(next === 'rejected' ? 'Reason for rejecting (internal, optional):' : 'Why is it hidden? (internal, optional)') ?? null);
    if (note === null) return;
    setBusy(r._id);
    try {
      await patch(`/api/admin/reviews/${r._id}`, { status: next, note });
      toast(next === 'approved' ? 'Review published' : next === 'rejected' ? 'Review rejected' : 'Review hidden');
      setNonce((n) => n + 1);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not update the review', 'error');
    } finally {
      setBusy('');
    }
  };
  const remove = async (r: Row) => {
    if (!window.confirm('Delete this review permanently? Its photos are deleted too. This cannot be undone.')) return;
    setBusy(r._id);
    try {
      await del(`/api/admin/reviews/${r._id}`);
      toast('Review deleted');
      setNonce((n) => n + 1);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not delete the review', 'error');
    } finally {
      setBusy('');
    }
  };

  const c = data?.counts ?? {};
  const tabs: ['' | Row['status'], string][] = [
    ['pending', `Pending (${c.pending ?? 0})`],
    ['approved', `Published (${c.approved ?? 0})`],
    ['hidden', `Hidden (${c.hidden ?? 0})`],
    ['rejected', `Rejected (${c.rejected ?? 0})`],
    ['', 'All'],
  ];

  return (
    <div className="a-page" data-testid="admin-reviews">
      <AHead title="Reviews">
        <button type="button" className="btn btn--primary btn--sm" onClick={() => setEditing('new')} data-testid="review-add">
          + Add customer review
        </button>
      </AHead>
      <p className="a-muted" style={{ marginTop: -8 }}>
        Reviews written on the site come from customers with a delivered order (verified purchase); new and edited ones wait here. Use <strong>Add customer review</strong> for real reviews customers sent on WhatsApp, Instagram or by phone —
        they are published with their source shown (for example “Shared on WhatsApp”). Only published reviews appear on the store and count in ratings.
      </p>
      {editing ? <StaffReviewForm row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), setNonce((n) => n + 1))} /> : null}
      <div className="a-card a-card--flush">
        <div className="a-filterbar" role="search">
          <div className="a-filterbar__tabs" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tabs.map(([k, label]) => (
              <button key={k || 'all'} type="button" className={`btn btn--sm ${status === k ? 'btn--primary' : 'btn--ghost'}`} onClick={() => (setStatus(k), setPage(1))}>
                {label}
              </button>
            ))}
            <button type="button" className={`btn btn--sm ${reported ? 'btn--primary' : 'btn--ghost'}`} onClick={() => (setReported((x) => !x), setPage(1))} aria-pressed={reported}>
              Reported ({c.reported ?? 0})
            </button>
          </div>
          <label className="a-filterbar__search">
            <span className="sr-only">Search reviews</span>
            <input className="a-input" type="search" maxLength={100} placeholder="Search text, name, product or SKU" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} data-testid="review-search" />
          </label>
          <select className="a-select" value={rating} onChange={(e) => (setRating(e.target.value), setPage(1))} aria-label="Rating">
            <option value="">All ratings</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} ★
              </option>
            ))}
          </select>
        </div>

        {error ? <ErrorPanel onRetry={reload} /> : null}
        {loading && !data ? <SkeletonTable rows={4} cols={4} /> : null}
        {data && !data.items.length ? <EmptyState title="No reviews here" text={status === 'pending' ? 'Nothing is waiting for moderation.' : 'No reviews match these filters.'} /> : null}

        {data?.items.map((r) => (
          <article key={r._id} className="a-card" style={{ margin: 12 }} data-testid="review-row">
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <strong style={{ color: '#d18f00' }} aria-label={`${r.rating} of 5`}>
                  {'★'.repeat(r.rating)}
                  <span style={{ color: '#ccc' }}>{'★'.repeat(5 - r.rating)}</span>
                </strong>{' '}
                <span className={`st ${TONE[r.status]}`}>
                  <span className="st__dot" aria-hidden="true" />
                  {STATUS_LABEL[r.status]}
                </span>
                {r.reportCount ? <span className="st st--negative" style={{ marginInlineStart: 6 }}>{r.reportCount} report(s)</span> : null}
                {r.editedAt ? <span className="a-muted" style={{ marginInlineStart: 6, fontSize: 12 }}>edited {dt(r.editedAt)}</span> : null}
              </div>
              <span className="a-muted" style={{ fontSize: 12 }}>
                {dt(r.createdAt)}
              </span>
            </div>
            <div style={{ margin: '8px 0' }} dir={r.lang === 'ar' ? 'rtl' : 'ltr'} lang={r.lang}>
              {r.title ? <strong>{r.title}</strong> : null}
              {r.body ? <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{r.body}</p> : <p className="a-muted" style={{ margin: '4px 0 0' }}>(no text)</p>}
            </div>
            {r.images?.length ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {r.images.map((im) => (
                  <a key={im.url} href={im.url} target="_blank" rel="noreferrer">
                    <img src={im.url} alt="Customer photo" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8 }} />
                  </a>
                ))}
              </div>
            ) : null}
            <p className="a-muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
              {r.product ? (
                <>
                  <a href={`/en/p/${r.product.slug}`} target="_blank" rel="noreferrer">
                    {r.product.name?.en || r.product.name?.ar}
                  </a>{' '}
                  ({r.product.sku}) ·{' '}
                </>
              ) : null}
              {isStaffEntered(r) ? (
                <>
                  Shown as “{r.displayName || 'Customer'}” · <strong>Shared on {sourceLabel(r.source)}</strong> (entered by staff)
                  {r.evidenceUrl ? (
                    <>
                      {' '}·{' '}
                      <a href={r.evidenceUrl} target="_blank" rel="noreferrer">
                        original message
                      </a>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  Shown as “{r.displayName || 'Customer'}” · {r.customer?.name} &lt;{r.customer?.email}&gt; · verified order {r.order?.orderNumber ?? '—'}
                </>
              )}
            </p>
            {r.reports?.length ? (
              <p className="a-muted" style={{ fontSize: 12 }}>
                Report reasons: {r.reports.map((x) => x.reason || '(none given)').join(' · ')}
              </p>
            ) : null}
            {r.moderationNote ? <p className="a-muted" style={{ fontSize: 12 }}>Note: {r.moderationNote}</p> : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {r.status !== 'approved' ? (
                <button className="btn btn--primary btn--sm" disabled={busy === r._id} onClick={() => act(r, 'approved')} data-testid="review-approve">
                  {r.status === 'hidden' ? 'Publish again' : 'Approve'}
                </button>
              ) : (
                <button className="btn btn--outline btn--sm" disabled={busy === r._id} onClick={() => act(r, 'hidden')}>
                  Hide
                </button>
              )}
              {r.status === 'pending' ? (
                <button className="btn btn--outline btn--sm" disabled={busy === r._id} onClick={() => act(r, 'rejected')}>
                  Reject
                </button>
              ) : null}
              {isStaffEntered(r) ? (
                <button className="btn btn--outline btn--sm" disabled={busy === r._id} onClick={() => setEditing(r)}>
                  Edit
                </button>
              ) : null}
              <button className="btn btn--ghost btn--sm" style={{ color: 'var(--danger, #b42318)' }} disabled={busy === r._id} onClick={() => remove(r)}>
                Delete
              </button>
            </div>
          </article>
        ))}
        {data && data.pages > 1 ? <Pager page={data.page} pages={data.pages} onPage={setPage} /> : null}
      </div>
    </div>
  );
}

/** Enter (or correct) a real review a customer gave on WhatsApp, Instagram, by phone… */
function StaffReviewForm({ row, onClose, onSaved }: { row: Row | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [productIds, setProductIds] = useState<string[]>(row?.product?._id ? [row.product._id] : []);
  const [displayName, setDisplayName] = useState(row?.displayName ?? '');
  const [rating, setRating] = useState(row?.rating ?? 5);
  const [title, setTitle] = useState(row?.title ?? '');
  const [body, setBody] = useState(row?.body ?? '');
  const [lang, setLang] = useState<'ar' | 'en'>(row?.lang === 'en' ? 'en' : 'ar');
  const [source, setSource] = useState(row?.source && row.source !== 'customer' ? row.source : 'whatsapp');
  const [receivedAt, setReceivedAt] = useState(row?.createdAt ? row.createdAt.slice(0, 10) : '');
  const [evidenceUrl, setEvidenceUrl] = useState(row?.evidenceUrl ?? '');
  const [photos, setPhotos] = useState<string[]>([...(row?.images ?? []).map((i) => i.url), '', '', ''].slice(0, 3));
  const [err, setErr] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!row && !productIds.length) {
      setErr(new Error('Choose the product this review is about'));
      return;
    }
    setSaving(true);
    const payload = {
      displayName: displayName.trim(),
      rating,
      title: title.trim(),
      body: body.trim(),
      lang,
      source,
      receivedAt: receivedAt ? new Date(`${receivedAt}T12:00:00`).toISOString() : null,
      evidenceUrl,
      imageUrls: photos.filter(Boolean),
    };
    try {
      if (row) await put(`/api/admin/reviews/${row._id}`, payload);
      else await post('/api/admin/reviews', { ...payload, productId: productIds[productIds.length - 1] });
      toast(row ? 'Review updated' : 'Review published');
      onSaved();
    } catch (ex) {
      setErr(ex);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={row ? 'Edit customer review' : 'Add a customer review'} onClose={onClose} wide>
      <form className="form-grid form-grid--2" onSubmit={save} data-testid="staff-review-form">
        <p className="a-muted span-2" style={{ margin: 0, fontSize: 13 }}>
          Copy a real review a customer sent you — on WhatsApp, Instagram, by phone or in store — in the customer’s own words and with their rating. It is published right away, with its source shown to shoppers (for example “Shared on
          WhatsApp”), and counts in the product rating.
        </p>
        <div className="span-2">
          <ErrorBox error={err} />
        </div>
        {row ? (
          <p className="span-2" style={{ margin: 0 }}>
            Product: <strong>{row.product?.name?.en || row.product?.name?.ar}</strong> <span className="a-muted ltr">({row.product?.sku})</span>
          </p>
        ) : (
          <ProductPicker label="Product" value={productIds.slice(-1)} onChange={(ids) => setProductIds(ids.slice(-1))} />
        )}
        <F label="Customer name to show" hint="As the customer is happy to be shown, e.g. “Ahmed K.”">
          <input className="input" required maxLength={60} value={displayName} onChange={(e) => setDisplayName(e.target.value)} data-testid="staff-review-name" />
        </F>
        <F label="Where the customer shared it">
          <select className="select" value={source} onChange={(e) => setSource(e.target.value)} data-testid="staff-review-source">
            {SOURCES.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </F>
        <div className="field">
          <span className="label">Rating the customer gave</span>
          <div role="radiogroup" aria-label="Rating" style={{ display: 'flex', gap: 4 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                onClick={() => setRating(n)}
                style={{ fontSize: 28, lineHeight: 1, padding: 2, border: 0, background: 'none', cursor: 'pointer', color: n <= rating ? '#e0a100' : '#d5d9de' }}
              >
                ★
              </button>
            ))}
          </div>
        </div>
        <F label="Date the customer gave it (optional)">
          <input className="input" type="date" max={new Date().toISOString().slice(0, 10)} value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
        </F>
        <F label="Language of the review">
          <select className="select" value={lang} onChange={(e) => setLang(e.target.value === 'en' ? 'en' : 'ar')}>
            <option value="ar">Arabic</option>
            <option value="en">English</option>
          </select>
        </F>
        <F label="Title (optional)">
          <input className="input" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} dir={lang === 'ar' ? 'rtl' : 'ltr'} />
        </F>
        <F label="Review text (the customer’s words)" span>
          <textarea className="input" required rows={5} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} dir={lang === 'ar' ? 'rtl' : 'ltr'} data-testid="staff-review-body" />
        </F>
        <MediaField label="Screenshot of the original message (staff only, optional)" kind="image" value={evidenceUrl} onChange={(u) => setEvidenceUrl(u)} hint="Kept as a record; never shown on the store." />
        {photos.map((url, i) => (
          <MediaField key={i} label={`Customer photo ${i + 1} (optional, shown with the review)`} kind="image" value={url} onChange={(u) => setPhotos(photos.map((x, j) => (j === i ? u : x)))} />
        ))}
        <div className="span-2" style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--primary" disabled={saving} data-testid="staff-review-save">
            {saving ? 'Saving…' : row ? 'Save changes' : 'Publish review'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
