import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18n';
import { L } from '../lib/format';
import { useCached } from '../lib/hooks';
import type { HomeData } from '../lib/types';
import { useSettings, whatsappLink } from '../state/settings';
import { Logo } from './Logo';
import { PayLogos } from './ui';

const socialLabels: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  snapchat: 'Snapchat',
  x: 'X',
  youtube: 'YouTube',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
};

function SocialIcon({ platform }: { platform: string }) {
  const common = {
    className: `footer__social-icon footer__social-icon--${platform}`,
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    fill: 'currentColor',
    'aria-hidden': true as const,
    focusable: false as const,
  };

  switch (platform) {
    case 'instagram':
      return (
        <svg {...common}>
          <defs>
            <linearGradient id="celibery-instagram-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#FEDA75" />
              <stop offset="35%" stopColor="#FA7E1E" />
              <stop offset="65%" stopColor="#D62976" />
              <stop offset="100%" stopColor="#4F5BD5" />
            </linearGradient>
          </defs>
          <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="url(#celibery-instagram-gradient)" strokeWidth="2" />
          <circle cx="12" cy="12" r="4" fill="none" stroke="url(#celibery-instagram-gradient)" strokeWidth="2" />
          <circle cx="17.5" cy="6.5" r="1.2" fill="url(#celibery-instagram-gradient)" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg {...common}>
          <path d="M19.6 7.2a6.8 6.8 0 0 1-4.2-1.5v9.1a5.7 5.7 0 1 1-5-5.7v3.1a2.7 2.7 0 1 0 2 2.6V2.5h3a4 4 0 0 0 4.2 3.9v.8Z" />
        </svg>
      );
    case 'snapchat':
      return (
        <svg {...common}>
          <path d="M12 2.2c-3.1 0-5 2.4-5 5.6 0 1.1.1 2.1-.1 3.1-.2 1.2-1.2 2-2.6 2.5-.5.2-.8.4-.8.8 0 .6 1.2 1 2.4 1.2.5.1.7.5.9 1 .2.6.7.9 1.4.9.5 0 1-.2 1.7.1.7.3 1.2 1 2.1 1s1.4-.7 2.1-1c.7-.3 1.2-.1 1.7-.1.7 0 1.2-.3 1.4-.9.2-.5.4-.9.9-1 1.2-.2 2.4-.6 2.4-1.2 0-.4-.3-.6-.8-.8-1.4-.5-2.4-1.3-2.6-2.5-.2-1-.1-2-.1-3.1 0-3.2-1.9-5.6-5-5.6Z" />
        </svg>
      );
    case 'x':
      return (
        <svg {...common}>
          <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.7 5.6 22H2.4l7.3-8.4L1.8 2h6.5l4.5 6.7L18.9 2Zm-1.1 18h1.7L7.3 3.9H5.5L17.8 20Z" />
        </svg>
      );
    case 'youtube':
      return (
        <svg {...common}>
          <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z" />
        </svg>
      );
    case 'linkedin':
      return (
        <svg {...common}>
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.35V9h3.414v1.561h.049c.476-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zM3.555 9h3.564v11.452H3.555z" />
        </svg>
      );
    case 'facebook':
      return (
        <svg {...common}>
          <path d="M13.5 22v-8.9h3l.5-3.5h-3.5V7.4c0-1 .3-1.7 1.8-1.7h1.9V2.6c-.9-.1-1.8-.2-2.7-.2-2.7 0-4.6 1.7-4.6 4.8v2.4H6.8v3.5h3.1V22h3.6Z" />
        </svg>
      );
    default:
      return null;
  }
}
/**
 * Trust information required by Saudi e-commerce rules: seller name, address, CR and VAT
 * numbers and Saudi Business Center verification. Values come from Admin → Settings;
 * nothing is invented — missing values are shown as "coming soon".
 */
