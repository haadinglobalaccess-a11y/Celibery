import { useI18n } from '../i18n/I18n';
import { currencyName, currencySymbol } from '../lib/currency';
import { setCurrency, useCurrency } from '../state/currency';

/**
 * Header currency selector: a small pill showing the current code (same look as the language
 * switch), with a native <select> over it, so it opens the platform picker on phones and is fully
 * keyboard/screen-reader accessible. "Automatic" returns to country-based detection.
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
        value={c.mode === 'manual' ? c.code : 'auto'}
        onChange={(e) => setCurrency(e.target.value === 'auto' ? null : e.target.value)}
        data-testid="currency-select"
      >
        <option value="auto">{t.currency.auto(c.detected)}</option>
        {c.available.map((code) => (
          <option key={code} value={code}>
            {label(code)}
          </option>
        ))}
      </select>
    </label>
  );
}
