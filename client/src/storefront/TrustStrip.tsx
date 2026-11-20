import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/I18n';
import { L } from '../lib/format';
import { useMoney } from '../state/currency';
import { useSettings } from '../state/settings';

type ServicePromise = { key: 'delivery' | 'warranty' | 'payment' | 'support'; icon: string; t: string; d: string };

/** The store's service promises. Every one follows Admin → Settings: nothing is claimed that the
 *  store cannot deliver. Shared by the trust strip and the "Why CELIBERY" tiles. */
export function useServicePromises(): ServicePromise[] {
  const { t, lang } = useI18n();
  const money = useMoney();
  const settings = useSettings();
  const commerce = settings?.commerce;
  const [delivery, warranty, payment, support] = t.home.why;
  const deliveryItem = !commerce || commerce.freeDelivery !== false
    ? delivery
    : {
        t: t.product.shipping,
        d: commerce.freeDeliveryThreshold
          ? t.checkout.freeFrom(money(commerce.freeDeliveryThreshold))
          : L(commerce.estimatedDelivery, lang) || (commerce.courierName ? t.product.deliveryBy(commerce.courierName) : ''),
      };
  const pay = settings?.payments;
  const methods = pay ? (['card', 'applepay', 'stcpay', 'tabby', 'cod'] as const).filter((m) => pay[m]).map((m) => t.home.payNames[m]) : [];
  return [
    { key: 'delivery', icon: 'truck', ...deliveryItem },
    ...(commerce?.warrantyEnabled && commerce.warrantyMonths ? [{ key: 'warranty' as const, icon: 'shield' as const, t: t.service.warranty(commerce.warrantyMonths), d: warranty.d }] : []),
    ...(methods.length ? [{ key: 'payment' as const, icon: 'lock' as const, t: payment.t, d: `${methods.join(t.home.listJoin)}.` }] : []),
    ...(settings?.business?.whatsappNumber ? [{ key: 'support' as const, icon: 'chat' as const, ...support }] : []),
  ];
}

/** UGREEN-style service strip: a quiet band of promises that drifts sideways (static with reduced
 *  motion). The list is rendered four times so the loop stays seamless on wide screens; the copies are hidden from
 *  assistive tech. */
export function TrustStrip() {
  const items = useServicePromises();
  if (!items.length) return null;
  const row = (hidden: boolean) => (
    <ul className="cx-trust__row" aria-hidden={hidden || undefined}>
      {items.map((w) => (
        <li key={w.key} className="cx-trust__item">
          <Icon name={w.icon} />
          <span>{w.t}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="cx-trust">
      <div className="cx-trust__track">
        {row(false)}
        {row(true)}
        {row(true)}
        {row(true)}
      </div>
    </div>
  );
}
