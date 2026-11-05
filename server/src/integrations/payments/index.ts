import { env, isProd } from '../../config/env';
import { integration } from '../credentials';
import { moyasarProvider } from './moyasar';
import { sandboxProvider } from './sandbox';
import { tabbyProvider } from './tabby';
import type { PaymentProvider } from './types';

export type OnlineMethod = 'card' | 'applepay' | 'stcpay' | 'tabby';

export const sandboxAllowed = () => !isProd || env.ALLOW_SANDBOX_PAYMENTS;

/**
 * Which gateway handles card / Apple Pay / STC Pay right now:
 *  - Moyasar when an administrator enabled it in Admin → Settings → Payments, or (legacy) when
 *    PAYMENT_GATEWAY=moyasar with MOYASAR_* environment variables;
 *  - otherwise the sandbox simulator, only where it is allowed (development / private staging);
 *  - otherwise none (online card payment unavailable).
 */
export function effectiveCardGateway(): 'moyasar' | 'sandbox' | 'none' {
  const m = integration('moyasar');
  if (moyasarProvider.isConfigured() && (m.source === 'admin' || env.PAYMENT_GATEWAY === 'moyasar')) return 'moyasar';
  if (env.PAYMENT_GATEWAY === 'sandbox' && sandboxAllowed()) return 'sandbox';
  return 'none';
}

/**
 * Chooses the provider for a payment method. Tabby uses its own adapter once it is enabled in the
 * admin (or configured through legacy environment variables with a real card gateway); in
 * sandbox development every method is simulated.
 * To add Tap / HyperPay / PayTabs: implement PaymentProvider and register it here.
 */
export function providerFor(method: OnlineMethod): PaymentProvider | null {
  const card = effectiveCardGateway();
  if (method === 'tabby') {
    const t = integration('tabby');
    if (tabbyProvider.isConfigured() && (t.source === 'admin' || env.PAYMENT_GATEWAY !== 'sandbox')) return tabbyProvider;
    return card === 'sandbox' ? sandboxProvider : null;
  }
  if (card === 'moyasar') return moyasarProvider;
  if (card === 'sandbox') return sandboxProvider;
  return null;
}

export function providerByName(name: string): PaymentProvider | null {
  if (name === 'sandbox') return sandboxProvider;
  if (name === 'moyasar') return moyasarProvider;
  if (name === 'tabby') return tabbyProvider;
  return null;
}

export type { PaymentProvider } from './types';
