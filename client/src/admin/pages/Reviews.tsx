import { useState } from 'react';
import { ApiError, del, patch, qs } from '../../lib/api';
import { useApi, useDebounced } from '../../lib/hooks';
import type { Localized } from '../../lib/types';
import { useToast } from '../../state/toast';
import { AHead, dt, EmptyState, ErrorPanel, Pager, SkeletonTable } from '../kit';

/**
 * Admin → Reviews. Every review comes from a signed-in customer with a delivered order for the
 * product (the order is shown); staff can approve, reject, hide or delete — never write or edit
 * customer reviews. Only approved reviews are public and counted. Actions are audit-logged.
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
};
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
      <AHead title="Reviews" />
      <p className="a-muted" style={{ marginTop: -8 }}>
        Only customers with a delivered order can review a product, so every review is a verified purchase. New and edited reviews wait here; only published reviews appear on the store and count in ratings.
      </p>
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
              Shown as “{r.displayName || 'Customer'}” · {r.customer?.name} &lt;{r.customer?.email}&gt; · verified order {r.order?.orderNumber ?? '—'}
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
