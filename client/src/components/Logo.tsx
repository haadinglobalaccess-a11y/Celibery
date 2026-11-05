import { useSettings } from '../state/settings';

/**
 * Single logo component used everywhere so the mark is always identical.
 * Q9: the client will supply its logo; until an image is uploaded in Admin → Settings → Brand,
 * a typographic wordmark is shown. Upload light (logoUrl) and dark (logoDarkUrl) versions.
 */
export function Logo({ onDark = false }: { onDark?: boolean }) {
  const s = useSettings();
  const src = onDark ? s?.brand?.logoDarkUrl || s?.brand?.logoUrl : s?.brand?.logoUrl || s?.brand?.logoDarkUrl;
  if (src) {
    return (
      <span className="logo">
        <img src={src} alt="CELIBERY International" />
      </span>
    );
  }
  return (
    <span className="logo" aria-label="CELIBERY International">
      CELIBERY <small>INTERNATIONAL</small>
    </span>
  );
}
