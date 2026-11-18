import { useId, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n/I18n';
import { post } from '../lib/api';
import { errorText } from '../lib/apiErrors';
import { useAuth } from '../state/auth';
import '../styles/productPhase4.css';
import { Icon } from './Icon';

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** "Notify me when restocked" — shown only while the product is out of stock. */
export function RestockForm({ slug }: { slug: string }) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const customerEmail = user?.type === 'customer' ? user.email : '';
  const [email, setEmail] = useState(customerEmail);
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState('');
  const id = useId();
  const r = t.restock;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_RX.test(value)) {
      setError(r.invalidEmail);
      return;
    }
    setError('');
    setState('busy');
    try {
      await post(`/api/products/${slug}/restock`, { email: value, lang });
      setState('done');
    } catch (err) {
      setError(errorText(err, t, lang));
      setState('idle');
    }
  };

  if (state === 'done')
    return (
      <div className="cx-restock cx-restock--done" role="status" data-testid="restock-done">
        <Icon name="check" className="icon" />
        <span>{r.success}</span>
      </div>
    );

  return (
    <form className="cx-restock" onSubmit={submit} noValidate data-testid="restock-form">
      <div className="cx-restock__head">
        <Icon name="bolt" className="icon" />
        <div>
          <strong>{r.title}</strong>
          <span>{customerEmail ? r.account(customerEmail) : r.text}</span>
        </div>
      </div>
      <div className="cx-restock__row">
        <label className="sr-only" htmlFor={id}>
          {r.email}
        </label>
        <input
          id={id}
          className="cx-restock__input"
          type="email"
          inputMode="email"
          autoComplete="email"
          dir="ltr"
          placeholder={r.email}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-err` : undefined}
          data-testid="restock-email"
        />
        <button className="cx-btn cx-btn--solid cx-restock__btn" disabled={state === 'busy'} data-testid="restock-submit">
          {state === 'busy' ? r.sending : r.submit}
        </button>
      </div>
      {error ? (
        <p id={`${id}-err`} className="cx-restock__error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
