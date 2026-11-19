import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Crumbs, ErrorState, Spinner } from '../components/ui';
import { useI18n } from '../i18n/I18n';
import { L } from '../lib/format';
import { useCached } from '../lib/hooks';
import { responsiveImg } from '../lib/media';
import { RichText } from '../components/RichText';
import { useSeo } from '../lib/useSeo';
import type { HomeData } from '../lib/types';
import { useSettings } from '../state/settings';

export default function CustomerInfo({ mode }: { mode: 'about' | 'support' | 'contact' }) {
  const { t, lang, p } = useI18n();
  const settings = useSettings();
  const { data: home, error } = useCached<HomeData>('/api/home');
  const text = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const title = mode === 'about' ? text('About CELIBERY', 'عن سيليبري') : mode === 'contact' ? text('Contact us', 'تواصل معنا') : text('How can we help?', 'كيف يمكننا مساعدتك؟');
  useSeo(title);
  if (error && mode === 'about') return <ErrorState onRetry={() => window.location.reload()} />;
  if (!settings || (mode === 'about' && !home)) return <Spinner />;
  const business = settings.business;
  const contacts = [
    ...(business?.email ? [{ label: text('Email', 'البريد الإلكتروني'), value: business.email, href: `mailto:${business.email}` }] : []),
    ...(business?.phone ? [{ label: text('Phone', 'الهاتف'), value: business.phone, href: `tel:${business.phone}` }] : []),
    ...(business?.whatsappNumber ? [{ label: t.common.whatsapp, value: `+${business.whatsappNumber.replace(/\D/g, '')}`, href: `https://wa.me/${business.whatsappNumber.replace(/\D/g, '')}` }] : []),
  ];
  return <article className="container cx-info">
    <header className="cx-pagehead">
      <Crumbs items={[{ label: t.common.home, to: p('/') }, { label: title }]} />
      <span className="cx-eyebrow">CELIBERY INTERNATIONAL</span>
      <h1 className="cx-display">{title}</h1>
    </header>
    {mode === 'about' ? <section className="cx-info__story">
      <div>{L(home?.brandStory.text, lang) ? <RichText text={L(home?.brandStory.text, lang)} /> : null}
        <Link className="cx-btn cx-btn--solid" to={p('/shop')}>{t.nav.allProducts}</Link>
      </div>
      {home?.brandStory.imageUrl ? <img {...responsiveImg(home.brandStory.imageUrl, '(max-width: 767px) 100vw, 45vw')} alt={L(business?.name, lang) || 'CELIBERY'} decoding="async" /> : null}
    </section> : null}
    {mode !== 'about' ? <div className="cx-info__contacts">
      {contacts.map(contact => <a className="cx-info__card" key={contact.label} href={contact.href}>
        <span className="cx-eyebrow">{contact.label}</span><strong dir="ltr">{contact.value}</strong>
      </a>)}
    </div> : null}
    <nav className="cx-info__links" aria-label={t.footer.help}>
      {[
        [p('/faq'), text('Frequently asked questions', 'الأسئلة الشائعة')],
        [p('/track'), t.nav.track],
        [p('/page/shipping'), t.footer.shipping],
        [p('/page/warranty'), t.footer.warranty],
        [p('/page/returns'), t.footer.returns],
        [p('/account'), t.nav.account],
      ].map(([href, label]) => <Link className="cx-info__card" key={href} to={href}><strong>{label}</strong><Icon name="external" className="icon icon--inline icon--flip-rtl" /></Link>)}
    </nav>
  </article>;
}
