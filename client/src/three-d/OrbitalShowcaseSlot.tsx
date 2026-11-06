import { Component, lazy, Suspense, useId, type ReactNode } from 'react';
import type { ProductCardData } from '../lib/types';
import { useMediaQuery } from '../lib/media';
import { useI18n } from '../i18n/I18n';

const OrbitalShowcase = lazy(() => import('./OrbitalShowcase'));
class AnimationBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

/** Request the animation chunk when products arrive; shopping renders independently. */
export function OrbitalShowcaseSlot({ products, loading }: { products: ProductCardData[]; loading: boolean }) {
  const titleId = useId();
  const { lang } = useI18n();
  const phone = useMediaQuery('(max-width: 599px)');
  const tablet = useMediaQuery('(max-width: 959px)');
  const present = loading || products.length > 0;
  if (!present) return null;
  return <section className="section cel-holosphere" aria-labelledby={titleId}>
    <div className="section__head">
      <div>
        <h2 id={titleId} lang={lang}>{lang === 'ar' ? 'سيليبيري هولوسفير' : 'Celibery HoloSphere'}</h2>
        <p className="muted section__lead" lang={lang}>{lang === 'ar' ? 'اكتشف ما وراء المألوف' : 'Explore Beyond the Ordinary'}</p>
      </div>
    </div>
    <div className="cel-orbit-slot" aria-busy={loading} style={{ position: 'relative', height: phone ? 470 : tablet ? 520 : 560, marginBlock: 0, borderRadius: phone ? 'var(--r-lg)' : 'var(--r-xl)', overflow: 'hidden', isolation: 'isolate', background: 'var(--surface)' }}>
    {products.length > 0 && <AnimationBoundary><Suspense fallback={null}><OrbitalShowcase products={products} loading={loading} /></Suspense></AnimationBoundary>}
    </div>
  </section>;
}


