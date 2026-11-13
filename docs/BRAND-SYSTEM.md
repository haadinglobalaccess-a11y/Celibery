# CELIBERY brand system (storefront)

Updated 13 November 2026. Source of truth: the client's answers Q1, Q2, Q4, Q5, Q6, Q8 and Q9 in *CELIBERY Website Questions and KSA Recommendations*, plus the client-supplied logo `docs/brand/celibery-logo-original.png`.

## Colour

| Token | Value | Use |
|---|---|---|
| `--brand-turquoise` / `--accent` | `#00B1C0` | Signature accent: offers, eyebrows, active states, focus, hero CTA hover. Measured from the logo (median of all opaque pixels `#02B1C0`). |
| `--accent-ink` | `#111111` | Text **on** a turquoise fill. White on turquoise is only 2.6:1 and fails WCAG AA. |
| `--accent-text` | turquoise mixed 68% with black (≈ `#007883`, 5.2:1 on white) | Turquoise-coloured **text** on light surfaces. Inside dark sections (`.is-dark`, `.cine`, footer) it resolves to the raw turquoise (≈7:1 on `#111`). |
| `--brand-midnight` / `--ink` | `#111111` | Primary text, primary buttons, dark sections |
| `--brand-graphite` / `--dark-3` | `#242B30` | Elevated dark surfaces, graphite spotlights, sample-data notice |
| `--brand-cloud` / `--surface` | `#F5F7F8` | Light shopping surfaces |
| `--brand-steel` | `#707A80` | Icons and rules. Body text uses `--muted` `#5F686D`, because steel is 4.4:1 on white, just under AA. |
| `--brand-ice` | `#D9F8FA` | Quiet accent washes |
| `--saudi-green` | `#006C35` | National Day campaign only, never as the brand accent |

Admin → Settings → Brand can still set a different accent. `state/settings.tsx` then chooses `--accent-ink` (`#111` or `#fff`) by contrast. The server's original default `#2563EB` was a placeholder, so the storefront treats it as unset.

## Type

Manrope (Latin, variable 400–800) and IBM Plex Sans Arabic (400–700), both under the SIL Open Font License, loaded from Google Fonts without blocking first paint. Arabic body text uses `--lh-ar: 1.8`. Digits are Western (Q11).

## Logo

`<Logo>` (`client/src/components/Logo.tsx`) uses the admin upload if there is one. Otherwise it shows `/brand/celibery-logo-480.webp` (960w for 2×), which is the client PNG cropped to its content. The turquoise wordmark works on the white header and on the near-black hero and footer, so one colourway is used for both. The source logo has no SVG yet (Q9): a true vector recreation is still outstanding.

## Surfaces and imagery

- **Hybrid theme (Q1).** Shopping pages are light: shop, category, search and collection headers use only the light tones (`porcelain`, `mist`, `sand`). The dark tones (`obsidian`, `graphite`, `midnight`) are reserved for homepage premium sections, the PDP "At a glance" band and the footer.
- **One image stage.** Product cards, the product gallery and bag lines all present products on the Cloud surface (`--surface`). Cut-out imagery (white-background product photography and the placeholder drawings in `public/placeholders/`) is multiplied onto it, so each product sits on one seamless tile. Full-bleed campaign artwork keeps its own matte (`--cx-art-matte`).
- **Product photography brief.** Shoot on pure white (`#FFFFFF`), with the whole product in frame and no cropping, in square 1:1 format. The site removes the white automatically.
- **Header.** Over the hero the header is transparent. Once the page is scrolled on desktop, it becomes a 92% white bar so it stays clean over dark sections.

## Rules

- One accent. Use it for highlights, not for whole sections. Dark spotlights are graphite or midnight with at most an 18% turquoise glow.
- Primary purchase buttons stay near-black; turquoise marks offers and confirmation states, such as "Added to cart".
- Never use green or blue in place of the turquoise.
