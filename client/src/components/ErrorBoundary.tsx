import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../lib/errorReporting';

/**
 * Last line of defence for rendering errors: without it, one failing component unmounts the whole
 * React tree and the visitor sees a blank page. Shows a bilingual message with "Try again" and
 * "Home" instead. It is reset on navigation (App passes the pathname as `resetKey`).
 *
 * After a deploy, an open tab may request a page chunk the new deploy removed ("Failed to fetch
 * dynamically imported module"). That case reloads the page once so the visitor gets the new build.
 *
 * Deliberately self-contained (no i18n/settings context): those providers may be what failed.
 */
type Props = { children: ReactNode; resetKey?: string };
type State = { error: Error | null };

const RELOAD_FLAG = 'cel_chunk_reload';
const isChunkError = (e: Error) => /dynamically imported module|Loading chunk|Importing a module script failed|error loading dynamically/i.test(`${e?.name} ${e?.message}`);

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkError(error)) {
      let reloaded: boolean;
      try {
        reloaded = sessionStorage.getItem(RELOAD_FLAG) === '1';
        if (!reloaded) sessionStorage.setItem(RELOAD_FLAG, '1');
      } catch {
        reloaded = true; // storage blocked: never risk a reload loop
      }
      if (!reloaded) {
        window.location.reload();
        return;
      }
    }
    // eslint-disable-next-line no-console
    console.error('Render error', error, info.componentStack);
    reportError(error, { source: 'react' });
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const en = window.location.pathname.startsWith('/en');
    const admin = window.location.pathname.startsWith('/admin');
    return (
      <div className="container not-found" role="alert" dir={en || admin ? 'ltr' : 'rtl'} lang={en || admin ? 'en' : 'ar'} style={{ padding: '64px 16px', textAlign: 'center' }}>
        <h1 style={{ marginBottom: 12 }}>{en || admin ? 'Something went wrong' : 'حدث خطأ غير متوقع'}</h1>
        <p style={{ marginBottom: 24 }}>
          {en || admin ? 'This page could not be displayed. Please try again.' : 'تعذّر عرض هذه الصفحة. يرجى المحاولة مرة أخرى.'}
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            {en || admin ? 'Try again' : 'إعادة المحاولة'}
          </button>
          <a className="btn btn--outline" href={admin ? '/admin' : en ? '/en' : '/ar'}>
            {en || admin ? 'Home' : 'الرئيسية'}
          </a>
        </div>
      </div>
    );
  }
}
