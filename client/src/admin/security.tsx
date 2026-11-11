import { useState, type FormEvent } from 'react';
import { Logo } from '../components/Logo';
import { ApiError, post } from '../lib/api';
import { useAuth } from '../state/auth';

/**
 * Two-factor authentication (TOTP) for staff accounts: set-up with any authenticator app
 * (Google Authenticator, Microsoft Authenticator, 1Password…), one-time recovery codes, and
 * switching it off. All checks happen on the server (/api/auth/mfa/*); this is only the form.
 */
export function MfaSettings() {
  const { user, refresh } = useAuth();
  const enabled = Boolean(user?.mfa?.enabled);
  const required = Boolean(user?.mfa?.required);
  const [step, setStep] = useState<'idle' | 'password' | 'scan' | 'codes' | 'disable'>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const start = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setSetup(await post<{ secret: string; otpauthUrl: string }>('/api/auth/mfa/setup', { password }));
      setPassword('');
      setStep('scan');
    });
  };
  const confirm = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await post<{ recoveryCodes: string[] }>('/api/auth/mfa/enable', { code });
      setCodes(r.recoveryCodes);
      setCode('');
      setSetup(null);
      setStep('codes');
    });
  };
  const disable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await post('/api/auth/mfa/disable', { password, code });
      setPassword('');
      setCode('');
      setStep('idle');
      await refresh();
    });
  };
  const finish = () => {
    setCodes([]);
    setStep('idle');
    void refresh();
  };

  const secretGroups = setup?.secret.match(/.{1,4}/g)?.join(' ') ?? '';

  return (
    <section className="a-fieldset" data-testid="mfa-settings" dir="ltr" lang="en">
      <h3 style={{ fontSize: 15, margin: '0 0 6px' }}>Two-factor authentication</h3>
      <p className="a-muted" style={{ marginTop: 0 }}>
        {enabled ? 'On — signing in needs your password and a code from your authenticator app.' : 'Off — protect this account with a code from an authenticator app on your phone.'}
        {required && !enabled ? ' It is required for staff accounts.' : ''}
      </p>
      {error ? <p className="alert alert--error">{error}</p> : null}

      {step === 'idle' && !enabled ? (
        <button type="button" className="btn btn--primary" onClick={() => setStep('password')} data-testid="mfa-start">
          Set up two-factor authentication
        </button>
      ) : null}
      {step === 'idle' && enabled && !required ? (
        <button type="button" className="btn" onClick={() => setStep('disable')}>
          Turn off
        </button>
      ) : null}

      {step === 'password' ? (
        <form className="form-grid" onSubmit={start}>
          <label className="field">
            <span className="label">Confirm your password</span>
            <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="btn btn--primary" disabled={busy}>
            Continue
          </button>
        </form>
      ) : null}

      {step === 'scan' && setup ? (
        <form className="form-grid" onSubmit={confirm}>
          <ol style={{ paddingInlineStart: 18, margin: 0 }}>
            <li>Open your authenticator app and add an account with this setup key (time-based):</li>
          </ol>
          <code className="ltr" style={{ fontSize: 16, letterSpacing: 1, userSelect: 'all', wordBreak: 'break-all' }} data-testid="mfa-secret">
            {secretGroups}
          </code>
          <p className="a-muted" style={{ margin: 0 }}>
            On a phone you can also <a href={setup.otpauthUrl}>open the setup link</a>. Never share this key.
          </p>
          <label className="field">
            <span className="label">2. Enter the 6-digit code the app shows</span>
            <input className="input" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </label>
          <button className="btn btn--primary" disabled={busy}>
            Turn on
          </button>
        </form>
      ) : null}

      {step === 'codes' ? (
        <div className="form-grid">
          <p className="alert alert--warning" style={{ margin: 0 }}>
            Save these recovery codes somewhere safe. Each one signs you in once if you lose your phone. They will not be shown again.
          </p>
          <pre className="ltr" style={{ margin: 0, userSelect: 'all' }} data-testid="mfa-recovery-codes">
            {codes.join('\n')}
          </pre>
          <button type="button" className="btn btn--primary" onClick={finish}>
            I have saved them
          </button>
        </div>
      ) : null}

      {step === 'disable' ? (
        <form className="form-grid" onSubmit={disable}>
          <label className="field">
            <span className="label">Password</span>
            <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Current 6-digit code</span>
            <input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </label>
          <button className="btn" disabled={busy}>
            Turn off two-factor authentication
          </button>
        </form>
      ) : null}
    </section>
  );
}

/** Shown instead of the dashboard while two-factor authentication is mandatory and not set up yet. */
export function MfaEnrollmentGate() {
  const { logout } = useAuth();
  return (
    <div className="admin-login">
      <div className="a-card form-grid" style={{ maxWidth: 480 }}>
        <Logo />
        <h1 style={{ fontSize: 20 }}>Set up two-factor authentication</h1>
        <p className="a-muted">Staff accounts must use two-factor authentication. Set it up to continue to the dashboard.</p>
        <MfaSettings />
        <button type="button" className="btn" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
