import { useSettings } from '../state/settings';

/**
 * Single logo component used everywhere so the mark is always identical.
 *
 * Source of truth, in order:
 *  1. A logo uploaded in Admin → Settings → Brand (logoUrl / logoDarkUrl) — the admin always wins.
 *  2. The client-supplied CELIBERY mark (turquoise wordmark with lightning-cut E's), cropped and
 *     optimised from docs/brand/celibery-logo-original.png into /public/brand. The turquoise reads on
 *     both the white header and the near-black hero/footer, so one colourway serves light and dark.
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
    <span className="logo logo--brand">
      <img
        src="/brand/celibery-logo-480.webp"
        srcSet="/brand/celibery-logo-480.webp 480w, /brand/celibery-logo-960.webp 960w"
        sizes="(min-width: 960px) 160px, 128px"
        width={480}
        height={107}
        alt="CELIBERY International"
        decoding="async"
      />
    </span>
  );
}