export function Footer() {
  const { t, p, lang } = useI18n();
  const s = useSettings();
  const { data: home } = useCached<HomeData>('/api/home');
  const b = s?.business;
  const wa = whatsappLink(b?.whatsappNumber);
  const social = Object.entries(b?.social ?? {}).filter(([, v]) => v);

  return (
    <footer className="footer cx-footer">
      <div className="container">
        <div className="footer__grid cx-footer__grid">
          <div className="cx-footer__brand">
            <Logo onDark />
            <p>{L(b?.name, lang)}</p>
            {L(b?.address, lang) ? <p>{L(b?.address, lang)}</p> : null}
            <ul>
              {wa ? (
                <li>
                  <a href={wa} target="_blank" rel="noopener noreferrer">
                    {t.common.whatsapp}: <span className="ltr">+{b?.whatsappNumber.replace(/\D/g, '')}</span>
                  </a>
                </li>
              ) : (
                <li>{t.common.whatsappMissing}</li>
              )}
              {b?.email ? (
                <li>
                  <a href={`mailto:${b.email}`} className="ltr">
                    {b.email}
                  </a>
                </li>
              ) : null}
              {b?.phone ? (
                <li>
                  <a href={`tel:${b.phone}`} className="ltr">
                    {b.phone}
                  </a>
                </li>
              ) : null}
              {L(b?.supportHours, lang) ? (
                <li>
                  {t.footer.hours}: {L(b?.supportHours, lang)}
                </li>
              ) : null}
            </ul>
            {social.length ? (
              <div className="footer__social" aria-label="Social media">
                {social.map(([k, v]) => {
                  const platform = k.toLowerCase();
                  const label = socialLabels[platform];
                  if (!label || typeof v !== 'string' || !v.trim()) return null;
                  return (
                    <a
                      key={platform}
                      href={v}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={label}
                      title={label}
                    >
                      <SocialIcon platform={platform} />
                    </a>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div>
            <h3>{t.footer.shop}</h3>
            <ul>
              {(home?.categories ?? []).map((c) => (
                <li key={c._id}>
                  <Link to={p(`/c/${c.slug}`)}>{L(c.name, lang)}</Link>
                </li>
              ))}
              <li>
                <Link to={p('/bundles')}>{t.nav.bundles}</Link>
              </li>
            </ul>
          </div>
          <div>
            <h3>{t.footer.help}</h3>
            <ul>
              <li>
                <Link to={p('/track')}>{t.nav.track}</Link>
              </li>
              <li>
                <Link to={p('/account')}>{t.nav.account}</Link>
              </li>
              <li>
                <Link to={p('/page/shipping')}>{t.footer.shipping}</Link>
              </li>
              <li>
                <Link to={p('/page/returns')}>{t.footer.returns}</Link>
              </li>
              <li>
                <Link to={p('/page/refunds')}>{t.footer.refunds}</Link>
              </li>
              <li>
                <Link to={p('/page/warranty')}>{t.footer.warranty}</Link>
              </li>
            </ul>
          </div>
          <div>
            <h3>{t.footer.policies}</h3>
            <ul>
              <li>
                <Link to={p('/page/privacy')}>{t.footer.privacy}</Link>
              </li>
              <li>
                <Link to={p('/page/terms')}>{t.footer.terms}</Link>
              </li>
            </ul>
            <h3 className="cx-footer__sub">{t.footer.payments}</h3>
            <PayLogos />
          </div>
        </div>
        <div className="cx-footer__word ltr" aria-hidden="true">
          CELIBERY
        </div>
        <div className="footer__legal cx-footer__legal">
          <span>
            © {new Date().getFullYear()} {L(b?.legalName, lang) || L(b?.name, lang)} — {t.footer.rights}
          </span>
          <span>
            {t.footer.cr}: <span className="ltr">{b?.crNumber || t.footer.pending}</span>
          </span>
          <span>
            {t.footer.vat}: <span className="ltr">{b?.vatNumber || t.footer.pending}</span>
          </span>
          {b?.sbcVerified ? (
            b.sbcVerificationUrl ? (
              <a href={b.sbcVerificationUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {b.sbcBadgeImageUrl ? <img src={b.sbcBadgeImageUrl} alt="" height={32} style={{ height: 32, width: 'auto' }} /> : null}
                {t.footer.sbc}
              </a>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {b.sbcBadgeImageUrl ? <img src={b.sbcBadgeImageUrl} alt="" height={32} style={{ height: 32, width: 'auto' }} /> : null}
                {t.footer.sbc}
              </span>
            )
          ) : null}
        </div>
      </div>
    </footer>
  );
}

export function WhatsAppFab({ raised = false }: { raised?: boolean }) {
  const s = useSettings();
  const { t } = useI18n();
  const link = whatsappLink(s?.business?.whatsappNumber);
  if (!link) return null; // only shown once the client's real number is configured (Q34)
  return (
    <a className={`wa-fab ${raised ? 'wa-fab--raised' : ''}`} href={link} target="_blank" rel="noopener noreferrer" aria-label={t.common.whatsapp}>
      <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
        <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm4.5 12.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3c.2-.6.2-1.1.1-1.3 0-.1-.2-.2-.4-.3Z" />
      </svg>
    </a>
  );
}


