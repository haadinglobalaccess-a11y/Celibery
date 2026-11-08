import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Field } from '../components/ui';
import { useI18n } from '../i18n/I18n';
import { ApiError, post } from '../lib/api';
import { useSeo } from '../lib/useSeo';
import { useAuth } from '../state/auth';

function safeNext(next: string | null, lang: string) {
  // Only allow internal paths (prevents open redirects).
  if (!next || !next.startsWith('/') || next.startsWith('//')) return `/${lang}/account`;
  return /^\/(ar|en)\//.test(next) ? next : `/${lang}${next}`;
}

export function Login() {
  const { t, p, lang } = useI18n();
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useSeo(t.auth.login, undefined, { noindex: true });
  if (user?.type === 'customer') return <Navigate to={safeNext(params.get('next'), lang)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      nav(safeNext(params.get('next'), lang), { replace: true });
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  };
  return (
    <div className="container auth-box">
      <h1>{t.auth.login}</h1>
      <form className="form-grid" onSubmit={submit}>
        <Field label={t.auth.email}>
          <input className="input" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t.auth.password}>
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error ? (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="btn btn--primary btn--lg" disabled={busy}>
          {t.auth.login}
        </button>
        <Link to={p('/forgot-password')} className="muted" style={{ textDecoration: 'underline' }}>
          {t.auth.forgot}
        </Link>
        <p className="muted">
          {t.auth.noAccount}{' '}
          <Link to={p(`/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`)} style={{ textDecoration: 'underline', color: 'var(--ink)' }}>
            {t.auth.register}
          </Link>
        </p>
      </form>
    </div>
  );
}

export function Register() {
  const { t, p, lang } = useI18n();
  const { register, user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', marketingOptIn: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useSeo(t.auth.register, undefined, { noindex: true });
  if (user?.type === 'customer') return <Navigate to={safeNext(params.get('next'), lang)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) {
      setError(t.auth.passwordHint);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await register({ ...form, phone: form.phone.replace(/\s/g, '') || undefined, lang });
      nav(safeNext(params.get('next'), lang), { replace: true });
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  };
  return (
    <div className="container auth-box">
      <h1>{t.auth.register}</h1>
      <form className="form-grid" onSubmit={submit}>
        <Field label={t.auth.name}>
          <input className="input" autoComplete="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label={t.auth.email}>
          <input className="input" type="email" dir="ltr" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label={t.auth.phone} hint={t.checkout.phoneHint}>
          <input className="input" type="tel" dir="ltr" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label={t.auth.password} hint={t.auth.passwordHint}>
          <input className="input" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={form.marketingOptIn} onChange={(e) => setForm({ ...form, marketingOptIn: e.target.checked })} /> {t.auth.marketing}
        </label>
        {error ? (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="btn btn--primary btn--lg" disabled={busy}>
          {t.auth.register}
        </button>
        <p className="muted">
          {t.auth.haveAccount}{' '}
          <Link to={p('/login')} style={{ textDecoration: 'underline', color: 'var(--ink)' }}>
            {t.auth.login}
          </Link>
        </p>
      </form>
    </div>
  );
}

export function ForgotPassword() {
  const { t, lang } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  useSeo(t.auth.resetTitle, undefined, { noindex: true });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await post('/api/auth/forgot-password', { email, lang }).catch(() => undefined);
    setSent(true);
    setBusy(false);
  };
  return (
    <div className="container auth-box">
      <h1>{t.auth.resetTitle}</h1>
      {sent ? (
        <p className="alert alert--success">{t.auth.linkSent}</p>
      ) : (
        <form className="form-grid" onSubmit={submit}>
          <p className="muted">{t.auth.resetText}</p>
          <Field label={t.auth.email}>
            <input className="input" type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <button className="btn btn--primary" disabled={busy}>
            {t.auth.sendLink}
          </button>
        </form>
      )}
    </div>
  );
}

export function ResetPasswordForm({ onDone, loginHref }: { onDone?: () => void; loginHref: string }) {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await post('/api/auth/reset-password', { token, password });
      setDone(true);
      onDone?.();
    } catch (err) {
      setError((err as ApiError).message);
    }
  };
  if (done)
    return (
      <p className="alert alert--success">
        {t.auth.passwordChanged}{' '}
        <Link to={loginHref} style={{ textDecoration: 'underline' }}>
          {t.auth.login}
        </Link>
      </p>
    );
  return (
    <form className="form-grid" onSubmit={submit}>
      <Field label={t.auth.newPassword} hint={t.auth.passwordHint}>
        <input className="input" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error ? <p className="alert alert--error">{error}</p> : null}
      <button className="btn btn--primary">{t.auth.setPassword}</button>
    </form>
  );
}

export function ResetPassword() {
  const { t, p } = useI18n();
  useSeo(t.auth.resetTitle, undefined, { noindex: true });
  return (
    <div className="container auth-box">
      <h1>{t.auth.resetTitle}</h1>
      <ResetPasswordForm loginHref={p('/login')} />
    </div>
  );
}
