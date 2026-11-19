import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18n';
import { apiUrl, del, post, put } from '../lib/api';
import { errorText } from '../lib/apiErrors';
import { formatDate } from '../lib/format';
import { useApi } from '../lib/hooks';
import { useAuth } from '../state/auth';
import '../styles/phase5.css';
import { Icon } from './Icon';
import { Field } from './ui';

type PublicReview = { id: string; rating: number; title: string; body: string; displayName: string; lang: 'ar' | 'en'; images: { url: string }[]; verifiedPurchase: boolean; createdAt: string; editedAt: string | null };
type Mine = { enabled: boolean; canReview: boolean; uploadsEnabled: boolean; review: (Omit<PublicReview, 'images'> & { status: string; images: { url: string; mediaId: string }[] }) | null };
type Summary = { average: number; count: number; distribution?: Record<'1' | '2' | '3' | '4' | '5', number> };
type Photo = { id: string; url: string };

/** Read-only star row; the accessible name carries the value. */
export function Stars({ value, label }: { value: number; label: string }) {
  const full = Math.round(value);
  return (
    <span className="cx-stars" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} aria-hidden="true" className={i <= full ? 'is-on' : ''}>
          <Icon name="star" className="icon icon--star" />
        </span>
      ))}
    </span>
  );
}

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Uploads one review photo through the verified media pipeline (owner-checked on the server). */
async function uploadPhoto(file: File): Promise<Photo> {
  const start = await post<{ assetId: string; upload: { url: string; headers: Record<string, string>; direct: boolean } }>('/api/reviews/uploads', { filename: file.name, contentType: file.type, size: file.size });
  const res = await fetch(start.upload.direct ? start.upload.url : apiUrl(start.upload.url), {
    method: 'PUT',
    headers: start.upload.direct ? start.upload.headers : { 'Content-Type': file.type, 'X-Requested-With': 'celibery' },
    credentials: start.upload.direct ? 'omit' : 'include',
    body: file,
  });
  if (!res.ok) throw new Error('upload');
  const done = await post<{ id: string; url: string }>(`/api/reviews/uploads/${start.assetId}/complete`, {});
  return { id: done.id, url: done.url };
}

/**
 * Verified-purchase reviews (Q19). Rendered only while Admin → Settings → "Show reviews" is on.
 * The server decides who may review (a delivered order containing the product); new and edited
 * reviews wait for moderation (Admin → Reviews) before they are shown or counted.
 */
