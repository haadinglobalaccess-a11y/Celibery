import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18n';
import { ApiError, post } from '../lib/api';
import { formatDate } from '../lib/format';
import { useApi } from '../lib/hooks';
import { useAuth } from '../state/auth';
import { Field } from './ui';

type PublicReview = { _id: string; rating: number; title: string; body: string; displayName: string; lang: 'ar' | 'en'; createdAt: string };

/** Read-only star row; the accessible name carries the value. */
export function Stars({ value, label }: { value: number; label: string }) {
  const full = Math.round(value);
  return (
    <span className="cx-stars" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} aria-hidden="true" className={i <= full ? 'is-on' : ''}>
          ★
        </span>
      ))}
    </span>
  );
}

/**
 * Verified-purchase reviews (Q19). Rendered only while Admin → Settings → "Show reviews" is on.
 * The server decides who may review (a delivered order containing the product) and every review
 * waits for moderation in Admin → Website content → Reviews before it is shown.
 */
export function ProductReviews({ slug, summary }: { slug: string; summary: { average: number; count: number } }) {
  const { t, lang, p } = useI18n();
  const r = t.reviews;
  const { user } = useAuth();
  const { data, loading } = useApi<PublicReview[]>(`/api/products/${slug}/reviews`);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!rating) return setError(r.chooseRating);
    setBusy(true);
    setError('');
    try {
      await post(`/api/products/${slug}/reviews`, { rating, title, body, displayName, lang });
      setDone(r.thanks);
      setOpen(false);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      if (code === 'ALREADY_REVIEWED') setDone(r.already);
      else if (code === 'NOT_VERIFIED_PURCHASE') setError(r.notVerified);
      else setError(r.failed);
    } finally {
      setBusy(false);
    }
  };

  const average = summary.average.toFixed(1);
  return (
    <section className="cx-pdp__section cx-reviews" aria-labelledby="cx-reviews-title" data-testid="product-reviews">
      <div className="container cx-split">
        <div>
          <span className="cx-eyebrow">{t.product.reviews}</span>
          <h2 id="cx-reviews-title" className="cx-display">
            {r.title}
          </h2>
          {summary.count ? (
            <p className="cx-reviews__summary">
              <Stars value={summary.average} label={r.average(average)} />
              <strong className="ltr">{average}</strong>
              <span className="cx-muted">· {r.count(summary.count)}</span>
            </p>
          ) : null}
        </div>

        <div>
          {loading ? null : data?.length ? (
            <ul className="cx-reviews__list">
              {data.map((rv) => (
                <li key={rv._id} className="cx-reviews__item" lang={rv.lang}>
                  <div className="cx-reviews__head">
                    <Stars value={rv.rating} label={r.star(rv.rating)} />
                    {rv.title ? <strong>{rv.title}</strong> : null}
                  </div>
                  {rv.body ? <p className="cx-reviews__body">{rv.body}</p> : null}
                  <small className="cx-muted">
                    {rv.displayName || r.anonymous} · {r.verified} · {formatDate(rv.createdAt, lang)}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cx-muted">{r.none}</p>
          )}

          <div className="cx-reviews__write">
            {done ? (
              <p className="alert alert--success" role="status">
                {done}
              </p>
            ) : user?.type === 'customer' ? (
              open ? (
                <form className="form-grid" onSubmit={submit} noValidate>
                  <fieldset className="cx-reviews__rating">
                    <legend className="label">{r.rating}</legend>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <label key={n} className={n <= rating ? 'is-on' : ''} title={r.star(n)}>
                        <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} />
                        <span aria-hidden="true">★</span>
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
                  {error ? (
                    <p className="alert alert--error" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <button className="btn btn--primary" disabled={busy}>
                    {r.submit}
                  </button>
                </form>
              ) : (
                <>
                  <button className="btn btn--outline" onClick={() => setOpen(true)} data-testid="write-review">
                    {r.write}
                  </button>
                  <p className="cx-muted cx-reviews__note">{r.verifiedOnly}</p>
                </>
              )
            ) : (
              <p className="cx-muted">
                {r.loginPrompt} <Link to={p(`/login?next=${encodeURIComponent(`/${lang}/p/${slug}`)}`)}>{r.login}</Link>
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
