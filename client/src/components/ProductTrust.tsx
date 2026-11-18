import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18n';
import { L } from '../lib/format';
import type { TrustItem } from '../lib/types';
import { useSettings } from '../state/settings';
import '../styles/productPhase4.css';
import { Icon } from './Icon';

const ICON: Record<TrustItem['icon'], string> = { shield: 'shield', return: 'return', truck: 'truck', support: 'chat' };

/**
 * Product-page trust benefits. Titles, descriptions, order, visibility and links come from
 * Admin → Website content → Product page trust (the four client-approved benefits by default);
 * nothing is shown when the list is empty.
 */
export function ProductTrust() {
  const { t, lang, p } = useI18n();
  const items = (useSettings()?.productTrust ?? []).filter((x) => x.visible !== false && L(x.title, lang));
  if (!items.length) return null;
  return (
    <ul className="cx-trust" aria-label={t.trust.label} data-testid="product-trust">
      {items.map((x, i) => {
        const title = L(x.title, lang);
        const description = L(x.description, lang);
        const link = x.link?.trim() ?? '';
        const href = link.startsWith('/') && !/^\/(ar|en)(\/|$)/.test(link) ? p(link) : link;
        return (
          <li key={i} className="cx-trust__item">
            <span className="cx-trust__icon" aria-hidden="true">
              <Icon name={ICON[x.icon] ?? 'shield'} />
            </span>
            <span className="cx-trust__text">
              <strong>{title}</strong>
              {description ? <span>{description}</span> : null}
              {href ? (
                href.startsWith('/') ? (
                  <Link to={href} className="cx-trust__more">
                    {t.trust.more}
                  </Link>
                ) : (
                  <a href={href} className="cx-trust__more" rel="noopener noreferrer" target="_blank">
                    {t.trust.more}
                  </a>
                )
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