export function ProductReviews({ slug, summary }: { slug: string; summary: Summary }) {
  const { t, lang, p } = useI18n();
  const r = t.reviews;
  const { user } = useAuth();
  const isCustomer = user?.type === 'customer';
  const [nonce, setNonce] = useState(0);
  const [filter, setFilter] = useState(0);
  const { data, loading } = useApi<PublicReview[]>(`/api/products/${slug}/reviews${filter ? `?rating=${filter}` : ''}`);
  const mine = useApi<Mine>(isCustomer ? `/api/products/${slug}/reviews/mine?r=${nonce}` : null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const [reported, setReported] = useState<Set<string>>(new Set());
  const average = summary.average.toFixed(1);
  const dist = summary.distribution;
  const own = mine.data?.review ?? null;

  const report = async (id: string) => {
    if (!window.confirm(r.reportConfirm)) return;
    try {
      await post(`/api/reviews/${id}/report`, {});
    } catch {
      /* already reported or not allowed: same quiet outcome */
    }
    setReported((s) => new Set(s).add(id));
  };
  const remove = async () => {
    if (!window.confirm(r.deleteConfirm)) return;
    try {
      await del(`/api/products/${slug}/reviews/mine`);
      setNotice(r.deleted);
      setNonce((n) => n + 1);
    } catch (e) {
      setNotice(errorText(e, t, lang));
    }
  };

  return (
    <section className="cx-pdp__section cx-reviews" aria-labelledby="cx-reviews-title" data-testid="product-reviews">
      <div className="container cx-split">
        <div>
          <span className="cx-eyebrow">{t.product.reviews}</span>
          <h2 id="cx-reviews-title" className="cx-display">
            {r.title}
          </h2>
          {summary.count ? (
            <>
              <p className="cx-reviews__summary">
                <Stars value={summary.average} label={r.average(average)} />
                <strong className="ltr">{average}</strong>
                <span className="cx-muted">· {r.count(summary.count)}</span>
              </p>
              {dist ? (
                <ul className="rv-dist" data-testid="review-distribution">
                  {([5, 4, 3, 2, 1] as const).map((s) => {
                    const n = dist[String(s) as '1'] ?? 0;
                    return (
                      <li key={s}>
                        <button type="button" className={`rv-dist__row ${filter === s ? 'is-on' : ''}`} onClick={() => setFilter(filter === s ? 0 : s)} aria-pressed={filter === s} aria-label={r.distribution(s, n)} disabled={!n && filter !== s}>
                          <span className="rv-dist__label ltr">{s}<Icon name="star" className="icon icon--star" /></span>
                          <span className="rv-dist__bar" aria-hidden="true">
                            <span style={{ width: `${summary.count ? (n / summary.count) * 100 : 0}%` }} />
                          </span>
                          <span className="rv-dist__n ltr">{n}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>

        <div>
          {notice ? (
            <p className="alert alert--success" role="status">
              {notice}
            </p>
          ) : null}

          {own && !editing ? (
            <div className="rv-own" data-testid="my-review">
              <div className="rv-own__head">
                <strong>{r.yours}</strong>
                <span className={`rv-status rv-status--${own.status}`}>{r.status[own.status] ?? own.status}</span>
              </div>
              <Stars value={own.rating} label={r.star(own.rating)} />
              {own.title ? <p className="rv-own__title">{own.title}</p> : null}
              {own.status !== 'approved' ? <p className="cx-muted rv-own__note">{r.statusNote}</p> : null}
              <div className="rv-own__actions">
                <button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing(true)} data-testid="edit-review">
                  {r.edit}
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={remove} data-testid="delete-review">
                  {r.delete}
                </button>
              </div>
            </div>
          ) : null}

          {filter ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFilter(0)}>
              {r.filterAll}
            </button>
          ) : null}
          {loading ? null : data?.length ? (
            <ul className="cx-reviews__list">
              {data.map((rv) => (
                <li key={rv.id} className="cx-reviews__item rv-card" lang={rv.lang} dir={rv.lang === 'ar' ? 'rtl' : 'ltr'}>
                  <div className="cx-reviews__head">
                    <Stars value={rv.rating} label={r.star(rv.rating)} />
                    {rv.title ? <strong>{rv.title}</strong> : null}
                  </div>
                  {rv.body ? <p className="cx-reviews__body">{rv.body}</p> : null}
                  {rv.images?.length ? (
                    <div className="rv-photos">
                      {rv.images.map((im, i) => (
                        <a key={im.url} href={im.url} target="_blank" rel="noopener noreferrer">
                          <img src={im.url} alt={r.photoAlt(i + 1)} loading="lazy" decoding="async" />
                        </a>
                      ))}
                    </div>
                  ) : null}
                  <div className="rv-meta">
                    <small className="cx-muted">
                      {rv.displayName || r.anonymous} · {formatDate(rv.createdAt, lang)}
                    </small>
                    {rv.verifiedPurchase ? <span className="rv-verified"><Icon name="check" className="icon icon--inline" /> {r.verified}</span> : null}
                    {isCustomer && own?.id !== rv.id ? (
                      reported.has(rv.id) ? (
                        <small className="cx-muted">{r.reported}</small>
                      ) : (
                        <button type="button" className="rv-report" onClick={() => report(rv.id)}>
                          {r.report}
                        </button>
                      )
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cx-muted">{r.none}</p>
          )}

          <div className="cx-reviews__write">
            {!isCustomer ? (
              <p className="cx-muted">
                {r.loginPrompt} <Link to={p(`/login?next=${encodeURIComponent(`/${lang}/p/${slug}`)}`)}>{r.login}</Link>
              </p>
            ) : editing && own ? (
              <ReviewForm
                slug={slug}
                initial={own}
                uploadsEnabled={Boolean(mine.data?.uploadsEnabled)}
                onCancel={() => setEditing(false)}
                onDone={() => {
                  setEditing(false);
                  setNotice(r.updated);
                  setNonce((n) => n + 1);
                }}
              />
            ) : mine.data?.canReview ? (
              <ReviewForm
                slug={slug}
                uploadsEnabled={Boolean(mine.data?.uploadsEnabled)}
                onDone={() => {
                  setNotice(r.thanks);
                  setNonce((n) => n + 1);
                }}
              />
            ) : !own ? (
              <p className="cx-muted cx-reviews__note">{r.verifiedOnly}</p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function ReviewForm({ slug, initial, uploadsEnabled, onDone, onCancel }: { slug: string; initial?: Mine['review']; uploadsEnabled: boolean; onDone: () => void; onCancel?: () => void }) {
  const { t, lang } = useI18n();
  const r = t.reviews;
  const [open, setOpen] = useState(Boolean(initial));
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [photos, setPhotos] = useState<Photo[]>((initial?.images ?? []).filter((i) => i.mediaId).map((i) => ({ id: i.mediaId, url: i.url })));
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const addPhotos = async (files: File[]) => {
    setError('');
    for (const f of files.slice(0, 3 - photos.length)) {
      if (!PHOTO_TYPES.includes(f.type) || f.size > 5 * 1024 * 1024) {
        setError(r.photoType);
        continue;
      }
      setUploading(true);
      try {
        const ph = await uploadPhoto(f);
        setPhotos((x) => [...x, ph].slice(0, 3));
      } catch (e) {
        setError(e instanceof Error && e.message === 'upload' ? r.failed : errorText(e, t, lang));
      } finally {
        setUploading(false);
      }
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!rating) return setError(r.chooseRating);
    setBusy(true);
    setError('');
    const payload = { rating, title, body, displayName, lang, imageIds: photos.map((x) => x.id) };
    try {
      if (initial) await put(`/api/products/${slug}/reviews/mine`, payload);
      else await post(`/api/products/${slug}/reviews`, payload);
      onDone();
    } catch (err) {
      setError(errorText(err, t, lang));
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <>
        <button className="btn btn--outline" onClick={() => setOpen(true)} data-testid="write-review">
          {r.write}
        </button>
        <p className="cx-muted cx-reviews__note">{r.statusNote}</p>
      </>
    );

  return (
    <form className="form-grid" onSubmit={submit} noValidate data-testid="review-form">
      <fieldset className="cx-reviews__rating">
        <legend className="label">{r.rating}</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={n <= rating ? 'is-on' : ''} title={r.star(n)}>
            <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} />
            <span aria-hidden="true"><Icon name="star" className="icon icon--star" /></span>
            <span className="sr-only">{r.star(n)}</span>
          </label>
        ))}
      </fieldset>
      <Field label={r.titleLabel}>
        <input className="input" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={r.bodyLabel}>
        <textarea className="input" rows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <Field label={r.nameLabel} hint={r.nameHint}>
        <input className="input" maxLength={60} autoComplete="nickname" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </Field>
      {uploadsEnabled ? (
        <div className="field">
          <span className="label">{r.photos}</span>
          <div className="rv-photos rv-photos--edit">
            {photos.map((ph, i) => (
              <span key={ph.id} className="rv-photo">
                <img src={ph.url} alt={r.photoAlt(i + 1)} />
                <button type="button" aria-label={r.removePhoto} onClick={() => setPhotos((x) => x.filter((y) => y.id !== ph.id))}>
                  <Icon name="close" className="icon icon--inline" />
                </button>
              </span>
            ))}
            {photos.length < 3 ? (
              <button type="button" className="rv-photo rv-photo--add" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? r.uploading : `+ ${r.addPhoto}`}
              </button>
            ) : null}
          </div>
          <input ref={fileRef} type="file" hidden accept={PHOTO_TYPES.join(',')} multiple onChange={(e) => e.target.files && void addPhotos([...e.target.files])} data-testid="review-photo-input" />
        </div>
      ) : null}
      {error ? (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="rv-own__actions">
        <button className="btn btn--primary" disabled={busy || uploading} data-testid="submit-review">
          {initial ? r.save : r.submit}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            {r.cancel}
          </button>
        ) : null}
      </div>
    </form>
  );
}
