import { Router } from 'express';
import { ah, ok } from '../../lib/http';
import { BASE_CURRENCY, currencyForCountry } from './currencies';
import { detectCountry } from './geo';
import { getRates } from './rates.service';

export const currencyRoutes = Router();

/**
 * GET /api/currency/context — everything the storefront needs to show prices in the visitor's
 * currency, in one small request: detected country, its currency, and SAR-based display rates.
 *
 * The answer depends on the caller's IP, so it is never cached by shared caches (the /api default
 * Cache-Control: no-store applies); the browser keeps its own copy and refreshes it at most hourly.
 * `currency` is SAR whenever the country is unknown, unsupported or has no valid rate.
 */
currencyRoutes.get(
  '/currency/context',
  ah(async (req, res) => {
    const [{ country, source }, { set, stale }] = await Promise.all([detectCountry(req), getRates()]);
    const rates = set?.rates ?? { [BASE_CURRENCY]: 1 };
    const mapped = currencyForCountry(country);
    const currency = mapped && rates[mapped] ? mapped : BASE_CURRENCY;
    return ok(res, {
      base: BASE_CURRENCY,
      country,
      countrySource: source,
      currency,
      rates,
      ratesUpdatedAt: set ? new Date(set.fetchedAt).toISOString() : null,
      ratesStale: stale,
    });
  }),
);
