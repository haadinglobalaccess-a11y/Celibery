import { useI18n } from '../i18n/I18n';
import { currencyName, currencySymbol } from '../lib/currency';
import { setCurrency, useCurrency } from '../state/currency';

/**
 * Header currency selector: a small pill showing the current code (same look as the language
 * switch), with a native <select> over it, so it opens the platform picker on phones and is fully
 * keyboard/screen-reader accessible. No "Automatic by country" line: the country currency is the default.
 */
export function CurrencySelect() {
  const { t, lang } = useI18n();
  const c = useCurrency();
  const label = (code: string) => {
    const symbol = currencySymbol(code, lang);
    return `${code}${symbol && symbol !== code ? ` · ${symbol}` : ''} — ${currencyName(code, lang)}`;
  };
  return (
    <label className="lang-switch currency-switch" data-testid="currency-switch" title={t.currency.label}>
      <span aria-hidden="true" className="ltr">
        {c.code}
      </span>
      <select
        className="currency-switch__select"
        aria-label={`${t.currency.label}: ${c.code}`}
        value={c.code}
        onChange={(e) => setCurrency(e.target.value)}
        data-testid="currency-select"
      >
        {/* Currencies only: the visitor's country currency is simply shown as selected. */}
        {(c.available.includes(c.code) ? c.available : [c.code, ...c.available]).map((code) => (
          <option key={code} value={code}>
            {label(code)}
          </option>
        ))}
      </select>
    </label>
  );
}
