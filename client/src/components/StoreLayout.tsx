import { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { I18nProvider, useI18n } from '../i18n/I18n';
import { useCached } from '../lib/hooks';
import { useLuxuryHeadings } from '../lib/motion';
import type { HomeData } from '../lib/types';
import { Footer, WhatsAppFab } from './Footer';
import { Header } from './Header';

function Shell() {
  useLuxuryHeadings();
  const { t } = useI18n();
  const { pathname } = useLocation();
  const { data: home } = useCached<HomeData>('/api/home');
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  const hasSample = home?.featured.some((p) => p.dataSource === 'demo') || home?.categoryProducts.some((c) => c.items.some((p) => p.dataSource === 'demo'));
  const isProduct = /\/p\//.test(pathname);
  return (
    <>
      <a className="skip-link" href="#main">
        {t.skipToContent}
      </a>
      {hasSample ? <div className="sample-banner">{t.home.sampleNotice}</div> : null}
      <Header />
      <span key={`bar-${pathname}`} className="route-bar" aria-hidden="true" />
      <main id="main" tabIndex={-1}>
        {/* Keyed by path so each page plays the entrance transition */}
        <div key={pathname} className="page">
          <Outlet />
        </div>
      </main>
      <Footer />
      <WhatsAppFab raised={isProduct} />
    </>
  );
}

/** /:lang/* — validates the language segment and provides translations + direction. */
export function StoreLayout() {
  const { lang } = useParams();
  const { pathname, search } = useLocation();
  if (lang !== 'ar' && lang !== 'en') {
    return <Navigate to={`/ar${pathname}${search}`} replace />;
  }
  return (
    <I18nProvider lang={lang}>
      <Shell />
    </I18nProvider>
  );
}
